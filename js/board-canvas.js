// Canvas 棋盘层（#13 折中方案）：
//   格子层（贴图 / 色条 / 名称 / HUD 徽章 / 垄断·当前·悬停光效）由 <canvas> 绘制；
//   棋子、飘字、金币等动态特效仍走 DOM 层（#tokenLayer / #fxLayer），交互改为命中检测。
// 不支持 canvas 的环境（node mock / 极旧 WebView）由 view-core 自动回退 DOM 格子路径。
import { G } from './state.js';
import { TILES, positions } from './data.js';
import { tileIcon, buildingSVG, iconColor } from './icons.js';
import { tileArtUrl, zoneTexUrl } from './assets-art.js';
import { getCellMetrics, invalidateCellMetricsCache } from './board-metrics.js';
import { tileDisplayName } from './config.js';

const ENABLED = typeof document !== 'undefined' && !!document.documentElement;
const N = 12;

// canvas 无法解析 var()：CSS 变量色值 → 字面量（与 style.css :root 保持一致）
const VAR_COLORS = {
  'var(--rust)': '#b5651d', 'var(--amber)': '#c9a227', 'var(--gang)': '#a31515',
  'var(--tech)': '#3fb6c4', 'var(--bio)': '#b06ad8', 'var(--dim)': '#6f7d76',
  'var(--phos)': '#7fae6e', 'var(--ink)': '#cfe0d2',
};
// 顶边色条（board-v2.css 的 --wallc 映射）
const WALL_COLORS = {
  prop: '#b5651d', market: '#c9a227', gang: '#a31515', tech: '#3fb6c4', bio: '#b06ad8',
  start: '#7fae6e', event: '#6a5acd', tax: '#6f7d76', quarantine: '#d05a4a', safe: '#7fa6a0',
  rail: '#9aa6ad', util: '#4aa3c9', wormhole: '#9a7bff', blackmarket: '#c97f2a',
  bounty: '#d8b13a', oasis: '#4aa3c9', radiation: '#b8d84a', bunker: '#9aa3ad',
};

let canvas = null, ctx = null;
let dpr = 1, boardW = 0, boardH = 0;
let cellW = 0, cellH = 0, gap = 3;
let hoverIdx = -1;
let onHover = null;
let monopolySet = new Set();   // 垄断组地块 idx 集合（view-core 注入）
let redrawScheduled = false;
let tilePulse = null;
let tilePulseRaf = 0;

const imgCache = new Map();    // 贴图 url -> Image
const svgCache = new Map();    // svg+color -> Image（图标按色缓存）
const posIndex = new Map();    // 'r,c' -> idx

function buildPosIndex() {
  if (posIndex.size) return;
  positions.forEach(([r, c], i) => posIndex.set(r + ',' + c, i));
}

export function isCanvasMode() { return !!(ENABLED && canvas && ctx); }

function resolveColor(c) { return VAR_COLORS[c] || c || '#ccc'; }

/** 创建 canvas 并绑定悬停/点按命中检测；失败返回 false（走 DOM 降级） */
export function initBoardCanvas(hoverCb) {
  if (!ENABLED) return false;
  if (canvas) return true;
  onHover = hoverCb || null;
  const inner = document.getElementById('boardInner');
  if (!inner || typeof inner.appendChild !== 'function') return false;
  const probe = document.createElement('canvas');
  if (!probe || typeof probe.getContext !== 'function') return false;
  const c2d = probe.getContext('2d');
  if (!c2d) return false;
  canvas = probe;
  ctx = c2d;
  canvas.id = 'tileCanvas';
  canvas.style.cssText = 'position:absolute;left:0;top:0;z-index:1;';
  inner.appendChild(canvas);
  if (canvas.addEventListener) {
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointer);
    canvas.addEventListener('pointerleave', onLeave);
  }
  return true;
}

