// 事件 / 落地分级动效（与 fx.js 并列，只做表现）
import { haptic, flashScreen, screenShake } from './fx.js';
import { flashLightning, nukeArtHtml } from './assets-art.js';
import { sfx } from './audio.js';
import { getTileRect } from './board-metrics.js';

const ENABLED = typeof document !== 'undefined' && !!document.documentElement;

function reducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}
const RM = ENABLED && reducedMotion();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ART_MOTES = {
  horde: 6, bandit: 4, trap: 5, rad: 5, storm: 7, fire: 8, gas: 6, warp: 6,
  caps: 5, med: 4, gear: 4, dice: 3, chip: 5, dna: 4, drop: 4,
};

let ambTimer = null;

/** 战报条目分类（Tier B icon） */
export function classifyLogKind(msg) {
  const s = String(msg);
  if (s.includes('💀') || s.includes('破产') || s.includes('隔离') || s.includes('尸潮') || s.includes('辐射风暴')) return 'warn';
  if (s.includes('核弹') || s.includes('密钥') || s.includes('导弹井') || s.includes('蘑菇云')
    || (s.includes('☢') && (s.includes('发射') || s.includes('截获') || s.includes('启动') || s.includes('绝对火力')))) return 'nuke';
  if (s.includes('占领') || s.includes('购得') || s.includes('拍卖')) return 'buy';
  if (s.includes('强化') || s.includes('棚户') || s.includes('地堡') || s.includes('Lv')) return 'build';
  if (s.includes('缴租') || (s.includes('支付') && s.includes('盖'))) return 'rent';
  if (s.includes('📖') || s.includes('章节') || s.includes('闯关')) return 'camp';
  if (s.includes('任务') || s.includes('🔗') || s.includes('⚑') || s.includes('//')) return 'event';
  if (s.includes('道德')) return 'moral';
  if (s.includes('盖') && (s.includes('-') || s.includes('+') || s.includes('支付'))) return 'money';
  return '';
}

const ART_FX = {
  horde: 'burst', bandit: 'burst', trap: 'burst', fire: 'burst', warp: 'warp',
  rad: 'smoke', gas: 'smoke', storm: 'smoke',
  caps: 'static', med: 'static', dice: 'static', gear: 'static', chip: 'static', dna: 'static', drop: 'static',
};

/** 解析事件入场 fx：JSON 显式 > art 映射 > 牌堆默认 */
export function resolveEventFx(m) {
  if (!m) return 'static';
  if (m.fx === 'burst' || m.fx === 'smoke' || m.fx === 'static' || m.fx === 'warp') return m.fx;
  if (m.art && ART_FX[m.art]) return ART_FX[m.art];
  if (m.bad) return 'burst';
  if (m.deck === 'faction') return 'smoke';
  if (m.deck === 'ruins') return 'warp';
  return 'static';
}

/** 选支后果摘要（用于 slide-in 条） */
export function formatChoiceResult(eff) {
  eff = eff || {};
  const parts = [];
  if (typeof eff.caps === 'number') parts.push((eff.caps >= 0 ? '+' : '') + eff.caps + '盖');
  if (eff.bonusHalf) parts.push('+50%现金');
  if (typeof eff.moral === 'number') parts.push('道德' + (eff.moral >= 0 ? '+' : '') + eff.moral);
  if (eff.getOut) parts.push('通行证+' + eff.getOut);
  if (eff.skip) parts.push('下回合跳过');
  if (eff.upgrade) parts.push('免费强化');
  if (eff.warp) parts.push('虫洞传送');
  if (eff.rep && typeof eff.rep === 'object') parts.push('派系声望');
  if (Array.isArray(eff.flags) && eff.flags.length) parts.push('获得线索');
  return parts.join(' · ') || '抉择已生效';
}

function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return null;
  return r;
}

function fxLayer() {
  return ENABLED ? document.getElementById('fxLayer') : null;
}

