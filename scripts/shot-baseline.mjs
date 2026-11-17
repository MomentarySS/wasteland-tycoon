#!/usr/bin/env node
// scripts/shot-baseline.mjs —— 截图基线（M1 验收：「画面与重构前像素级一致」）
//
// 为什么要单独一个脚本：M0 只建了性能基线，没建画面基线；而 M1 动的是渲染主干，
// 没有重构前的截图就没法证明「看起来没变」。
//
// 关键设计：**确定性对局**。通过 Page.addScriptToEvaluateOnNewDocument 在应用脚本之前
// 把 Math.random 换成固定种子的 mulberry32 —— 骰子、洗牌、事件全链路可复现，
// 两次跑的截图才可能逐像素相同。这不是改应用代码，是外部注入。
//
// 用法：
//   node scripts/shot-baseline.mjs --out docs/shots/baseline
//   node scripts/shot-baseline.mjs --out docs/shots/current --width 1600 --height 900
//
// 输出：<out>/NN-name.png + <out>/manifest.json（局面说明 + 文件清单）

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
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
const OUT_DIR = path.resolve(argVal('out', path.join(ROOT, 'docs', 'shots', 'baseline')));
const VW = parseInt(argVal('width', '1600'), 10);
const VH = parseInt(argVal('height', '900'), 10);
const ROUNDS = Math.max(1, parseInt(argVal('rounds', '6'), 10) || 6);
const PORT = parseInt(argVal('port', '9341'), 10) || 9341;
// 截图前的稳定等待：地块画像是异步解码的（img.onload 才触发重绘），
// 等不够久会截到「画还没加载完」的中间态，两次跑差异很大。
const SETTLE = Math.max(500, parseInt(argVal('settle', '3500'), 10) || 3500);
// states = 生成局面（打一遍并存档）；shoot = 逐个载入局面并截图（默认）
const MODE = (argVal('mode', 'shoot') || 'shoot').toLowerCase();
const STATES_DIR = path.resolve(argVal('states', path.join(ROOT, 'docs', 'shots', 'states')));

// 在应用脚本之前注入：确定性 PRNG + 屏蔽阻塞式原生弹窗
//（alert/confirm 在 Electron 里会卡住渲染进程，自动化时必须屏蔽）
const SEED = String.raw`
(() => {
  let s = (0x9e3779b9 ^ 0x1234567) >>> 0;
  Math.random = function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  window.alert = function () {};
  window.confirm = function () { return true; };
})();
`;

