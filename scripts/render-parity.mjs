#!/usr/bin/env node
// scripts/render-parity.mjs —— 红线 R7：Canvas 路径 vs DOM 降级路径的渲染语义一致性
//
// 方案 remaster-plan.md §3.4 R7 要求「同一局面两边产出的状态等价」。
// 本脚本是**轻量版**：不比对像素（两条路径本来就不是同一套绘制实现），
// 而是比对**每格的渲染语义**——名称 / 抵押 / 主人颜色 / 等级 / 当前格 / 垄断。
//
// 做法：
//   1. CDP 起两个真实 Electron 会话，载入**同一份存档**（docs/shots/states）
//      - Canvas 路径：正常
//      - DOM 路径：注入 HTMLCanvasElement.prototype.getContext → null，
//        让 board-canvas 的 initBoardCanvas 探测失败，自动回退 #tiles
//   2. DOM 路径：直接解析 #tiles .tile 的 class / 内联样式 / 文本
//   3. Canvas 路径：注入 recording 2D context，记录主画布最后一帧的
//      fillText / fillRect / strokeRect / arc / drawImage，按格几何归位
//   4. 逐格比对，输出差异表 + JSON
//
// 用法：
//   node scripts/render-parity.mjs                       # 用 docs/shots/states 全部局面
//   node scripts/render-parity.mjs --state 02-round-4    # 只跑一个
//   node scripts/render-parity.mjs --settle 4000         # 载入后等待毫秒（默认 3500）
//
// 不改应用一行代码：所有观测都靠 CDP 外部注入。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_INDEX = path.join(ROOT, 'www', 'index.html');
const STATES_DIR = path.join(ROOT, 'docs', 'shots', 'states');
const OUT_DIR = path.join(ROOT, 'docs', 'parity');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const ONLY_STATE = argVal('state', '');
const SETTLE = Math.max(800, parseInt(argVal('settle', '3500'), 10) || 3500);
const PORT_BASE = Math.max(2000, parseInt(argVal('port', '9500'), 10) || 9500);

function log(s) { process.stdout.write(String(s) + '\n'); }

// ---------------- CDP 客户端（与 perf-probe 同构） ----------------
class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
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

// 录制主画布最后一帧的绘制调用（只记录挂在 #tileCanvas 上的上下文）
const RECORD_SCRIPT = `
(() => {
  const rec = window.__renderRec = { ops: [], frame: 0 };
  const P = CanvasRenderingContext2D.prototype;
  const isMain = (ctx) => ctx.canvas && ctx.canvas.id === 'tileCanvas';
  const push = (ctx, op, d) => {
    if (!isMain(ctx)) return;
    try {
      rec.ops.push(Object.assign({
        op, frame: rec.frame,
        fill: String(ctx.fillStyle), stroke: String(ctx.strokeStyle),
        lw: ctx.lineWidth, alpha: ctx.globalAlpha,
      }, d));
    } catch (_) {}
  };
  const wrap = (name, before) => { const o = P[name]; P[name] = function (...a) { try { before && before.call(this, a); } catch (_) {} return o.apply(this, a); }; };
  wrap('clearRect', function () { if (isMain(this)) rec.frame++; });
  wrap('fillText', function (a) { push(this, 'fillText', { text: String(a[0]), x: a[1], y: a[2] }); });
  wrap('fillRect', function (a) { push(this, 'fillRect', { x: a[0], y: a[1], w: a[2], h: a[3] }); });
  wrap('strokeRect', function (a) { push(this, 'strokeRect', { x: a[0], y: a[1], w: a[2], h: a[3] }); });
  wrap('arc', function (a) { push(this, 'arc', { x: a[0], y: a[1], r: a[2] }); });
  wrap('drawImage', function (a) {
    const d = a.length >= 9 ? { x: a[5], y: a[6], w: a[7], h: a[8] } : { x: a[1], y: a[2], w: a[3], h: a[4] };
    push(this, 'drawImage', Object.assign({ src: a[0] && a[0].src ? String(a[0].src).slice(-48) : '' }, d));
  });
})();
`;

