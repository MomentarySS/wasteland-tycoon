#!/usr/bin/env node
// subType mechanism regression test.
// The smoke test does NOT exercise subType mechanics, so "tests pass" alone would prove nothing.
// Drives the real modules via the shared DOM stub in scripts/dom-stub.mjs.
//
// ESCAPED LITERALS: every CJK *string literal* below is a \uXXXX escape on purpose
// (the trailing CJK comments are safe -- they are never parsed as tokens).
// This file was originally written through PowerShell Set-Content, which re-encoded the
// UTF-8 bytes as ANSI and silently truncated CJK literals into U+FFFD, eating the closing
// quote. Keeping literals escaped makes that failure mode unreachable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub, loadModule } from './dom-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// DOM / window / fetch 桩：与 smoke.test.mjs、scripts/balance-probe.mjs 共用
// scripts/dom-stub.mjs。
const { getEl, tick } = installDomStub({ root: ROOT });

// CJK tile names (escaped so this file stays ASCII)
const NAME_LANDMARK = '\u63a0\u593a\u8005\u519b\u9600'; // 掠夺者军阀
const NAME_SHACK = '\u65e7\u8b66\u5907\u6240';       // 旧警备所
const NAME_VOLATILE = '\u6bd2\u8c37\u60c5\u62a5\u5546'; // 毒谷情报商
const NAME_CURSED = '\u6539\u88c5\u5de5\u574a';     // 改装工坊
const NAME_NORMAL = '\u65ad\u88c2\u5929\u6865';     // 断裂天桥
const EN_DASH = '\u2013';                            // rentDisplay range separator


const load = f => loadModule(ROOT, f);
const data = await load('data.js');
const state = await load('state.js');
const rules = await load('rules.js');
const view = await load('view.js');
const game = await load('game.js');
await data.loadContent();
view.initView(); view.buildSetup();

// ---------------- assertions ----------------
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS: ' + msg); } else { fail++; console.error('  FAIL: ' + msg); } };

const byName = n => data.TILES.find(t => t.name === n);
console.log('=== data landed ===');
for (const [name, st] of [[NAME_LANDMARK, 'landmark'], [NAME_SHACK, 'shack'], [NAME_VOLATILE, 'volatile'], [NAME_CURSED, 'cursed']]) {
  const t = byName(name);
  ok(!!t, `tile exists: ${name}`);
  ok(t && t.subType === st, `${name} subType=${t && t.subType} (expect ${st})`);
}
ok(data.TILES.filter(t => t.subType).length === 4, `exactly 4 tiles carry subType (got ${data.TILES.filter(t => t.subType).length})`);
ok(data.TILES.length === 44, `board still has 44 tiles (got ${data.TILES.length})`);

const sub = await load('subtypes.js');

console.log('\n=== landmark: not mortgageable ===');
// NOTE: these five are captured BEFORE startGame(). data.shuffleBoard() rebuilds
// every tile from RAW_SPEC via buildTiles(), so after the board is dealt these
// references point at DETACHED objects that are no longer in TILES. They are fine
// for the pure-function checks below (same data, no board lookup), but every
// board-interaction test must re-resolve by name after startGame() -- see below.
let lm = byName(NAME_LANDMARK);
ok(!!lm, `landmark tile resolves by name (guard: a bad \\u escape would silently pass the next line)`);
ok(sub.canMortgageTile(lm) === false, 'landmark cannot be mortgaged');
let normal = byName(NAME_NORMAL);
ok(!!normal, `control prop tile resolves by name`);
ok(sub.canMortgageTile(normal) === true, 'normal prop still mortgageable');

