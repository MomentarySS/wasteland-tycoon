// 特效层：3D 骰子、棋子弹跳、金币飞散、飘字、震屏、触感反馈
// 设计约定：本模块只做表现，不参与任何规则判定；在无 DOM 环境（node 测试）下整体降级为空操作。
import { getTileRect } from './board-metrics.js';
import { getPlayerRowEl } from './player-row.js';

const ENABLED = typeof document !== 'undefined'
  && !!document.documentElement
  && typeof document.body === 'object';

function reducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}
const RM = ENABLED && reducedMotion();
const SPEED = RM ? 0.25 : 1;           // 降低动效偏好下整体提速收敛
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canAnimate = el => el && typeof el.animate === 'function';

let fxLayer = null;

export function initFx() {
  if (!ENABLED) return;
  fxLayer = document.getElementById('fxLayer');
  if (!fxLayer) {
    fxLayer = document.createElement('div');
    fxLayer.id = 'fxLayer';
    document.body.appendChild(fxLayer);
  }
  buildDice();
}

// ---------------- 3D 骰子 ----------------
// 面在立方体上的摆放：1 前 / 6 后 / 3 右 / 4 左 / 2 上 / 5 下
// translateZ 取 CSS 变量 --dz，随骰子尺寸在媒体查询里联动，避免小屏时立方体散架
const FACE_PLACE = [
  [1, 'translateZ(var(--dz))'],
  [6, 'rotateY(180deg) translateZ(var(--dz))'],
  [3, 'rotateY(90deg) translateZ(var(--dz))'],
  [4, 'rotateY(-90deg) translateZ(var(--dz))'],
  [2, 'rotateX(90deg) translateZ(var(--dz))'],
  [5, 'rotateX(-90deg) translateZ(var(--dz))'],
];
// 要把某一面转到正面所需的角度 [rotateX, rotateY]
const SHOW = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function faceHTML(n) {
  let s = '';
  for (let i = 0; i < 9; i++) s += PIPS[n].includes(i) ? '<i></i>' : '<b></b>';
  return s;
}
function buildDice() {
  // 对页面上所有带 id="die1/die2" 的骰子补建六个面；id 不固定，方便复用
  document.querySelectorAll('.die').forEach(d => {
    if (d.dataset.built) return;
    d.innerHTML = FACE_PLACE
      .map(([n, t]) => `<div class="dface" style="transform:${t}">${faceHTML(n)}</div>`).join('');
    d.dataset.built = '1';
  });
}

/** 掷骰动画：立方体翻滚落定到 a / b 点数 */
export async function rollDice3D(a, b) {
  if (!ENABLED) return;
  const d1 = document.getElementById('die1'), d2 = document.getElementById('die2');
  if (!d1 || !d2) return;
  buildDice();
  const box = document.getElementById('diceCubes');
  if (box) { box.classList.remove('rolling'); void box.offsetWidth; box.classList.add('rolling'); }

  const dur = Math.round(860 * SPEED);
  [[d1, a, 3], [d2, b, 2]].forEach(([el, v, spins]) => {
    const [rx, ry] = SHOW[v] || [0, 0];
    el.style.transition = 'none';
    el.style.transform = 'rotateX(0deg) rotateY(0deg)';
    void el.offsetWidth;
    el.style.transition = `transform ${dur}ms cubic-bezier(.18,.86,.24,1)`;
    el.style.transform = `rotateX(${360 * spins + rx}deg) rotateY(${360 * spins + ry}deg)`;
  });
  await sleep(dur + 40);
  if (box) box.classList.remove('rolling');
  // 落地一顿
  [d1, d2].forEach(el => { if (canAnimate(el)) el.animate(
    [{ transform: el.style.transform + ' scale(1)' },
     { transform: el.style.transform + ' scale(.88)', offset: .4 },
     { transform: el.style.transform + ' scale(1)' }],
    { duration: 180 * SPEED, easing: 'ease-out' }); });
  haptic('light');
}

// ---------------- 棋子弹跳 ----------------
/** 单格跳跃：squash → 腾空 → 落地微震 */
export function hopToken(p) {
  if (!ENABLED || !p || !p.tokenEl) return;
  const inner = p.tokenEl.querySelector ? p.tokenEl.querySelector('.tinner') : null;
  const target = inner || p.tokenEl;
  if (!canAnimate(target)) return;
  target.animate([
    { transform: 'translateY(0) scale(1,1)' },
    { transform: 'translateY(1px) scale(1.18,.82)', offset: .12 },
    { transform: 'translateY(-9px) scale(.88,1.16)', offset: .45 },
    { transform: 'translateY(0) scale(1.14,.86)', offset: .82 },
    { transform: 'translateY(0) scale(1,1)' },
  ], { duration: 190 * SPEED, easing: 'ease-out' });
}

