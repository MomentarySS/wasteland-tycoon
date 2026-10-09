// 视图核心：条带式棋盘、中央预览、布局自适应
import { G } from './state.js';
import { TILES, positions } from './data.js';
import { N, CELL, COLORS, GROUPS, TOKEN_SLOT } from './config.js';
import { playerPortrait, tileIcon, iconColor, buildingSVG } from './icons.js';
import { netWorth, rentDisplay, isMonopoly, canUpgrade } from './rules-core.js';
import { subTypeDef } from './subtypes.js';
import { resolveMutatorVisualFamily, VISUAL_FAMILY_PRIORITY } from './mutators.js';
import { evaluateCampaign, evaluateCampaignCoop, campaignDecayPerTurn } from './campaign.js';
import { formatFactionRep } from './missions.js';
import { nukeKeyBadgeHtml } from './view-nuke.js';
import { FACTIONS } from './config.js';
import { initFx, fxMoney, fxResetMoney } from './fx.js';
import { classifyLogKind, startAmbience } from './fx-events.js';
import { initLogPanel, applyEntryFilter, makeLogTag } from './log-panel.js';
import { initBoardCanvas, isCanvasMode, resizeBoardCanvas, drawBoard, setMonopolySet } from './board-canvas.js';
import { getCellMetrics, invalidateCellMetricsCache } from './board-metrics.js';
import { ttsSpeak } from './tts.js';
import { escapeHtml } from './view-util.js';
import { tileArtUrl, zoneTexUrl } from './assets-art.js';
import { setPlayerRowEl } from './player-row.js';

let tilesEl, tokenLayer, logEl, actionsEl, diceEl, previewEl;
let tileHoverBound = false;

// 玩家行 DOM 引用已迁至 player-row.js（v1.6.0 接手轮 · 清理 _rowEl 技术债）
// 单向依赖：view-core.js → player-row.js,fx.js → player-row.js,无循环

// 全局首次用户交互解锁音频（Android WebView 要求用户手势触发 AudioContext resume）
function ensureAudioUnlocked() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch (_) { /* ignore */ }
}
if (typeof window !== 'undefined') {
  const unlockEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];
  const unlockHandler = () => {
    ensureAudioUnlocked();
    unlockEvents.forEach(evt => window.removeEventListener(evt, unlockHandler));
  };
  unlockEvents.forEach(evt => window.addEventListener(evt, unlockHandler, { once: false }));
}

export function applyBoardTilt(_on) {
  if (!document.body || !document.body.classList) return;
  const cl = document.body.classList;
  if (typeof cl.add === 'function') cl.add('no-tilt');
  fitBoard();
  repositionAllTokens();
}

/** 顶面贴图：始终开启，不可关闭 */
export function isTileArtEnabled() {
  return true;
}

export function applyTileArt(_on) {
  if (!document.body || !document.body.classList) return;
  const cl = document.body.classList;
  if (typeof cl.add === 'function') cl.add('tile-art');
}

export const WASTELAND_EMOJI = ['🧟', '☣️', '🤖', '👽', '🔥', '💀', '🛡️', '🥷', '🐺', '🦅', '⚙️', '📻'];
const slotAvatars = [];

const TYPE_LABEL = {
  start: '避难所', event: '事件', tax: '税收', quarantine: '隔离区', safe: '安全地带',
  rail: '哨站', util: '设施', wormhole: '虫洞', blackmarket: '黑市', bounty: '赏金',
  oasis: '绿洲', radiation: '矿坑', bunker: '掩体',
};

export function avatarHTML(p) {
  const av = p.avatar;
  let inner;
  if (av && typeof av === 'string' && av.startsWith('data:')) inner = `<img class="avimg" src="${escapeHtml(av)}">`;
  else if (av) inner = `<span class="avemoji">${escapeHtml(av)}</span>`;
  else inner = playerPortrait(p.id);
  // color 可能来自读档存档，必须转义防止破坏 style 属性边界
  const color = escapeHtml(String(p.color || '#ccc'));
  return `<span class="pva" style="color:${color}">${inner}</span>`;
}

export function slotAvatarHTML(i) {
  return avatarHTML({ id: i, color: COLORS[i], avatar: slotAvatars[i] || '' });
}

