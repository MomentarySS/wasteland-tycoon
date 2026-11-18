#!/usr/bin/env node
// scripts/perf-probe.mjs —— M0 性能基线探针（remaster-plan.md §3.1）
//
// 目的：在**真实 Electron 渲染进程**内，把方案里 D1–D8 的静态推算换成实测数字。
//
// 做法：spawn electron → CDP 连渲染进程 → 用 Page.addScriptToEvaluateOnNewDocument
//       在应用脚本之前注入 instrumentation（包装 rAF / Canvas2D / 位图分配 / CSS 变量写）
//       → 通过 DOM 点击真实驱动对局 → 按三档视口各跑若干次取中位数。
//
// **不改应用一行代码**：所有指标都从外部观测（原型链包装 + CDP），
// 因此测到的就是用户实际跑到的那条路径。
//
// 用法：
//   node scripts/perf-probe.mjs                     # 三档 × 3 次，完整场景
//   node scripts/perf-probe.mjs --repeats 1         # 快速冒烟
//   node scripts/perf-probe.mjs --tiers 1080p@100%  # 只跑某一档
//   node scripts/perf-probe.mjs --rounds 30         # 长局回合数（默认 12）
//   node scripts/perf-probe.mjs --trace             # 额外产出 Chrome trace（体积大）
//   node scripts/perf-probe.mjs --no-launch         # 复用已开着的 --remote-debugging-port
//
// 输出：
//   docs/perf-baseline.json     原始数据（机器可读，供后续 diff）
//   docs/perf-traces/*.json     Chrome trace（仅 --trace）
//   stdout                      Markdown 摘要表
//
// 安全说明：本脚本只在**开发态**（app.isPackaged === false）连接 CDP。
// 生产包 devTools 已关、也没有调试端口，这条路在发布产物里不存在。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_INDEX = path.join(ROOT, 'www', 'index.html');
const OUT_DIR = path.join(ROOT, 'docs');
const TRACE_DIR = path.join(OUT_DIR, 'perf-traces');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 进度同时写文件：stdout 重定向到文件时是块缓冲，长跑看不到中间状态。
// 用法：PERF_PROBE_LOG=.tmpcheck/perf.log node scripts/perf-probe.mjs ...
const LOG_FILE = process.env.PERF_PROBE_LOG || '';
function log(line) {
  process.stdout.write(String(line) + '\n');
  if (LOG_FILE) { try { appendFileSync(LOG_FILE, String(line) + '\n'); } catch (_) {} }
}

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const REPEATS = Math.max(1, parseInt(argVal('repeats', '3'), 10) || 3);
const ROUNDS = Math.max(1, parseInt(argVal('rounds', '12'), 10) || 12);
// 长局场景的时长上限：对局越往后事件/隔离区链越多，不设上限会拖垮整轮基线。
const LONG_CAP_MS = Math.max(20000, parseInt(argVal('long-cap', '150000'), 10) || 150000);
const WANT_TRACE = argv.includes('--trace');
const NO_LAUNCH = argv.includes('--no-launch');
const ONLY_TIER = argVal('tiers', '');
// 分档跑时指定输出文件，方便逐档执行再合并成一份基线
const OUT_JSON = argVal('out', path.join(OUT_DIR, 'perf-baseline.json'));
const PORT = parseInt(argVal('port', '9337'), 10) || 9337;

const TIERS = [
  { name: '1080p@100%', width: 1920, height: 1080, dpr: 1 },
  { name: '1080p@200%', width: 1920, height: 1080, dpr: 2 },
  { name: '4K@150%', width: 3840, height: 2160, dpr: 1.5 },
].filter(t => !ONLY_TIER || t.name === ONLY_TIER);