// 对局驱动（与 perf-probe 同源：真实点击 UI + 状态机）
const DRIVER = String.raw`
(() => {
  'use strict';
  window.__shotModalOpen = function () {
    const m = document.getElementById('modal');
    return !!(m && getComputedStyle(m).display !== 'none');
  };
  window.__shotJailBtn = function () {
    return document.querySelector('#jb1') || document.querySelector('#jb3') || document.querySelector('#jb2') || null;
  };
  window.__shotHasPanel = function () {
    return !!(document.querySelector('#buyBtn') || document.querySelector('#upBtn')
      || document.querySelector('#endBtn') || window.__shotModalOpen() || window.__shotJailBtn());
  };
  const SAFE = ['mc0', 'sd0', 'nukeWait', 'hdClose', 'tgBack', 'bmLeave', 'radLeave', 'bkLeave', 'chGo', 'bmCard'];
  window.__shotPickModal = function () {
    const ma = document.getElementById('modalActions');
    if (!ma) return null;
    const btns = Array.from(ma.querySelectorAll('button')).filter(b => !b.disabled);
    if (!btns.length) return null;
    for (const id of SAFE) { const b = btns.find(x => x.id === id); if (b) { b.click(); return b.id; } }
    const mc = btns.find(x => /^mc\d+$/.test(x.id)); if (mc) { mc.click(); return mc.id; }
    const last = btns[btns.length - 1]; last.click(); return last.id;
  };
  // 画布快照：在脉冲中段从页面内部抓，时机精确（不受 CDP 往返延迟影响）
  window.__shotCaptureBoard = function () {
    const c = document.querySelector('#tileCanvas');
    return c ? c.toDataURL('image/png') : null;
  };
  window.__shotFxDataUrl = null;
  window.__shotCaptureFx = false;
  window.__shotSettle = async function (timeoutMs) {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    while (performance.now() - t0 < (timeoutMs || 25000)) {
      if (window.__shotModalOpen()) { window.__shotPickModal(); await sl(250); continue; }
      const jb = window.__shotJailBtn(); if (jb) { jb.click(); await sl(1500); continue; }
      if (document.querySelector('#rollBtn')) return 'roll';
      const e = document.querySelector('#endBtn'); if (e) { e.click(); await sl(250); continue; }
      await sl(100);
    }
    return 'timeout';
  };
  /** 完整一回合，返回动作序列 */
  window.__shotPlayRound = async function () {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    const actions = [];
    let guard = 0;
    while (guard++ < 500) {
      if (performance.now() - t0 > 45000) return { actions, capped: true };
      const win = document.querySelector('#win');
      if (win && win.style.display !== 'none') return { actions, gameOver: true };
      if (window.__shotModalOpen()) { const id = window.__shotPickModal(); if (id) { actions.push('modal:' + id); await sl(900); continue; } }
      const jb = window.__shotJailBtn(); if (jb) { jb.click(); actions.push('jail'); await sl(1600); continue; }
      const b = document.querySelector('#buyBtn'), u = document.querySelector('#upBtn');
      if (b && !b.disabled) {
        b.click(); actions.push('buy');
        if (window.__shotCaptureFx) { await sl(280); window.__shotFxDataUrl = window.__shotCaptureBoard(); }
        await sl(800); continue;
      }
      if (u && !u.disabled) {
        u.click(); actions.push('upgrade');
        if (window.__shotCaptureFx) { await sl(280); window.__shotFxDataUrl = window.__shotCaptureBoard(); }
        await sl(800); continue;
      }
      const e = document.querySelector('#endBtn'); if (e) { e.click(); actions.push('end'); await sl(1200); continue; }
      if (document.querySelector('#rollBtn')) {
        document.querySelector('#rollBtn').click(); actions.push('roll');
        for (let i = 0; i < 160; i++) { await sl(100); if (window.__shotHasPanel()) break; }
        continue;
      }
      let quiet = true;
      for (let i = 0; i < 6; i++) { await sl(250); if (window.__shotHasPanel() || document.querySelector('#rollBtn')) { quiet = false; break; } }
      if (quiet) return { actions };
    }
    return { actions, guardExpired: true };
  };
  /** 掷骰直到出现可购买/可升级，点下去之后**立刻返回**（不让脉冲跑完），供截图用 */
  window.__shotRollUntilBuild = async function (maxMs) {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    const limit = maxMs || 40000;
    while (performance.now() - t0 < limit) {
      if (window.__shotModalOpen()) { window.__shotPickModal(); await sl(900); continue; }
      const jb = window.__shotJailBtn(); if (jb) { jb.click(); await sl(1600); continue; }
      const b = document.querySelector('#buyBtn'), u = document.querySelector('#upBtn');
      if (b && !b.disabled) { b.click(); return 'buy'; }
      if (u && !u.disabled) { u.click(); return 'upgrade'; }
      const e = document.querySelector('#endBtn'); if (e) { e.click(); await sl(1500); continue; }
      if (document.querySelector('#rollBtn')) {
        document.querySelector('#rollBtn').click();
        for (let i = 0; i < 160; i++) { await sl(100); if (window.__shotHasPanel()) break; }
        continue;
      }
      await sl(200);
    }
    return 'timeout';
  };
  /** 掷骰直到出现「可购买/可升级」面板，**不点**，返回供存档用 */
  window.__shotRollUntilPendingPanel = async function (maxMs) {
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    while (performance.now() - t0 < (maxMs || 40000)) {
      if (window.__shotModalOpen()) { window.__shotPickModal(); await sl(900); continue; }
      const jb = window.__shotJailBtn(); if (jb) { jb.click(); await sl(1600); continue; }
      const b = document.querySelector('#buyBtn'), u = document.querySelector('#upBtn');
      if ((b && !b.disabled) || (u && !u.disabled)) return 'pending';
      const e = document.querySelector('#endBtn'); if (e) { e.click(); await sl(1500); continue; }
      if (document.querySelector('#rollBtn')) {
        document.querySelector('#rollBtn').click();
        for (let i = 0; i < 160; i++) { await sl(100); if (window.__shotHasPanel()) break; }
        continue;
      }
      await sl(200);
    }
    return 'timeout';
  };
  /** 用应用自己的存档函数写存档，再从 localStorage 取出来 */
  window.__shotSaveState = function () {
    const btn = document.querySelector('#saveBtn');
    if (btn) btn.click();
    try { return localStorage.getItem('wasteland_save'); } catch (e) { return null; }
  };
})();
`;

class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.listeners = []; }
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