/** 棋子落定后在脚下扩散一圈尘环 + 落地碎片 */
export function landDust(p) {
  if (!ENABLED || !p || !p.tokenEl || !fxLayer) return;
  const r = rectOf(p.tokenEl);
  if (!r) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const ring = document.createElement('div');
  ring.className = 'fxRing';
  ring.style.left = cx + 'px';
  ring.style.top = cy + 'px';
  ring.style.borderColor = p.color || '#c9a227';
  fxLayer.appendChild(ring);
  if (canAnimate(ring)) {
    const an = ring.animate(
      [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .85 },
       { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }],
      { duration: 420 * SPEED, easing: 'ease-out' });
    an.onfinish = () => ring.remove();
  } else setTimeout(() => ring.remove(), 500);
  // 落地碎片：向两侧下方飞溅的小方块
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'fxDebris';
    d.style.left = cx + 'px';
    d.style.top = cy + 'px';
    d.style.background = p.color || '#7fae6e';
    fxLayer.appendChild(d);
    if (canAnimate(d)) {
      const ang = Math.PI * (0.55 + 0.22 * i) + (Math.random() - 0.5) * 0.4;
      const dx = Math.cos(ang) * (12 + Math.random() * 16);
      const dy = Math.abs(Math.sin(ang)) * (8 + Math.random() * 12) + 5;
      const an = d.animate(
        [{ transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
         { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.35)`, opacity: 0 }],
        { duration: (360 + Math.random() * 200) * SPEED, easing: 'cubic-bezier(.2,.7,.3,1)' });
      an.onfinish = () => d.remove();
    } else setTimeout(() => d.remove(), 600);
  }
}

/** 2.5D：棋子经过的格子留足迹残影（让棋盘活起来） */
export function footprint(p, fromIdx) {
  if (!ENABLED || !fxLayer || RM || !p) return;
  const r = getTileRect(fromIdx);
  if (!r) return;
  const d = document.createElement('div');
  d.className = 'fxFootprint';
  d.style.left = (r.left + r.width / 2) + 'px';
  d.style.top = (r.top + r.height / 2) + 'px';
  d.style.background = p.color || '#7fae6e';
  fxLayer.appendChild(d);
  if (canAnimate(d)) {
    const an = d.animate(
      [{ transform: 'translate(-50%,-50%) scale(.45)', opacity: .75 },
       { transform: 'translate(-50%,-50%) scale(1.7)', opacity: 0 }],
      { duration: 430 * SPEED, easing: 'ease-out' });
    an.onfinish = () => d.remove();
  } else setTimeout(() => d.remove(), 470);
}

// ---------------- 金币 / 飘字 ----------------
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return null;
  return r;
}

/** 从 A 元素飞向 B 元素的一串金币 */
export function coinsBetween(fromEl, toEl, count = 8) {
  if (!ENABLED || !fxLayer) return;
  const a = rectOf(fromEl), b = rectOf(toEl);
  if (!a || !b) return;
  const x0 = a.left + a.width * .7, y0 = a.top + a.height / 2;
  const x1 = b.left + b.width * .7, y1 = b.top + b.height / 2;
  const n = RM ? 3 : count;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'fxCoin';
    fxLayer.appendChild(c);
    if (!canAnimate(c)) { c.remove(); continue; }
    const lift = 40 + Math.random() * 55;
    const jx = (Math.random() - .5) * 26, jy = (Math.random() - .5) * 16;
    const an = c.animate([
      { transform: `translate(${x0}px,${y0}px) scale(.35)`, opacity: 0 },
      { transform: `translate(${x0 + (x1 - x0) * .3 + jx}px,${y0 + (y1 - y0) * .3 - lift}px) scale(1.15)`, opacity: 1, offset: .38 },
      { transform: `translate(${x1 + jx * .3}px,${y1 + jy}px) scale(.55)`, opacity: 0 },
    ], { duration: (560 + Math.random() * 260) * SPEED, delay: i * 42 * SPEED, easing: 'cubic-bezier(.32,.72,.4,1)' });
    an.onfinish = () => c.remove();
  }
}

/** 在元素右侧冒出 ±N 飘字 */
export function floatDelta(el, amount) {
  if (!ENABLED || !fxLayer || !amount) return;
  const r = rectOf(el);
  if (!r) return;
  const up = amount > 0;
  const d = document.createElement('div');
  d.className = 'fxFloat ' + (up ? 'up' : 'down');
  d.textContent = (up ? '+' : '') + amount;
  d.style.left = (r.right - 14) + 'px';
  d.style.top = (r.top + r.height / 2) + 'px';
  fxLayer.appendChild(d);
  if (canAnimate(d)) {
    const an = d.animate([
      { transform: 'translate(-100%,-50%) translateY(4px) scale(.8)', opacity: 0 },
      { transform: 'translate(-100%,-50%) translateY(-6px) scale(1.12)', opacity: 1, offset: .25 },
      { transform: 'translate(-100%,-50%) translateY(-30px) scale(1)', opacity: 0 },
    ], { duration: 950 * SPEED, easing: 'cubic-bezier(.2,.7,.3,1)' });
    an.onfinish = () => d.remove();
  } else setTimeout(() => d.remove(), 1000);
}

// ---------------- 资金变化自动侦测 ----------------
// 每次 render 后比对各玩家瓶盖；一付一收且金额相等即判定为转账，播放金币飞行。
const lastCaps = new Map();
export function fxResetMoney(players) {
  lastCaps.clear();
  (players || []).forEach(p => lastCaps.set(p.id, p.caps));
}
export function fxMoney(players) {
  if (!players || !players.length) return;
  if (!ENABLED) { players.forEach(p => lastCaps.set(p.id, p.caps)); return; }
  const changed = [];
  players.forEach(p => {
    const prev = lastCaps.has(p.id) ? lastCaps.get(p.id) : p.caps;
    const d = p.caps - prev;
    lastCaps.set(p.id, p.caps);
    if (d !== 0) changed.push({ p, d });
  });
  if (!changed.length) return;
  const losers = changed.filter(x => x.d < 0), gainers = changed.filter(x => x.d > 0);
  if (losers.length === 1 && gainers.length === 1 && Math.abs(losers[0].d) === gainers[0].d) {
    coinsBetween(getPlayerRowEl(losers[0].p), getPlayerRowEl(gainers[0].p), Math.min(14, 4 + Math.floor(gainers[0].d / 40)));
  } else {
    gainers.forEach(g => coinsBetween(null, getPlayerRowEl(g.p), 0));
  }
  changed.forEach(x => {
    floatDelta(getPlayerRowEl(x.p), x.d);
    pulseRow(getPlayerRowEl(x.p), x.d > 0);
  });
  if (losers.some(x => x.d <= -100)) { screenShake(.6); haptic('medium'); }
}
function pulseRow(el, up) {
  if (!el || !canAnimate(el)) return;
  const c = up ? 'rgba(127,174,110,.30)' : 'rgba(163,21,21,.32)';
  el.animate([{ background: c }, { background: 'transparent' }],
    { duration: 700 * SPEED, easing: 'ease-out' });
}

// ---------------- 全屏反馈 ----------------
export function screenShake(intensity = 1) {
  if (!ENABLED || RM) return;
  const el = document.getElementById('wrap');
  if (!canAnimate(el)) return;
  const k = 5 * intensity;
  el.animate([
    { transform: 'translate(0,0)' },
    { transform: `translate(${-k}px,${k * .5}px)` },
    { transform: `translate(${k}px,${-k * .4}px)` },
    { transform: `translate(${-k * .6}px,0)` },
    { transform: `translate(${k * .4}px,${k * .3}px)` },
    { transform: 'translate(0,0)' },
  ], { duration: 320, easing: 'ease-out' });
}

export function flashScreen(color = 'rgba(163,21,21,.34)') {
  if (!ENABLED || !fxLayer || RM) return;
  const f = document.createElement('div');
  f.className = 'fxFlash';
  f.style.background = color;
  fxLayer.appendChild(f);
  if (canAnimate(f)) {
    const an = f.animate([{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: 0 }],
      { duration: 480, easing: 'ease-out' });
    an.onfinish = () => f.remove();
  } else setTimeout(() => f.remove(), 500);
}

/** 胜利金币雨 */
export function coinRain(n = 28) {
  if (!ENABLED || !fxLayer || RM) return;
  const W = (typeof window !== 'undefined' && window.innerWidth) || 900;
  const H = (typeof window !== 'undefined' && window.innerHeight) || 700;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'fxCoin';
    fxLayer.appendChild(c);
    if (!canAnimate(c)) { c.remove(); continue; }
    const x = Math.random() * W, s = .7 + Math.random() * .7;
    const an = c.animate([
      { transform: `translate(${x}px,-30px) scale(${s}) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x + (Math.random() - .5) * 140}px,${H + 40}px) scale(${s * .8}) rotate(${360 + Math.random() * 620}deg)`, opacity: .85 },
    ], { duration: 1500 + Math.random() * 1500, delay: Math.random() * 1000, easing: 'cubic-bezier(.32,.1,.62,1)' });
    an.onfinish = () => c.remove();
  }
}

// ---------------- 触感反馈 ----------------
const VIB = { light: 12, medium: [0, 26], heavy: [0, 42, 30, 42], win: [0, 60, 40, 60, 40, 90] };
export function haptic(kind = 'light') {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(VIB[kind] || 12);
    }
  } catch (e) { /* 触感失败不影响游戏 */ }
}