export function getSlotAvatars() { return slotAvatars; }
export function getSlotAvatarStore() { return slotAvatars; }

function tileDisplayName(t) {
  if (t.name) return t.name;
  return TYPE_LABEL[t.type] || t.type;
}

function tileMetaLine(t) {
  if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
    // subType 变种在末尾标注，缺省（普通地产）不追加，保持原有信息层级不变
    const sub = subTypeDef(t);
    return `${t.price}盖 · 租${rentDisplay(t)}${t.level > 0 ? ' · Lv' + t.level : ''}${sub ? ' · ' + sub.label : ''}`;
  }
  if (t.type === 'tax') return `-${t.tax}盖`;
  if (t.type === 'start') return `+${G.SALARY}盖`;
  if (t.type === 'wormhole') return '随机传送';
  if (t.type === 'blackmarket') return '黑市交易';
  if (t.type === 'bounty') return '赏金任务';
  if (t.type === 'oasis') return '补给恢复';
  if (t.type === 'radiation') return '辐射采矿';
  if (t.type === 'bunker') return '国会掩体';
  if (t.type === 'event') return '废土事件';
  if (t.type === 'quarantine') return '隔离区';
  if (t.type === 'safe') return '安全地带';
  return '';
}

function tileTip(t) {
  let tip = tileDisplayName(t);
  const meta = tileMetaLine(t);
  if (meta) tip += ' · ' + meta;
  if (t.type === 'prop' && t.group && GROUPS[t.group]) tip += ' · ' + GROUPS[t.group].name;
  if (t.owner != null && G.players[t.owner] && !G.players[t.owner].bankrupt) tip += ' · ' + G.players[t.owner].name;
  if (t.mortgaged) tip += ' · [押当]';
  return tip;
}

function commandWeatherLabel() {
  if (typeof document === 'undefined' || !document.body || !document.body.classList) return '常态';
  if (document.body.classList.contains('weather-dust')) return '沙尘暴';
  if (document.body.classList.contains('weather-acid')) return '酸雨';
  if (document.body.classList.contains('weather-dusk')) return '暮色';
  return '常态';
}

const MUTVIZ_CLASSES = VISUAL_FAMILY_PRIORITY.map(f => 'mutviz-' + f);

/**
 * mutator 视觉族同步：只切 body class，不读也不写任何规则数值。
 * 挂在 updateCommandCenter()（render() 每回合调用）而不是 applyMutators()，
 * 这样重抽、读档、换局都自动跟随 G.activeMutators，且规则层不感知表现层。
 */
function syncMutatorVisual() {
  if (typeof document === 'undefined' || !document.body || !document.body.classList) return;
  const fam = resolveMutatorVisualFamily(G.activeMutators);
  for (const c of MUTVIZ_CLASSES) document.body.classList.toggle(c, c === 'mutviz-' + fam);
}

function commandTileHint(t, p) {
  if (!t || !p) return '等待落点信号';
  if (t.type === 'prop') {
    if (t.owner == null) {
      return p.caps >= t.price ? `可购买 · ${t.price}盖` : `资金不足 · 需要 ${t.price}盖`;
    }
    if (t.owner === p.id) {
      if (t.mortgaged) return '已抵押 · 可在资产面板赎回';
      if (canUpgrade(p, t)) return `可升级 · ${t.price}盖`;
      return t.level >= 2 ? '设施已满级 · 产权稳定' : '等待同组地产归属';
    }
    return t.mortgaged ? '抵押地块 · 本次免租' : `对手产权 · 租金 ${rentDisplay(t)}盖`;
  }
  const hints = {
    start: '补给站 · 经过获得瓶盖', event: '事件频道 · 等待选择', tax: '税务节点 · 准备结算',
    quarantine: '隔离区 · 可能跳过回合', safe: '安全地带 · 暂时喘息', rail: '哨站 · 过路费随线路增长',
    util: '设施 · 租金随骰点变化', wormhole: '虫洞 · 位置将被改写', blackmarket: '黑市 · 可交易或淘卡',
    bounty: '赏金任务 · 领取额外目标', oasis: '绿洲 · 补给恢复', radiation: '辐射矿 · 高风险收益',
    bunker: '国会掩体 · 休整或加固',
  };
  return hints[t.type] || '已抵达 · 等待行动';
}

