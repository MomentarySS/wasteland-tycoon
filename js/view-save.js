// 本地存档 / 读档（v4：含回合 UI、规则状态、地块价格 + 校验）
import { G } from './state.js';
import { TILES, restoreBoardOrder, resetTiles } from './data.js';
import { TILES_COUNT } from './config.js';
import { buildTokens, render, log } from './view-core.js';
import { hideWin, showWin, showNukeWin, showCampaignEnding } from './view-modal.js';
import { restoreTurnUI } from './game.js';
import { netWorth } from './rules.js';
import { evaluateCampaign, evaluateCampaignCoop, campaignCount } from './campaign.js';
import { MUTATOR_FIELDS, MUTATOR_POOL, resetMutatorFields } from './mutators.js';

const SAVE_KEY = 'wasteland_save';
const SAVE_VERSION = 4;
const SAVE_RULE_FIELDS = [
  ...Object.keys(MUTATOR_FIELDS),
  'goodEventBonus', 'aiCoopBonus', 'randomStart', 'startRepPenalty', 'narrativeSeed',
];

function cloneSaveValue(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function pendingTilePos() {
  if (!G.pendingTile) return null;
  const idx = TILES.indexOf(G.pendingTile);
  return idx >= 0 ? idx : null;
}

function validateSave(d) {
  if (!d || typeof d !== 'object') return '存档格式无效';
  if (d.v !== 2 && d.v !== 3 && d.v !== 4) return '存档版本不支持（v' + d.v + '）';
  if (!Array.isArray(d.tiles) || d.tiles.length !== TILES.length) {
    return '地块数据与当前棋盘不匹配（期望 ' + TILES.length + ' 格）';
  }
  if (!Array.isArray(d.players) || d.players.length < 1) return '玩家数据无效';
  for (let i = 0; i < d.tiles.length; i++) {
    const t = d.tiles[i];
    if (!t || typeof t !== 'object') return '地块 #' + i + ' 数据损坏';
  }
  for (const p of d.players) {
    if (p == null || typeof p.id !== 'number' || typeof p.pos !== 'number') return '玩家数据损坏';
    if (p.pos < 0 || p.pos >= TILES_COUNT) return '玩家位置无效';
  }
  if (typeof d.current !== 'number' || d.current < 0 || d.current >= d.players.length) {
    return '当前玩家索引无效';
  }
  if (!d.gameOver && d.players.every(p => p.bankrupt)) {
    return '存档状态异常：全员破产但对局未结束';
  }
  return null;
}

function normalizeSave(d) {
  const out = { ...d };
  if (out.awaitingRoll == null) out.awaitingRoll = false;
  if (out.lastRoll == null) out.lastRoll = 0;
  if (out.turnPlayerId == null) out.turnPlayerId = d.turnPlayerId ?? null;
  return out;
}

function inferGameOverUI() {
  const alive = G.players.filter(p => !p.bankrupt);
  if (alive.length === 0) {
    showWin('协议中断', '无人幸存');
    return;
  }
  if (G.mode === 'campaign' || G.mode === 'coop') {
    const human = G.players.find(p => !p.isAI) || G.players[0];
    const ally = G.players.find(p => p.isAI);
    // 合作模式：任一队友破产即失败
    if (G.mode === 'coop' && human && human.bankrupt) { showWin(human.name, '合作失败'); return; }
    if (G.mode === 'coop' && ally && ally.bankrupt) { showWin(ally.name, '合作失败'); return; }
    if (G.mode === 'campaign' && human && human.bankrupt) { showWin(human.name, '闯关失败'); return; }
    if (human && G.campaign >= campaignCount() - 1) {
      const r = G.mode === 'coop'
        ? evaluateCampaignCoop(human, ally, { TILES, netWorth }, G.campaign)
        : evaluateCampaign(human, { TILES, netWorth }, G.campaign);
      if (r.done) {
        if (G.mode === 'coop') {
          showWin(human.name + (ally ? ' & ' + ally.name : ''), '合作通关');
        } else {
          showCampaignEnding(human);
        }
        return;
      }
    }
  }
  if (alive.length === 1) {
    showWin(alive[0].name);
    return;
  }
  const winner = alive.reduce((a, b) => netWorth(b) > netWorth(a) ? b : a);
  showWin(winner.name);
}

function restoreGameOverUI(d) {
  const kind = d.endKind || G.endKind;
  const winnerId = d.endWinnerId != null ? d.endWinnerId : G.endWinnerId;
  const winner = winnerId != null ? G.players.find(p => p.id === winnerId) : null;

  if (kind === 'draw') {
    showWin('协议中断', '无人幸存');
    return;
  }
  if (kind === 'campaign' && winner) {
    showCampaignEnding(winner);
    return;
  }
  if (kind === 'campaignLose' && winner) {
    showWin(winner.name, '闯关失败');
    return;
  }
  if (kind === 'nuke' && winner) {
    showNukeWin(winner.name);
    return;
  }
  if (kind === 'win' && winner) {
    showWin(winner.name);
    return;
  }
  inferGameOverUI();
}

export function saveGame() {
  const data = {
    v: SAVE_VERSION,
    mode: G.mode,
    campaign: G.campaign,
    turn: G.turn || 0,
    current: G.current,
    SALARY: G.SALARY,
    STARTCAPS: G.STARTCAPS,
    targetWealth: G.targetWealth,
    difficulty: G.difficulty || 'standard',
    taxMult: G.taxMult != null ? G.taxMult : 1,
    aiBuyAggro: G.aiBuyAggro != null ? G.aiBuyAggro : 1,
    aiBidAggro: G.aiBidAggro != null ? G.aiBidAggro : 1,
    aiUpgradeChance: G.aiUpgradeChance != null ? G.aiUpgradeChance : 0.6,
    gameOver: G.gameOver,
    endKind: G.endKind || null,
    endWinnerId: G.endWinnerId != null ? G.endWinnerId : null,
    awaitingRoll: G.awaitingRoll,
    pendingTilePos: pendingTilePos(),
    turnPlayerId: G.turnPlayer ? G.turnPlayer.id : null,
    lastRoll: G.lastRoll || 0,
    activeMutatorIds: Array.isArray(G.activeMutators) ? G.activeMutators.map(m => m.id).filter(Boolean) : [],
    ruleState: Object.fromEntries(SAVE_RULE_FIELDS.map(k => [k, cloneSaveValue(G[k])])),
    boardArtOrder: TILES.map(t => t.artIndex ?? t.id),
    tiles: TILES.map(t => ({ owner: t.owner, level: t.level, mortgaged: t.mortgaged, price: t.price })),
    players: G.players.map(p => ({
      id: p.id, name: p.name, short: p.short, isAI: p.isAI, color: p.color,
      caps: p.caps, pos: p.pos, skipNext: p.skipNext, bankrupt: p.bankrupt,
      inJail: p.inJail, jailTurns: p.jailTurns, getOut: p.getOut, doubles: p.doubles,
      extraRoll: !!p.extraRoll,
      moral: p.moral || 0, avatar: p.avatar || '',
      flags: Array.isArray(p.flags) ? p.flags.slice() : [],
      missionDone: Array.isArray(p.missionDone) ? p.missionDone.slice() : [],
      cards: Array.isArray(p.cards) ? p.cards.slice() : [],
      shield: p.shield || 0, marchBonus: p.marchBonus || 0,
      factionRep: p.factionRep && typeof p.factionRep === 'object' ? { ...p.factionRep } : { eagle: 0, survivor: 0, tech: 0 }
    }))
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); log('游戏已存档（本地 v' + SAVE_VERSION + '）'); }
  catch (e) { alert('存档失败：' + e.message); }
}