async function main() {
  if (!existsSync(WWW_INDEX)) throw new Error('www/index.html 不存在，请先跑 node scripts/sync-www.mjs');
  const require = createRequire(import.meta.url);
  const electronBin = require('electron');
  const proc = spawn(electronBin, [
    '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ROOT, '.tmp-shot-profile')}`,
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  ], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, windowsHide: true });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch (_) {}
    await sleep(250);
  }
  if (!targets) { proc.kill(); throw new Error('CDP 端口无响应'); }
  const page = targets.find(t => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED + '\n' + DRIVER });

  const ev = async (expression, awaitPromise = false) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (process.env.SHOT_DEBUG) log('EV ' + expression.slice(0, 48) + ' => ' + JSON.stringify(r).slice(0, 220));
    // 注意：cdp.send 已经解开过一层 m.result，这里 r 就是 {result: RemoteObject}
    const res = r || {};
    if (res.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(res.exceptionDetails).slice(0, 300));
    return res.result ? res.result.value : undefined;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const data = (r && r.data) || (r && r.result && r.result.data);
    if (!data) throw new Error('截图返回为空: ' + JSON.stringify(r).slice(0, 200));
    writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(data, 'base64'));
    log('  截图 ' + name + '.png');
  };

  function log(s) { process.stdout.write(String(s) + '\n'); }

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { mode: MODE, out: path.relative(ROOT, OUT_DIR), viewport: { width: VW, height: VH, dpr: 1 }, shots: [] };

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  // shoot 模式关掉 CSS/WAAPI 动画：截图比的是「布局与绘制结果」，
  // 不是某一帧恰好落在哪个动画相位上（那会引入与代码无关的差异）。
  if (MODE === 'shoot') {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }

  async function freshPage() {
    await cdp.send('Page.navigate', { url: 'file:///' + WWW_INDEX.replace(/\\/g, '/') });
    const t = Date.now();
    while (Date.now() - t < 30000) {
      if (await ev(`!!(window.__shotPlayRound && document.querySelector('#startBtn'))`).catch(() => false)) break;
      await sleep(250);
    }
    try { await cdp.send('Page.bringToFront'); } catch (_) {}
    await sleep(1200);
  }
  const writeState = (name, what, raw, pendingPanel) => {
    log('  [state] ' + name + ' → save ' + (raw ? String(raw).length + ' 字符' : 'NULL'));
    const obj = { name, what, pendingPanel: !!pendingPanel, save: raw };
    writeFileSync(path.join(OUT_DIR, name + '.state.json'), JSON.stringify(obj));
    manifest.shots.push({ name, what, pendingPanel: !!pendingPanel, stateFile: name + '.state.json' });
    log('  存档 ' + name + '.state.json');
  };

  if (MODE === 'states') {
    // ---- 生成局面：怎么打无所谓，只要存下来，之后两个版本都加载同一批局面 ----
    await freshPage();
    await ev(`(() => { const s=document.querySelector('#randBoard'); if(s){ s.value='off'; s.dispatchEvent(new Event('change',{bubbles:true})); } return true; })()`);
    await sleep(200);
    await ev(`(() => { const b=document.querySelector('#startBtn'); if(b) b.click(); return true; })()`);
    const t1 = Date.now();
    while (Date.now() - t1 < 15000) {
      if (await ev(`!!document.querySelector('#rollBtn')`).catch(() => false)) break;
      await sleep(200);
    }
    await sleep(1800);
    writeState('00-start', '开局', await ev(`window.__shotSaveState()`), false);

    for (let r = 1; r <= ROUNDS; r++) {
      const res = await ev(`window.__shotPlayRound()`, true);
      log(`  第 ${r} 回合: ${JSON.stringify(res && res.actions)}`);
      if (r % 2 === 0) writeState('0' + (r / 2) + '-round-' + r, `第 ${r} 回合后`, await ev(`window.__shotSaveState()`), false);
    }
    for (let k = 0; k < 6; k++) {
      await ev(`window.__shotSettle(25000)`, true);
      const got = await ev(`window.__shotRollUntilPendingPanel(40000)`, true);
      if (got === 'pending') {
        writeState('09-pending-buy', '落地面板（未购买）', await ev(`window.__shotSaveState()`), true);
        break;
      }
    }
  } else {
    // ---- 拍摄：每个局面重新载入的固定状态，渲染结果必须逐像素一致 ----
    const stateFiles = manifest0().filter(f => f.endsWith('.state.json')).sort();
    if (!stateFiles.length) throw new Error('局面目录里没有 *.state.json：' + STATES_DIR);
    for (const f of stateFiles) {
      const st = JSON.parse(readFileSync(path.join(STATES_DIR, f), 'utf8'));
      await freshPage();
      await ev(`(() => { localStorage.setItem('wasteland_save', ${JSON.stringify(st.save)}); return true; })()`);
      await ev(`(() => { const b=document.querySelector('#loadBtn'); if(b) b.click(); return true; })()`);
      await sleep(SETTLE);
      await shot(st.name);
      manifest.shots.push({ name: st.name, what: st.what, stateFile: f });
      if (st.pendingPanel) {
        const acted = await ev(`(() => { const b=document.querySelector('#buyBtn'); const u=document.querySelector('#upBtn'); if(b&&!b.disabled){b.click();return 'buy';} if(u&&!u.disabled){u.click();return 'upgrade';} return 'none'; })()`);
        if (acted !== 'none') {
          await sleep(1000);   // 等脉冲跑完，取稳定画面
          await shot(st.name + '-after-buy');
          manifest.shots.push({ name: st.name + '-after-buy', what: st.what + ' → 购买后（脉冲结束）' });
        }
      }
    }
  }

  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log('完成：' + path.relative(ROOT, OUT_DIR) + '（' + manifest.shots.length + ' 项）');
  cdp.close();
  proc.kill();
}

function manifest0() {
  if (!existsSync(STATES_DIR)) return [];
  return readdirSync(STATES_DIR);
}

main().catch(e => { console.error('截图基线失败:', e && e.message); process.exit(1); });
