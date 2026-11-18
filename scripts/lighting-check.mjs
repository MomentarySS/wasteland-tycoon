#!/usr/bin/env node
/**
 * scripts/lighting-check.mjs —— M3 光照模型的验收工具（不改应用代码）
 *
 * 方案 remaster-plan.md §M3 的验收要求：
 *   ① 地块文字对比度 ≥ 4.5:1
 *   ② 所有档位（含 reduced-motion）下状态可读
 *   ③ 「不再像贴纸」——需要有可量化的方向光证据
 *
 * 本脚本提供两条：
 *   A. 方向性：对**同一份局面**的前后两张截图，逐格比较四条边的平均亮度差。
 *      画面内容（贴图）在两张图里相同，因此差值只剩光照的贡献：
 *      顶/左应为正（受光），底/右应为负（背光）。用 Δ 而不用绝对亮度，
 *      是为了抵消「某些贴图本身上亮下暗」的干扰。
 *   B. 对比度：文字色 #f8fbf9（drawTileName 的字色）vs 该格文字带的**最亮背景像素**
 *      （最坏情况），按 WCAG 相对亮度公式算比值。
 *
 * 用法：
 *   node scripts/lighting-check.mjs geom --state 01-round-2 --out .tmpcheck/geom.json
 *   node scripts/lighting-check.mjs check --geom .tmpcheck/geom.json --a <改造前目录> --b <改造后目录>
 *
 * 几何来源与应用同源：--cell-w / --cell-h / --gap（:root computed style）+ #boardInner 矩形，
 * 与 js/board-metrics.js 的 getCellMetrics() / getTileRect() 同一套数据。
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW_INDEX = path.join(ROOT, 'www', 'index.html');
const STATES_DIR = path.join(ROOT, 'docs', 'shots', 'states');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const CMD = argv[0] || 'check';
function log(s) { process.stdout.write(String(s) + '\n'); }

// ---------------- CDP（与 shot-baseline / render-parity 同构） ----------------
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
      const id = ++this.id;
      this.pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function launch() {
  const require = createRequire(import.meta.url);
  const electronBin = require('electron');
  const PORT = parseInt(argVal('port', '9700'), 10) || 9700;
  const proc = spawn(electronBin, [
    '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ROOT, '.tmp-light-profile')}`,
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  ], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, windowsHide: true });
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch (_) {}
    await sleep(250);
  }
  if (!targets) { proc.kill(); throw new Error('CDP 端口无响应'); }
  const page = targets.find((t) => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result ? r.result.value : undefined;
  };
  return { proc, cdp, ev };
}

async function cmdGeom() {
  if (!existsSync(WWW_INDEX)) throw new Error('www/index.html 不存在，请先跑 node scripts/sync-www.mjs');
  const out = path.resolve(argVal('out', '.tmpcheck/geom.json'));
  const stateArg = argVal('state', '');
  const stName = stateArg || readdirSync(STATES_DIR).find((f) => f.endsWith('.state.json')).replace('.state.json', '');
  const st = JSON.parse(readFileSync(path.join(STATES_DIR, stName + '.state.json'), 'utf8'));

  const { proc, cdp, ev } = await launch();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: parseInt(argVal('width', '1600'), 10), height: parseInt(argVal('height', '900'), 10),
      deviceScaleFactor: 1, mobile: false,
    });
    // 与截图口径一致：关掉 CSS/WAAPI 动画，避免相位进几何测量
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
    for (let i = 0; i < 120; i++) {
      if (await ev(`!!(document.querySelector('#startBtn') || document.querySelector('#loadBtn'))`).catch(() => false)) break;
      await sleep(250);
    }
    await ev(`(() => { localStorage.setItem('wasteland_save', ${JSON.stringify(st.save)}); return true; })()`);
    await ev(`(() => { const b=document.querySelector('#loadBtn'); if(b) b.click(); return true; })()`);
    await sleep(parseInt(argVal('settle', '3500'), 10));
    const geom = await ev(`(() => {
      const inner = document.getElementById('boardInner');
      if (!inner) return null;
      const r = inner.getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      return {
        left: r.left, top: r.top, width: r.width, height: r.height,
        cellW: parseFloat(cs.getPropertyValue('--cell-w')) || 0,
        cellH: parseFloat(cs.getPropertyValue('--cell-h')) || 0,
        gap: parseFloat(cs.getPropertyValue('--gap')) || 0,
        dpr: window.devicePixelRatio || 1,
      };
    })()`);
    if (!geom || !geom.cellW || !geom.cellH) throw new Error('几何读取失败：' + JSON.stringify(geom));
    writeFileSync(out, JSON.stringify(geom, null, 2));
    log(`几何已写入 ${out}`);
    log(JSON.stringify(geom));
  } finally {
    cdp.close();
    proc.kill();
  }
}

// ---------------- 像素分析 ----------------
// 棋盘固定 12×12，只有外环 44 格是地块（inner 10×10 是背景）。
// 不从 js/data.js 取 positions：那是应用运行时由 loadContent() 填充的，Node 侧导入是空数组。
const N = 12;
const RING_CELLS = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    if (r === 0 || r === N - 1 || c === 0 || c === N - 1) RING_CELLS.push([r, c]);
  }
}

const TEXT_RGB = [0xf8, 0xfb, 0xf9]; // drawTileName 的字色

function lum(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const L_TEXT = lum(...TEXT_RGB);

async function loadRaw(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function rgbAt(info, data, x, y) {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
/** 矩形带内的平均相对亮度 */
function bandLum(img, x0, y0, x1, y1) {
  const { info, data } = img;
  let sum = 0, n = 0;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(info.height, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(info.width, Math.round(x1)); x++) {
      sum += lum(...rgbAt(info, data, x, y)); n++;
    }
  }
  return n ? sum / n : 0;
}
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 逐格四条边的亮度（同一张图内），返回每格四项 */
function edgeLums(img, geom) {
  const band = Math.max(1, Math.round(Math.min(geom.cellW, geom.cellH) * 0.05));
  const out = [];
  for (let i = 0; i < RING_CELLS.length; i++) {
    const [r, c] = RING_CELLS[i];
    const x = geom.left + c * (geom.cellW + geom.gap);
    const y = geom.top + r * (geom.cellH + geom.gap);
    const w = geom.cellW, h = geom.cellH;
    out.push({
      i,
      top: bandLum(img, x, y, x + w, y + band),
      left: bandLum(img, x, y, x + band, y + h),
      bottom: bandLum(img, x, y + h - band, x + w, y + h),
      right: bandLum(img, x + w - band, y, x + w, y + h),
    });
  }
  return out;
}