// ---------------- 注入的 instrumentation ----------------
// 在页面任何脚本之前执行：包装 rAF、Canvas2D 原型、canvas 位图尺寸、CSS 变量写入。
const INSTRUMENT = String.raw`
(() => {
  'use strict';
  const S = window.__perf = {
    v: 2,
    t0: performance.now(),
    frames: [],        // {t, dur, gap, ops, time, ra, canvasMs}
    opsTotal: {},
    opsTimeTotal: {},
    bitmaps: [],       // {t, w, h, bytes}
    fitVarWrites: 0,
    fitVarTime: 0,
    renderAll: 0,
    longTasks: [],
    heap: [],
    dom: [],
  };
  const round1 = (x) => Math.round(x * 10) / 10;

  function pct(arr, p) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  }

  // ---- rAF：帧边界 + 帧内操作桶 ----
  const raf = window.requestAnimationFrame.bind(window);
  let lastFrameEnd = 0;
  let cur = null;
  window.requestAnimationFrame = function (cb) {
    return raf(function (ts) {
      const start = performance.now();
      const bucket = { ops: {}, time: {} };
      cur = bucket;
      try {
        return cb.apply(this, arguments);
      } finally {
        const end = performance.now();
        let canvasMs = 0;
        for (const k in bucket.time) canvasMs += bucket.time[k];
        S.frames.push({
          t: start, dur: end - start,
          gap: lastFrameEnd ? start - lastFrameEnd : 0,
          ops: bucket.ops, time: bucket.time,
          ra: (bucket.ops.clearRect || 0) > 0,
          canvasMs,
        });
        lastFrameEnd = end;
        cur = null;
      }
    });
  };

  // ---- Canvas2D：逐操作计数与耗时 ----
  const P = CanvasRenderingContext2D.prototype;
  const NAMES = [
    'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'measureText',
    'createLinearGradient', 'createRadialGradient', 'createPattern', 'arc', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'rect', 'ellipse', 'save', 'restore', 'translate', 'scale', 'rotate',
    'setTransform', 'setLineDash', 'clip', 'fill', 'stroke', 'quadraticCurveTo', 'bezierCurveTo',
    'putImageData', 'getImageData',
  ];
  for (const name of NAMES) {
    const orig = P[name];
    if (typeof orig !== 'function') continue;
    S.opsTotal[name] = 0;
    S.opsTimeTotal[name] = 0;
    P[name] = function (...a) {
      const t0 = performance.now();
      try {
        const r = orig.apply(this, a);
        if (name === 'measureText' || name === 'createLinearGradient' || name === 'createRadialGradient') {
          // 这两个是 D2/D3 的热点：额外记录返回对象（梯度）/宽度，用于判断是否逐帧新建
        }
        return r;
      } finally {
        const dt = performance.now() - t0;
        S.opsTotal[name]++;
        S.opsTimeTotal[name] += dt;
        if (cur) {
          cur.ops[name] = (cur.ops[name] || 0) + 1;
          cur.time[name] = (cur.time[name] || 0) + dt;
        }
      }
    };
  }

  // ---- 位图重分配：canvas.width/height 赋值 ----
  const wDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const hDesc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  function bitmap(side, v) {
    const w = side === 'w' ? v : wDesc.get.call(this);
    const h = side === 'h' ? v : hDesc.get.call(this);
    S.bitmaps.push({ t: performance.now(), w, h, bytes: Math.round(w * h * 4) });
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    configurable: true, get: wDesc.get, set(v) { bitmap.call(this, 'w', v); return wDesc.set.call(this, v); },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
    configurable: true, get: hDesc.get, set(v) { bitmap.call(this, 'h', v); return hDesc.set.call(this, v); },
  });

  // ---- fitBoard 的 CSS 变量写入（每次 fitBoard 写 13 个） ----
  const sp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (k, v, pr) {
    if (this === document.documentElement.style) {
      const t0 = performance.now();
      try { return sp.call(this, k, v, pr); }
      finally { S.fitVarWrites++; S.fitVarTime += performance.now() - t0; }
    }
    return sp.call(this, k, v, pr);
  };

  // ---- longtask：主线程长任务 ----
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) S.longTasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { S.longTaskErr = String(e); }

  // ---- 周期采样：堆 / DOM ----
  S._timer = setInterval(() => {
    try {
      const mem = performance.memory;
      S.heap.push({ t: Math.round(performance.now()), mb: mem ? Math.round(mem.usedJSHeapSize / 1048576 * 10) / 10 : null });
      S.dom.push({ t: Math.round(performance.now()), n: document.getElementsByTagName('*').length });
    } catch (e) { /* ignore */ }
  }, 500);

  // ---- 对外接口 ----
  window.__perfReset = function () {
    S.frames.length = 0;
    S.bitmaps.length = 0;
    S.longTasks.length = 0;
    S.heap.length = 0;
    S.dom.length = 0;
    for (const k of Object.keys(S.opsTotal)) { S.opsTotal[k] = 0; S.opsTimeTotal[k] = 0; }
    S.fitVarWrites = 0; S.fitVarTime = 0; S.renderAll = 0;
    S.t0 = performance.now();
  };

  window.__perfSnapshot = function () {
    const F = S.frames;
    const ra = F.filter(f => f.ra);
    const burst = F.filter(f => f.gap > 0 && f.gap < 25);
    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const opTotal = (name) => sum(F, f => (f.ops[name] || 0));
    const opTime = (name) => sum(F, f => (f.time[name] || 0));

    // 连续重绘段（renderAll 连续帧）= 一次脉冲/动画。固定时间窗会把多次动画混在一起，
    // 所以按「连续 ra 帧」切段，取最长那段作为脉冲成本。
    const bursts = [];
    let curB = null;
    for (const f of F) {
        if (f.ra) {
          if (!curB) curB = { n: 0, canvasMs: [], durs: [], gaps: [], mt: [], t0: f.t, t1: f.t };
          curB.n++;
          curB.canvasMs.push(f.canvasMs);
          curB.durs.push(f.dur);
          if (f.gap) curB.gaps.push(f.gap);
          curB.mt.push(f.ops.measureText || 0);
          curB.t1 = f.t;
        } else if (curB) { bursts.push(curB); curB = null; }
    }
    if (curB) bursts.push(curB);
    const longest = bursts.reduce((a, b) => (b.n > (a ? a.n : 0) ? b : a), null);
    return {
      wallMs: Math.round(performance.now() - S.t0),
      frames: F.length,
      frame: {
        durP50: round1(pct(F.map(f => f.dur), 0.5)),
        durP95: round1(pct(F.map(f => f.dur), 0.95)),
        gapP50: round1(pct(F.map(f => f.gap), 0.5)),
        gapP95: round1(pct(F.map(f => f.gap), 0.95)),
        gapMax: round1(pct(F.map(f => f.gap), 1)),
        canvasMsP50: round1(pct(F.map(f => f.canvasMs), 0.5)),
        canvasMsP95: round1(pct(F.map(f => f.canvasMs), 0.95)),
        canvasMsMax: round1(pct(F.map(f => f.canvasMs), 1)),
      },
      burst: {
        count: burst.length,
        durP50: round1(pct(burst.map(f => f.dur), 0.5)),
        durP95: round1(pct(burst.map(f => f.dur), 0.95)),
        gapP50: round1(pct(burst.map(f => f.gap), 0.5)),
        gapP95: round1(pct(burst.map(f => f.gap), 0.95)),
      },
      raBursts: {
        count: bursts.length,
        longest: longest ? {
          frames: longest.n,
          spanMs: Math.round(longest.t1 - longest.t0),
          canvasMsP50: round1(pct(longest.canvasMs, 0.5)),
          canvasMsP95: round1(pct(longest.canvasMs, 0.95)),
          durP50: round1(pct(longest.durs, 0.5)),
          durP95: round1(pct(longest.durs, 0.95)),
          gapP50: round1(pct(longest.gaps, 0.5)),
          gapP95: round1(pct(longest.gaps, 0.95)),
          gapMax: round1(pct(longest.gaps, 1)),
          measureTextPerFrame: pct(longest.mt, 0.5),
        } : null,
        all: bursts.slice(0, 6).map(b => ({ frames: b.n, canvasMsP50: round1(pct(b.canvasMs, 0.5)) })),
      },
      renderAll: {
        frames: ra.length,
        canvasMsP50: round1(pct(ra.map(f => f.canvasMs), 0.5)),
        canvasMsP95: round1(pct(ra.map(f => f.canvasMs), 0.95)),
        canvasMsMax: round1(pct(ra.map(f => f.canvasMs), 1)),
        measureTextP50: pct(ra.map(f => (f.ops.measureText || 0)), 0.5),
        measureTextMax: pct(ra.map(f => (f.ops.measureText || 0)), 1),
        gradientsP50: pct(ra.map(f => ((f.ops.createLinearGradient || 0) + (f.ops.createRadialGradient || 0))), 0.5),
        gradientsMax: pct(ra.map(f => ((f.ops.createLinearGradient || 0) + (f.ops.createRadialGradient || 0))), 1),
        drawImageP50: pct(ra.map(f => (f.ops.drawImage || 0)), 0.5),
        fillTextP50: pct(ra.map(f => (f.ops.fillText || 0)), 0.5),
      },
      ops: {
        measureText: opTotal('measureText'),
        createLinearGradient: opTotal('createLinearGradient'),
        drawImage: opTotal('drawImage'),
        fillRect: opTotal('fillRect'),
        fillText: opTotal('fillText'),
        setTransform: opTotal('setTransform'),
      },
      opsMs: {
        measureText: round1(opTime('measureText')),
        createLinearGradient: round1(opTime('createLinearGradient')),
        drawImage: round1(opTime('drawImage')),
        fillRect: round1(opTime('fillRect')),
      },
      fitVarWrites: S.fitVarWrites,
      fitVarTimeMs: round1(S.fitVarTime),
      bitmaps: {
        count: S.bitmaps.length,
        bytes: S.bitmaps.reduce((a, b) => a + b.bytes, 0),
        largest: S.bitmaps.reduce((a, b) => Math.max(a, b.bytes), 0),
        samples: S.bitmaps.slice(0, 6),
      },
      longTasks: S.longTasks.length,
      longTaskMax: S.longTasks.reduce((a, b) => Math.max(a, b.dur), 0),
      longTaskSamples: S.longTasks.filter(t => t.dur >= 50).slice(0, 8),
      visibility: document.visibilityState,
      hidden: document.hidden,
      domNow: document.getElementsByTagName('*').length,
      heapNowMb: performance.memory ? round1(performance.memory.usedJSHeapSize / 1048576) : null,
      heapSeries: S.heap.slice(-8),
      domSeries: S.dom.slice(-8),
    };
  };

  // 刷新率：空 rAF 循环的帧间隔中位数
  window.__perfRefreshRate = function () {
    return new Promise(resolve => {
      const gaps = [];
      let last = 0;
      function step() {
        const now = performance.now();
        if (last) gaps.push(now - last);
        last = now;
        if (gaps.length < 90) requestAnimationFrame(step);
        else {
          const med = pct(gaps, 0.5);
          resolve({ medianGapMs: round1(med), hz: round1(1000 / med) });
        }
      }
      requestAnimationFrame(step);
    });
  };

  // ---------- 对局驱动（真实点击 UI）----------
  // 关键坑：#modal 隐藏靠 CSS（默认 display:none），内联 style.display 初始是空串，
  // 必须用 getComputedStyle 判断；点击掷骰后 rollBtn 会留在 DOM 里直到面板替换它。
  window.__perfModalOpen = function () {
    const m = document.getElementById('modal');
    return !!(m && getComputedStyle(m).display !== 'none');
  };
  // 弹窗处理：项目里有十几种模态（事件选项 / 超频骰 / 核弹 / 黑市 / 辐射 / 掩体 /
  // 章节叙事 / 手牌 / 目标列表 / 拍卖 / 资产管理），按钮 id 各不相同。
  // 策略：先点「安全项」（不花钱、不触发结局、不结束对话），否则点最后一个可用按钮 ——
  // 这些弹窗的最后一项按约定都是「离开 / 关闭 / 返回」。绝不点 nukeGo（会直接核平获胜）。
  const MODAL_SAFE = ['mc0', 'sd0', 'nukeWait', 'hdClose', 'tgBack', 'bmLeave', 'radLeave', 'bkLeave', 'chGo', 'bmCard'];
  window.__perfPickModal = function () {
    const ma = document.getElementById('modalActions');
    if (!ma) return null;
    const btns = Array.from(ma.querySelectorAll('button')).filter(b => !b.disabled);
    if (!btns.length) return null;
    for (const id of MODAL_SAFE) {
      const b = btns.find(x => x.id === id);
      if (b) { b.click(); return b.id; }
    }
    const firstMc = btns.find(x => /^mc\d+$/.test(x.id));
    if (firstMc) { firstMc.click(); return firstMc.id; }
    const last = btns[btns.length - 1];
    last.click();
    return last.id;
  };
  // 隔离区按钮：优先出狱卡（免费），其次掷骰逃出，最后才付保释金
  window.__perfJailBtn = function () {
    return document.querySelector('#jb1') || document.querySelector('#jb3') || document.querySelector('#jb2') || null;
  };
  window.__perfHasPanel = function () {
    return !!(document.querySelector('#buyBtn') || document.querySelector('#upBtn')
      || document.querySelector('#endBtn') || window.__perfModalOpen() || window.__perfJailBtn());
  };
  /** 把当前回合收干净（处理模态 / 隔离区 + 结束回合），不触发购买脉冲。 */
  window.__perfSettle = async function (timeoutMs) {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    while (performance.now() - t0 < (timeoutMs || 25000)) {
      if (window.__perfModalOpen()) { window.__perfPickModal(); await sl(250); continue; }
      const jb = window.__perfJailBtn();
      if (jb) { jb.click(); await sl(1500); continue; }
      if (document.querySelector('#rollBtn')) return 'roll';
      const e = document.querySelector('#endBtn');
      if (e) { e.click(); await sl(250); continue; }
      await sl(100);
    }
    return 'timeout';
  };
  /**
   * 完整操作一个人类回合：从「待掷骰」开始，直到回合推进（操作栏空、轮到 AI）。
   * 状态机式循环而不是线性脚本 —— 因为实际对局会经过：掷骰 → 移动 → 落点面板
   * → 购买/升级 → （双数补掷）→ 结束回合 → AI 回合，中间还会插事件模态与隔离区。
   */
  window.__perfPlayOneRound = async function () {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    const actions = [];
    let guard = 0;
    while (guard++ < 500) {
      // 单回合硬上限：对局越往后事件链越长，超了就收尾，别把整轮基线拖死
      if (performance.now() - t0 > 45000) return { actions, ms: Math.round(performance.now() - t0), capped: true };
      const win = document.querySelector('#win');
      if (win && win.style.display !== 'none') return { actions, gameOver: true, ms: Math.round(performance.now() - t0) };
      if (window.__perfModalOpen()) {
        const id = window.__perfPickModal();
        if (id) { actions.push('modal:' + id); await sl(900); continue; }
      }
      const jb = window.__perfJailBtn();
      if (jb) { jb.click(); actions.push('jail'); await sl(1600); continue; }
      const b = document.querySelector('#buyBtn');
      const u = document.querySelector('#upBtn');
      if (b && !b.disabled) { b.click(); actions.push('buy'); await sl(800); continue; }
      if (u && !u.disabled) { u.click(); actions.push('upgrade'); await sl(800); continue; }
      const e = document.querySelector('#endBtn');
      if (e) { e.click(); actions.push('end'); await sl(1200); continue; }
      if (document.querySelector('#rollBtn')) {
        document.querySelector('#rollBtn').click();
        actions.push('roll');
        // 等落点面板（点击后 rollBtn 仍在 DOM 里，不能拿它当等待条件）
        for (let i = 0; i < 160; i++) { await sl(100); if (window.__perfHasPanel()) break; }
        continue;
      }
      // 既没有面板也没有 rollBtn → 多半轮到 AI 了，确认一下再收尾
      let quiet = true;
      for (let i = 0; i < 6; i++) {
        await sl(250);
        if (window.__perfHasPanel() || document.querySelector('#rollBtn')) { quiet = false; break; }
      }
      if (quiet) return { actions, ms: Math.round(performance.now() - t0) };
    }
    return { actions, ms: Math.round(performance.now() - t0), guardExpired: true };
  };

  window.__perfState = function () {
    return {
      players: document.querySelectorAll('#players .pl').length,
      logEntries: document.querySelectorAll('#log .logEntry').length,
      logSummary: document.querySelectorAll('#log .logSummary').length,
      logSummaryText: (document.querySelector('#log .logSummary') || {}).textContent || '',
      fxNodes: document.querySelectorAll('#fxLayer > *').length,
      actions: (document.querySelector('#actions') || {}).textContent || '',
      hasRoll: !!document.querySelector('#rollBtn'),
      gameOver: G_gameOver(),
    };
    function G_gameOver() {
      const win = document.querySelector('#win');
      return !!(win && win.style.display !== 'none');
    }
  };
})();
`;

