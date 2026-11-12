// 桌面语音链：
//   custom = 自定义 OpenAI 兼容在线 TTS（任务 / 过场 / 动态战报）
//   mimo   = 小米 MiMo 在线 TTS
//   voice  = 仅预录语音（随包）
// 系统 speechSynthesis 已停用。默认仅预录，不与其它引擎混播。
import { cleanVoiceText as cleanText, voiceHash, VOICE_DIR, VOICE_MANIFEST_URL } from './voice-lines.js';
import { escapeHtml } from './view-util.js';

const SOURCE_STORAGE = 'wasteland_tts_source';
const MIMO_VOICE_STORAGE = 'wasteland_tts_mimo_voice';
const CUSTOM_BASE_STORAGE = 'wasteland_tts_custom_base';
const CUSTOM_MODEL_STORAGE = 'wasteland_tts_custom_model';
const CUSTOM_VOICE_STORAGE = 'wasteland_tts_custom_voice';

export const MIMO_VOICES = [
  { id: '苏打', label: '苏打（男声）' },
  { id: '白桦', label: '白桦（男声）' },
  { id: '冰糖', label: '冰糖（女声）' },
  { id: '茉莉', label: '茉莉（女声）' },
];
const DEFAULT_MIMO_VOICE = MIMO_VOICES[0].id;

export const CUSTOM_TTS_DEFAULTS = { baseUrl: '', model: 'tts-1', voice: 'alloy' };

let enabled = true;
let rate = 1.05;
let volume = 1.0;
let source = 'voice';
let mimoVoice = DEFAULT_MIMO_VOICE;
let customBaseUrl = CUSTOM_TTS_DEFAULTS.baseUrl;
let customModel = CUSTOM_TTS_DEFAULTS.model;
let customVoice = CUSTOM_TTS_DEFAULTS.voice;
let lastEngine = '';
let audioCtx = null;
let currentAudio = null;
let currentStop = null;   // 当前播放的「立即结算」开关：取消/被打断时用它兑现 Promise
let debugHidden = true;
try { if (localStorage.getItem('ttsDebugHidden') === '0') debugHidden = false; } catch (_) {}
let customReady = false;
let customInfo = null;
let mimoReady = false;
let mimoInfo = null;

function desktopApi() {
  try { return (typeof window !== 'undefined' && window.wastelandDesktop) || null; } catch (_) { return null; }
}

function loadSourcePref() {
  try {
    const s = localStorage.getItem(SOURCE_STORAGE);
    if (s === 'voice' || s === 'mimo' || s === 'custom') source = s;
    else {
      // 旧版的 minimax / local 在线来源已移除：迁移到仅预录，避免开局白等一次失败请求。
      source = 'voice';
      if (s === 'minimax' || s === 'local') localStorage.setItem(SOURCE_STORAGE, 'voice');
    }
  } catch (_) {}
}

function loadCustomPref() {
  try {
    const b = localStorage.getItem(CUSTOM_BASE_STORAGE);
    if (b) customBaseUrl = String(b).slice(0, 500);
    const m = localStorage.getItem(CUSTOM_MODEL_STORAGE);
    if (m) customModel = String(m).slice(0, 128);
    const v = localStorage.getItem(CUSTOM_VOICE_STORAGE);
    if (v) customVoice = String(v).slice(0, 128);
  } catch (_) {}
}

function loadMimoVoicePref() {
  try {
    const v = localStorage.getItem(MIMO_VOICE_STORAGE);
    if (v && MIMO_VOICES.some((x) => x.id === v)) mimoVoice = v;
    else mimoVoice = DEFAULT_MIMO_VOICE;
  } catch (_) {}
}

function sourceOrder() {
  if (source === 'voice') return ['voice'];
  return source === 'mimo' ? ['mimo'] : ['custom'];
}

