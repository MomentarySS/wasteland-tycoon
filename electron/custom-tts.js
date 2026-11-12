// electron/custom-tts.js —— 通用自定义 TTS（OpenAI 兼容 /v1/audio/speech）
// 配置来自渲染层（Base URL / 模型 / 音色），密钥来自 safeStorage 用户数据、
// CUSTOM_TTS_API_KEY 环境变量或项目根目录 .custom-tts-api-key（开发回退）。
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeTtsBaseUrl } from './tts-endpoint.js';

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const MAX_CACHE_FILES = 80;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_BYTES = 4096;
const TIMEOUT_MS = 30000;
const AUDIO_EXT = /\.(mp3|wav|ogg)$/i;

let apiKey = '';
let baseUrl = '';
let model = DEFAULT_MODEL;
let voice = DEFAULT_VOICE;
let cacheDir = '';

/** 流式读取并在超过上限时中止，避免对端在没有 Content-Length 时撑爆主进程内存。 */
async function readBytesLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return { bytes: buf.subarray(0, maxBytes), truncated: buf.length > maxBytes };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    const room = maxBytes - total;
    if (room <= 0) { truncated = true; break; }
    if (chunk.length > room) {
      chunks.push(chunk.subarray(0, room));
      total += room;
      truncated = true;
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  if (truncated) { try { await reader.cancel(); } catch (_) {} }
  return { bytes: Buffer.concat(chunks), truncated };
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
  // 地址校验先于 Key 检查：地址非法时不要把 Key 状态透出去，也不要发任何请求。
  const endpoint = normalizeTtsBaseUrl(opts.baseUrl || process.env.CUSTOM_TTS_BASE_URL || '');
  baseUrl = endpoint.ok ? endpoint.url : '';
  model = String(opts.model || DEFAULT_MODEL).trim().slice(0, 128) || DEFAULT_MODEL;
  voice = String(opts.voice || DEFAULT_VOICE).trim().slice(0, 128) || DEFAULT_VOICE;
  if (!endpoint.ok) return { ok: false, error: endpoint.error, model, voice };
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
      // 错误体只读 4KB：此前 res.text() 无上限，对端可以借此让主进程分配任意大缓冲区。
      const errBody = await readBytesLimited(res, MAX_ERROR_BYTES);
      throw new Error('HTTP ' + res.status + ': ' + scrub(errorDetail(errBody.bytes.toString('utf8'))));
    }

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_AUDIO_BYTES) throw new Error('响应音频过大');

    let audio;
    let format;
    if (contentType.includes('application/json')) {
      // 部分兼容服务把音频放在 JSON 的 base64 字段里；上限按 base64 膨胀预留余量。
      const jsonCap = Math.ceil(MAX_AUDIO_BYTES * 1.4) + 65536;
      const body = await readBytesLimited(res, jsonCap);
      if (body.truncated) throw new Error('响应音频过大');
      const raw = body.bytes.toString('utf8');
      audio = decodeJsonAudio(raw);
      if (!audio) throw new Error('响应缺少音频: ' + scrub(raw.slice(0, 120)));
      format = 'mp3';
    } else {
      const body = await readBytesLimited(res, MAX_AUDIO_BYTES);
      if (body.truncated) throw new Error('响应音频过大');
      audio = body.bytes;
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