/** 事件弹窗分级粒子入场 */
export function playEventIntro(modalBox, m) {
  if (!modalBox || RM) return;
  const fx = resolveEventFx(m);
  modalBox.classList.remove('evtFx-burst', 'evtFx-smoke', 'evtFx-static', 'evtFx-warp');
  modalBox.classList.add('evtFx-' + fx);
  const old = modalBox.querySelector('.evtFxLayer');
  if (old) old.remove();
  const layer = document.createElement('div');
  layer.className = 'evtFxLayer evtFxLayer-' + fx + (m.bad ? ' bad' : ' good');
  const n = fx === 'static' ? 6 : fx === 'smoke' ? 10 : fx === 'warp' ? 14 : 12;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'evtParticle';
    p.style.setProperty('--i', String(i));
    p.style.setProperty('--a', (360 / n * i) + 'deg');
    layer.appendChild(p);
  }
  modalBox.insertBefore(layer, modalBox.firstChild);
  playEventArtFx(modalBox, m);
}

/** Tier B：事件插画 art 专属叠加层（位图 + SVG 通用） */
export function playEventArtFx(modalBox, m) {
  if (!modalBox || RM || !m || !m.art) return;
  const artEl = modalBox.querySelector('.evtArt');
  if (!artEl) return;
  artEl.classList.remove(...Array.from(artEl.classList).filter(c => c.startsWith('art-')));
  artEl.classList.add('art-' + m.art);
  const old = artEl.querySelector('.evtArtOverlay');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'evtArtOverlay art-' + m.art;
  const n = ART_MOTES[m.art] || 4;
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('span');
    dot.className = 'artMote';
    dot.style.left = (8 + Math.random() * 84) + '%';
    dot.style.top = (12 + Math.random() * 72) + '%';
    dot.style.animationDelay = (i * 0.22) + 's';
    overlay.appendChild(dot);
  }
  artEl.appendChild(overlay);
}

/** Tier B：背景氛围 — 慢渐变 + 偶发远距闪电 */
export function startAmbience() {
  if (!ENABLED || RM || ambTimer) return;
  document.body.classList.add('amb-on');
  ambTimer = setInterval(() => {
    if (Math.random() < 0.14) flashLightning(320);
  }, 42000);
}

/** Tier B：买地 / 升级 brief 建造动效 */
export function playTileBuildFx(tileId, kind = 'buy') {
  if (!ENABLED || RM) return;
  const tileEl = document.querySelector(`.tile[data-i="${tileId}"]`);
  const r = getTileRect(tileId);
  if (!r) return;
  if (tileEl) {
    tileEl.classList.remove('tbuild-buy', 'tbuild-up');
    void tileEl.offsetWidth;
    tileEl.classList.add(kind === 'upgrade' ? 'tbuild-up' : 'tbuild-buy');
  }
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const col = kind === 'upgrade' ? '#c9a227' : '#7fae6e';
  spawnRing(x, y, col, 2.4, 520);
  spawnBurst(x, y, col, kind === 'upgrade' ? 10 : 7);
  if (tileEl) setTimeout(() => tileEl.classList.remove('tbuild-buy', 'tbuild-up'), 680);
}

/** 升级飘字：格子上冒出 +Lv1 / +Lv2 浮动文字 */
export function floatUpgrade(tileId, level) {
  if (!ENABLED || !fxLayer()) return;
  const r = getTileRect(tileId);
  if (!r) return;
  const d = document.createElement('div');
  d.className = 'fxFloat';
  d.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;color:#c9a227;font-size:13px;font-weight:bold;font-family:"Courier New",monospace;letter-spacing:1px;text-shadow:0 0 8px #c9a227,0 1px 2px #000;white-space:nowrap;pointer-events:none;z-index:85;`;
  d.textContent = level >= 2 ? '+Lv2' : '+Lv1';
  fxLayer().appendChild(d);
  if (d.animate) {
    const an = d.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-50%) translateY(-28px) scale(1)', opacity: 1, offset: .4 },
      { transform: 'translate(-50%,-50%) translateY(-48px) scale(.85)', opacity: 0 },
    ], { duration: 1100 * (RM ? .25 : 1), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    an.onfinish = () => d.remove();
  } else {
    d.animate = null;
    setTimeout(() => d.remove(), 1150);
  }
}