// ---------------- CDP 客户端 ----------------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  on(fn) { this.listeners.push(fn); return fn; }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method) { for (const fn of this.listeners) { try { fn(m); } catch (_) {} } }
    };
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = ++this.id;
      this.pending.set(i, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function connect(port) {
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) { targets = await r.json(); break; }
    } catch (_) {}
    await sleep(250);
  }
  if (!targets) throw new Error('CDP 端口无响应: ' + port);
  const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url)) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('未找到页面 target');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

async function launchElectron() {
  const require = createRequire(import.meta.url);
  const electronBin = require('electron');
  // 关闭后台节流：否则窗口被遮挡时 rAF 会被降到 ~1Hz，量到的就是「后台行为」而不是前台体验。
  // （方案 D9 把 backgroundThrottling 列为未设置项，这里显式固定为前台口径。）
  const proc = spawn(electronBin, [
    '.',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ROOT, '.tmp-perf-profile')}`,
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
    windowsHide: true,
  });
  let err = '';
  proc.stderr.on('data', d => { err += d.toString(); });
  proc.on('error', e => { err += String(e.message || e); });
  try {
    return { proc, err };
  } catch (e) {
    throw new Error('Electron 启动失败: ' + (err || e.message));
  }
}

// ---------------- 页面操作 ----------------
async function evalPage(cdp, expression, { awaitPromise = true } = {}) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) {
    throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  }
  return r.result ? r.result.value : undefined;
}

async function pageState(cdp) {
  return evalPage(cdp, `(() => ({
    visibility: document.visibilityState,
    overlay: (document.querySelector('#overlay')||{}).style ? document.querySelector('#overlay').style.display : null,
    win: (document.querySelector('#win')||{}).style ? document.querySelector('#win').style.display : null,
    modal: getComputedStyle(document.getElementById('modal')).display,
    actions: (document.querySelector('#actions')||{}).textContent || '',
    roll: !!document.querySelector('#rollBtn'),
    panel: !!document.querySelector('#buyBtn'), up: !!document.querySelector('#upBtn'), end: !!document.querySelector('#endBtn'),
    players: document.querySelectorAll('#players .pl').length,
    log: document.querySelectorAll('#log .logEntry').length,
    logSummary: document.querySelectorAll('#log .logSummary').length,
    logSummaryText: (document.querySelector('#log .logSummary')||{}).textContent || '',
    fxNodes: document.querySelectorAll('#fxLayer > *').length,
    logText: Array.from(document.querySelectorAll('#log .logEntry')).slice(0, 5).map(e => e.textContent),
    turn: (document.querySelector('#ccTurn')||{}).textContent || '',
  }))()`, { awaitPromise: false });
}

async function waitFor(cdp, expr, timeoutMs = 20000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalPage(cdp, expr, { awaitPromise: false });
    if (v) return true;
    await sleep(200);
  }
  const st = await pageState(cdp).catch(e => ({ err: String(e.message || e) }));
  throw new Error('等待超时: ' + label + ' | 页面状态: ' + JSON.stringify(st));
}

async function setupTier(cdp, tier) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: tier.width, height: tier.height, deviceScaleFactor: tier.dpr, mobile: false,
  });
  // 本机系统设置是 prefers-reduced-motion: reduce —— 那会整条关掉 pulseTile 动画
  // （fx-events.js 的 RM 分支），D2 热点就处于「休眠」状态。
  // 基线要量的是**完整动画路径的最坏情况**，所以显式模拟 no-preference。
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
  await waitFor(cdp, `!!(window.__perf && document.querySelector('#startBtn'))`, 30000, '应用就绪');
  try { await cdp.send('Page.bringToFront'); } catch (_) {}
  // 让首屏渲染与图片解码稳定
  await sleep(2500);
}

async function resetAndWait(cdp, ms) {
  await evalPage(cdp, `window.__perfReset()`, { awaitPromise: false });
  await sleep(ms);
}

/** 把当前回合收干净（处理模态 + 结束回合），不触发购买脉冲。 */
async function settle(cdp, timeoutMs = 25000) {
  const r = await evalPage(cdp, `window.__perfSettle(${timeoutMs})`, { awaitPromise: true });
  return r === 'roll';
}

// ---------------- 场景 ----------------
async function scenarioStart(cdp) {
  // 首次开局：量首局 render() 全链路（fitBoard + 位图分配 + drawBoard 合帧情况）
  // 注意：必须在全新页面上做 —— startGame() 不是幂等的，开局后再点启动会留下不一致状态。
  await evalPage(cdp, `(() => { const b=document.querySelector('#startBtn'); if(b) b.click(); return true; })()`, { awaitPromise: false });
  await waitFor(cdp, `!!document.querySelector('#rollBtn')`, 15000, '开局完成');
  await sleep(1500);
  return evalPage(cdp, `window.__perfSnapshot()`, { awaitPromise: false });
}

async function scenarioIdle(cdp) {
  // 开局后静置：不应有任何重绘（应用无空闲 rAF 主循环）
  await sleep(1500);
  await resetAndWait(cdp, 3000);
  return evalPage(cdp, `window.__perfSnapshot()`, { awaitPromise: false });
}

async function scenarioTurn(cdp) {
  if (!(await settle(cdp))) { await restartGame(cdp); if (!(await settle(cdp))) return null; }
  await resetAndWait(cdp, 200);
  const t0 = Date.now();
  const round = await evalPage(cdp, `window.__perfPlayOneRound()`, { awaitPromise: true });
  const wallMs = Date.now() - t0;
  log(`  [turn] 驱动动作序列: ${JSON.stringify(round && round.actions)}`);
  const snap = await evalPage(cdp, `window.__perfSnapshot()`, { awaitPromise: false });
  return { ...snap, scenarioWallMs: wallMs, round };
}

async function scenarioPulse(cdp) {
  // 跑完整回合（含购买/升级），再从连续重绘段里挑出脉冲。
  // 比「反复掷骰直到落到可购买格」更贴近真实对局，也不会因为隔离区/事件卡住。
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await settle(cdp))) { await restartGame(cdp); if (!(await settle(cdp))) return null; }
    await resetAndWait(cdp, 200);
    const round = await evalPage(cdp, `window.__perfPlayOneRound()`, { awaitPromise: true });
    const snap = await evalPage(cdp, `window.__perfSnapshot()`, { awaitPromise: false });
    const lb = snap.raBursts.longest;
    if (lb && lb.frames >= 20) return { ...snap, round };
  }
  return null;
}

/** 上一局结束（破产/胜利）后，重开一局干净的对局 —— 长局趋势测量必须有起点。 */
async function restartGame(cdp) {
  await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
  await waitFor(cdp, `!!(window.__perf && document.querySelector('#startBtn'))`, 30000, '应用就绪');
  try { await cdp.send('Page.bringToFront'); } catch (_) {}
  await sleep(1500);
  await evalPage(cdp, `(() => { const b=document.querySelector('#startBtn'); if(b) b.click(); return true; })()`, { awaitPromise: false });
  await waitFor(cdp, `!!document.querySelector('#rollBtn') || !!window.__perfJailBtn()`, 15000, '开局完成');
  await sleep(1200);
}

async function scenarioRounds(cdp, rounds) {
  if (!(await settle(cdp))) {
    await restartGame(cdp);
    if (!(await settle(cdp))) return null;
  }
  await resetAndWait(cdp, 300);
  const t0 = Date.now();
  const events = [];
  const capMs = LONG_CAP_MS;
  for (let i = 0; i < rounds; i++) {
    if (Date.now() - t0 > capMs) { log(`  [rounds] 达到时长上限 ${capMs}ms，提前收尾（已跑 ${i} 回合）`); break; }
    let ready = false;
    for (let k = 0; k < 300; k++) {
      // 人类回合可能以「待掷骰」或「隔离区」两种状态开始
      if (await evalPage(cdp, `!!document.querySelector('#rollBtn') || !!window.__perfJailBtn()`, { awaitPromise: false })) { ready = true; break; }
      await sleep(100);
    }
    if (!ready) break;
    const res = await evalPage(cdp, `window.__perfPlayOneRound()`, { awaitPromise: true });
    events.push(res);
    if (res.ms > 25000) log(`  [rounds] 第 ${i + 1} 回合耗时 ${res.ms}ms（偏长，可能有事件/隔离区链）`);
    if (res.gameOver) break;
  }
  const wallMs = Date.now() - t0;
  const snap = await evalPage(cdp, `window.__perfSnapshot()`, { awaitPromise: false });
  const state = await evalPage(cdp, `window.__perfState()`, { awaitPromise: false });
  log(`  [rounds] 每回合动作: ${events.map(e => `[${e.ms}ms]${(e.actions || []).join(',')}`).join(' | ')}`);
  return { ...snap, scenarioWallMs: wallMs, events, state };
}

// ---------------- trace ----------------
async function captureTrace(cdp, name) {
  if (!WANT_TRACE) return null;
  mkdirSync(TRACE_DIR, { recursive: true });
  const chunks = [];
  const listener = cdp.on((m) => {
    if (m.method === 'Tracing.dataCollected') chunks.push(...m.params.value);
    else if (m.method === 'Tracing.tracingComplete') done(m.params);
  });
  let done = () => {};
  const finished = new Promise((res) => { done = res; });
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['devtools.timeline', 'blink.user_timing', 'v8', 'cc', 'gpu'] },
    transferMode: 'ReportEvents',
  });
  await sleep(2600);                       // 采一段移动/结算
  await cdp.send('Tracing.end');
  await finished;
  const file = path.join(TRACE_DIR, name + '.json');
  writeFileSync(file, JSON.stringify({ traceEvents: chunks }));
  cdp.listeners = cdp.listeners.filter(l => l !== listener);
  return { file: path.relative(ROOT, file), events: chunks.length, bytes: JSON.stringify({ traceEvents: chunks }).length };
}

// ---------------- 统计 ----------------
function medianOf(arr, pick) {
  const v = arr.map(pick).filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.5))];
}
const r1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

// ---------------- 主流程 ----------------
async function main() {
  if (!TIERS.length) throw new Error('没有匹配的档位: ' + ONLY_TIER);
  if (!existsSync(path.join(ROOT, 'www', 'index.html'))) {
    throw new Error('www/index.html 不存在，请先跑 node scripts/sync-www.mjs');
  }

  let proc = null;
  let cdp = null;
  const launchErr = '';
  try {
    if (!NO_LAUNCH) {
      log('=== 启动 Electron ===');
      ({ proc } = await launchElectron());
    }
    log('=== 连接 CDP ===');
    cdp = await connect(PORT);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });

    // 收集控制台错误/警告，随基线一起输出（渲染异常往往先在这里露头）
    const consoleMsgs = [];
    cdp.on((m) => {
      if (m.method !== 'Runtime.consoleAPICalled') return;
      if (m.params.type !== 'error' && m.params.type !== 'warning') return;
      const text = (m.params.args || []).map(a => (a.value !== undefined ? a.value : (a.description || a.type))).join(' ');
      consoleMsgs.push({ type: m.params.type, text: String(text).slice(0, 300) });
    });

    const rmBefore = await evalPage(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`, { awaitPromise: false }).catch(() => null);
    const meta = {
      probe: 'scripts/perf-probe.mjs',
      date: new Date().toISOString(),
      repeats: REPEATS,
      rounds: ROUNDS,
      node: process.version,
      platform: process.platform + ' ' + process.arch,
      electron: requireElectronVersion(),
      chromium: await evalPage(cdp, `navigator.userAgent`, { awaitPromise: false }).catch(() => null),
      tiers: TIERS.map(t => t.name),
      // 本机系统原本是 reduce（动画整条关掉）；探针强制 no-preference 以量完整动画路径
      reducedMotionNative: rmBefore,
      reducedMotionEmulated: 'no-preference',
      chromiumFlags: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    };

    const results = [];
    for (const tier of TIERS) {
      log(`\n=== 档位 ${tier.name} (${tier.width}×${tier.height} @${tier.dpr}x) × ${REPEATS} 次 ===`);
      const runs = [];
      for (let rep = 0; rep < REPEATS; rep++) {
        log(`  --- 第 ${rep + 1}/${REPEATS} 次 ---`);
        await setupTier(cdp, tier);
        const refresh = await evalPage(cdp, `window.__perfRefreshRate()`, { awaitPromise: true });
        log(`  刷新率: ${refresh.hz}Hz (帧间隔 ${refresh.medianGapMs}ms)`);

        const start = await scenarioStart(cdp);
        log(`  [start] fitVarWrites=${start.fitVarWrites} bitmaps=${start.bitmaps.count} (${Math.round(start.bitmaps.bytes / 1048576)}MB) renderAll=${start.renderAll.frames} canvasMsP50=${start.renderAll.canvasMsP50}`);

        const idle = await scenarioIdle(cdp);
        log(`  [idle]  frames=${idle.frames} longTasks=${idle.longTasks} dom=${idle.domNow} heap=${idle.heapNowMb}MB`);

        const turn = await scenarioTurn(cdp);
        if (turn) log(`  [turn]  ${turn.scenarioWallMs}ms frames=${turn.frames} canvasMsP95=${turn.frame.canvasMsP95} renderAll=${turn.renderAll.frames}`);
        else log('  [turn]  跳过（未等到落点面板）');

        const pulse = await scenarioPulse(cdp);
        if (pulse) {
          const lb = pulse.raBursts.longest;
          log(`  [pulse] 连续重绘段 ${pulse.raBursts.count} 段，最长 ${lb ? lb.frames : 0} 帧`
            + ` | canvasMs P50=${lb ? lb.canvasMsP50 : '-'} P95=${lb ? lb.canvasMsP95 : '-'}`
            + ` | 帧间隔 P50=${lb ? lb.gapP50 : '-'} P95=${lb ? lb.gapP95 : '-'}`
            + ` | measureText/帧=${lb ? lb.measureTextPerFrame : '-'}`);
        } else {
          log('  [pulse] 本档未捕获到脉冲（可能没落到可购买地块）');
        }

        const long = await scenarioRounds(cdp, ROUNDS);
        if (long) log(`  [rounds] ${ROUNDS} 回合 ${Math.round(long.scenarioWallMs / 1000)}s dom=${long.domNow} heap=${long.heapNowMb}MB log=${long.state.logEntries}`);
        else log('  [rounds] 跳过（未回到可掷骰状态）');

        const trace = await captureTrace(cdp, `${tier.name.replace(/[^a-z0-9]/gi, '_')}-r${rep + 1}`);
        if (trace) log(`  [trace] ${trace.events} 事件 ${Math.round(trace.bytes / 1048576)}MB`);

        runs.push({ rep: rep + 1, refresh, idle, start, turn, pulse, long, trace });
      }
      results.push({ tier, runs });
    }

    // -------- 聚合 --------
    const baseline = { ...buildBaseline(meta, results), console: consoleMsgs };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(baseline, null, 2));
    log('\n=== 完成 ===');
    log('写出: ' + OUT_JSON);
    log('\n' + renderMarkdown(baseline));
    if (WANT_TRACE) log('trace: docs/perf-traces/');
    if (consoleMsgs.length) {
      log('\n=== 控制台错误/警告 (' + consoleMsgs.length + ') ===');
      for (const m of consoleMsgs.slice(0, 20)) log(`  [${m.type}] ${m.text}`);
    }
  } finally {
    if (cdp) cdp.close();
    if (proc) proc.kill();
  }
}