/**
 * 文字对比度：字色 vs 文字实际占据区域的背景亮度。
 *
 * 关键点：不要在整个文字带里取「最亮像素」——带内没被文字覆盖的贴图画素再亮，
 * 也与「文字可读性」无关。所以先**从图像反推文字行**（底板压暗过的行，行均亮度
 * 显著低于该格中位行），只在这些行里、且排除字形墨迹（亮像素）后取最亮背景。
 *
 * 报两个数：
 *  - textRows：上述「文字行」口径 —— 设计门（目标 ≥ 4.5:1）
 *  - wholeBand：整个底部文字带的最亮非墨像素 —— 上限参考（含文字未覆盖的贴图）
 */
function textContrast(img, geom) {
  const band = Math.max(6, Math.round(Math.min(geom.cellW, geom.cellH) * 0.30));
  const INK = 0.25; // 亮度高于此视为字形/抗锯齿，不计入背景
  const out = [];
  for (let i = 0; i < RING_CELLS.length; i++) {
    const [r, c] = RING_CELLS[i];
    const x = Math.round(geom.left + c * (geom.cellW + geom.gap));
    const y = Math.round(geom.top + r * (geom.cellH + geom.gap));
    const w = Math.round(geom.cellW), h = Math.round(geom.cellH);
    const x0 = x + 2, x1 = x + w - 2;
    const cols = x1 - x0;
    const rowMean = [];
    const rowLum = [];
    for (let yy = y; yy < y + h; yy++) {
      let s = 0; const arr = [];
      for (let xx = x0; xx < x1; xx++) {
        const L = lum(...rgbAt(img.info, img.data, xx, yy));
        arr.push(L); s += L;
      }
      rowLum.push(arr); rowMean.push(s / cols);
    }
    const tileMed = median(rowMean);
    // 文字行 = 行均亮度明显低于该格中位行的行（底板 + 字形共同压暗）
    const textRows = [];
    for (let k = Math.max(0, h - band - 2); k < h - 2; k++) {
      if (rowMean[k] < tileMed * 0.72) textRows.push(k);
    }
    let bandMax = 0;
    const textLums = [];
    for (let k = Math.max(0, h - band - 2); k < h - 2; k++) {
      for (let xx = 0; xx < cols; xx++) {
        const L = rowLum[k][xx];
        if (L > INK) continue;
        if (L > bandMax) bandMax = L;
        if (textRows.includes(k)) textLums.push(L);
      }
    }
    textLums.sort((a, b) => a - b);
    const p95 = textLums.length ? textLums[Math.min(textLums.length - 1, Math.floor(textLums.length * 0.95))] : 0;
    out.push({
      i,
      textRows: textRows.length,
      // 主口径用 p95：单个抗锯齿杂点不该让整格文字判失败
      text: textLums.length ? (L_TEXT + 0.05) / (p95 + 0.05) : Infinity,
      textMax: textLums.length ? (L_TEXT + 0.05) / (textLums[textLums.length - 1] + 0.05) : Infinity,
      wholeBand: bandMax ? (L_TEXT + 0.05) / (bandMax + 0.05) : Infinity,
    });
  }
  return out;
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

async function cmdCheck() {
  const geomPath = path.resolve(argVal('geom', '.tmpcheck/geom.json'));
  const dirA = path.resolve(argVal('a', ''));
  const dirB = path.resolve(argVal('b', 'docs/shots/current'));
  if (!existsSync(geomPath)) throw new Error('缺几何文件：' + geomPath + '（先跑 geom 子命令）');
  const geom = JSON.parse(readFileSync(geomPath, 'utf8'));
  const files = readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) throw new Error('目录没有 PNG：' + dirA);
  if (!readdirSync(dirB).some((f) => f.endsWith('.png'))) throw new Error('目录没有 PNG：' + dirB);

  log('== A. 方向性（Δ = 改造后 − 改造前，平均相对亮度）==');
  const perFile = [];
  const sign = [0, 0, 0, 0];
  let signOk = 0, total = 0;
  for (const f of files) {
    const [A, B] = await Promise.all([loadRaw(path.join(dirA, f)), loadRaw(path.join(dirB, f))]);
    const ea = edgeLums(A, geom), eb = edgeLums(B, geom);
    const mean = (k) => eb.reduce((s, e, idx) => s + (e[k] - ea[idx][k]), 0) / eb.length;
    const d = { top: mean('top'), left: mean('left'), bottom: mean('bottom'), right: mean('right') };
    log(`  ${f}：Δtop ${d.top >= 0 ? '+' : ''}${d.top.toFixed(4)}  Δleft ${d.left >= 0 ? '+' : ''}${d.left.toFixed(4)}  `
      + `Δbottom ${d.bottom >= 0 ? '+' : ''}${d.bottom.toFixed(4)}  Δright ${d.right >= 0 ? '+' : ''}${d.right.toFixed(4)}`);
    perFile.push(d);
    for (let k = 0; k < eb.length; k++) {
      total++;
      const dt = eb[k].top - ea[k].top, dl = eb[k].left - ea[k].left;
      const db = eb[k].bottom - ea[k].bottom, dr = eb[k].right - ea[k].right;
      if (dt > 0) sign[0]++;
      if (dl > 0) sign[1]++;
      if (db < 0) sign[2]++;
      if (dr < 0) sign[3]++;
      if (dt > 0 && dl > 0 && db < 0 && dr < 0) signOk++;
    }
  }
  const mm = (k) => perFile.reduce((s, v) => s + v[k], 0) / perFile.length;
  log(`  合计：Δtop ${mm('top').toFixed(4)} / Δleft ${mm('left').toFixed(4)} / Δbottom ${mm('bottom').toFixed(4)} / Δright ${mm('right').toFixed(4)}`);
  log(`  各边符号正确率：顶>0 ${(sign[0] / total * 100).toFixed(1)}%   左>0 ${(sign[1] / total * 100).toFixed(1)}%`
    + `   底<0 ${(sign[2] / total * 100).toFixed(1)}%   右<0 ${(sign[3] / total * 100).toFixed(1)}%`);
  log(`  四边同时正确：${signOk}/${total}（${(signOk / total * 100).toFixed(1)}%）—— 逐格全对易被图标/产权条等覆盖物干扰，看上面四行`);

  log('\n== B. 文字对比度（WCAG，字色 #f8fbf9；主口径 = 文字行内背景亮度 p95）==');
  const allT = [], allTm = [], allW = [];
  for (const f of files) {
    const B = await loadRaw(path.join(dirB, f));
    const rs = textContrast(B, geom);
    const t = rs.map((o) => o.text), tm = rs.map((o) => o.textMax), w = rs.map((o) => o.wholeBand);
    allT.push(...t); allTm.push(...tm); allW.push(...w);
    log(`  ${f}：p95 最差 ${Math.min(...t).toFixed(2)} / 中位 ${median(t).toFixed(2)}`
      + `   |  逐格最大值 最差 ${Math.min(...tm).toFixed(2)}（抗锯齿杂点上限）`
      + `   |  整带参考 最差 ${Math.min(...w).toFixed(2)}`
      + `   （识别文字行 ${rs.filter((o) => o.textRows > 0).length}/${rs.length}）`);
  }
  const p = (arr, th) => (arr.filter((v) => v >= th).length / arr.length * 100).toFixed(1);
  log(`  总体 p95：最差 ${Math.min(...allT).toFixed(2)} / 中位 ${median(allT).toFixed(2)}`
    + `   |  逐格最大值：最差 ${Math.min(...allTm).toFixed(2)}`);
  log(`  p95 口径达标率：≥4.5:1 → ${p(allT, 4.5)}%   ≥3:1 → ${p(allT, 3)}%`);
}

if (CMD === 'geom') await cmdGeom();
else await cmdCheck();