// electron/kokoro-host.js —— 优先用系统 Node 子进程推理，失败再回退主进程
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(__dirname, 'kokoro-worker.mjs');

function modelsDir() {
  if (process.env.WASTELAND_TTS_MODELS && existsSync(process.env.WASTELAND_TTS_MODELS)) {
    return process.env.WASTELAND_TTS_MODELS;
  }
  const repo = path.join(ROOT, 'assets', 'tts-models');
  if (existsSync(path.join(repo, 'model.onnx')) || existsSync(path.join(repo, 'model.int8.onnx'))) {
    return repo;
  }
  return path.join(ROOT, 'www', 'assets', 'tts-models');
}

function resolveNodeExec() {
  const cands = [process.env.WASTELAND_NODE, process.env.npm_node_execpath];
  for (const p of cands) {
    if (p && existsSync(p) && !/electron(\.exe)?$/i.test(p)) return p;
  }
  return 'node';
}

let worker = null;
const pending = new Map();
let nextId = 1;
let inProcess = null;
let readyInfo = null;

function failAll(err) {
  for (const [, fn] of pending) fn({ ok: false, error: err });
  pending.clear();
}

function startWorker() {
  if (worker) return true;
  const nodeBin = resolveNodeExec();
  try {
    worker = fork(WORKER, [], {
      execPath: nodeBin,
      execArgv: [],
      cwd: ROOT,
      env: { ...process.env, WASTELAND_TTS_MODELS: modelsDir() },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
  } catch (e) {
    console.error('[kokoro-host] fork 失败:', e);
    worker = null;
    return false;
  }
  worker.on('message', (msg) => {
    const fn = pending.get(msg && msg.id);
    if (!fn) return;
    pending.delete(msg.id);
    fn(msg);
  });
  worker.on('exit', (code) => {
    console.error('[kokoro-host] worker 退出', code);
    failAll('worker exit ' + code);
    worker = null;
    readyInfo = null;
  });
  worker.on('error', (e) => {
    console.error('[kokoro-host] worker error', e);
    failAll(String(e && e.message || e));
    worker = null;
  });
  return true;
}

function rpc(cmd, extra = {}) {
  return new Promise((resolve) => {
    if (!worker || !worker.connected) {
      resolve({ ok: false, error: 'worker 未启动' });
      return;
    }
    const id = nextId++;
    pending.set(id, resolve);
    worker.send({ id, cmd, ...extra });
  });
}

function toRendererPayload(wavBuf, meta) {
  return {
    wav: wavBuf,
    sampleRate: meta.sampleRate,
    voice: meta.voice,
    sid: meta.sid,
  };
}

export async function init() {
  if (readyInfo && readyInfo.ok) return { ...readyInfo, cached: true };

  if (startWorker()) {
    const info = await rpc('init');
    if (info && info.ok) {
      readyInfo = { ...info, via: 'worker' };
      console.warn('[kokoro-host] worker 就绪', info.modelFile, info.defaultVoice);
      return readyInfo;
    }
    console.warn('[kokoro-host] worker init 失败，回退主进程:', info && info.error);
    try { worker.kill(); } catch (_) {}
    worker = null;
  }

  try {
    inProcess = await import('./kokoro-node.js');
    const info = await inProcess.init();
    if (!info || !info.ok) return info || { ok: false, error: 'in-process init 空' };
    readyInfo = { ...info, via: 'in-process' };
    return readyInfo;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

export async function speak(text, opts = {}) {
  if (!readyInfo || !readyInfo.ok) {
    const info = await init();
    if (!info.ok) return null;
  }

  if (worker) {
    const r = await rpc('speak', { text, opts: { ...opts, includePcm: false } });
    if (!r || !r.ok || !r.wav) {
      console.error('[kokoro-host] worker speak 失败', r && r.error);
      return null;
    }
    return toRendererPayload(Buffer.from(r.wav), r);
  }

  if (!inProcess) return null;
  const r = await inProcess.speak(text, { ...opts, includePcm: false });
  if (!r || !r.wav) return null;
  return toRendererPayload(Buffer.from(r.wav), r);
}

export function stop() {
  if (worker) {
    try { worker.kill(); } catch (_) {}
    worker = null;
  }
  readyInfo = null;
}
