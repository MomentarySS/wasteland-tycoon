// 全局帧调度器：把「重绘请求」与「脉冲动画」合并到同一条 rAF 循环，
// 避免 board-canvas 的重绘合帧与脉冲各自维护一条 rAF 链。
// 渲染仍由调用方提供（initFrameScheduler 的 tick），本模块只负责「什么时候画」。
//
// 用法：
//   initFrameScheduler(tick, active)  tick = (now) => void；active = () => bool（是否还要继续排帧）
//   scheduleFrameDraw()              请求一次重绘（同一帧内多次调用只画一次）
//
// 后台节流兜底：rAF 在后台页签停摆时，scheduleFrameDraw 仍用 100ms 定时器推进一次
// （沿用重构前 drawBoard 的 setTimeout 兜底语义）。

let tickFn = null;
let activeFn = null;
let rafId = 0;
let drawScheduled = false;
let fallbackTimer = 0;

export function initFrameScheduler(tick, active) {
  tickFn = typeof tick === 'function' ? tick : null;
  activeFn = typeof active === 'function' ? active : null;
}

export function scheduleFrameDraw() {
  drawScheduled = true;
  kickRaf();
  if (!fallbackTimer && typeof setTimeout === 'function') {
    fallbackTimer = setTimeout(() => { fallbackTimer = 0; step(nowMs()); }, 100);
  }
}

function kickRaf() {
  if (rafId) return;
  if (typeof requestAnimationFrame !== 'function') { step(nowMs()); return; }
  rafId = requestAnimationFrame(step);
}

function step(now) {
  rafId = 0;
  const active = drawScheduled || (activeFn ? activeFn() : false);
  drawScheduled = false;
  if (active && tickFn) tickFn(now);
  // 脉冲未结束 / 帧内又来了重绘请求 → 继续排下一帧
  const more = drawScheduled || (activeFn ? activeFn() : false);
  if (more) kickRaf();
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}