/** 选支后结果条 slide-in，再执行 cb */
export function showChoiceResult(modalBox, summary, bad, cb) {
  if (!modalBox || RM) { if (cb) cb(); return Promise.resolve(); }
  return new Promise(resolve => {
    const done = () => { if (cb) cb(); resolve(); };
    const bar = document.createElement('div');
    bar.className = 'fxChoiceResult' + (bad ? ' bad' : ' good');
    bar.textContent = summary;
    modalBox.appendChild(bar);
    void bar.offsetWidth;
    bar.classList.add('in');
    haptic(bad ? 'medium' : 'light');
    setTimeout(() => {
      bar.classList.add('out');
      setTimeout(() => { bar.remove(); done(); }, 280);
    }, 400);
  });
}

function spawnRing(x, y, color, scale = 2.2, ms = 480) {
  const layer = fxLayer();
  if (!layer || RM) return;
  const ring = document.createElement('div');
  ring.className = 'fxLandRing';
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  ring.style.borderColor = color;
  layer.appendChild(ring);
  if (ring.animate) {
    ring.animate(
      [{ transform: 'translate(-50%,-50%) scale(.25)', opacity: .9 },
       { transform: `translate(-50%,-50%) scale(${scale})`, opacity: 0 }],
      { duration: ms, easing: 'ease-out' }).onfinish = () => ring.remove();
  } else setTimeout(() => ring.remove(), ms + 40);
}