export function loadGame() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {
    alert('读取存档失败：' + e.message);
    return;
  }
  if (!raw) { alert('没有可用存档'); return; }

  let d;
  try { d = JSON.parse(raw); } catch (e) {
    alert('存档已损坏，无法解析 JSON');
    return;
  }

  d = normalizeSave(d);
  const err = validateSave(d);
  if (err) { alert('无法读档：' + err); return; }

  // 读档会替换当前内存局面；先清掉当前局规则，缺少 v4 字段的旧档按基础规则兼容。
  resetMutatorFields(G);
  G.goodEventBonus = 0;
  G.aiCoopBonus = 0;
  G.randomStart = false;
  G.startRepPenalty = null;
  G.narrativeSeed = null;

  G.mode = d.mode || 'versus';
  G.campaign = d.campaign != null ? d.campaign : 0;
  G.turn = d.turn || 0;
  G.SALARY = d.SALARY;
  G.STARTCAPS = d.STARTCAPS;
  G.targetWealth = d.targetWealth;
  G.difficulty = d.difficulty || 'standard';
  G.taxMult = d.taxMult != null ? d.taxMult : 1;
  G.aiBuyAggro = d.aiBuyAggro != null ? d.aiBuyAggro : 1;
  G.aiBidAggro = d.aiBidAggro != null ? d.aiBidAggro : 1;
  G.aiUpgradeChance = d.aiUpgradeChance != null ? d.aiUpgradeChance : 0.6;
  G.gameOver = !!d.gameOver;
  G.endKind = d.endKind || null;
  G.endWinnerId = d.endWinnerId != null ? d.endWinnerId : null;
  G.awaitingRoll = !!d.awaitingRoll;
  G.lastRoll = d.lastRoll || 0;

  if (d.ruleState && typeof d.ruleState === 'object') {
    for (const key of SAVE_RULE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(d.ruleState, key)) {
        G[key] = cloneSaveValue(d.ruleState[key]);
      }
    }
  }
  const mutatorIds = Array.isArray(d.activeMutatorIds) ? d.activeMutatorIds : [];
  G.activeMutators = mutatorIds
    .map(id => MUTATOR_POOL.find(m => m.id === id))
    .filter(Boolean);

  // 还原地块模板价格，避免从遗产局读档时沿用当前局的突变价格。
  resetTiles();
  if (Array.isArray(d.boardArtOrder) && d.boardArtOrder.length === TILES.length) {
    restoreBoardOrder(d.boardArtOrder);
  }

  TILES.forEach((t, i) => {
    t.owner = d.tiles[i].owner;
    t.level = d.tiles[i].level;
    t.mortgaged = !!d.tiles[i].mortgaged;
    if (Number.isFinite(d.tiles[i].price) && d.tiles[i].price > 0) t.price = d.tiles[i].price;
  });

  // 必须在 restoreBoardOrder 之后取值：否则引用的是被替换掉的旧 TILES 数组中的对象
  G.pendingTile = d.pendingTilePos != null ? TILES[d.pendingTilePos] : null;

  G.players = d.players.map(p => ({
    ...p,
    extraRoll: !!p.extraRoll,
    flags: Array.isArray(p.flags) ? p.flags.slice() : [],
    missionDone: Array.isArray(p.missionDone) ? p.missionDone.slice() : [],
    cards: Array.isArray(p.cards) ? p.cards.slice() : [],
    shield: p.shield || 0, marchBonus: p.marchBonus || 0,
    factionRep: p.factionRep && typeof p.factionRep === 'object' ? { ...p.factionRep } : { eagle: 0, survivor: 0, tech: 0 },
    tokenEl: null
  }));
  G.current = d.current;
  G.turnPlayer = d.turnPlayerId != null
    ? G.players.find(p => p.id === d.turnPlayerId) || G.players[G.current]
    : null;

  const overlay = document.getElementById('overlay');
  if (overlay) overlay.style.display = 'none';
  hideWin();
  buildTokens();
  render();
  log('已读取存档（v' + d.v + '）');
  if (G.gameOver) restoreGameOverUI(d);
  else restoreTurnUI();
}

/** 供测试：序列化当前状态 */
export function exportSaveSnapshot() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }
  catch (_) { return null; }
}
