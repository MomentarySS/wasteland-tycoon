// Xiaomi MiMo-V2.5-TTS through the official OpenAI-compatible API.
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PAY_AS_YOU_GO_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const TOKEN_PLAN_ENDPOINT = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
const MODEL = 'mimo-v2.5-tts';
const DEFAULT_VOICE = '苏打';
const MAX_CACHE_FILES = 80;

let apiKey = '';
let endpoint = PAY_AS_YOU_GO_ENDPOINT;
let cacheDir = '';

function cacheKey(text, speed, voice) {
  return createHash('sha1').update(`${voice}|${MODEL}|${speed}|${text}`).digest('hex').slice(0, 16);
}

function decodeAudio(data) {
  if (!data || typeof data !== 'string') return null;
  try {
    const raw = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
    const buf = Buffer.from(raw, 'base64');
    return buf.length >= 64 ? buf : null;
  } catch (_) { return null; }
}

function pruneCache() {
  if (!cacheDir || !existsSync(cacheDir)) return;
  const files = readdirSync(cacheDir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => {
      const p = path.join(cacheDir, f);
      try { return { p, mtime: statSync(p).mtimeMs }; } catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of files.slice(MAX_CACHE_FILES)) {
    try { unlinkSync(extra.p); } catch (_) {}
  }
}

export async function init(opts = {}) {
  cacheDir = opts.cacheDir || (opts.userData && path.join(opts.userData, 'mimo-tts-cache')) || '';
  apiKey = String(opts.userDataApiKey || process.env.MIMO_API_KEY || '').trim();
  const keyFiles = [];
  if (opts.root) keyFiles.push(path.join(opts.root, '.mimo-api-key'));
  keyFiles.push(path.join(process.cwd(), '.mimo-api-key'));
  if (!apiKey) {
    for (const file of keyFiles) {
      try { apiKey = readFileSync(file, 'utf8').trim(); } catch (_) { apiKey = ''; }
      if (apiKey) break;
    }
  }
  if (!apiKey) return { ok: false, error: '缺少 MIMO_API_KEY / .mimo-api-key', model: MODEL, voice: DEFAULT_VOICE };
  endpoint = /^(tp|ttp)-/i.test(apiKey) ? TOKEN_PLAN_ENDPOINT : PAY_AS_YOU_GO_ENDPOINT;
  if (cacheDir) { try { mkdirSync(cacheDir, { recursive: true }); } catch (_) {} }
  return { ok: true, model: MODEL, voice: DEFAULT_VOICE };
}

export async function speak(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'empty' };
  if (!apiKey) {
    const info = await init(opts);
    if (!info.ok) return { ok: false, error: info.error };
  }
  const voice = String(opts.voice || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  const key = cacheKey(t, speed, voice);
  const file = cacheDir ? path.join(cacheDir, key + '.wav') : '';
  if (file && existsSync(file)) {
    try {
      const audio = readFileSync(file);
      if (audio.length >= 64) return { ok: true, audio, format: 'wav', cached: true, voice };
    } catch (_) {}
  }

  const rateHint = speed < 0.95 ? '请用偏慢的语速' : speed > 1.1 ? '请用偏快的语速' : '请用自然、清晰的语速';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'user', content: `${rateHint}播报，不添加原文以外的内容。` },
          { role: 'assistant', content: t },
        ],
        audio: { format: 'wav', voice },
        stream: false,
      }),
    });
    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); } catch (_) { result = null; }
    if (!response.ok) {
      const detail = result && result.error && result.error.message;
      const safeDetail = String(detail || '请检查 API Key 与额度').replaceAll(apiKey, '[已隐藏]').slice(0, 160);
      return { ok: false, error: `HTTP ${response.status}: ${safeDetail}` };
    }
    if (!result) return { ok: false, error: 'MiMo 返回了无效响应' };
    const audio = decodeAudio(result.choices && result.choices[0]
      && result.choices[0].message && result.choices[0].message.audio
      && result.choices[0].message.audio.data);
    if (!audio) return { ok: false, error: (result.error && result.error.message) || 'MiMo 响应中没有有效音频' };
    if (file) { try { writeFileSync(file, audio); pruneCache(); } catch (_) {} }
    return { ok: true, audio, format: 'wav', cached: false, voice };
  } catch (e) {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : ((e && e.message) || 'MiMo 请求失败') };
  } finally { clearTimeout(timer); }
}