/** 播放一段音频。@returns {Promise<boolean>} 是否正常播完。
 *  旧实现的问题：暂停不会触发 ended/error，Promise 要等 60s 兜底定时器；
 *  定时器成功后也不清，导致每次播报都多留一分钟的 Audio + blob URL；
 *  autoplay 被拒又和正常结束走同一分支，于是「没响」也被记成引擎可用。 */
function playBlob(blob, gen) {
  return new Promise((resolve) => {
    if (gen != null && gen !== _gen) { resolve(false); return; }
    let audio = null;
    let url = '';
    let timer = null;
    let settled = false;
    const stop = () => finish(false);
    function finish(ok) {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { if (audio) audio.pause(); } catch (_) {}
      try { if (url) URL.revokeObjectURL(url); } catch (_) {}
      if (currentAudio === audio) currentAudio = null;
      if (currentStop === stop) currentStop = null;
      resolve(ok);
    }
    try {
      // 先让上一条立即结算（而不是把它晾到 60s 定时器）
      if (currentStop) currentStop();
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      currentAudio = audio;
      currentStop = stop;
      audio.volume = volume;
      // 语速对预录/在线音频同样生效：旧实现只设 volume，「播报语速」对默认预录源无效
      try {
        audio.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
        audio.preservesPitch = true;
      } catch (_) {}
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      const p = audio.play();
      if (p && p.catch) p.catch(() => finish(false));
      timer = setTimeout(() => finish(false), 60000);
    } catch (_) {
      finish(false);
    }
  });
}

// 预录音频解码缓存：文件是内容 hash 命名（voiceHash(voice, text)），同一句文案永远指向同一个文件，
// 因此可以安全地按 file 缓存解码后的 Blob，避免每次播报都重走 fetch + MP3 解码。
// 只缓存 Blob（不缓存 Audio 实例）：playBlob 每次都会新建 Audio 并按当前 volume 设音量，
// 缓存实例会导致「调音量不生效」和「被新播报打断后无法复用」。
const prerecordedBlobs = new Map();   // file -> Promise<Blob>
const PRERECORDED_CACHE_MAX = 320;    // 与目标条数同量级；LRU 超出即淘汰，避免无上限增长

function touchPrerecorded(file, blob) {
  prerecordedBlobs.delete(file);      // 删除后重新插入 = 移到最新
  prerecordedBlobs.set(file, Promise.resolve(blob));
  while (prerecordedBlobs.size > PRERECORDED_CACHE_MAX) {
    const oldest = prerecordedBlobs.keys().next().value;
    prerecordedBlobs.delete(oldest);
  }
}

function fetchPrerecorded(file) {
  if (prerecordedBlobs.has(file)) {
    const hit = prerecordedBlobs.get(file);
    prerecordedBlobs.delete(file);    // 命中也刷新为最新
    prerecordedBlobs.set(file, hit);
    return hit;
  }
  // 失败不缓存：next() 会重新发起，避免一次网络抖动永久毒化该条目。
  const pending = fetch(VOICE_DIR + '/' + file).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.blob();
  }).then((blob) => {
    if (!blob || blob.size < 64) throw new Error('音频异常');
    touchPrerecorded(file, blob);
    return blob;
  }).catch((e) => {
    prerecordedBlobs.delete(file);
    throw e;
  });
  prerecordedBlobs.set(file, pending);
  return pending;
}

function audioToBlob(data, type = 'audio/mpeg') {
  if (!data) return null;
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data], { type });
  if (data instanceof Uint8Array) {
    const copy = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data
      : data.slice();
    return new Blob([copy], { type });
  }
  if (ArrayBuffer.isView(data)) return new Blob([data], { type });
  if (Array.isArray(data)) return new Blob([Uint8Array.from(data)], { type });
  if (data.type === 'Buffer' && Array.isArray(data.data)) {
    return new Blob([Uint8Array.from(data.data)], { type });
  }
  if (data.data) return new Blob([Uint8Array.from(data.data)], { type });
  return null;
}