function commandGoal(p) {
  if (!p) return '从右侧设置开始一局';
  if (G.mode === 'campaign' || G.mode === 'coop') {
    const human = G.players.find(x => !x.isAI) || p;
    const ally = G.players.find(x => x.isAI);
    const r = G.mode === 'coop'
      ? evaluateCampaignCoop(human, ally, { TILES, netWorth }, G.campaign)
      : evaluateCampaign(human, { TILES, netWorth }, G.campaign);
    const current = r.objs.find(o => !o.done) || r.objs[r.objs.length - 1];
    return `${r.name} · ${current ? `${current.text} ${current.value}/${current.goal}` : '章节目标已完成'}`;
  }
  if (G.mode === 'survival') {
    const next = 8 - ((G.turn || 0) % 8);
    return `生存 ${G.turn || 0} 回合 · ${next} 回合后衰减升级`;
  }
  return G.targetWealth > 0 ? `净身家 ${netWorth(p)} / ${G.targetWealth}盖` : `第 ${G.turn || 0} 回合 · 自由经营`;
}

/** 中央废土指挥中枢：只显示当前决策所需的态势、落点提示和目标进度。 */
export function updateCommandCenter() {
  // 先同步表现层：必须在下面的空态早退之前，否则「待开局」时上一局的
  // 视觉族会留在 body 上不被清掉。
  syncMutatorVisual();
  const turnEl = document.getElementById('ccTurn');
  const weatherEl = document.getElementById('ccWeather');
  const mutEl = document.getElementById('ccMutators');
  const actionEl = document.getElementById('ccAction');
  const goalEl = document.getElementById('ccGoal');
  if (!turnEl || !weatherEl || !actionEl || !goalEl) return;
  const p = G.players && G.players[G.current];
  if (!p) {
    turnEl.textContent = '待开局';
    weatherEl.textContent = '—';
    actionEl.textContent = '等待幸存者就位';
    goalEl.textContent = '从右侧设置开始一局';
    if (mutEl) mutEl.textContent = '';
    return;
  }
  turnEl.textContent = `第 ${G.turn || 0} 回合 · ${p.isAI ? 'AI' : '玩家'} ${p.short || ''}`;
  weatherEl.textContent = commandWeatherLabel();
  const muts = Array.isArray(G.activeMutators) ? G.activeMutators.slice(0, 2) : [];
  if (mutEl) mutEl.textContent = muts.length ? ` · ${muts.map(m => `${m.icon || '☢'} ${m.name || m.id}`).join(' / ')}` : '';
  const t = TILES[p.pos];
  actionEl.textContent = commandTileHint(t, p);
  goalEl.textContent = commandGoal(p);
}

function buildStripTileHTML(t) {
  const name = tileDisplayName(t);
  const plainLen = name.replace(/\s/g, '').length;
  const longName = plainLen >= 5;
  let html = `<div class="tileSimple${longName ? ' long-name' : ''}">`;
  if (!longName) {
    html += `<div class="ticon" style="color:${iconColor(t)}">${tileIcon(t)}</div>`;
  }
  html += `<span class="tname">${escapeHtml(name)}${t.mortgaged ? ' <span class="mort">[押]</span>' : ''}</span>`;
  html += `</div>`;
  // board-v2: prop 格右上角 HUD = 主人色点 + 等级徽章 + 建造图标
  if (t.type === 'prop') {
    const owner = t.owner != null && G.players[t.owner] ? G.players[t.owner] : null;
    const ownerColor = owner ? escapeHtml(owner.color) : '';
    const level = t.level || 0;
    html += `<div class="tileHud"><div class="tileRow">`;
    if (owner) html += `<span class="towner" style="background:${ownerColor};color:${ownerColor}"></span>`;
    if (level > 0) html += `<span class="tlevel" data-lv="${level}">${level}</span>`;
    if (level > 0) html += `<span class="tbuild">${buildingSVG(level)}</span>`;
    html += `</div></div>`;
  }
  return html;
}