/** fitBoard 后同步 canvas 物理尺寸（dpr 缩放保证文字清晰） */
export function resizeBoardCanvas() {
  if (!isCanvasMode()) return false;
  invalidateCellMetricsCache();
  const m = getCellMetrics();
  cellW = m.cellW; cellH = m.cellH; gap = m.gap;
  const inner = canvas.parentElement;
  if (!inner) return false;
  const cs = getComputedStyle(inner);
  const w = parseFloat(cs.width) || 0;
  const h = parseFloat(cs.height) || 0;
  if (w <= 0 || h <= 0) return false;
  boardW = w; boardH = h;
  dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

export function setMonopolySet(set) {
  monopolySet = set instanceof Set ? set : new Set();
}

/** 合帧重绘：同一帧内多次调用只画一次；rAF 被节流（后台页签）时用 setTimeout 兜底 */
export function drawBoard() {
  if (!isCanvasMode()) return false;
  if (redrawScheduled) return true;
  redrawScheduled = true;
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    redrawScheduled = false;
    if (isCanvasMode()) renderAll();
  };
  requestAnimationFrame(run);
  setTimeout(run, 100);
  return true;
}

/** Canvas 主路径的占领/建造瞬态反馈；DOM 降级路径由 fx-events 自己处理。 */
export function pulseTile(tileId, color = '#d18b4b', mode = 'claim', accentColor = '') {
  if (!isCanvasMode()) return false;
  tilePulse = {
    tileId,
    color: resolveColor(color),
    accentColor: resolveColor(accentColor || color),
    mode,
    started: nowMs(),
    progress: 0,
    duration: 620,
  };
  if (!tilePulseRaf) tilePulseRaf = requestAnimationFrame(tickTilePulse);
  return true;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

function tickTilePulse(now) {
  if (!tilePulse || !isCanvasMode()) {
    tilePulseRaf = 0;
    if (isCanvasMode()) renderAll();
    return;
  }
  tilePulse.progress = Math.min(1, Math.max(0, (now - tilePulse.started) / tilePulse.duration));
  renderAll();
  if (tilePulse.progress < 1) tilePulseRaf = requestAnimationFrame(tickTilePulse);
  else {
    tilePulse = null;
    tilePulseRaf = 0;
    renderAll();
  }
}

// ---------------- 交互：命中检测 ----------------
function hitTest(px, py) {
  buildPosIndex();
  const c = Math.floor(px / (cellW + gap));
  const r = Math.floor(py / (cellH + gap));
  if (c < 0 || r < 0 || c >= N || r >= N) return -1;
  const idx = posIndex.get(r + ',' + c);
  return idx == null ? -1 : idx;
}

function onPointer(e) {
  if (!canvas || !e) return;
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  if (!rect) return;
  const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (idx !== hoverIdx) {
    hoverIdx = idx;
    drawBoard();
    if (onHover) onHover(idx >= 0 ? idx : null);
  }
}

function onLeave() {
  if (hoverIdx === -1) return;
  hoverIdx = -1;
  drawBoard();
  if (onHover) onHover(null);
}

// ---------------- 资源 ----------------
function getImg(url) {
  if (!url) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  const img = new Image();
  img.onload = () => drawBoard();
  img.src = url;
  imgCache.set(url, img);
  return img;
}

function svgImage(svg, color) {
  const key = color + '|' + svg;
  if (svgCache.has(key)) return svgCache.get(key);
  const img = new Image();
  img.onload = () => drawBoard();
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.replace(/currentColor/g, color));
  svgCache.set(key, img);
  return img;
}

function tileReady(img) { return img && img.complete && img.naturalWidth > 0; }

// ---------------- 绘制 ----------------
function renderAll() {
  ctx.clearRect(0, 0, boardW, boardH);
  const activeIdx = (!G.gameOver && G.players && G.players[G.current])
    ? G.players[G.current].pos : -1;
  for (let i = 0; i < TILES.length; i++) {
    const [r, c] = positions[i] || [];
    if (r == null) continue;
    drawTile(TILES[i], i, r, c);
  }
  for (let i = 0; i < TILES.length; i++) {
    const [r, c] = positions[i] || [];
    if (r == null) continue;
    drawStateOverlay(TILES[i], i, r, c, activeIdx);
  }
  if (tilePulse) drawTilePulse(tilePulse);
}

