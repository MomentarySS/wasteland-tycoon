// Xiaomi MiMo-V2.5-TTS through the official OpenAI-compatible API.
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PAY_AS_YOU_GO_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const TOKEN_PLAN_ENDPOINT = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
// 按此顺序尝试；实际用哪个由「试通即记住」决定，见 speak()
const ENDPOINTS = [PAY_AS_YOU_GO_ENDPOINT, TOKEN_PLAN_ENDPOINT];
const MODEL = 'mimo-v2.5-tts';
const DEFAULT_VOICE = '苏打';
const MAX_CACHE_FILES = 80;

let apiKey = '';
let endpoint = '';   // 最近一次试通的端点；空 = 尚未确定，按 ENDPOINTS 顺序试
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
  // 端点不再按密钥前缀（tp-/ttp-）猜测：前缀约定一旦调整或用户的 Key 形态不符，
  // 按量付费的 Key 就会被发往 token-plan 主机。改为 speak() 里失败回退、试通即记住。
  // 两个主机同属小米官方域，故不因回退而扩大 Key 的暴露面。
  if (cacheDir) { try { mkdirSync(cacheDir, { recursive: true }); } catch (_) {} }
  return { ok: true, model: MODEL, voice: DEFAULT_VOICE };
}

/** 单个端点的一次请求。返回 {ok:true, audio} 或 {ok:false, error}；
 *  网络层异常直接抛出，由调用方决定是否换主机重试。 */
async function requestOnce(url, t, voice, rateHint, signal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    signal,
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
  return { ok: true, audio };
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
  // 端点回退（与 minimax-tts.js 同构）：已知可用的优先，其余按 ENDPOINTS 顺序试。
  // 配额 / Key 类错误换主机通常也没用，但两个主机同属小米官方域，多一次失败的代价
  // 远小于「猜错主机导致 Key 发往错误入口」的风险。
  const urls = endpoint ? [endpoint, ...ENDPOINTS.filter((u) => u !== endpoint)] : ENDPOINTS.slice();
  let lastErr = '';
  try {
    for (const url of urls) {
      if (controller.signal.aborted) break;   // 已超时，换主机也没用
      let r;
      try { r = await requestOnce(url, t, voice, rateHint, controller.signal); }
      catch (e) { lastErr = (e && e.message) || 'MiMo 请求失败'; continue; }
      if (!r.ok) { lastErr = r.error; continue; }
      endpoint = url;
      if (file) { try { writeFileSync(file, r.audio); pruneCache(); } catch (_) {} }
      return { ok: true, audio: r.audio, format: 'wav', cached: false, voice };
    }
    return { ok: false, error: controller.signal.aborted ? 'timeout' : (lastErr || 'synth failed') };
  } finally { clearTimeout(timer); }
}
