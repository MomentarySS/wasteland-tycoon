#!/usr/bin/env node
// scripts/balance-probe.mjs —— 对局平衡基线探针
//
// 目的：在改动地产机制前，先用真实引擎量出当前平衡基线，避免"照文档抄数字"。
// 做法：自带与 smoke.test.mjs 同源的轻量 DOM 桩，驱动真实 ES 模块跑完整全 AI 对局，
//       统计终局净值 / 存活人数 / 终局回合 / 持有地产数。
//
// 用法：
//   node scripts/balance-probe.mjs                    # 默认 20 局对抗
//   node scripts/balance-probe.mjs --games 40        # 指定局数
//   node scripts/balance-probe.mjs --players 4       # 4 人局
//   node scripts/balance-probe.mjs --caps 1500        # 初始资金
//   node scripts/balance-probe.mjs --json            # 仅输出 JSON，便于对比存档
//   node scripts/balance-probe.mjs --save base.json   # 同时写入基线文件
//
// 退出码恒为 0（这是测量工具，不做断言）；回归判定见 docs/v1.8.0-plan.md。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// ---------------- 加速：所有 setTimeout 走 setImmediate ----------------
global.setTimeout = (fn) => setImmediate(() => fn());

// ---------------- 轻量 DOM 桩（与 smoke.test.mjs 同源）----------------
const cache = {};
const mkStyle = () => ({ setProperty(k, v) { this[k] = v; } });
function mkEl(id) {
  return {
    id, _html: '', textContent: '', value: '', style: mkStyle(), dataset: {}, children: [],
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    set innerHTML(v) { this._html = String(v); this.children.length = 0; }, get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    prepend(c) { this.children.unshift(c); if (this.children.length > 400) this.children.length = 400; return c; },
    insertBefore(c, ref) { if (!ref) { this.children.push(c); } else { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); } return c; },
    get firstChild() { return this.children[0] || null; },
    remove() { }, addEventListener() { }, removeEventListener() { }, setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
    querySelector() { return null; }, querySelectorAll() { return []; },
    get offsetWidth() { return 1; }, focus() { }, scrollIntoView() { },
    getBoundingClientRect() { return { top: 0, left: 0, width: 54, height: 54 }; },
    set onclick(fn) { this._onclick = fn; }, get onclick() { return this._onclick; },
  };
}
const getEl = id => (cache[id] ||= mkEl(id));
(function setupTilePreview() {
  const tp = mkEl('tilePreview');
  const mkSub = cls => { const el = mkEl(cls); el.className = cls.replace('.', ''); el.hidden = false; return el; };
  const subs = { '.tpName': mkSub('tpName'), '.tpMeta': mkSub('tpMeta'), '.tpIcon': mkSub('tpIcon'), '.tpArt': mkSub('tpArt') };
  tp.querySelector = sel => subs[sel] || null;
  cache.tilePreview = tp;
})();
(function setupActions() {
  const actions = mkEl('actions');
  actions._html = '';
  Object.defineProperty(actions, 'innerHTML', {
    set(html) {
      actions._html = String(html);
      actions.children.length = 0;
      for (const id of [...String(html).matchAll(/id="([^"]+)"/g)].map(m => m[1])) if (!cache[id]) cache[id] = mkEl(id);
    },
    get() { return actions._html; },
  });
  cache.actions = actions;
})();
global.document = {
  getElementById: getEl,
  createElement: () => mkEl('dyn'),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() { },
  body: (() => { const b = mkEl('body'); b.classList = { s: new Set(['no-tilt']), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } }; return b; })(),
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.window = {
  addEventListener() { }, removeEventListener() { },
  AudioContext: undefined, webkitAudioContext: undefined,
  speechSynthesis: undefined, SpeechSynthesisUtterance: undefined,
  navigator: { serviceWorker: undefined },
};
Object.defineProperty(global, 'navigator', { value: { serviceWorker: undefined }, configurable: true, writable: true });
global.alert = () => { };
global.confirm = () => true;
global.prompt = () => null;
global.requestAnimationFrame = fn => setImmediate(fn);
global.fetch = async (url) => {
  const txt = fs.readFileSync(path.join(ROOT, String(url).replace(/^\.?\//, '')), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
};
const tick = () => new Promise(r => setImmediate(r));

// ---------------- 载入真实模块 ----------------
const load = f => import(pathToFileURL(path.join(ROOT, 'js', f)).href);
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