function spawnBurst(x, y, color, count = 8) {
  const layer = fxLayer();
  if (!layer || RM) return;
  const n = RM ? 3 : count;
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('span');
    dot.className = 'fxLandDot';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.style.background = color;
    const ang = (Math.PI * 2 * i) / n + Math.random() * .4;
    const dist = 28 + Math.random() * 36;
    layer.appendChild(dot);
    if (dot.animate) {
      dot.animate(
        [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
         { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(.2)`, opacity: 0 }],
        { duration: 420 + Math.random() * 180, easing: 'cubic-bezier(.2,.8,.3,1)' }
      ).onfinish = () => dot.remove();
    } else dot.remove();
  }
}

/** 落地按地块类型短效反馈 */
export function playTileLandFx(type, tokenEl) {
  if (!ENABLED || RM || !tokenEl) return;
  const r = rectOf(tokenEl);
  if (!r) return;
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  switch (type) {
    case 'tax':
      spawnRing(x, y, '#e0574a', 2.6, 520);
      spawnBurst(x, y, '#a31515', 6);
      break;
    case 'oasis':
      spawnRing(x, y, '#7fae6e', 2.8, 560);
      spawnBurst(x, y, '#4aa3c9', 5);
      break;
    case 'event':
      spawnRing(x, y, '#9b6bb8', 2.4, 500);
      spawnBurst(x, y, '#7a4f9a', 7);
      break;
    case 'wormhole':
      spawnRing(x, y, '#6ec4d8', 3.2, 640);
      spawnBurst(x, y, '#4aa3c9', 10);
      break;
    case 'radiation':
      spawnRing(x, y, '#b8d84a', 2.5, 540);
      spawnBurst(x, y, '#8fad2a', 8);
      break;
    case 'bunker':
      spawnRing(x, y, '#9aa3ad', 2.3, 480);
      break;
    case 'blackmarket':
      spawnRing(x, y, '#c9a227', 2.2, 460);
      spawnBurst(x, y, '#c9a227', 5);
      break;
    case 'bounty':
      spawnRing(x, y, '#c9a227', 2.7, 520);
      spawnBurst(x, y, '#ffe9a3', 6);
      break;
    case 'safe':
      spawnRing(x, y, '#7fae6e', 1.8, 420);
      break;
    case 'quarantine':
      spawnRing(x, y, '#a31515', 3, 600);
      break;
    default:
      break;
  }
}

/** 隐藏结局：棋盘中央蘑菇云核爆 */
export async function playNukeStrike() {
  if (!ENABLED) return;
  sfx('nukeStrike');
  flashScreen('rgba(255,248,200,.72)');
  screenShake(2.6);
  haptic('heavy');
  if (RM) {
    await sleep(900);
    flashScreen('rgba(163,21,21,.5)');
    await sleep(600);
    return;
  }
  const board = document.getElementById('board');
  const layer = fxLayer();
  const r = board ? rectOf(board) : null;
  const cx = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const cy = r ? r.top + r.height / 2 : window.innerHeight / 2;

  const flash = document.createElement('div');
  flash.className = 'fxNukeFlash';
  document.body.appendChild(flash);

  const ill = document.createElement('div');
  ill.className = 'fxNukeIllustration';
  ill.innerHTML = nukeArtHtml('strike');
  document.body.appendChild(ill);
  if (ill.animate) {
    ill.animate(
      [{ opacity: 0, transform: 'translate(-50%,-50%) scale(0.88)' },
       { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.18 },
       { opacity: 0.92, transform: 'translate(-50%,-50%) scale(1.04)', offset: 0.55 },
       { opacity: 0, transform: 'translate(-50%,-50%) scale(1.08)' }],
      { duration: 2600, easing: 'ease-out', fill: 'forwards' }
    ).onfinish = () => ill.remove();
  } else setTimeout(() => ill.remove(), 2700);

  if (flash.animate) {
    flash.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0 }],
      { duration: 1800, easing: 'ease-out' }
    ).onfinish = () => flash.remove();
  } else setTimeout(() => flash.remove(), 1900);

  if (layer) {
    const stem = document.createElement('div');
    stem.className = 'fxMushStem';
    stem.style.left = cx + 'px';
    stem.style.top = cy + 'px';
    layer.appendChild(stem);

    const cap = document.createElement('div');
    cap.className = 'fxMushCap';
    cap.style.left = cx + 'px';
    cap.style.top = (cy - 40) + 'px';
    layer.appendChild(cap);

    const ring = document.createElement('div');
    ring.className = 'fxNukeRing';
    ring.style.left = cx + 'px';
    ring.style.top = cy + 'px';
    layer.appendChild(ring);

    // P8: shockwave SVG ring
    const svgNS = 'http://www.w3.org/2000/svg';
    const shockwave = document.createElementNS(svgNS, 'svg');
    shockwave.setAttribute('class', 'fxShockwave');
    shockwave.setAttribute('viewBox', '0 0 100 100');
    shockwave.style.left = cx + 'px';
    shockwave.style.top = cy + 'px';
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', '48');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#ffe9a3');
    circle.setAttribute('stroke-dasharray', '12 8');
    shockwave.appendChild(circle);
    layer.appendChild(shockwave);
    if (shockwave.animate) {
      shockwave.animate(
        [{ transform: 'translate(-50%,-50%) scale(0)', opacity: 0.9, strokeWidth: 18 },
         { transform: 'translate(-50%,-50%) scale(4)', opacity: 0.5, strokeWidth: 4, offset: 0.5 },
         { transform: 'translate(-50%,-50%) scale(22)', opacity: 0, strokeWidth: 0 }],
        { duration: 1400, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }
      ).onfinish = () => shockwave.remove();
    } else setTimeout(() => shockwave.remove(), 1500);

    setTimeout(() => { stem.remove(); cap.remove(); ring.remove(); }, 3200);
  }

  await sleep(400);
  flashScreen('rgba(163,21,21,.45)');
  screenShake(1.4);
  if (board) {
    board.classList.add('board-nuked', 'board-chromatic');
    setTimeout(() => board.classList.remove('board-nuked', 'board-chromatic'), 3200);
  }
  await sleep(1800);
}