export function updateTilePreview(idx, opts = {}) {
  if (!previewEl) previewEl = document.getElementById('tilePreview');
  if (!previewEl || typeof previewEl.querySelector !== 'function') return;
  if (idx == null || idx < 0 || idx >= TILES.length) return;
  const t = TILES[idx];
  const nameEl = previewEl.querySelector('.tpName');
  const metaEl = previewEl.querySelector('.tpMeta');
  const iconEl = previewEl.querySelector('.tpIcon');
  const artEl = previewEl.querySelector('.tpArt');
  if (nameEl) nameEl.textContent = tileDisplayName(t);
  if (metaEl) {
    let meta = tileMetaLine(t);
    if (t.type === 'prop' && t.group && GROUPS[t.group]) meta = GROUPS[t.group].name + (meta ? ' · ' + meta : '');
    if (t.owner != null && G.players[t.owner] && !G.players[t.owner].bankrupt) meta += (meta ? ' · ' : '') + G.players[t.owner].name;
    metaEl.textContent = meta || '废土地块';
  }
  if (iconEl) {
    iconEl.style.color = iconColor(t);
    iconEl.innerHTML = tileIcon(t);
  }
  const art = tileArtUrl(t.artIndex ?? idx);
  if (artEl) {
    if (art) {
      artEl.src = art;
      artEl.hidden = false;
      previewEl.classList.add('has-art');
    } else {
      artEl.removeAttribute('src');
      artEl.hidden = true;
      previewEl.classList.remove('has-art');
    }
  }
  previewEl.dataset.type = t.type;
  if (t.type === 'prop') previewEl.dataset.group = t.group || '';
  else if (typeof previewEl.removeAttribute === 'function') previewEl.removeAttribute('data-group');
  // subType 写到 dataset，供 CSS 做配色/描边；无变种时必须显式移除，
  // 否则上一格的变种标记会残留在同一个预览元素上（该元素是复用的）。
  if (t.type === 'prop' && t.subType) previewEl.dataset.subtype = t.subType;
  else if (typeof previewEl.removeAttribute === 'function') previewEl.removeAttribute('data-subtype');
  if (previewEl.classList) previewEl.classList.add('is-visible');
  if (opts.pulse && previewEl.classList) {
    previewEl.classList.remove('tpPulse');
    void previewEl.offsetWidth;
    previewEl.classList.add('tpPulse');
  }
}

function syncActivePreview() {
  if (!G.players || G.gameOver) return;
  const cur = G.players[G.current];
  if (cur && cur.pos != null) updateTilePreview(cur.pos, { pulse: true });
}

function bindTileHover() {
  if (tileHoverBound || !tilesEl) return;
  tileHoverBound = true;
  tilesEl.addEventListener('pointerenter', (e) => {
    const tile = e.target.closest?.('.tile');
    if (!tile || !tilesEl.contains(tile)) return;
    const i = Number(tile.dataset.i);
    if (!Number.isNaN(i)) updateTilePreview(i);
  }, true);
  tilesEl.addEventListener('pointerleave', (e) => {
    if (!tilesEl.contains(e.relatedTarget)) syncActivePreview();
  });
}

export function initView() {
  tilesEl = document.getElementById('tiles');
  tokenLayer = document.getElementById('tokenLayer');
  logEl = document.getElementById('log');
  actionsEl = document.getElementById('actions');
  diceEl = document.getElementById('diceSum') || document.getElementById('dice');
  previewEl = document.getElementById('tilePreview');
  updateCommandCenter();
  initFx();
  initLogPanel();
  startAmbience();
  applyBoardTilt(false);
  applyTileArt(true);
  // 老 WebView（<105 不支持 container-type）降级：格子内部尺寸回退 CSS 变量路径
  try {
    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('container-type', 'size')) {
      document.body.classList.add('no-container');
    }
  } catch (_) { /* 部分旧环境 CSS.supports 抛错 */ }
  // Canvas 棋盘层（#13）：支持 canvas 时格子层改由 <canvas> 绘制，#tiles 保留为降级路径
  if (initBoardCanvas((idx) => { if (idx != null) updateTilePreview(idx); else syncActivePreview(); })) {
    if (tilesEl) tilesEl.style.display = 'none';
  } else {
    bindTileHover();
  }
  if (window.addEventListener) {
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        fitBoard();
        repositionAllTokens();
        invalidateCellMetricsCache();
        if (isCanvasMode()) { resizeBoardCanvas(); drawBoard(); }
      }, 80);
    });
  }
}