console.log('\n=== rent math (pure) ===');
let shack = byName(NAME_SHACK);
ok(sub.upkeepOf(shack) === 10, `shack upkeep = ${sub.upkeepOf(shack)}`);
// shack: baseCut=1 (no cut on base rent), rentMult=0.55
// Lv0 = round(8*1*0.55)=4, Lv2 = round(8*3*0.55)=13
shack.level = 0;
ok(sub.propBaseRent(shack, 6) === 4, `shack Lv0 base rent = ${sub.propBaseRent(shack, 6)} (expect 4)`);
shack.level = 2;
ok(sub.propBaseRent(shack, 6) === 13, `shack Lv2 base rent = ${sub.propBaseRent(shack, 6)} (expect 13)`);
ok(sub.propBaseRent(shack, 6) * 2 === 26, `shack Lv2 + monopoly = 26 (matches design table)`);
let cursed = byName(NAME_CURSED);
ok(sub.moralHitOf(cursed) === 1, `cursed moral hit = ${sub.moralHitOf(cursed)}`);
ok(sub.moralHitOf(normal) === 0, 'normal prop has no moral hit');
let vol = byName(NAME_VOLATILE);
ok(sub.propBaseRent(vol, 6) < sub.propBaseRent(vol, 12), 'volatile rent rises with roll');
// 旧断言写的是 Math.abs(f(vol,6) - f(vol,6)) === 0 —— 同一表达式自减，除 NaN 外
// 恒为真，等于什么都没验。换成两条真的能失败的：同一 roll 重复求值必须同为有限值，
// 以及缺失 / 非法 roll 需落到除数默认值 6 而不是算出 NaN。
const volAt6 = sub.propBaseRent(vol, 6);
ok(Number.isFinite(volAt6) && volAt6 === sub.propBaseRent(vol, 6),
  `volatile deterministic for a given roll (${volAt6})`);
ok(Number.isFinite(sub.propBaseRent(vol)) && sub.propBaseRent(vol) === volAt6,
  'volatile falls back to roll=6 when roll is missing');
// landmark: baseCut=0.55, rentMult=2.2
// Lv0 = round(round(26*0.55)*2.2) = 31, Lv2 = round(round(round(26*0.55)*3)*2.2)
const lm0 = sub.propBaseRent(lm, 6);
lm.level = 2;
const lm2 = sub.propBaseRent(lm, 6);
lm.level = 0;
ok(lm0 === 31, `landmark Lv0 base rent = ${lm0} (expect 31)`);
ok(lm2 * 2 === 184, `landmark Lv2 + monopoly = ${lm2 * 2} (design table said 185; impl rounds each step)`);
ok(lm2 * 2 <= 243, `landmark worst case within cap (${lm2 * 2} <= 243)`);

console.log('\n=== rentDisplay ===');
// give the landmark to a player so rentDisplay shows a value
data.TILES.filter(t => t.type === 'prop').forEach(t => { t.owner = null; t.mortgaged = false; t.level = 0; });
lm.owner = 0;
const disp = rules.rentDisplay(lm);
ok(typeof disp === 'string' && disp.length > 0, `landmark rentDisplay = "${disp}"`);
vol.owner = 0;
const vdisp = rules.rentDisplay(vol);
ok(vdisp.includes(EN_DASH), `volatile rentDisplay shows a range (en-dash): "${vdisp}"`);
ok(vdisp !== disp, 'volatile display differs from landmark display');

console.log('\n=== payRent: shack upkeep + cursed moral ===');
// set up a real 2-player game
for (let i = 0; i < 4; i++) getEl('slot' + i).value = i < 2 ? 'ai' : 'off';
getEl('mode').value = 'versus';
getEl('startCaps').value = '5000';
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
data.shuffleBoard();
game.startGame();
await tick(); await tick();
const G = state.G;
ok(G.players.length === 2, `game started with ${G.players.length} players`);

const restore = t => { t.owner = null; t.level = 0; t.mortgaged = false; };

// Re-resolve against the dealt board. shuffleBoard() rebuilt every tile from
// RAW_SPEC, so the pre-game references above are detached; running payRent() /
// mortgage() / updateTilePreview() against those would exercise off-board objects
// and could pass even with the mechanism broken.
lm = byName(NAME_LANDMARK);
shack = byName(NAME_SHACK);
vol = byName(NAME_VOLATILE);
cursed = byName(NAME_CURSED);
normal = byName(NAME_NORMAL);
ok([lm, shack, vol, cursed, normal].every(t => t && data.TILES.includes(t)),
  'post-deal tile references really belong to TILES (guard: detached pre-shuffle objects would let the interaction tests pass vacuously)');