// 强制走 DOM 降级路径：让 canvas 探测失败
const FORCE_DOM_SCRIPT = `
(() => { HTMLCanvasElement.prototype.getContext = function () { return null; }; })();
`;

async function launch(port, inject) {
  const require = createRequire(import.meta.url);
  const proc = spawn(require('electron'), [
    '.',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(ROOT, '.tmp-parity-profile-' + port)}`,
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ], { stdio: 'ignore', cwd: ROOT, windowsHide: true });
  const cdp = await connect(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (inject) for (const src of inject) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  return { proc, cdp };
}

async function evalPage(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result ? r.result.value : undefined;
}

// 读档后 restoreTurnUI() 对 AI 当前玩家会立刻 takeTurn()，局面随时间漂移，
// 两条路径就不再是「同一局面」。这里把当前玩家强制为人类并置 awaitingRoll，
// 让状态稳定下来（humanActionUI 只铺操作栏，不推进回合）。
function stabilizeSave(save) {
  let s;
  try { s = JSON.parse(save); } catch (_) { return save; }
  if (!Array.isArray(s.players) || !s.players.length) return save;
  let hi = s.players.findIndex(p => !p.isAI);
  if (hi < 0) hi = 0;
  s.current = hi;
  s.awaitingRoll = true;
  s.pendingTile = null;
  s.extraRoll = false;
  s.players.forEach(p => { p.extraRoll = false; });
  return JSON.stringify(s);
}

async function loadState(cdp, save, settle) {
  await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
  for (let i = 0; i < 80; i++) {
    if (await evalPage(cdp, `!!(window.__shotPlayRound && document.querySelector('#startBtn'))`).catch(() => false)) break;
    await sleep(250);
  }
  await evalPage(cdp, `(() => { localStorage.setItem('wasteland_save', ${JSON.stringify(save)}); return true; })()`);
  await evalPage(cdp, `(() => { const b = document.querySelector('#loadBtn'); if (b) b.click(); return true; })()`);
  await sleep(settle);
}

// 归一化颜色：#hex / rgb(...) → 'rgb(r,g,b)'
const NORM_COLOR = `(c) => {
  if (!c) return '';
  c = String(c).trim();
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    if (h.length === 6) return 'rgb(' + parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16) + ')';
    return c;
  }
  const m = c.match(/rgba?\\(([^)]+)\\)/);
  if (m) return 'rgb(' + m[1].split(',').slice(0,3).map(s => Math.round(parseFloat(s))).join(',') + ')';
  return c;
}`;

const DOM_FACTS = `(() => {
  const norm = ${NORM_COLOR};
  const out = [];
  document.querySelectorAll('#tiles .tile').forEach(el => {
    const nameEl = el.querySelector('.tname');
    const ownerEl = el.querySelector('.towner');
    const lvlEl = el.querySelector('.tlevel');
    const cls = el.classList;
    out.push({
      i: Number(el.dataset.i),
      r: Number(el.style.gridRow) - 1,
      c: Number(el.style.gridColumn) - 1,
      name: nameEl ? nameEl.textContent.replace(/\\s*\\[押\\]\\s*/g, '') : '',
      mort: !!el.querySelector('.mort'),
      owner: ownerEl ? norm(getComputedStyle(ownerEl).backgroundColor) : '',
      level: lvlEl ? Number(lvlEl.dataset.lv) : (cls.contains('level-2') ? 2 : cls.contains('level-1') ? 1 : 0),
      active: cls.contains('active'),
      monopoly: cls.contains('monopoly-set'),
    });
  });
  return out;
})()`;

const CANVAS_FACTS = `(() => {
  const norm = ${NORM_COLOR};
  const rec = window.__renderRec || { ops: [], frame: 0 };
  const cs = getComputedStyle(document.documentElement);
  const cellW = parseFloat(cs.getPropertyValue('--cell-w')) || 0;
  const cellH = parseFloat(cs.getPropertyValue('--cell-h')) || 0;
  const gap = parseFloat(cs.getPropertyValue('--gap')) || 3;
  const ops = rec.ops.filter(o => o.frame === rec.frame);
  const out = [];
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const x = c * (cellW + gap), y = r * (cellH + gap), w = cellW, h = cellH;
      const inX = (px) => px >= x - 1 && px <= x + w + 1;
      const inY = (py) => py >= y - 1 && py <= y + h + 1;
      const names = [], levels = [], owners = [];
      let active = false, monopoly = false, wall = '';
      for (const o of ops) {
        if (o.op === 'fillText' && inX(o.x) && inY(o.y)) {
          if (/^\\d+$/.test(o.text) && o.y < y + h * 0.4) levels.push(Number(o.text));
          else if (o.y > y + h * 0.45) names.push(o.text);
        } else if (o.op === 'fillRect') {
          if (o.w >= w - 2 && o.h <= 4 && Math.abs(o.y - y) < 1.5) wall = norm(o.fill);
          else if (o.x >= x - 1 && o.x <= x + 4 && inY(o.y) && o.w <= 4 && o.h > h * 0.5) owners.push(norm(o.fill));
          else if (inX(o.x) && inY(o.y) && norm(o.fill) === 'rgb(127,174,110)') monopoly = true;
        } else if (o.op === 'strokeRect') {
          if (inX(o.x) && inY(o.y) && norm(o.stroke) === 'rgb(201,162,39)') active = true;
        }
      }
      out.push({ r, c, name: names.join(''), mort: names.join('').includes('[押]'), owner: owners[0] || '', level: levels[0] || 0, active, monopoly, wall });
    }
  }
  return out;
})()`;

function keyOf(f) { return f.r + ',' + f.c; }

function compare(domFacts, canvasFacts) {
  const dom = new Map(domFacts.map(f => [keyOf(f), f]));
  const cv = new Map(canvasFacts.map(f => [keyOf(f), f]));
  const diffs = [];
  for (const [k, d] of dom) {
    const c = cv.get(k);
    if (!c) { diffs.push({ tile: k, field: '_missing', dom: 'present', canvas: 'missing' }); continue; }
    for (const field of ['name', 'mort', 'owner', 'level', 'active', 'monopoly']) {
      const dv = d[field], cvv = c[field];
      if (String(dv) !== String(cvv)) diffs.push({ tile: k, field, dom: dv, canvas: cvv });
    }
  }
  return diffs;
}

async function run() {
  if (!existsSync(STATES_DIR)) throw new Error('缺少局面目录：' + STATES_DIR + '（先跑 scripts/shot-baseline.mjs --mode states）');
  let stateFiles = readdirSafe(STATES_DIR).filter(f => f.endsWith('.state.json')).sort();
  if (ONLY_STATE) stateFiles = stateFiles.filter(f => f.includes(ONLY_STATE));
  if (!stateFiles.length) throw new Error('没有匹配的局面文件');
  mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (const f of stateFiles) {
    const st = JSON.parse(readFileSync(path.join(STATES_DIR, f), 'utf8'));
    log('=== 局面 ' + st.name + ' ===');

    const dom = await launch(PORT_BASE, [FORCE_DOM_SCRIPT]);
    await loadState(dom.cdp, stabilizeSave(st.save), SETTLE);
    const domMode = await evalPage(dom.cdp, `!!document.querySelector('#tiles .tile') && !document.getElementById('tileCanvas')`);
    const domDbg = await evalPage(dom.cdp, `({ tiles: document.querySelectorAll('#tiles .tile').length, canvas: !!document.getElementById('tileCanvas'), tilesDisplay: getComputedStyle(document.getElementById('tiles')).display, getContextSrc: String(HTMLCanvasElement.prototype.getContext).slice(0, 60) })`);
    log('  [dom] mode=' + domMode + ' ' + JSON.stringify(domDbg));
    const domFacts = domMode ? await evalPage(dom.cdp, DOM_FACTS) : [];
    const domTile11 = process.env.PARITY_DEBUG ? await evalPage(dom.cdp, `(() => { const el = document.querySelector('#tiles .tile[data-i="11"]'); return el ? el.outerHTML.slice(0, 500) : 'NO EL'; })()`).catch(() => 'n/a') : '';
    dom.cdp.close(); dom.proc.kill();
    await sleep(300);

    const cv = await launch(PORT_BASE + 1, [RECORD_SCRIPT]);
    await loadState(cv.cdp, stabilizeSave(st.save), SETTLE);
    const cvMode = await evalPage(cv.cdp, `!!document.getElementById('tileCanvas')`);
    const cvFacts = cvMode ? await evalPage(cv.cdp, CANVAS_FACTS) : [];
    const cvOps00 = process.env.PARITY_DEBUG ? await evalPage(cv.cdp, `(() => {
      const rec = window.__renderRec || { ops: [], frame: 0 };
      const cs = getComputedStyle(document.documentElement);
      const w = parseFloat(cs.getPropertyValue('--cell-w')) || 0, h = parseFloat(cs.getPropertyValue('--cell-h')) || 0;
      return rec.ops.filter(o => o.frame === rec.frame && o.op === 'fillRect').map(o => ({ op: o.op, x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, text: o.text }));
    })()`).catch(() => []) : [];
    const cvActiveOps = process.env.PARITY_DEBUG ? await evalPage(cv.cdp, `(() => {
      const rec = window.__renderRec || { ops: [], frame: 0 };
      return rec.ops.filter(o => o.frame === rec.frame && o.op === 'strokeRect').map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, stroke: o.stroke }));
    })()`).catch(() => []) : [];
    cv.cdp.close(); cv.proc.kill();
    await sleep(300);

    if (process.env.PARITY_DEBUG) {
      log('  [dom sample] ' + JSON.stringify(domFacts.filter(f => f.owner).slice(0, 3)));
      log('  [cv sample] ' + JSON.stringify(cvFacts.filter(f => f.owner).slice(0, 3)));
      log('  [dom tile11] ' + domTile11);
      log('  [cv ops 00] ' + JSON.stringify(cvOps00).slice(0, 800));
      log('  [dom active] ' + JSON.stringify(domFacts.filter(f => f.active)));
      log('  [cv active] ' + JSON.stringify(cvFacts.filter(f => f.active)));
      log('  [cv activeOps] ' + JSON.stringify(cvActiveOps));
    }
    const diffs = compare(domFacts, cvFacts);
    results.push({ state: st.name, domTiles: domFacts.length, canvasTiles: cvFacts.length, diffs });
    log('  DOM 格数 ' + domFacts.length + ' | Canvas 格数 ' + cvFacts.length + ' | 语义差异 ' + diffs.length);
    for (const d of diffs.slice(0, 20)) log('   ! ' + d.tile + ' ' + d.field + ': DOM=' + JSON.stringify(d.dom) + ' Canvas=' + JSON.stringify(d.canvas));
  }

  const total = results.reduce((a, r) => a + r.diffs.length, 0);
  const outFile = path.join(OUT_DIR, 'render-parity.json');
  writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), states: results }, null, 2));
  log('');
  log('合计语义差异：' + total + '（明细：' + path.relative(ROOT, outFile) + '）');
  log(total === 0 ? '✅ RENDER PARITY PASSED' : '❌ RENDER PARITY FAILED');
  process.exit(total === 0 ? 0 : 1);
}

function readdirSafe(dir) { try { return readdirSync(dir); } catch (_) { return []; } }

run().catch(e => { console.error('render-parity 失败：' + (e && e.stack || e)); process.exit(2); });