export function fitBoard() {
  if (typeof window === 'undefined' || !document.getElementById) return;
  const topEl = document.getElementById('top');
  const sideEl = document.getElementById('side');
  const wrapEl = document.getElementById('wrap');
  const mapEl = document.getElementById('mapFrame');
  if (!topEl || !sideEl || !wrapEl) return;
  const root = document.documentElement;
  const setVar = (k, v) => { try { root && root.style && root.style.setProperty(k, v); } catch (_) { } };
  const topH = topEl.offsetHeight || 56;
  setVar('--top-h', topH + 'px');
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  // 21:9 超宽屏（横屏 ratio > 2）：压缩侧栏，让棋盘优先吃满横向空间
  const isUltraWide = vw > 0 && vh > 0 && (vw / vh) > 2;
  // 21:9 竖长屏（竖屏 height > width×2.0）：也压缩侧栏，避免棋盘被挤窄
  const isTallPill = vw > 0 && vh > 0 && (vh / vw) > 2.0;
  const baseSideW = vw >= 1400 ? 420 : vw >= 1100 ? 400 : vw >= 860 ? 380 : 320;
  // CSS 21:9 媒体查询（ratio≥2.333）已压缩侧栏时用实测值；
  // 20:9 等未命中 CSS 的设备（ratio>2 但 <2.333）由 JS 兜底压缩
  const measuredSideW = sideEl.offsetWidth || 0;
  const compressedSideW = Math.max(160, Math.floor(baseSideW * 0.5));
  const sideW = (isUltraWide || isTallPill) && measuredSideW > baseSideW * 0.75
    ? compressedSideW
    : (measuredSideW || baseSideW);
  setVar('--side-w', sideW + 'px');
  const PAD = 16, BPAD = 6, BOARD_PAD = 12;
  const MAP_TOP = 22, MAP_BOT = 16, MAP_SIDE = 8;
  // 优先用 mapFrame 实测尺寸，棋盘铺满可用区域（上下不留黑边）
  let availW = vw - sideW - PAD * 2 - BPAD * 2 - MAP_SIDE * 2 - BOARD_PAD;
  let availH = vh - topH - PAD * 2 - BPAD * 2 - MAP_TOP - MAP_BOT - BOARD_PAD;
  if (mapEl && mapEl.clientWidth > 120) {
    availW = mapEl.clientWidth - MAP_SIDE * 2 - BOARD_PAD;
  }
  if (mapEl && mapEl.clientHeight > 120) {
    availH = mapEl.clientHeight - MAP_TOP - MAP_BOT - BOARD_PAD;
  }
  const gap = 3;
  const MIN_CELL_W = 36;
  const MIN_CELL_H = 22;
  // 宽高独立计算，填满 mapFrame（不再锁 16:9，避免上下大段空白）
  let cellW = Math.max(MIN_CELL_W, Math.floor((availW - gap * (N - 1)) / N));
  let cellH = Math.max(MIN_CELL_H, Math.floor((availH - gap * (N - 1)) / N));
  const realW = cellW * N + gap * (N - 1);
  const realH = cellH * N + gap * (N - 1);
  setVar('--cell-w', cellW + 'px');
  setVar('--cell-h', cellH + 'px');
  setVar('--cell', cellW + 'px');
  setVar('--board-w', realW + 'px');
  setVar('--board-h', realH + 'px');
  setVar('--board-min', Math.min(realW, realH) + 'px');
  const innerN = N - 2;
  const centerW = innerN * cellW + (innerN - 1) * gap;
  const centerH = innerN * cellH + (innerN - 1) * gap;
  setVar('--center-w', centerW + 'px');
  setVar('--center-h', centerH + 'px');
  setVar('--center-min', Math.min(centerW, centerH) + 'px');
  setVar('--center-left', (cellW + gap) + 'px');
  setVar('--center-top', (cellH + gap) + 'px');
  setVar('--board-size', realW + 'px');
  setVar('--gap', gap + 'px');
  // CSS 变量已更新，棋子移动动画使用的格宽缓存必须同步失效
  invalidateCellMetricsCache();
}

