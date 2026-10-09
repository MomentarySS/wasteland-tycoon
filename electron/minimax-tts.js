// electron/minimax-tts.js —— 运行时 MiniMax T2A（纯云端）
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const ENDPOINTS = [
  'https://api.minimaxi.com/v1/t2a_v2',
  'https://api.minimax.io/v1/t2a_v2',
];

const MODEL = 'speech-2.8-turbo';
const DEFAULT_VOICE = 'male-qn-jingying';
const SAMPLE_RATE = 32000;
const BITRATE = 64000;
const MAX_CACHE_FILES = 80;

let apiKey = '';
let groupId = '';
let endpoint = '';
let cacheDir = '';
const inFlight = new Map();

function readSecret(envName, file) {
  if (process.env[envName]) return String(process.env[envName]).trim();
  try { return readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
}

function cacheKey(text, speed, voice) {
  return createHash('sha1').update(`${voice}|${MODEL}|${speed}|${text}`).digest('hex').slice(0, 16);
}

function pruneCache() {
  if (!cacheDir || !existsSync(cacheDir)) return;
  const files = readdirSync(cacheDir)
    .filter((f) => f.endsWith('.mp3'))
    .map((f) => {
      const p = path.join(cacheDir, f);
      try { return { p, mtime: statSync(p).mtimeMs }; }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of files.slice(MAX_CACHE_FILES)) {
    try { unlinkSync(extra.p); } catch (_) {}
  }
}

function decodeAudio(audio) {
  if (!audio) return null;
  const buf = /^[0-9a-fA-F]+$/.test(audio) && audio.length % 2 === 0
    ? Buffer.from(audio, 'hex')
    : Buffer.from(audio, 'base64');
  return buf.length >= 64 ? buf : null;
}

/** 错误回显会经 speak() 返回给渲染进程并显示在 UI/战报里。
 *  服务端错误正文有时会带出请求里的 Key，出界前统一抹除（对齐 mimo-tts.js:105）。 */
function scrub(s) {
  const str = String(s ?? '');
  return apiKey ? str.replaceAll(apiKey, '[已隐藏]') : str;
}

async function postSynth(url, text, speed, voice) {
  const qs = groupId ? `?GroupId=${encodeURIComponent(groupId)}` : '';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let res;
  try {
    res = await fetch(url + qs, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL,
        text,
        stream: false,
        language_boost: 'Chinese',
        voice_setting: { voice_id: voice, speed, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: SAMPLE_RATE, bitrate: BITRATE, format: 'mp3', channel: 1 },
      }),
    });
  } catch (e) {
    if (ac.signal.aborted) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + scrub(raw).slice(0, 180));
  let j;
  try { j = JSON.parse(raw); }
  catch (_) { throw new Error('非 JSON 响应: ' + scrub(raw).slice(0, 120)); }
  const base = j.base_resp || {};
  if (base.status_code !== 0 && base.status_code != null) {
    throw new Error('base_resp ' + base.status_code + ': ' + scrub(base.status_msg || ''));
  }
  const buf = decodeAudio(j.data && j.data.audio);
  if (!buf) throw new Error('响应缺少音频');
  return buf;
}

export async function init(opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  cacheDir = opts.cacheDir || path.join(root, '.minimax-tts-cache');
  // 游戏内用户密钥优先；环境变量和项目目录密钥用于开发 / 部署回退。
  apiKey = String(opts.userDataApiKey || process.env.MINIMAX_API_KEY || '').trim();
  const keyFiles = [path.join(root, '.minimax-api-key'), path.join(process.cwd(), '.minimax-api-key')];
  if (!apiKey) {
    for (const f of keyFiles) {
      try { apiKey = readFileSync(f, 'utf8').trim(); } catch (_) { apiKey = ''; }
      if (apiKey) break;
    }
  }
  groupId = readSecret('MINIMAX_GROUP_ID', path.join(root, '.minimax-group-id'));
  if (!groupId && opts.userData) {
    groupId = readSecret('MINIMAX_GROUP_ID', path.join(opts.userData, '.minimax-group-id'));
  }
  if (!apiKey) {
    return { ok: false, error: '缺少 MINIMAX_API_KEY / .minimax-api-key', model: MODEL, voice: DEFAULT_VOICE };
  }
  try { mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  return { ok: true, model: MODEL, voice: DEFAULT_VOICE, endpoint: endpoint || 'auto' };
}

export function status() {
  return {
    ok: !!apiKey,
    model: MODEL,
    voice: DEFAULT_VOICE,
    endpoint: endpoint || '',
  };
}

export async function speak(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'empty' };
  if (!apiKey) {
    // 转发 opts：否则这里的兜底 init 会退回 DEFAULT_ROOT，打包态读不到
    // userData 下由游戏内设置保存的 Key（与 mimo-tts.js:68 保持一致）。
    const info = await init(opts);
    if (!info.ok) return { ok: false, error: info.error };
  }
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  const voice = String(opts.voice || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const key = cacheKey(t, speed, voice);
  const file = cacheDir ? path.join(cacheDir, key + '.mp3') : '';
  if (file && existsSync(file)) {
    try {
      const mp3 = readFileSync(file);
      if (mp3.length >= 64) return { ok: true, mp3, cached: true, voice };
    } catch (_) {}
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    const urls = endpoint ? [endpoint, ...ENDPOINTS.filter((u) => u !== endpoint)] : ENDPOINTS.slice();
    let lastErr = '';
    for (const url of urls) {
      try {
        const mp3 = await postSynth(url, t, speed, voice);
        endpoint = url;
        if (file) {
          try { writeFileSync(file, mp3); pruneCache(); } catch (_) {}
        }
        return { ok: true, mp3, cached: false, voice };
      } catch (e) {
        lastErr = (e && e.message) || String(e);
      }
    }
    return { ok: false, error: lastErr || 'synth failed' };
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}
