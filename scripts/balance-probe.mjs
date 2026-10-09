#!/usr/bin/env node
// scripts/balance-probe.mjs —— 对局平衡基线探针
//
// 目的：在改动地产机制前，先用真实引擎量出当前平衡基线，避免"照文档抄数字"。
// 做法：自带与 smoke.test.mjs 共用的轻量 DOM 桩（scripts/dom-stub.mjs），驱动真实 ES
//       模块跑完整全 AI 对局，统计终局净值 / 存活人数 / 终局回合 / 持有地产数。
//
// 用法：
//   node scripts/balance-probe.mjs                    # 默认 20 局对抗
//   node scripts/balance-probe.mjs --games 40        # 指定局数
//   node scripts/balance-probe.mjs --players 4       # 4 人局
//   node scripts/balance-probe.mjs --caps 1500        # 初始资金
//   node scripts/balance-probe.mjs --json            # 仅输出 JSON，便于对比存档
//   node scripts/balance-probe.mjs --save base.json   # 同时写入基线文件
//
// 退出码：正常出基线为 0；0 局跑完时为 1（基线是 NaN/Infinity，不可用）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub, loadModule } from './dom-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
const numArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const GAMES = Math.max(1, numArg('--games', 20));
const PLAYERS = Math.max(2, Math.min(4, numArg('--players', 4)));
const CAPS = numArg('--caps', 1500);
const AS_JSON = args.includes('--json');
const saveIdx = args.indexOf('--save');
const SAVE_TO = saveIdx >= 0 && args[saveIdx + 1] ? args[saveIdx + 1] : null;

// DOM / window / fetch 桩：与 smoke.test.mjs、scripts/subtype-test.mjs 共用
// scripts/dom-stub.mjs。alert 保持默认静默 —— 本工具做统计，不做断言。
const { getEl, tick } = installDomStub({ root: ROOT });

// ---------------- 载入真实模块 ----------------
const load = f => loadModule(ROOT, f);
const data = await load('data.js');
const state = await load('state.js');
const rules = await load('rules.js');
const view = await load('view.js');
const game = await load('game.js');

await data.loadContent();
view.initView();
view.buildSetup();

// ---------------- 跑一局 ----------------
async function runOne() {
  getEl('mode').value = 'versus';
  for (let i = 0; i < 4; i++) getEl('slot' + i).value = i < PLAYERS ? 'ai' : 'off';
  getEl('startCaps').value = String(CAPS);
  data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
  data.shuffleBoard();
  game.startGame();
  const t0 = Date.now();
  let ticks = 0;
  while (!state.G.gameOver && Date.now() - t0 < 20000) { await tick(); ticks++; }
  const players = state.G.players.map(p => ({
    net: Math.round(rules.netWorth(p)),
    bankrupt: !!p.bankrupt,
    owned: data.TILES.filter(t => t.owner === p.id && t.type === 'prop').length,
  }));
  const nets = players.map(p => p.net);
  return {
    finished: state.G.gameOver,
    turn: state.G.turn ?? null,
    ticks,
    survivors: players.filter(p => !p.bankrupt).length,
    bankruptCount: players.filter(p => p.bankrupt).length,
    topNet: Math.max(...nets),
    medianNet: nets.slice().sort((a, b) => a - b)[Math.floor(nets.length / 2)],
    ownedTotal: players.reduce((a, p) => a + p.owned, 0),
  };
}

// ---------------- 统计 ----------------
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.75)]; };
const runs = [];
const t0 = Date.now();
for (let i = 0; i < GAMES; i++) {
  try { runs.push(await runOne()); }
  catch (e) { console.error(`game ${i + 1} failed:`, e && e.message); }
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const finished = runs.filter(r => r.finished);
// 零局跑完时 Math.min(...[]) = Infinity、0/0 = NaN，下面整份基线都会是垃圾数字，
// 而本工具此前退出码恒为 0，CI / 人工都无法察觉。宁可硬失败，也不要产出看似正常的基线。
if (!finished.length) {
  console.error(`\n!! 0 / ${GAMES} 局跑完 —— 基线不可用，已中止（不写出、不打印）。`);
  console.error('   先看上面逐条 "game N failed:" 的报错，修复后再跑。');
  process.exit(1);
}
const tops = finished.map(r => r.topNet);
const turns = finished.map(r => r.turn).filter(v => typeof v === 'number');

const report = {
  meta: { games: GAMES, players: PLAYERS, startCaps: CAPS, finished: finished.length, elapsedSec: elapsed },
  topNet: { min: Math.min(...tops), median: med(tops), p75: pct(tops), max: Math.max(...tops) },
  medianNet: { median: med(finished.map(r => r.medianNet)) },
  survivors: { mean: +(finished.reduce((a, r) => a + r.survivors, 0) / finished.length).toFixed(2), allAlive: finished.filter(r => r.survivors === PLAYERS).length },
  bankrupt: { total: finished.reduce((a, r) => a + r.bankruptCount, 0), gamesWithAny: finished.filter(r => r.bankruptCount > 0).length },
  turns: turns.length ? { min: Math.min(...turns), median: med(turns), max: Math.max(...turns) } : null,
  ownedTotal: { median: med(finished.map(r => r.ownedTotal)) },
  // 单次收租占终局净值的比例：平衡设计的锚点
  peakRentPctOfNet: +(78 / med(tops) * 100).toFixed(2),   // 普通 prop Lv2+垄断 = 26x3
  cap8pctOfNet: Math.round(med(tops) * 0.08),             // 8% 上限对应的绝对金额
  runs,
};

if (SAVE_TO) {
  const p = path.isAbsolute(SAVE_TO) ? SAVE_TO : path.join(ROOT, SAVE_TO);
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.error('baseline written -> ' + path.relative(ROOT, p));
}
if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log('\n=== BALANCE BASELINE (' + PLAYERS + 'P, ' + GAMES + ' games, ' + elapsed + 's) ===');
  console.log('finished: ' + finished.length + '/' + GAMES);
  console.log('top net worth : min ' + report.topNet.min + ' | median ' + report.topNet.median + ' | p75 ' + report.topNet.p75 + ' | max ' + report.topNet.max);
  console.log('median net worth (per player) : ' + report.medianNet.median);
  if (report.turns) console.log('final turn : min ' + report.turns.min + ' | median ' + report.turns.median + ' | max ' + report.turns.max);
  console.log('survivors avg ' + report.survivors.mean + ' | all-alive games ' + report.survivors.allAlive + '/' + finished.length);
  console.log('bankruptcies : total ' + report.bankrupt.total + ' | games with any ' + report.bankrupt.gamesWithAny);
  console.log('props owned at end (median) : ' + report.ownedTotal.median);
  console.log('\n--- balance anchors ---');
  console.log('normal prop Lv2+monopoly (78) = ' + report.peakRentPctOfNet + '% of median top net worth');
  console.log('8% cap for extreme single rent = ' + report.cap8pctOfNet + ' caps');
  console.log('\n(compare with docs/v1.8.0-plan.md; a >15% median shift means balance moved)');
}
process.exit(0);