export function log(msg, opts) {
  const d = document.createElement('div');
  d.className = 'logEntry';
  const kind = classifyLogKind(msg);
  if (kind) d.classList.add('log-' + kind);
  d.dataset.kind = kind || 'sys';
  d.dataset.text = String(msg);
  const tag = makeLogTag(d.dataset.kind);
  if (tag) d.appendChild(tag);
  const tx = document.createElement('span');
  tx.className = 'logText';
  tx.textContent = msg;
  d.appendChild(tx);
  if (logEl) {
    logEl.prepend(d);
    // 战报上限：生存模式无限回合下 DOM 无限增长会拖垮低端 WebView
    if (typeof logEl.removeChild === 'function') {
      while (logEl.children && logEl.children.length > 100) logEl.removeChild(logEl.lastChild);
    }
    applyEntryFilter(d);
  }
  requestAnimationFrame(() => d.classList.add('in'));
  if (opts === true || (opts && opts.speak)) ttsSpeak(msg);
}

export function clearLog() { if (logEl) logEl.innerHTML = ''; }
export function setDice(t) { if (diceEl) diceEl.textContent = t; }
export function setActionsHTML(html) { if (actionsEl) actionsEl.innerHTML = html; }

export function setActiveTile(idx) {
  if (!tilesEl || G.gameOver) return;
  if (isCanvasMode()) {
    // 当前格由 G.players[G.current].pos 推导，重绘即可
    drawBoard();
    return;
  }
  tilesEl.querySelectorAll('.tile.active').forEach(el => el.classList.remove('active'));
  const cur = G.players && G.players[G.current];
  if (cur && cur.pos === idx) {
    const t = tilesEl.querySelector(`.tile[data-i="${idx}"]`);
    if (t) t.classList.add('active');
  }
}

export function renderPlayers() {
  const pp = document.getElementById('players');
  if (!pp) return;
  pp.innerHTML = '';
  G.players.forEach(p => {
    const owned = TILES.filter(t => t.owner === p.id).length;
    const div = document.createElement('div');
    div.className = 'pl' + (p.id === G.current && !G.gameOver ? ' cur' : '') + (p.bankrupt ? ' bk' : '');
    const tag = (p.inJail ? ' <span style="color:#d05a4a">⛓</span>' : '') + (p.getOut > 0 ? ` <span style="color:var(--phos)">卡${p.getOut}</span>` : '');
    const repTag = formatFactionRep(p, FACTIONS);
    const repHtml = repTag ? ` · <span class="frep" title="派系声望">${escapeHtml(repTag)}</span>` : '';
    const nukeHtml = nukeKeyBadgeHtml(p);
    const handHtml = (Array.isArray(p.cards) && p.cards.length) ? ` <span class="aiTag" title="道具卡">🃏${p.cards.length}</span>` : '';
    const avHtml = avatarHTML(p);
    // 调试：检测头像 HTML 是否异常（开发时保留）
    if (typeof console !== 'undefined' && console.debug) {
      const avCount = (avHtml.match(/class="pva"/g) || []).length;
      if (avCount > 1) console.debug('[renderPlayers] 玩家', p.name, '头像重复', avCount, '次:', avHtml);
    }
    div.title = p.name || ('玩家' + (p.short || ''));
    div.setAttribute('aria-label', div.title);
    div.innerHTML = `<span>${avHtml}${p.isAI ? ' <span class="aiTag">AI</span>' : ''}${tag}${nukeHtml}${handHtml}</span>
      <span><span class="cap">${Math.max(p.caps, 0)}</span>盖 · <span class="nw">净${netWorth(p)}</span> · 产${owned} · <span class="moral">德${Number(p.moral) || 0}</span>${repHtml}</span>`;

    // 地块缩略条：每个拥有产权格一个小色块
    const propThumbs = TILES.filter(t => t.type === 'prop' && t.owner === p.id);
    if (propThumbs.length > 0) {
      const thumbRow = document.createElement('div');
      thumbRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;padding:2px 4px;background:#0e1213;border-radius:2px;';
      propThumbs.forEach(t => {
        const g = GROUPS[t.group];
        const color = g ? g.color : '#888';
        const lv = t.level > 0 ? `<span style="position:absolute;font-size:7px;font-weight:bold;color:#000;line-height:1;top:1px;right:2px;">${t.level}</span>` : '';
        const div2 = document.createElement('div');
        div2.style.cssText = `position:relative;width:14px;height:14px;background:${color};border-radius:2px;border:1px solid #000;opacity:${t.mortgaged ? '0.4' : '1'};display:flex;align-items:center;justify-content:center;overflow:visible;flex-shrink:0;`;
        if (lv) div2.innerHTML = lv;
        thumbRow.appendChild(div2);
      });
      div.appendChild(thumbRow);
    }

    pp.appendChild(div);
    setPlayerRowEl(p, div);
  });
}