function requireElectronVersion() {
  try {
    const require = createRequire(import.meta.url);
    const p = require('electron/package.json');
    return p.version;
  } catch (_) { return 'unknown'; }
}

function buildBaseline(meta, results) {
  const tiers = results.map(({ tier, runs }) => {
    const m = (pick) => r1(medianOf(runs, pick));
    const pulseRuns = runs.filter(r => r.pulse);
    const mp = (pick) => r1(medianOf(pulseRuns, pick));
    return {
      name: tier.name,
      viewport: { width: tier.width, height: tier.height, dpr: tier.dpr },
      refreshHz: m(r => r.refresh.hz),
      idle: {
        frames: m(r => r.idle.frames),
        longTasks: m(r => r.idle.longTasks),
        domNodes: m(r => r.idle.domNow),
        heapMB: m(r => r.idle.heapNowMb),
      },
      start: {
        fitVarWrites: m(r => r.start.fitVarWrites),
        fitVarTimeMs: m(r => r.start.fitVarTimeMs),
        bitmapAllocs: m(r => r.start.bitmaps.count),
        bitmapMB: r1(m(r => r.start.bitmaps.bytes) / 1048576),
        renderAllFrames: m(r => r.start.renderAll.frames),
        frames: m(r => r.start.frames),
      },
      turn: {
        wallMs: m(r => r.turn && r.turn.scenarioWallMs),
        frames: m(r => r.turn && r.turn.frames),
        frameDurP95: m(r => r.turn && r.turn.frame.durP95),
        frameGapP95: m(r => r.turn && r.turn.burst.gapP95),
        canvasMsP95: m(r => r.turn && r.turn.frame.canvasMsP95),
        canvasMsMax: m(r => r.turn && r.turn.frame.canvasMsMax),
        renderAllFrames: m(r => r.turn && r.turn.renderAll.frames),
      },
      pulse: pulseRuns.length ? {
        samples: pulseRuns.length,
        bursts: mp(r => r.pulse.raBursts.count),
        burstFrames: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.frames),
        canvasMsP50: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.canvasMsP50),
        canvasMsP95: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.canvasMsP95),
        frameDurP50: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.durP50),
        frameDurP95: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.durP95),
        frameGapP50: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.gapP50),
        frameGapP95: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.gapP95),
        measureTextPerFrameP50: mp(r => r.pulse.raBursts.longest && r.pulse.raBursts.longest.measureTextPerFrame),
        renderAllFrames: mp(r => r.pulse.renderAll.frames),
        totalMeasureText: mp(r => r.pulse.ops.measureText),
        totalGradients: mp(r => r.pulse.ops.createLinearGradient),
        gradientsPerFrameP50: mp(r => r.pulse.renderAll.gradientsP50),
        drawImagePerFrameP50: mp(r => r.pulse.renderAll.drawImageP50),
      } : null,
      longGame: {
        rounds: ROUNDS,
        wallMs: m(r => r.long && r.long.scenarioWallMs),
        wallPerRoundMs: r1(m(r => r.long && r.long.scenarioWallMs) / ROUNDS),
        domNodes: m(r => r.long && r.long.domNow),
        heapMB: m(r => r.long && r.long.heapNowMb),
        logEntries: m(r => r.long && r.long.state.logEntries),
        longTasks: m(r => r.long && r.long.longTasks),
        longTaskMaxMs: m(r => r.long && r.long.longTaskMax),
      },
      raw: runs.map(r => ({
        rep: r.rep,
        idle: r.idle, start: r.start, turn: r.turn,
        pulse: r.pulse || null, long: r.long, trace: r.trace,
      })),
    };
  });
  return { meta, tiers };
}

function renderMarkdown(b) {
  const L = [];
  L.push('| 档位 | 刷新率 | 待机帧数 | 开局位图分配 | renderAll 帧 | 回合耗时 | 脉冲 canvasMs P50/P95 | 脉冲 measureText/帧 | 长局 DOM | 长局堆 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of b.tiers) {
    const p = t.pulse;
    L.push('| ' + [
      t.name,
      t.refreshHz + 'Hz',
      t.idle.frames,
      t.start.bitmapAllocs + ' 次/' + t.start.bitmapMB + 'MB',
      t.start.renderAllFrames,
      t.turn.wallMs + 'ms',
      p ? (p.canvasMsP50 + '/' + p.canvasMsP95) : 'n/a',
      p ? p.measureTextPerFrameP50 : 'n/a',
      t.longGame.domNodes,
      t.longGame.heapMB + 'MB',
    ].join(' | ') + ' |');
  }
  return L.join('\n');
}

main().catch(e => {
  console.error('探针失败:', e && e.message);
  process.exit(1);
});