async function ensureCustom() {
  const desk = desktopApi();
  if (!desk || !desk.custom) return false;
  if (customReady) return true;
  try {
    const info = await desk.custom.init({ baseUrl: customBaseUrl, model: customModel, voice: customVoice });
    customInfo = info || null;
    customReady = !!(info && info.ok);
    if (!customReady) console.warn('[TTS] 自定义 TTS init 未就绪', info && info.error);
    else console.warn('[TTS] 自定义 TTS 就绪', info.model, info.voice, info.baseUrl);
    return customReady;
  } catch (e) {
    console.warn('[TTS] 自定义 TTS init 失败', e && e.message);
    return false;
  }
}

async function synthCustom(text) {
  const desk = desktopApi();
  if (!desk || !desk.custom) {
    console.warn('[TTS] 自定义 TTS 不可用：非桌面壳');
    return null;
  }
  if (!(await ensureCustom())) return null;
  const result = await desk.custom.speak(text, {
    speed: Math.max(0.5, Math.min(2, Number(rate) || 1)),
    // 主进程只接受 model / voice / speed；服务地址以「保存 Key 时绑定的 origin」为准，
    // 这里传 baseUrl 也不会被采用（旧版主进程会直接用，等于把 Key 交给渲染层决定去向）。
    model: customModel,
    voice: customVoice,
  });
  if (!result || !result.ok) {
    console.warn('[TTS] 自定义 TTS 合成失败', result && result.error);
    return null;
  }
  const type = result.format === 'wav' ? 'audio/wav' : result.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
  const blob = audioToBlob(result.audio, type);
  if (!blob || blob.size < 64) {
    console.warn('[TTS] 自定义 TTS 音频为空');
    return null;
  }
  return { blob, engine: 'custom' };
}

async function ensureMimo() {
  const desk = desktopApi();
  if (!desk || !desk.mimo) return false;
  if (mimoReady) return true;
  try {
    const info = await desk.mimo.init();
    mimoInfo = info || null;
    mimoReady = !!(info && info.ok);
    if (!mimoReady) console.warn('[TTS] MiMo init 未就绪', info && info.error);
    else console.warn('[TTS] MiMo 就绪', info.model, info.voice);
    return mimoReady;
  } catch (e) {
    console.warn('[TTS] MiMo init 失败', e && e.message);
    return false;
  }
}

async function synthMimo(text) {
  const desk = desktopApi();
  if (!desk || !desk.mimo) {
    console.warn('[TTS] MiMo 不可用：非桌面壳');
    return null;
  }
  if (!(await ensureMimo())) return null;
  const result = await desk.mimo.speak(text, { speed: Math.max(0.5, Math.min(2, Number(rate) || 1)), voice: mimoVoice });
  if (!result || !result.ok) {
    console.warn('[TTS] MiMo 合成失败', result && result.error);
    return null;
  }
  const blob = audioToBlob(result.audio, 'audio/wav');
  if (!blob || blob.size < 64) {
    console.warn('[TTS] MiMo 音频为空');
    return null;
  }
  return { blob, engine: 'mimo' };
}

let voiceManifestPromise = null;
let voicePackState = 'unknown';