/** 垄断成套装发光：收集垄断组地块，Canvas 模式注入绘制，DOM 模式打 class */
export function markMonopolyTiles() {
  if (!tilesEl) return;
  const monoIdx = new Set();
  if (G.players) {
    G.players.forEach(p => {
      if (p.bankrupt) return;
      // 收集该玩家所有垄断组
      const groups = new Set();
      TILES.forEach(t => {
        if (t.type === 'prop' && t.owner === p.id && !t.mortgaged) {
          if (isMonopoly(t)) groups.add(t.group);
        }
      });
      // 属于这些组的 prop 格
      TILES.forEach((t, i) => {
        if (t.type === 'prop' && groups.has(t.group)) monoIdx.add(i);
      });
    });
  }
  if (isCanvasMode()) {
    setMonopolySet(monoIdx);
    drawBoard();
    return;
  }
  tilesEl.querySelectorAll('.tile.tile-v2').forEach(el => el.classList.remove('monopoly-set'));
  monoIdx.forEach(i => {
    const el = tilesEl.querySelector(`.tile[data-i="${i}"]`);
    if (el) el.classList.add('monopoly-set');
  });
}

export function render() {
  fitBoard();
  if (!tilesEl) return;
  if (isCanvasMode()) {
    // Canvas 模式：格子层由 board-canvas 绘制，#tiles 保持空
    tilesEl.innerHTML = '';
    resizeBoardCanvas();
    drawBoard();
  } else {
    tilesEl.innerHTML = '';
    const tileArtOn = isTileArtEnabled();
    for (let i = 0; i < TILES.length; i++) {
      const t = TILES[i]; const [r, c] = positions[i];
      const d = document.createElement('div');
      d.className = 'tile tile-v2 ' + t.type + (r === 0 ? ' top' : r === N - 1 ? ' bot' : c === 0 ? ' left' : c === N - 1 ? ' right' : '');
      if (t.type === 'prop') {
        d.dataset.group = t.group;
        if (t.level === 1) d.classList.add('level-1');
        else if (t.level >= 2) d.classList.add('level-2');
      }
      d.style.gridRow = r + 1; d.style.gridColumn = c + 1;
      d.dataset.i = String(i);
      if (t.type === 'prop' && t.group) {
        const zt = zoneTexUrl(t.group);
        if (zt) d.style.setProperty('--zone-tex', `url("${zt}")`);
      }
      // 顶面贴图模式：把该格的废土插画（artIndex 固定映射）铺成顶面
      if (tileArtOn) {
        const art = tileArtUrl(t.artIndex ?? i);
        if (art) {
          d.dataset.art = '1';
          d.style.setProperty('--tile-art', `url("${art}")`);
        }
      }
      d.innerHTML = buildStripTileHTML(t);
      d.title = tileTip(t);
      if (!G.gameOver && G.players[G.current] && i === G.players[G.current].pos) d.classList.add('active');
      tilesEl.appendChild(d);
    }
  }
  renderPlayers();
  const campCard = document.getElementById('campCard');
  if (campCard) {
    if (G.mode === 'campaign' || G.mode === 'coop') {
      campCard.style.display = '';
      const human = G.players.find(p => !p.isAI);
      const ally = G.players.find(p => p.isAI);
      if (human) {
        const r = G.mode === 'coop'
          ? evaluateCampaignCoop(human, ally, { TILES, netWorth }, G.campaign)
          : evaluateCampaign(human, { TILES, netWorth }, G.campaign);
        const decay = campaignDecayPerTurn(G.campaign);
        const decayNote = decay > 0 ? `<div class="campDecay">☢ 废土衰减：每回合 -${decay} 盖</div>` : '';
        const coopNote = G.mode === 'coop' ? `<div class="campCoop">🤝 合作目标（双人共享）</div>` : '';
        document.getElementById('campObj').innerHTML =
          `<div class="campName">${escapeHtml(r.name)}</div><div class="campBrief">${escapeHtml(r.brief)}</div>` +
          coopNote + decayNote +
          r.objs.map(o => `<div class="campObj ${o.done ? 'done' : ''}">${o.done ? '✔' : '○'} ${escapeHtml(o.text)} <span class="campVal">(${o.value}/${o.goal})</span></div>`).join('');
      }
    } else if (G.mode === 'survival') {
      campCard.style.display = '';
      const tier = Math.floor((G.turn || 0) / 8);
      const decay = tier > 0 ? tier * 5 : 0;
      const nextTierIn = 8 - ((G.turn || 0) % 8);
      document.getElementById('campObj').innerHTML =
        `<div class="campName">☢ 生存模式</div><div class="campBrief">在无尽的废土衰减中活下去</div>` +
        `<div class="campCoop">存活回合：${G.turn || 0}</div>` +
        `<div class="campDecay">衰减等级 ${tier}：每回合 -${decay} 盖` +
        (tier > 0 ? `（下阶段 ${nextTierIn} 回合后 +5）` : `（${nextTierIn} 回合后开始衰减）`) +
        `</div>`;
    } else campCard.style.display = 'none';
  }
  fxMoney(G.players);
  repositionAllTokens();
  syncActivePreview();
  updateCommandCenter();
  markMonopolyTiles();
}

