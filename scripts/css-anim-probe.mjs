#!/usr/bin/env node
// scripts/css-anim-probe.mjs —— CSS 动画成本探针（D6 动画白名单的测量手段）
//
// 目的：给「动画属性白名单改造」一个可量化的口径。方法是在**同一个真实 Electron 会话**里
// 采集两段 Chrome trace：
//   A 段：CSS 动画照常运行（idle，环境/天气/玩家脉冲/突变可视等持续动画）
//   B 段：注入 `*{animation:none!important;transition:none!important}` 关掉 CSS 动画
// 两段的差值 ≈ CSS 动画带来的绘制/合成/布局成本。
//
// 用法：
//   node scripts/css-anim-probe.mjs                 # 每段 8s
//   node scripts/css-anim-probe.mjs --seconds 5     # 每段 5s
//   node scripts/css-anim-probe.mjs --no-launch     # 复用已开着的 --remote-debugging-port
//   node scripts/css-anim-probe.mjs --out .tmpcheck/css-anim.json
//
// 不改应用代码：所有观测靠 CDP（Tracing + Runtime 注入）。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_INDEX = path.join(ROOT, 'www', 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const SECONDS = Math.max(2, parseInt(argVal('seconds', '8'), 10) || 8);
const OUT = argVal('out', path.join(ROOT, '.tmpcheck', 'css-anim.json'));
const PORT = parseInt(argVal('port', '9600'), 10) || 9600;
const NO_LAUNCH = argv.includes('--no-launch');

function log(s) { process.stdout.write(String(s) + '\n'); }

class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.listeners = []; }
  on(fn) { this.listeners.push(fn); }
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
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch (_) {}
    await sleep(250);
  }
  if (!targets) throw new Error('CDP 端口无响应: ' + port);
  const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url)) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('未找到页面 target');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

async function evalPage(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result ? r.result.value : undefined;
}

const KEEP_NAMES = [
  'Paint', 'PrePaint', 'UpdateLayoutTree', 'Layout', 'PaintImage', 'CompositeLayers',
  'DrawFrame', 'Commit', 'ActivateLayerTree', 'FireAnimationFrame', 'CSSAnimationFrame',
  'TimerFire', 'FunctionCall', 'Task', 'RunMicrotasks', 'MajorGC', 'MinorGC', 'EvaluateScript',
  'RasterTask', 'PaintPhase', 'HitTest', 'UpdateLayer', 'DisplayItemListUpdate',
];

/** 从 traceEvents 里按 name 汇总 complete 事件（ph==='X'）的 dur 总和与次数 */
function aggregate(traceEvents, fromTs, toTs) {
  const out = {};
  for (const e of traceEvents) {
    if (!e || e.ph !== 'X') continue;
    if (e.ts < fromTs || (toTs != null && e.ts >= toTs)) continue;
    const n = e.name;
    const slot = out[n] || (out[n] = { count: 0, dur: 0 });
    slot.count++;
    slot.dur += (e.dur || 0);
  }
  return out;
}

async function captureTrace(cdp, seconds, markFn) {
  const chunks = [];
  let done;
  const doneP = new Promise(res => { done = res; });
  cdp.on(m => {
    if (m.method === 'Tracing.dataCollected') chunks.push(...m.params.value);
    else if (m.method === 'Tracing.tracingComplete') done(m.params);
  });
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['devtools.timeline', 'cc', 'gpu', 'blink.user_timing', 'v8'] },
  });
  await markFn('trace_window_start');
  await sleep(seconds * 1000);
  await markFn('trace_window_end');
  await cdp.send('Tracing.end');
  await doneP;
  return chunks;
}