function loadVoiceManifest() {
  if (!voiceManifestPromise) {
    voiceManifestPromise = (async () => {
      try {
        const res = await fetch(VOICE_MANIFEST_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const body = await res.text();
        if (!ct.includes('json') || !body.trim().startsWith('{')) throw new Error('SPA 回退误判');
        const j = JSON.parse(body);
        if (!j || !j.meta || !j.lines) throw new Error('manifest 结构异常');
        voicePackState = 'ready';
        console.warn('[TTS] 预录语音包就绪:', j.meta.voice, j.meta.count + '条');
        return j;
      } catch (e) {
        voicePackState = 'none';
        console.warn('[TTS] 无预录语音包:', e && e.message);
        return null;
      }
    })();
  }
  return voiceManifestPromise;
}

export function voicePackStatus() { return voicePackState; }

/** 预录语音：只负责拿到 Blob，播放与引擎标记交给 speakOne 统一处理。 */
async function synthVoice(text) {
  const manifest = await loadVoiceManifest();
  if (!manifest) return null;
  const key = voiceHash(manifest.meta.voice, text);
  const entry = manifest.lines[key];
  if (!entry || !entry.file) return null;
  let blob;
  try {
    blob = await fetchPrerecorded(entry.file);
  } catch (_) {
    return null;   // 缓存未命中且取不到：按原语义视为该句不可播，交给引擎链下一档
  }
  if (!blob || blob.size < 64) return null;
  return { blob, engine: 'voice' };
}

async function speakOne(text, gen) {
  if (gen !== _gen) return false;
  const order = sourceOrder();
  for (const eng of order) {
    if (gen !== _gen) return false;
    try {
      let got = null;
      if (eng === 'custom') got = await synthCustom(text);
      else if (eng === 'mimo') got = await synthMimo(text);
      else if (eng === 'voice') got = await synthVoice(text);
      if (!got) continue;
      // 合成是异步的：等它回来时可能已经换局/关播报，结果必须丢弃而不是补播
      if (gen !== _gen) return false;
      const ok = await playBlob(got.blob, gen);
      if (gen !== _gen) return false;
      if (!ok) continue;          // 播放失败（autoplay/解码）：不算引擎可用，试下一档
      lastEngine = got.engine;    // 只在真正播完之后标记，避免「测音没响却显示就绪」
      return true;
    } catch (e) {
      console.warn('[TTS] 引擎失败，尝试下一档:', eng, e && e.message);
    }
  }
  console.warn('[TTS] 所有引擎均失败');
  return false;
}

let _chain = Promise.resolve();

export function initTTS() {
  loadSourcePref();
  loadCustomPref();
  loadMimoVoicePref();
  if (source === 'custom') ensureCustom().catch(() => {});
  else if (source === 'mimo') ensureMimo().catch(() => {});
  else if (source === 'voice') loadVoiceManifest();
  try {
    console.warn('[TTS] initTTS 完成, source:', source, 'desktop:', !!desktopApi());
  } catch (_) {}
  return true;
}

export function preloadTTS() {
  if (source === 'voice') return loadVoiceManifest();
  if (source === 'mimo') return ensureMimo().catch(() => false);
  return ensureCustom().catch(() => false);
}

export function ttsEngineStatus() {
  try {
    if (!enabled) return 'disabled';
    if (source === 'voice') {
      if (lastEngine === 'voice') return 'voice';
      if (voicePackState === 'ready') return 'voice-ready';
      if (voicePackState === 'none') return 'voice-none';
      return 'voice-pending';
    }
    if (source === 'mimo') {
      if (lastEngine === 'mimo') return 'mimo';
      if (desktopApi() && desktopApi().mimo) return mimoReady ? 'mimo-ready' : 'mimo-pending';
      return 'mimo-missing';
    }
    if (lastEngine === 'custom') return 'custom';
    if (desktopApi() && desktopApi().custom) return customReady ? 'custom-ready' : 'custom-pending';
    return 'custom-missing';
  } catch (e) {
    console.warn('[TTS] ttsEngineStatus 异常:', e && e.message);
    return 'pending';
  }
}

export async function testTts() {
  lastEngine = '';
  console.warn('[TTS] testTts 开始, source:', source);
  if (source === 'voice') {
    const manifest = await loadVoiceManifest();
    const first = manifest && manifest.lines && Object.values(manifest.lines)[0];
    if (!first || !first.text) {
      console.warn('[TTS] testTts 无预录条目');
      return null;
    }
    const got = await synthVoice(cleanText(first.text));
    if (!got) return null;
    const ok = await playBlob(got.blob, _gen);
    if (!ok) return null;
    lastEngine = got.engine;
    return got.engine;
  }
  let ok = false;
  try {
    ok = await speakOne('测试语音：废土大亨语音播报正常', _gen);
  } catch (e) {
    console.warn('[TTS] testTts', e && e.message);
  }
  return ok ? (lastEngine || null) : null;
}

export function updateTtsDebugPanel() {
  try {
    const el = document.getElementById('debugTts');
    if (!el) return;
    if (debugHidden) { el.style.display = 'none'; return; }
    const status = ttsEngineStatus();
    const desk = desktopApi();
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:2px"><span>TTS 调试面板</span><span id="ttsDbgClose" title="关闭调试面板" style="cursor:pointer;padding:0 4px;border:1px solid #0f0;border-radius:2px;line-height:1.3">✕</span></div>
      <div>来源: ${escapeHtml(source)}</div>
      <div>自定义 TTS: ${desk && desk.custom ? (customReady ? '✓ ' + escapeHtml((customInfo && customInfo.model) || customModel) : '…') : '✗ 非桌面'}</div>
      <div>服务地址: ${escapeHtml(customBaseUrl || '未设置')}</div>
      <div>小米 MiMo: ${desk && desk.mimo ? (mimoReady ? '✓ ' + escapeHtml((mimoInfo && mimoInfo.model) || 'online') : '…') : '✗ 非桌面'}</div>
      <div>音色: ${escapeHtml(source === 'mimo' ? mimoVoice : customVoice)}</div>
      <div>Voice: ${voicePackState === 'ready' ? '✓ 预录' : '✗'}</div>
      <div>状态: ${escapeHtml(status)}</div>
      <div>LastEngine: ${escapeHtml(lastEngine || '无')}</div>
    `;
    const closeBtn = document.getElementById('ttsDbgClose');
    if (closeBtn) closeBtn.onclick = () => {
      debugHidden = true;
      try { localStorage.setItem('ttsDebugHidden', '1'); } catch (_) {}
      el.style.display = 'none';
    };
  } catch (_) {}
}

export function setVoiceSource(s) {
  if (s === 'custom' || s === 'mimo' || s === 'voice' || s === 'auto') {
    source = s === 'auto' ? 'voice' : s;
    lastEngine = '';
    try { localStorage.setItem(SOURCE_STORAGE, source); } catch (_) {}
    try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
    if (source === 'custom') ensureCustom().catch(() => {});
    else if (source === 'mimo') ensureMimo().catch(() => {});
  }
}
export function getVoiceSource() { return source; }

export function getCustomTtsConfig() {
  return { baseUrl: customBaseUrl, model: customModel, voice: customVoice };
}

/** 保存自定义服务配置（Base URL / 模型 / 音色）；配置变了就重置就绪状态，下次播报重新 init。 */
export function setCustomTtsConfig(patch = {}) {
  if (typeof patch.baseUrl === 'string') customBaseUrl = patch.baseUrl.trim().slice(0, 500);
  if (typeof patch.model === 'string') customModel = patch.model.trim().slice(0, 128) || CUSTOM_TTS_DEFAULTS.model;
  if (typeof patch.voice === 'string') customVoice = patch.voice.trim().slice(0, 128) || CUSTOM_TTS_DEFAULTS.voice;
  customReady = false;
  customInfo = null;
  lastEngine = '';
  try {
    localStorage.setItem(CUSTOM_BASE_STORAGE, customBaseUrl);
    localStorage.setItem(CUSTOM_MODEL_STORAGE, customModel);
    localStorage.setItem(CUSTOM_VOICE_STORAGE, customVoice);
  } catch (_) {}
  try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
}

export function setMimoVoice(id) {
  mimoVoice = MIMO_VOICES.some((x) => x.id === id) ? id : DEFAULT_MIMO_VOICE;
  lastEngine = '';
  try { localStorage.setItem(MIMO_VOICE_STORAGE, mimoVoice); } catch (_) {}
  try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
}
export function getMimoVoice() { return mimoVoice; }

export async function onlineKeyStatus(provider = source) {
  const desk = desktopApi();
  const api = provider === 'mimo' ? desk && desk.mimo : provider === 'custom' ? desk && desk.custom : null;
  if (!api || !api.status) return { ok: false, available: false };
  try {
    const status = provider === 'custom' ? await api.status(getCustomTtsConfig()) : await api.status();
    return { ...status, available: true };
  }
  catch (_) { return { ok: false, available: true }; }
}

export async function saveOnlineKey(provider, key) {
  const desk = desktopApi();
  const api = provider === 'mimo' ? desk && desk.mimo : provider === 'custom' ? desk && desk.custom : null;
  if (!api || !api.saveKey) return { ok: false, error: '此功能需要 Windows 桌面版' };
  // 自定义 TTS 的地址随 Key 一起交给主进程绑定：之后换地址必须重新保存 Key。
  const result = provider === 'custom'
    ? await api.saveKey(key, getCustomTtsConfig())
    : await api.saveKey(key);
  if (provider === 'mimo') { mimoReady = !!(result && result.ok); mimoInfo = result || null; }
  else if (provider === 'custom') { customReady = false; customInfo = null; }
  try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
  return result;
}

export async function clearOnlineKey(provider) {
  const desk = desktopApi();
  const api = provider === 'mimo' ? desk && desk.mimo : provider === 'custom' ? desk && desk.custom : null;
  if (!api || !api.clearKey) return { ok: false, error: '此功能需要 Windows 桌面版' };
  const result = await api.clearKey();
  if (provider === 'mimo') { mimoReady = false; mimoInfo = null; }
  else if (provider === 'custom') { customReady = false; customInfo = null; }
  try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
  return result;
}

export function setTtsEnabled(v) { enabled = !!v; if (!enabled) cancelTts(); }
export function isTtsEnabled() { return enabled; }

export function setTtsRate(r) {
  const n = parseFloat(r);
  if (!isNaN(n)) rate = Math.max(0.5, Math.min(2, n));
}
export function getTtsRate() { return rate; }

export function unlockTts() {
  if (!audioCtx) audioCtx = new AudioContext();
  audioCtx.resume().catch(() => {});
}

export function cancelTts() {
  _chain = Promise.resolve();
  // 队列计数一并归零，并换代：被遗弃链上的播报会在合成前/播放前检查世代号后自行退出，
  // _pending 只由同代条目递减，避免旧链把新链计数减成负数。
  _gen++;
  _pending = 0;
  // 关键：让正在播的那条立刻结算并暂停。旧实现只 pause，不 settle，
  // 于是这条播报要等 60s 定时器，期间队列计数虚高、后续播报被丢弃。
  if (currentStop) { try { currentStop(); } catch (_) {} }
  if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
}

const MAX_QUEUE = 3;
let _pending = 0;
let _gen = 0;
// 把一条播报挂上 _chain，并登记它所属的世代号
function enqueue(t) {
  const gen = _gen;
  _pending++;
  _chain = _chain.then(() => speakOne(t, gen)).catch(() => {})
    .finally(() => { if (gen === _gen) _pending--; });
  return _chain;
}

export function ttsSpeak(text) {
  const t = cleanText(text);
  if (!enabled || !t) return;
  if (_pending >= MAX_QUEUE) {
    console.warn('[TTS] 播报队列已满，丢弃:', t.slice(0, 20));
    return;
  }
  return enqueue(t);
}

/** 过场 / 固定旁白：与 ttsSpeak 使用同一语音来源，不受队列上限丢弃 */
export function ttsSpeakPrerecorded(text) {
  const t = cleanText(text);
  if (!enabled || !t) return Promise.resolve(false);
  return enqueue(t);
}