export function repositionAllTokens() {
  if (!G.players) return;
  G.players.forEach((p) => {
    if (p.tokenEl) placeToken(p, p.pos != null ? p.pos : 0);
  });
}

export function buildTokens() {
  if (!tokenLayer) return;
  fitBoard();
  tokenLayer.innerHTML = '';
  G.players.forEach(p => {
    const d = document.createElement('div'); d.className = 'token';
    d.style.background = p.color; d.style.color = '#0c0e0d';
    d.innerHTML = `<div class="tinner">${avatarHTML(p)}</div>`;
    tokenLayer.appendChild(d); p.tokenEl = d; placeToken(p, p.pos || 0);
  });
  fxResetMoney(G.players);
  syncActivePreview();
}

export function placeToken(p, idx, metrics) {
  if (!p.tokenEl || !positions[idx]) return;
  const [r, c] = positions[idx];
  let cellW = CELL, cellH = CELL, gap = 3;
  if (metrics) {
    cellW = metrics.cellW; cellH = metrics.cellH; gap = metrics.gap;
  } else if (typeof getComputedStyle === 'function' && document.documentElement) {
    const cs = getComputedStyle(document.documentElement);
    const w = parseFloat(cs.getPropertyValue('--cell-w'));
    const h = parseFloat(cs.getPropertyValue('--cell-h'));
    const g = parseFloat(cs.getPropertyValue('--gap'));
    if (w > 0) cellW = w;
    if (h > 0) cellH = h;
    if (g > 0) gap = g;
  }
  const slot = TOKEN_SLOT[p.id % TOKEN_SLOT.length] || [0.5, 0.25];
  const tw = Math.max(10, Math.min(cellW, cellH) * 0.26);
  const th = Math.max(10, Math.min(cellW, cellH) * 0.26);
  const liftOff = 4;
  const x = c * (cellW + gap) + slot[0] * cellW - tw / 2;
  const y = r * (cellH + gap) + slot[1] * cellH - th / 2 - liftOff;
  const st = p.tokenEl.style;
  st.left = x + 'px';
  st.top = y + 'px';
  st.width = tw + 'px';
  st.height = th + 'px';
  if (p.id === G.current && !G.gameOver) updateTilePreview(idx, { pulse: true });
}

// 格尺寸缓存已下沉到 board-metrics.js（Canvas / DOM 双模式共用），此处 re-export 兼容旧导入
export { getCellMetrics, invalidateCellMetricsCache };