console.log('\n=== preview panel (plan step 6) ===');
// Runs after startGame() on purpose: updateTilePreview dereferences G.players[t.owner]
// for the owner suffix, which throws when t.owner != null but no game exists yet.
const previewEl = getEl('tilePreview');
const metaEl = previewEl.querySelector('.tpMeta');
data.TILES.forEach(restore);
const SUB_TILES = [[NAME_LANDMARK, 'landmark'], [NAME_SHACK, 'shack'], [NAME_VOLATILE, 'volatile'], [NAME_CURSED, 'cursed']];
for (const [nm, st] of SUB_TILES) {
  const t = byName(nm);
  const idx = data.TILES.indexOf(t);
  view.updateTilePreview(idx);
  const label = sub.SUBTYPE_DEFS[st].label;
  ok(metaEl.textContent.includes(label), `preview meta shows "${label}" for ${nm}: "${metaEl.textContent}"`);
  ok(previewEl.dataset.subtype === st, `preview dataset.subtype = ${previewEl.dataset.subtype} (expect ${st})`);
}
const labels = Object.values(sub.SUBTYPE_DEFS).map(d => d.label);
ok(new Set(labels).size === 4 && labels.every(l => typeof l === 'string' && l.length > 0),
  `4 distinct non-empty subType labels: ${JSON.stringify(labels)}`);
// the preview element is reused, so a stale data-subtype would bleed onto the next tile
const normalIdx = data.TILES.indexOf(normal);
view.updateTilePreview(normalIdx);
ok(previewEl.dataset.subtype === undefined, `data-subtype cleared when hovering a normal prop (got ${previewEl.dataset.subtype})`);
ok(!labels.some(l => metaEl.textContent.includes(l)), `normal prop meta carries no subType label: "${metaEl.textContent}"`);

// shack: owner is player 0, payer is player 1
data.TILES.forEach(restore);
const s2 = shack;
s2.owner = 0; s2.level = 2;
G.current = 1; G.lastRoll = 6;
const ownerObj = G.players[0];
const ownerCapsBefore = ownerObj.caps;
rules.payRent(G.players[1], s2);
const paid = ownerCapsBefore === undefined ? 0 : (ownerObj.caps - ownerCapsBefore);
ok(paid > 0, `shack owner received rent+upkeep (${paid})`);
ok(Math.abs(paid - (sub.propBaseRent(s2, 6) * (rules.isMonopoly(s2) ? 2 : 1) + sub.upkeepOf(s2))) <= 1, `shack total = rent + upkeep (${paid})`);

// cursed: moral drop
// NOTE: the payer starts at moral 0, and payRent clamps with Math.max(0, ...),
// so asserting from a 0 baseline would pass VACUOUSLY no matter whether the
// penalty fires. Seed a positive baseline so -1 is actually observable.
data.TILES.forEach(restore);
const c2 = cursed;
c2.owner = 0; c2.level = 0;
G.current = 1; G.lastRoll = 6;
G.players[1].moral = 3;
rules.payRent(G.players[1], c2);
ok(G.players[1].moral === 2, `cursed moral 3 -> ${G.players[1].moral} (expect 2; a 0-baseline assert here would pass vacuously)`);
G.players[1].moral = 0;

// volatile: rent varies with lastRoll
data.TILES.forEach(restore);
const v2 = vol;
const ownerCaps = () => G.players[0].caps;
v2.owner = 0; v2.level = 0;
G.current = 1;
G.lastRoll = 1; const c1 = ownerCaps(); rules.payRent(G.players[1], v2); const low = ownerCaps() - c1;
data.TILES.forEach(restore); v2.owner = 0; v2.level = 0;
G.lastRoll = 12; const c2a = ownerCaps(); rules.payRent(G.players[1], v2); const high = ownerCaps() - c2a;
ok(high > low, `volatile rent scales with roll (roll1=${low}, roll12=${high})`);
// worst case is Lv2 + monopoly, not the Lv0 numbers measured end-to-end above
const volWorst = sub.propBaseRent(Object.assign(vol, { level: 2 }), 12) * 2;
ok(volWorst === 180, `volatile Lv2 + monopoly + roll12 = ${volWorst} (expect 180, design table)`);
ok(volWorst <= 243, `volatile worst case within cap (${volWorst} <= 243)`);
vol.level = 0;

// landmark mortgage blocked end-to-end
data.TILES.forEach(restore);
const l2 = lm; l2.owner = 0; l2.level = 0;
G.current = 0;
const capsB = G.players[0].caps;
rules.mortgage(G.players[0], l2);
ok(G.players[0].caps === capsB && !l2.mortgaged, 'mortgage() on landmark is refused, no caps gained');

console.log('\n=== summary ===');
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);