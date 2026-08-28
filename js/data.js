// 内容加载：从 content/*.json 构建棋盘与事件（数据驱动，改内容只需动 JSON）
import { N, TILES_COUNT } from './config.js';

export let TILES = [];
export let ALERTS = [];
export let INTEL = [];
export let FACTIONS = [];
export let RUINS = [];
export let positions = [];

let RAW_SPEC = null;   // 棋盘原始模板，用于每次开局随机重排

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('内容加载失败: ' + url);
  return r.json();
}

function buildTiles(spec) {
  return spec.map((s, i) => {
    const t = { id: i, artIndex: i };
    if (s.t === 'start') { t.type = 'start'; t.name = s.name || '避难所出口'; }
    else if (s.t === 'prop') { t.type = 'prop'; t.group = s.group; t.name = s.name; t.price = s.price; t.rent = s.rent; t.owner = null; t.level = 0; t.mortgaged = false; }
    else if (s.t === 'rail') { t.type = 'rail'; t.name = s.name; t.price = s.price; t.owner = null; t.level = 0; t.mortgaged = false; }
    else if (s.t === 'util') {
      t.type = 'util'; t.name = s.name; t.price = s.price; t.owner = null; t.level = 0; t.mortgaged = false;
      t.utilKind = s.utilKind || (String(s.name || '').includes('水') ? 'water' : 'power');
    }
    else if (s.t === 'event') { t.type = 'event'; t.name = '事件'; }
    else if (s.t === 'tax') { t.type = 'tax'; t.name = '税收'; t.tax = s.tax; }
    else if (s.t === 'quarantine') { t.type = 'quarantine'; t.name = '隔离区'; }
    else if (s.t === 'safe') { t.type = 'safe'; t.name = '安全地带'; }
    else if (s.t === 'wormhole') { t.type = 'wormhole'; t.name = s.name || '虫洞'; }
    else if (s.t === 'blackmarket') { t.type = 'blackmarket'; t.name = s.name || '黑市'; }
    else if (s.t === 'bounty') { t.type = 'bounty'; t.name = s.name || '赏金站'; }
    else if (s.t === 'oasis') { t.type = 'oasis'; t.name = s.name || '绿洲'; }
    else if (s.t === 'radiation') { t.type = 'radiation'; t.name = s.name || '莫诺加矿洞'; }
    else if (s.t === 'bunker') { t.type = 'bunker'; t.name = s.name || '国会掩体'; }
    return t;
  });
}

function buildEvents(spec) {
  const decks = spec.decks || {};
  const build = (key) => (spec[key] || []).map(e => ({
    id: e.id, art: e.art, title: e.title, story: e.story || '',
    moral: e.moral || '', choices: e.choices || [],
    requires: Array.isArray(e.requires) ? e.requires.slice() : [],
    requiresRep: e.requiresRep && typeof e.requiresRep === 'object' ? { ...e.requiresRep } : null,
    unlocks: Array.isArray(e.unlocks) ? e.unlocks.slice() : [],
    once: !!e.once,
    deck: key,
    deckName: decks[key] ? decks[key].name : key,
    deckTag: decks[key] ? decks[key].tag : '',
    bad: decks[key] ? !!decks[key].bad : false,
    fx: e.fx || (decks[key] && decks[key].fx) || null,
  }));
  return { alerts: build('radio'), intel: build('manual'), factions: build('faction'), ruins: build('ruins') };
}

function computePositions() {
  const pos = [];
  for (let c = N - 1; c >= 0; c--) pos.push([N - 1, c]);
  for (let r = N - 2; r >= 1; r--) pos.push([r, 0]);
  for (let c = 0; c < N; c++) pos.push([0, c]);
  for (let r = 1; r <= N - 2; r++) pos.push([r, N - 1]);
  return pos;
}

// 随机重排棋盘：保持「据点」(start) 固定在第 0 格。
// 采用「类型轮转均匀分布」：按类型分桶、桶内随机后，用贪心策略逐个铺排——
// 每步优先取「剩余最多的类型」且避免与刚放置的同类相邻，从而把大桶均匀打散，
// 既保证每局布局都不同，又避免同类格子扎堆（如连续多个事件格），整体分布更均匀。
export function shuffleBoard() {
  if (!RAW_SPEC) return;
  const rebuilt = buildTiles(RAW_SPEC);
  const start = rebuilt[0];           // 据点固定在第 0 格
  const rest = rebuilt.slice(1);

  // 按类型分桶（prop 归为同一类，便于整体均匀分布）
  const buckets = new Map();
  for (const t of rest) {
    if (!buckets.has(t.type)) buckets.set(t.type, []);
    buckets.get(t.type).push(t);
  }
  // 桶内各自洗牌：同类型内部随机
  for (const arr of buckets.values()) shuffle(arr);

  // 贪心铺排：每步从非空桶中选「剩余最多且不是上一次类型」的桶放置
  const all = [...buckets.values()];
  const next = [start];
  let remaining = rest.length;
  let lastType = start.type;
  while (remaining > 0) {
    const candidates = all.filter(a => a.length > 0 && a[0].type !== lastType);
    const pool = candidates.length ? candidates : all.filter(a => a.length > 0);
    pool.sort((x, y) => y.length - x.length);
    const maxLen = pool[0].length;
    const top = pool.filter(a => a.length === maxLen);
    const pick = top[Math.floor(Math.random() * top.length)];
    const t = pick.shift();
    next.push(t);
    lastType = t.type;
    remaining--;
  }
  next.forEach((t, i) => { t.id = i; });
  TILES = next;
}

/** 读档时按存档的 artIndex 顺序还原棋盘布局（随机洗牌后刷新页面仍能对上地块状态） */
export function restoreBoardOrder(artOrder) {
  if (!RAW_SPEC || !Array.isArray(artOrder) || artOrder.length !== TILES_COUNT) return;
  const pool = buildTiles(RAW_SPEC);
  TILES = artOrder.map((ai, i) => {
    const src = pool[ai] ?? pool[i];
    return { ...src, id: i };
  });
}

/** 新局重置所有可占有格（owner / level / mortgaged） */
export function resetTiles() {
  TILES.forEach((t) => {
    if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
      t.owner = null;
      t.level = 0;
      t.mortgaged = false;
    }
  });
}

export async function loadContent() {
  const [tilesSpec, eventsSpec] = await Promise.all([
    fetchJSON('content/tiles.json'),
    fetchJSON('content/events.json')
  ]);
  RAW_SPEC = tilesSpec;
  TILES = buildTiles(tilesSpec);
  const ev = buildEvents(eventsSpec);
  ALERTS = ev.alerts;
  INTEL = ev.intel;
  FACTIONS = ev.factions;
  RUINS = ev.ruins;
  positions = computePositions();
  if (TILES.length !== TILES_COUNT) console.warn('棋盘格数异常:', TILES.length);
  return { TILES, ALERTS, INTEL, FACTIONS, RUINS, positions };
}