function tileXY(r, c) {
  return { x: c * (cellW + gap), y: r * (cellH + gap), w: cellW, h: cellH };
}

function sideOf(r, c) {
  return r === 0 ? 'top' : r === N - 1 ? 'bot' : c === 0 ? 'left' : c === N - 1 ? 'right' : '';
}

function drawTile(t, i, r, c) {
  const { x, y, w, h } = tileXY(r, c);
  const side = sideOf(r, c);
  // 1) 底色
  ctx.fillStyle = '#121816';
  ctx.fillRect(x, y, w, h);
  // 2) 顶面贴图（cover + 焦点偏移，对齐 CSS background-position）
  const art = getImg(tileArtUrl(t.artIndex ?? i));
  if (tileReady(art)) drawCover(art, x, y, w, h, side);
  // 3) 底部压暗渐变（对齐 tile-art 模式的文字可读性处理）
  const grad = ctx.createLinearGradient(0, y + h * 0.62, 0, y + h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // 4) 区域纹理（prop 组，低透明度叠加）
  if (t.type === 'prop' && t.group) {
    const zt = getImg(zoneTexUrl(t.group));
    if (tileReady(zt)) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.globalAlpha = 0.14;
      drawCover(zt, x, y, w, h, side);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
  // 5) 内壁高光 / 底部内阴影
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, w, 1);
  const shade = ctx.createLinearGradient(0, y + h - 8, 0, y + h);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y + h - 8, w, 8);
  // 6) 顶边色条（3px）
  const wall = t.type === 'prop' ? (WALL_COLORS[t.group] || WALL_COLORS.prop) : (WALL_COLORS[t.type] || '#2a3133');
  ctx.fillStyle = wall;
  ctx.fillRect(x, y, w, 3);
  // 7) 边框（避难所绿框）
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.type === 'start' ? '#7fae6e' : '#2a3133';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // 8) 名称（底部对齐、自动换行截断）
  drawTileName(t, x, y, w, h, side);
  // 9) 角标图标（长名隐藏）
  drawTileIcon(t, x, y, w, h, side);
  // 10) HUD：主人色点 + 等级徽章 + 建造图标（右上角一行，右对齐）
  drawTileHud(t, x, y, w, h);
}

