/**
 * 集齐 3 枚核弹密钥 — 含事件外来源（莫诺加矿洞/黑市/隔离电台阵列/手册）
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { missionEligible, markMissionDone, addPlayerFlags } from '../js/missions.js';
import { NUKE_KEY_CHANCES, NUKE_FLAGS } from '../js/nuke.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const tilesRaw = JSON.parse(readFileSync(join(root, 'content/tiles.json'), 'utf8'));
const eventsRaw = JSON.parse(readFileSync(join(root, 'content/events.json'), 'utf8'));

const TILES_COUNT = 44;
const RADIO_P = 0.38;
const MANUAL_P = 0.38;
const EVENT_P = 0.38 + 0.38 + 0.24; // land event -> any pile

const eventPositions = new Set(
  tilesRaw.map((t, i) => (t.t === 'event' ? i : -1)).filter((i) => i >= 0)
);
const radiationPos = tilesRaw.findIndex((t) => t.t === 'radiation');
const blackmarketPos = tilesRaw.findIndex((t) => t.t === 'blackmarket');
const chipFactoryPos = tilesRaw.findIndex((t) => t.name === '隔离电台阵列');

const DICE = [];
for (let a = 1; a <= 6; a++) {
  for (let b = 1; b <= 6; b++) {
    const s = a + b;
    const prev = DICE.find((d) => d.sum === s);
    if (prev) prev.p += 1 / 36;
    else DICE.push({ sum: s, p: 1 / 36 });
  }
}

const ALERTS = eventsRaw.radio.map((m) => ({ ...m, deck: 'radio' }));
const INTEL = eventsRaw.manual.map((m) => ({ ...m, deck: 'manual' }));

function makePlayer() {
  return { flags: [], missionDone: [], factionRep: { eagle: 0, survivor: 0, tech: 0 } };
}

function keysHeld(p) {
  return NUKE_FLAGS.filter((f) => p.flags.includes(f)).length;
}

function nextNeed(p) {
  for (const f of NUKE_FLAGS) if (!p.flags.includes(f)) return f;
  return null;
}

function buildWeightedPool(pile, player) {
  const eligible = pile.filter((m) => missionEligible(m, player));
  const pool = eligible.length
    ? eligible
    : pile.filter((m) => !m.once || !(player.missionDone || []).includes(m.id));
  const weighted = [];
  for (const m of pool) {
    const isChain = m.once || (m.requires && m.requires.length);
    const w = isChain ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(m);
  }
  return weighted;
}

function tryGrant(p, source) {
  const need = nextNeed(p);
  if (!need) return false;
  const ch = NUKE_KEY_CHANCES[source] || 0;
  if (ch <= 0 || Math.random() >= ch) return false;
  addPlayerFlags(p, [need]);
  return true;
}

function applyNukeRadio(p, mission) {
  const c = mission.choices.find((x) => (x.effects?.flags || []).some((f) => f.startsWith('nuke_')));
  if (!c) return false;
  addPlayerFlags(p, c.effects.flags);
  markMissionDone(p, mission);
  return true;
}

function resolveEvent(p) {
  const roll = Math.random();
  const pile = roll < 0.38 ? ALERTS : roll < 0.76 ? INTEL : null;
  if (!pile) return;
  const weighted = buildWeightedPool(pile, p);
  if (!weighted.length) return;
  const m = weighted[Math.floor(Math.random() * weighted.length)];
  if (pile === ALERTS && String(m.id).startsWith('nuke_chain_')) {
    applyNukeRadio(p, m);
    return;
  }
  markMissionDone(p, m);
  if (pile === INTEL) tryGrant(p, 'manual');
}

function onLand(pos, p) {
  if (pos === radiationPos) {
    if (p.caps >= 80 && Math.random() < 0.55) tryGrant(p, 'radiation_deep');
    else if (p.caps >= 40) tryGrant(p, 'radiation_shallow');
  } else if (pos === blackmarketPos) {
    if (Math.random() < 0.55) tryGrant(p, 'blackmarket_steal');
    else tryGrant(p, 'blackmarket_card');
  } else if (pos === chipFactoryPos) {
    tryGrant(p, 'chip_factory');
  } else if (eventPositions.has(pos)) {
    resolveEvent(p);
  }
}

function rollDice() {
  return DICE[Math.floor(Math.random() * DICE.length)].sum;
}

function monteCarlo(runs = 80000) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const p = makePlayer();
    let pos = 0;
    let turns = 0;
    p.caps = 200;
    while (keysHeld(p) < 3 && turns < 8000) {
      turns++;
      pos = (pos + rollDice()) % TILES_COUNT;
      onLand(pos, p);
    }
    results.push(turns);
  }
  results.sort((a, b) => a - b);
  const q = (x) => results[Math.min(results.length - 1, Math.floor(results.length * x))];
  return {
    min: results[0],
    mean: results.reduce((a, b) => a + b, 0) / results.length,
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    max: results[results.length - 1],
  };
}

console.log('=== 密钥来源概率 (js/nuke.js) ===');
console.log(NUKE_KEY_CHANCES);
console.log('\n特殊格: 莫诺加矿洞', radiationPos, '黑市', blackmarketPos, '隔离电台阵列', chipFactoryPos, '事件', [...eventPositions].join(','));

const mc = monteCarlo(80000);
console.log('\n=== 蒙特卡洛 8 万次（含全部来源 + 电台链，2/3/4 人相同） ===');
console.log(`最少 ${mc.min} | 均值 ${mc.mean.toFixed(1)} | 中位 ${mc.p50} | P90 ${mc.p90} | P99 ${mc.p99} | 最大 ${mc.max}`);

for (const n of [2, 3, 4]) {
  const r = monteCarlo(15000);
  console.log(`${n}人: 最少=${r.min} 均值=${r.mean.toFixed(1)} P99=${r.p99}`);
}

console.log('\n对比：改版前约 均值~383 中位~345 P99~1040');
