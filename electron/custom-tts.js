// electron/custom-tts.js —— 通用自定义 TTS（OpenAI 兼容 /v1/audio/speech）
// 配置来自渲染层（Base URL / 模型 / 音色），密钥来自 safeStorage 用户数据、
// CUSTOM_TTS_API_KEY 环境变量或项目根目录 .custom-tts-api-key（开发回退）。
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const MAX_CACHE_FILES = 80;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const AUDIO_EXT = /\.(mp3|wav|ogg)$/i;

let apiKey = '';
let baseUrl = '';
let model = DEFAULT_MODEL;
let voice = DEFAULT_VOICE;
let cacheDir = '';

/** 只接受 http(s)；未以 /audio/speech 结尾时按 OpenAI 兼容约定补齐。 */
function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch (_) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (!u.hostname) return '';
  const pathPart = u.pathname.replace(/\/+$/, '');
  const full = u.origin + pathPart;
  return /\/audio\/speech$/i.test(full) ? full : full + '/audio/speech';
}

function cacheKey(text, speed) {
  return createHash('sha1')
    .update(`${baseUrl}|${model}|${voice}|${speed}|${text}`)
    .digest('hex')
    .slice(0, 16);
}

function pruneCache() {
  if (!cacheDir || !existsSync(cacheDir)) return;
  const files = readdirSync(cacheDir)
    .filter((f) => AUDIO_EXT.test(f))
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

/** 错误回显会经 speak() 返回给渲染进程并显示在 UI 里，出界前抹除 Key。 */
function scrub(s) {
  const str = String(s ?? '');
  return apiKey ? str.replaceAll(apiKey, '[已隐藏]') : str;
}

function formatFromContentType(ct) {
  const type = String(ct || '').toLowerCase();
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'mp3';
}

function decodeJsonAudio(raw) {
  let j;
  try { j = JSON.parse(raw); } catch (_) { return null; }
  const b64 = j && (j.audio || j.audio_base64 || (j.data && j.data.audio));
  if (typeof b64 !== 'string' || !b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length >= 64 ? buf : null;
  } catch (_) { return null; }
}

function errorDetail(raw) {
  let j = null;
  try { j = JSON.parse(raw); } catch (_) {}
  const detail = j && j.error && (j.error.message || j.error.msg);
  return String(detail || raw || '自定义 TTS 返回错误').slice(0, 180);
}

export async function init(opts = {}) {
  cacheDir = opts.cacheDir || (opts.userData && path.join(opts.userData, 'custom-tts-cache')) || '';
  apiKey = String(opts.userDataApiKey || process.env.CUSTOM_TTS_API_KEY || '').trim();
  if (!apiKey && opts.root) {
    try { apiKey = readFileSync(path.join(opts.root, '.custom-tts-api-key'), 'utf8').trim(); }
    catch (_) { apiKey = ''; }
  }
  baseUrl = normalizeBaseUrl(opts.baseUrl || process.env.CUSTOM_TTS_BASE_URL || '');
  model = String(opts.model || DEFAULT_MODEL).trim().slice(0, 128) || DEFAULT_MODEL;
  voice = String(opts.voice || DEFAULT_VOICE).trim().slice(0, 128) || DEFAULT_VOICE;
  if (!baseUrl) return { ok: false, error: '缺少自定义 TTS 服务地址（Base URL）', model, voice };
  if (!apiKey) return { ok: false, error: '缺少 CUSTOM_TTS_API_KEY / .custom-tts-api-key', model, voice };
  if (cacheDir) { try { mkdirSync(cacheDir, { recursive: true }); } catch (_) {} }
  return { ok: true, baseUrl, model, voice };
}

export async function speak(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'empty' };

  // 每次播报都带上当前配置：用户在设置里改了 Base URL / 模型 / 音色后立即生效。
  // 不沿用模块内缓存的 apiKey：清空 Key 后必须立刻失效（主进程每次都传入解密后的当前值）。
  const info = await init(opts);
  if (!info.ok) return { ok: false, error: info.error };

  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  const key = cacheKey(t, speed);
  const fileFor = (format) => (cacheDir ? path.join(cacheDir, key + '.' + format) : '');
  // 不同服务返回的容器不同（mp3/wav/ogg），按格式各查一次再决定是否请求。
  for (const format of ['mp3', 'wav', 'ogg']) {
    const cachedFile = fileFor(format);
    if (!cachedFile || !existsSync(cachedFile)) continue;
    try {
      const audio = readFileSync(cachedFile);
      if (audio.length >= 64) return { ok: true, audio, format, cached: true, voice };
    } catch (_) {}
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        input: t,
        voice,
        response_format: 'mp3',
        speed,
      }),
      signal: ac.signal,
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      const raw = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + scrub(errorDetail(raw)));
    }

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_AUDIO_BYTES) throw new Error('响应音频过大');

    let audio;
    let format;
    if (contentType.includes('application/json')) {
      // 部分兼容服务把音频放在 JSON 的 base64 字段里。
      const raw = await res.text();
      audio = decodeJsonAudio(raw);
      if (!audio) throw new Error('响应缺少音频: ' + scrub(raw.slice(0, 120)));
      format = 'mp3';
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_AUDIO_BYTES) throw new Error('响应音频过大');
      audio = buf;
      format = formatFromContentType(contentType);
    }
    if (!audio || audio.length < 64) throw new Error('响应缺少音频');

    const outputFile = fileFor(format);
    if (outputFile) {
      try { writeFileSync(outputFile, audio); pruneCache(); } catch (_) {}
    }
    return { ok: true, audio, format, cached: false, voice };
  } catch (e) {
    if (ac.signal.aborted) return { ok: false, error: 'timeout' };
    return { ok: false, error: scrub((e && e.message) || 'synth failed') };
  } finally {
    clearTimeout(timer);
  }
}