function drawCover(img, x, y, w, h, side) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  let dx = x + (w - dw) / 2;
  let dy = y + (h - dh) / 2;
  if (side === 'top' || side === 'bot') dy = y + (h - dh) * 0.42;
  else if (side === 'left' || side === 'right') dx = x + (w - dw) * 0.42;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function wrapText(text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

// 二分找最大字号：让 name 在 (maxW, maxH) 内、≤ maxLines 行，且文字总高 ≤ maxH
// 文字总高（alphabetic 基线、行距 1.12） = (lines-1) * fs * 1.12 + fs
// 字号越小 → 行数越少、文字越窄、总高越小 → 单调，故可二分
function fitFontSizeToCell(name, maxW, maxH, maxLines, fontFamily, hardMaxFs) {
  const LINEMUL = 1.12;
  let lo = 5, hi = hardMaxFs;
  let best = { fs: 5, lines: [] };
  ctx.font = `bold 5px ${fontFamily}`;
  best.lines = wrapText(name, maxW);
  for (let iter = 0; iter < 10; iter++) {
    const fs = (lo + hi) / 2;
    ctx.font = `bold ${fs.toFixed(1)}px ${fontFamily}`;
    const lines = wrapText(name, maxW);
    const totalH = lines.length <= 1
      ? fs
      : fs * ((lines.length - 1) * LINEMUL + 1);
    if (lines.length <= maxLines && totalH <= maxH) {
      best = { fs, lines };
      lo = fs;
    } else {
      hi = fs;
    }
    if (hi - lo < 0.3) break;
  }
  return best;
}

function drawTileName(t, x, y, w, h, side) {
  const plain = tileDisplayName(t);
  const name = plain + (t.mortgaged ? ' [押]' : '');
  const vert = side === 'top' || side === 'bot';
  const FONT = '"Courier New",Consolas,monospace';
  // 视觉上限：短边 ×0.30（避免 4 字名爆出超大字号；短边天然统一顶/底 vs 左/右）
  const HARD_MAX = Math.min(30, Math.min(w, h) * 0.30);
  // 顶/底允许 3 行（很扁的横格），左/右允许 4 行（很窄的竖格）
  const maxLines = vert ? 3 : 4;
  const fit = fitFontSizeToCell(name, w - 6, h - 2, maxLines, FONT, HARD_MAX);
  const fs = fit.fs;
  const lines = fit.lines.slice(0, maxLines);
  if (!lines.length) return;
  ctx.font = `bold ${fs.toFixed(1)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lh = fs * 1.12;
  const y0 = y + h - 2 - (lines.length - 1) * lh;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#f8fbf9';
  lines.forEach((ln, k) => ctx.fillText(ln, x + w / 2, y0 + k * lh));
  // [押] 标红（DOM 版 .mort 色）
  if (t.mortgaged) {
    const last = lines[lines.length - 1];
    const mark = ' [押]';
    if (last.endsWith(mark)) {
      const head = last.slice(0, -mark.length);
      const fullW = ctx.measureText(last).width;
      const headW = ctx.measureText(head).width;
      const lx = x + w / 2 - fullW / 2;
      ctx.fillStyle = '#d05a4a';
      ctx.textAlign = 'left';
      ctx.fillText(mark, lx + headW, y0 + (lines.length - 1) * lh);
      ctx.textAlign = 'center';
    }
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawTileIcon(t, x, y, w, h, side) {
  const plain = tileDisplayName(t);
  if (plain.replace(/\s/g, '').length >= 5) return; // 长名隐藏角标
  const vert = side === 'top' || side === 'bot';
  const s = vert ? Math.max(6, cellH * 0.38) : Math.max(7, Math.min(cellH * 0.26, cellW * 0.18));
  const col = resolveColor(iconColor(t));
  const img = svgImage(tileIcon(t), col);
  if (tileReady(img)) ctx.drawImage(img, x + w - s - 1, y + 1, s, s);
}

function drawTileHud(t, x, y, w, h) {
  if (t.type !== 'prop') return;
  const owner = t.owner != null && G.players && G.players[t.owner] ? G.players[t.owner] : null;
  const level = t.level || 0;
  const dotS = Math.max(7, Math.min(cellH * 0.28, cellW * 0.18));
  const badgeS = Math.max(10, Math.min(cellH * 0.34, cellW * 0.22));
  const buildS = Math.max(10, Math.min(cellH * 0.30, cellW * 0.20));
  // DOM 行序：色点 → 徽章 → 建造图标（右对齐），从右往左排
  let xr = x + w - 1;
  if (level > 0) {
    const col = level >= 2 ? '#a31515' : '#b5651d';
    const img = svgImage(buildingSVG(level), col);
    if (tileReady(img)) ctx.drawImage(img, xr - buildS, y + 1, buildS, buildS);
    xr -= buildS + 2;
  }
  if (level > 0) {
    ctx.beginPath();
    ctx.arc(xr - badgeS / 2, y + 1 + badgeS / 2, badgeS / 2, 0, Math.PI * 2);
    ctx.fillStyle = level >= 2 ? '#a31515' : '#c9a227';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.fillStyle = level >= 2 ? '#fff' : '#000';
    ctx.font = 'bold ' + Math.max(6, cellH * 0.2).toFixed(1) + 'px "Courier New",Consolas,monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(level), xr - badgeS / 2, y + 1 + badgeS / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    xr -= badgeS + 2;
  }
  if (owner) {
    const oc = resolveColor(owner.color);
    // 产权常驻侧边：比整块染色更安静，但能在棋盘上快速扫出归属。
    ctx.fillStyle = oc;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(x + 1, y + 4, Math.max(1.5, Math.min(2.5, w * 0.045)), Math.max(2, h - 5));
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(xr - dotS / 2, y + 1 + dotS / 2, dotS / 2, 0, Math.PI * 2);
    ctx.fillStyle = oc;
    ctx.shadowColor = oc;
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }
}

/** 状态光效叠加：垄断发光 / 当前格 amber / 悬停 phos（第二遍画，避免被邻格内容覆盖） */
function drawStateOverlay(t, i, r, c, activeIdx) {
  const { x, y, w, h } = tileXY(r, c);
  const mono = monopolySet.has(i);
  if (mono) {
    // 对齐 .monopoly-set：主题色描边 + 绿色泛光 + 中心淡绿罩
    const wall = t.type === 'prop' ? (WALL_COLORS[t.group] || WALL_COLORS.prop) : (WALL_COLORS[t.type] || '#7fae6e');
    ctx.save();
    ctx.shadowColor = 'rgba(127,174,110,0.55)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
    ctx.fillStyle = 'rgba(127,174,110,0.10)';
    ctx.fillRect(x, y, w, h);
  }
  if (i === activeIdx) {
    ctx.save();
    ctx.shadowColor = 'rgba(201,162,39,0.5)';
    ctx.shadowBlur = 9;
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    ctx.restore();
  }
  if (i === hoverIdx && i !== activeIdx) {
    ctx.save();
    ctx.shadowColor = 'rgba(127,174,110,0.4)';
    ctx.shadowBlur = 7;
    ctx.strokeStyle = '#7fae6e';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }
}

/** 地产占领协议：中心雷达发出信号，目标地块以玩家色锁定。 */
function drawTilePulse(pulse) {
  const t = TILES[pulse.tileId];
  const pos = positions[pulse.tileId];
  if (!t || !pos) return;
  const { x, y, w, h } = tileXY(pos[0], pos[1]);
  const p = pulse.progress;
  const fade = 1 - p;
  const color = pulse.color || '#d18b4b';
  const accent = pulse.accentColor || color;
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  if (pulse.mode === 'claim') {
    ctx.globalAlpha = 0.72 * fade;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -p * 24;
    ctx.beginPath();
    ctx.moveTo(boardW / 2, boardH / 2);
    ctx.lineTo(cx, cy);
    ctx.stroke();
  }

  if (pulse.mode === 'upgrade' || pulse.mode === 'upgrade-free') {
    // 设施线框从地块底部向上展开，不缩放/重绘整张地块插画。
    const buildP = Math.min(1, p * 1.25);
    const baseY = y + h - 4;
    const topY = baseY - Math.max(4, h * 0.46 * buildP);
    const bw = Math.max(6, w * 0.42);
    const bx = cx - bw / 2;
    ctx.globalAlpha = 0.78 * Math.min(1, buildP * 1.4) * Math.max(0.35, fade);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, baseY);
    ctx.lineTo(bx, topY + 3);
    ctx.lineTo(cx, topY);
    ctx.lineTo(bx + bw, topY + 3);
    ctx.lineTo(bx + bw, baseY);
    ctx.moveTo(bx - 2, baseY);
    ctx.lineTo(bx + bw + 2, baseY);
    ctx.moveTo(cx, topY + 1);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
    ctx.globalAlpha = 0.55 * Math.min(1, p * 1.5);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 4);
    ctx.lineTo(x + 1, y + h - 4);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.95 * Math.max(0.2, fade);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 * fade + 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 + 1.3 * fade;
  const growX = w * 0.10 * p;
  const growY = h * 0.16 * p;
  ctx.strokeRect(x - growX + 0.5, y - growY + 0.5, w + growX * 2 - 1, h + growY * 2 - 1);
  ctx.shadowBlur = 0;

  if (p < 0.78) {
    const marker = pulse.mode === 'claim' ? 'LOCKED' : 'BUILD';
    const fs = Math.max(7, Math.min(11, Math.min(w * 0.18, h * 0.24)));
    ctx.globalAlpha = Math.min(1, (0.78 - p) * 2.2);
    ctx.font = `700 ${fs}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelW = Math.min(w - 4, fs * marker.length * 0.72 + 6);
    const labelH = fs + 5;
    ctx.fillStyle = 'rgba(8, 11, 10, 0.84)';
    ctx.fillRect(cx - labelW / 2, cy - labelH / 2, labelW, labelH);
    ctx.fillStyle = color;
    ctx.fillText(marker, cx, cy + 0.5);
  }
  ctx.restore();
}
