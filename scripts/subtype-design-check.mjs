#!/usr/bin/env node
// scripts/subtype-design-check.mjs —— subType 数值上限校验器
//
// 目的：在把 subType 写进 content/tiles.json 之前，先证明每个变体的
//       「最坏情况单次收租」（Lv2 + 垄断；骰子变体取 12 点）不超过实测基线推导出的 8% 上限。
//       设计与取舍见 docs/v1.8.0-plan.md 第 3 节；基线由 scripts/balance-probe.mjs 生成。
//
// 用法：
//   node scripts/subtype-design-check.mjs            # 用默认设计校验
//   node scripts/subtype-design-check.mjs --baseline docs/balance-baseline-4p.json
//
// 退出码：0 = 全部在上限内；1 = 有变体越界（可作为 CI 闸门）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const bi = args.indexOf('--baseline');
const BASE_FILE = bi >= 0 && args[bi + 1] ? args[bi + 1] : 'docs/balance-baseline-4p.json';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASE_FILE), 'utf8'));
const NET = baseline.topNet.median;
const CAP = baseline.cap8pctOfNet;

const tiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/tiles.json'), 'utf8'));
const props = tiles.filter(t => t.t === 'prop');
const groups = {};
for (const p of props) (groups[p.group] ||= []).push(p);

// --- 变体设计。约束：最坏单次收租 <= 8% 上限（实测基线推导）---
// 注意：volatile 用「除以 6」而非「乘 12」，否则中价地块直接爆表（首次验证 61.5%）。
const SUBTYPE = {
  landmark: { label: '地标', glyph: '★', mortgageable: false, rentMult: 2.2, baseCut: 0.55, pick: t => t.rent >= 16 },
  shack: { label: '棚户', glyph: '棚', mortgageable: true, rentMult: 0.55, baseCut: 1.0, upkeep: 10, pick: t => t.rent <= 8 },
  volatile: { label: '流动', glyph: '骰', mortgageable: true, rentMult: 1.0, baseCut: 1.0, diceDivisor: 6, diceMax: 12, pick: t => t.rent > 8 && t.rent < 16 },
  cursed: { label: '污染', glyph: '☠', mortgageable: true, rentMult: 1.6, baseCut: 1.0, moralHit: 1, pick: t => t.rent >= 14 && t.rent < 20 },
};

const targets = [];
for (const [key, def] of Object.entries(SUBTYPE)) {
  const cand = props.filter(t => def.pick(t) && !targets.includes(t));
  if (cand.length) { const t = cand.sort((a, b) => b.rent - a.rent)[0]; targets.push({ ...t, subtype: key }); }
}
console.log('\n=== target tiles ===');
for (const t of targets) console.log(`  ${t.subtype.padEnd(9)} ${t.group}/${t.name}: rent=${t.rent} price=${t.price}`);

const MONO_MULT = 2;
console.log('\n=== worst-case single rent per subtype (Lv0/1/2, with monopoly) ===');
const results = {};
for (const [key, def] of Object.entries(SUBTYPE)) {
  let worst = 0, worstAt = '';
  for (const t of targets.filter(x => x.subtype === key)) {
    const base = Math.round(t.rent * def.baseCut);
    for (let lv = 0; lv <= 2; lv++) {
      let rent = base * (lv + 1) * def.rentMult;
      if (def.diceDivisor) rent = rent * def.diceMax / def.diceDivisor;   // worst roll
      rent *= MONO_MULT;
      if (rent > worst) { worst = rent; worstAt = `${t.group}/${t.name} Lv${lv}`; }
    }
  }
  worst = Math.round(worst);
  results[key] = { worst, worstAt, pctOfNet: +(worst / NET * 100).toFixed(2), overCap: worst > CAP };
  console.log(`  ${key.padEnd(9)} worst=${String(worst).padStart(4)} caps (${(worst / NET * 100).toFixed(2)}% of net) at ${worstAt}  ${worst > CAP ? 'OVER CAP' : 'ok'}`);
}

console.log('\n=== baseline for comparison ===');
console.log(`  median top net worth : ${NET} caps`);
console.log(`  8% cap                : ${CAP} caps`);
console.log(`  normal prop Lv2+mono  : ${78} caps (${(78 / NET * 100).toFixed(2)}%)`);
console.log(`  doc's landmark proposal: 312 caps (${(312 / NET * 100).toFixed(2)}%) -> ${312 > CAP ? 'OVER CAP by ' + (312 - CAP) : 'ok'}`);

console.log('\n=== verdict ===');
const over = Object.entries(results).filter(([, r]) => r.overCap);
console.log(over.length ? 'OVER CAP: ' + over.map(([k]) => k).join(', ') : 'all subtypes within the 8% cap');

console.log('\n=== expected income for a shack owner (sanity: should be a trap) ===');
for (const t of targets.filter(t => t.subtype === 'shack')) {
  const def = SUBTYPE.shack;
  const base = Math.round(t.rent * def.baseCut);
  const gross = Math.round(base * 3 * def.rentMult);         // Lv2 + monopoly
  const net = gross - def.upkeep;
  console.log(`  ${t.group}/${t.name}: Lv2+mono gross=${gross} upkeep=${def.upkeep} net=${net}  ${net < gross ? '(trap: upkeep eats the yield)' : 'NOT A TRAP'}`);
}

if (over.length) {
  console.error(`\nFAIL: ${over.map(([k, r]) => `${k} ${r.worst}>${r.cap || CAP}`).join(', ')}`);
  process.exit(1);
}
console.log('\nPASS: all subtypes within the 8% cap');
process.exit(0);