async function run() {
  let proc = null;
  let cdp = null;
  try {
    if (!NO_LAUNCH) {
      const require = createRequire(import.meta.url);
      proc = spawn(require('electron'), [
        '.', `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${path.join(ROOT, '.tmp-css-anim-profile')}`,
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ], { stdio: 'ignore', cwd: ROOT, windowsHide: true });
    }
    cdp = await connect(PORT);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
    for (let i = 0; i < 80; i++) {
      if (await evalPage(cdp, `!!(document.querySelector('#startBtn'))`).catch(() => false)) break;
      await sleep(250);
    }
    await sleep(1500);
    // 开局：让玩家面板/环境动画/天气等持续动画跑起来
    await evalPage(cdp, `(() => { const b = document.querySelector('#startBtn'); if (b) b.click(); return true; })()`);
    for (let i = 0; i < 80; i++) {
      if (await evalPage(cdp, `!!(document.querySelector('#rollBtn') || document.querySelector('#endBtn'))`).catch(() => false)) break;
      await sleep(250);
    }
    await sleep(3000);   // 等动画进入稳态

    const mark = name => evalPage(cdp, `(() => { performance.clearMarks(); performance.mark(${JSON.stringify(name)}); return true; })()`);

    // A 段：CSS 动画照常
    const chunks = await captureTrace(cdp, SECONDS, mark);
    // B 段：注入全局样式关掉 CSS 动画
    await evalPage(cdp, `(() => {
      let s = document.getElementById('__cssAnimOff');
      if (!s) { s = document.createElement('style'); s.id = '__cssAnimOff'; document.head.appendChild(s); }
      s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      return true;
    })()`);
    await sleep(1200);
    const chunksB = await captureTrace(cdp, SECONDS, mark);
    // 还原
    await evalPage(cdp, `(() => { const s = document.getElementById('__cssAnimOff'); if (s) s.remove(); return true; })()`);

    const startA = chunks.find(e => e && e.name === 'trace_window_start');
    const endA = chunks.find(e => e && e.name === 'trace_window_end');
    const startB = chunksB.find(e => e && e.name === 'trace_window_start');
    const endB = chunksB.find(e => e && e.name === 'trace_window_end');
    if (!startA || !endA || !startB || !endB) throw new Error('trace 里找不到 mark，无法分段');

    const aggA = aggregate(chunks, startA.ts, endA.ts);
    const aggB = aggregate(chunksB, startB.ts, endB.ts);
    const durA = Math.max(1, endA.ts - startA.ts);
    const durB = Math.max(1, endB.ts - startB.ts);

    const rows = KEEP_NAMES.map(n => {
      const a = aggA[n] || { count: 0, dur: 0 };
      const b = aggB[n] || { count: 0, dur: 0 };
      return {
        name: n,
        onCount: a.count, onMs: +(a.dur / 1000).toFixed(2),
        offCount: b.count, offMs: +(b.dur / 1000).toFixed(2),
        deltaMs: +((a.dur - b.dur) / 1000).toFixed(2),
      };
    }).filter(r => r.onCount || r.offCount);

    const totalOn = rows.reduce((s, r) => s + r.onMs, 0);
    const totalOff = rows.reduce((s, r) => s + r.offMs, 0);
    const result = {
      date: new Date().toISOString(),
      viewport: { width: 1920, height: 1080, dpr: 1 },
      secondsPerWindow: SECONDS,
      windowMs: { on: +(durA / 1000).toFixed(1), off: +(durB / 1000).toFixed(1) },
      totalMs: { on: +totalOn.toFixed(2), off: +totalOff.toFixed(2), delta: +(totalOn - totalOff).toFixed(2) },
      events: rows,
      eventsTotal: { on: chunks.length, off: chunksB.length },
    };
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(result, null, 2));

    log('');
    log('=== CSS 动画成本（同会话 A 动画开 vs B 动画关）===');
    log(`窗口：动画开 ${result.windowMs.on}ms / 动画关 ${result.windowMs.off}ms`);
    log('| 事件 | 开(次数/毫秒) | 关(次数/毫秒) | 差(ms) |');
    log('|---|---|---|---|');
    for (const r of rows.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs))) {
      log(`| ${r.name} | ${r.onCount} / ${r.onMs} | ${r.offCount} / ${r.offMs} | ${r.deltaMs > 0 ? '+' : ''}${r.deltaMs} |`);
    }
    log(`| **合计** | | | **${result.totalMs.delta > 0 ? '+' : ''}${result.totalMs.delta}** |`);
    log(`明细：${path.relative(ROOT, OUT)}`);
    log('注：差值 = 动画开 − 动画关，近似 CSS 动画带来的绘制/合成/布局成本。');
  } finally {
    if (cdp) cdp.close();
    if (proc) proc.kill();
  }
}

run().catch(e => { console.error('css-anim-probe 失败：' + (e && e.stack || e)); process.exit(2); });
