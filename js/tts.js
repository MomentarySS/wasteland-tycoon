// 桌面语音链：
//   custom = 自定义 OpenAI 兼容在线 TTS（任务 / 过场 / 动态战报）
//   mimo   = 小米 MiMo 在线 TTS
//   voice  = 仅预录语音（随包）
// 系统 speechSynthesis 已停用。默认仅预录，不与其它引擎混播。
import { cleanVoiceText as cleanText, voiceHash, VOICE_DIR, VOICE_MANIFEST_URL } from './voice-lines.js';

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
let debugHidden = true;
try { if (localStorage.getItem('ttsDebugHidden') === '0') debugHidden = false; } catch (_) {}
let cachedZhVoice = null;
let browserVoicesHooked = false;
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

function pickZhVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  if (cachedZhVoice) return cachedZhVoice;
  try {
    const voices = speechSynthesis.getVoices();
    cachedZhVoice = voices.find((v) => /^zh(-|_)/i.test(v.lang))
      || voices.find((v) => /chinese|中文|Huihui|Yaoyao|Kangkang|Ting-Ting|Meijia/i.test(v.name))
      || null;
  } catch (_) { cachedZhVoice = null; }
  return cachedZhVoice;
}

function initBrowserVoices() {
  if (typeof speechSynthesis === 'undefined' || browserVoicesHooked) return;
  browserVoicesHooked = true;
  pickZhVoice();
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedZhVoice = null;
    pickZhVoice();
  });
}

export function browserTtsSupported() {
  return typeof speechSynthesis !== 'undefined';
}

function playBlob(blob) {
  return new Promise((resolve) => {
    try {
      if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.volume = volume;
      const done = () => {
        try { URL.revokeObjectURL(url); } catch (_) {}
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      const p = audio.play();
      if (p && p.catch) p.catch(done);
      setTimeout(done, 60000);
    } catch (_) {
      resolve();
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

async function speakBrowser(text) {
  if (!browserTtsSupported()) return false;
  initBrowserVoices();
  return new Promise((resolve) => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = Math.max(0.5, Math.min(2.5, rate * 1.1));
      u.volume = volume;
      const voice = pickZhVoice();
      if (voice) u.voice = voice;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      speechSynthesis.speak(u);
      setTimeout(() => finish(false), 45000);
    } catch (_) {
      resolve(false);
    }
  });
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

async function speakCustom(text) {
  const desk = desktopApi();
  if (!desk || !desk.custom) {
    console.warn('[TTS] 自定义 TTS 不可用：非桌面壳');
    return false;
  }
  if (!(await ensureCustom())) return false;
  const result = await desk.custom.speak(text, {
    speed: Math.max(0.5, Math.min(2, Number(rate) || 1)),
    baseUrl: customBaseUrl,
    model: customModel,
    voice: customVoice,
  });
  if (!result || !result.ok) {
    console.warn('[TTS] 自定义 TTS 合成失败', result && result.error);
    return false;
  }
  const type = result.format === 'wav' ? 'audio/wav' : result.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
  const blob = audioToBlob(result.audio, type);
  if (!blob || blob.size < 64) {
    console.warn('[TTS] 自定义 TTS 音频为空');
    return false;
  }
  lastEngine = 'custom';
  await playBlob(blob);
  return true;
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

async function speakMimo(text) {
  const desk = desktopApi();
  if (!desk || !desk.mimo) {
    console.warn('[TTS] MiMo 不可用：非桌面壳');
    return false;
  }
  if (!(await ensureMimo())) return false;
  const result = await desk.mimo.speak(text, { speed: Math.max(0.5, Math.min(2, Number(rate) || 1)), voice: mimoVoice });
  if (!result || !result.ok) {
    console.warn('[TTS] MiMo 合成失败', result && result.error);
    return false;
  }
  const blob = audioToBlob(result.audio, 'audio/wav');
  if (!blob || blob.size < 64) {
    console.warn('[TTS] MiMo 音频为空');
    return false;
  }
  lastEngine = 'mimo';
  await playBlob(blob);
  return true;
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

async function speakVoice(text) {
  const manifest = await loadVoiceManifest();
  if (!manifest) return false;
  const key = voiceHash(manifest.meta.voice, text);
  const entry = manifest.lines[key];
  if (!entry || !entry.file) return false;
  let blob;
  try {
    blob = await fetchPrerecorded(entry.file);
  } catch (_) {
    return false;   // 缓存未命中且取不到：按原语义视为该句不可播，交给引擎链下一档
  }
  lastEngine = 'voice';
  await playBlob(blob);
  return true;
}

async function speakOne(text) {
  const order = sourceOrder();
  for (const eng of order) {
    try {
      if (eng === 'custom') {
        const ok = await speakCustom(text);
        if (ok) return;
        continue;
      }
      if (eng === 'mimo') {
        const ok = await speakMimo(text);
        if (ok) return;
        continue;
      }
      if (eng === 'voice') {
        const ok = await speakVoice(text);
        if (ok) return;
        continue;
      }
      if (eng === 'browser') {
        continue;
      }
    } catch (e) {
      console.warn('[TTS] 引擎失败，尝试下一档:', eng, e && e.message);
    }
  }
  console.warn('[TTS] 所有引擎均失败');
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
  if (source === 'voice') loadVoiceManifest();
  else if (source === 'mimo') ensureMimo().catch(() => {});
  else ensureCustom().catch(() => {});
  return Promise.resolve(true);
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
    const ok = await speakVoice(cleanText(first.text));
    return ok ? 'voice' : null;
  }
  try {
    await speakOne('测试语音：废土大亨语音播报正常');
  } catch (e) {
    console.warn('[TTS] testTts', e && e.message);
  }
  return lastEngine || null;
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
      <div>来源: ${source}</div>
      <div>自定义 TTS: ${desk && desk.custom ? (customReady ? '✓ ' + ((customInfo && customInfo.model) || customModel) : '…') : '✗ 非桌面'}</div>
      <div>服务地址: ${customBaseUrl || '未设置'}</div>
      <div>小米 MiMo: ${desk && desk.mimo ? (mimoReady ? '✓ ' + ((mimoInfo && mimoInfo.model) || 'online') : '…') : '✗ 非桌面'}</div>
      <div>音色: ${source === 'mimo' ? mimoVoice : customVoice}</div>
      <div>Voice: ${voicePackState === 'ready' ? '✓ 预录' : '✗'}</div>
      <div>状态: ${status}</div>
      <div>LastEngine: ${lastEngine || '无'}</div>
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
  const result = await api.saveKey(key);
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
  if (provider === 'mimo') { mimoReady = !!(result && result.ok); mimoInfo = result || null; }
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
  // 队列计数一并归零，并换代：被遗弃链上的播报最长要等 60s 安全定时器才 settle，
  // 期间它们会各自执行 _pending--，若不换代会把新链的计数减成负数、队列上限从此失效。
  _gen++;
  _pending = 0;
  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
}

const MAX_QUEUE = 3;
let _pending = 0;
let _gen = 0;
// 把一条播报挂上 _chain，并登记它所属的世代号
function enqueue(t) {
  const gen = _gen;
  _pending++;
  _chain = _chain.then(() => speakOne(t)).catch(() => {})
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
