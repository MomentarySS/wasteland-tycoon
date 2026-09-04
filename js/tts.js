// 桌面语音链（2026-09-03 应急）：
//   minimax = 全部走 MiniMax 在线 T2A（任务 / 过场 / 动态战报）
//   local   = 仅 Kokoro（对照）
//   voice   = 仅 MiniMax 预录
// 系统 speechSynthesis 已停用。默认纯 MiniMax，不与其它引擎混播。
import { cleanVoiceText as cleanText, voiceHash, VOICE_DIR, VOICE_MANIFEST_URL } from './voice-lines.js';

const SOURCE_STORAGE = 'wasteland_tts_source';
const VOICE_STORAGE = 'wasteland_tts_minimax_voice';

export const MINIMAX_VOICES = [
  { id: 'male-qn-jingying', label: '精英青年（默认）' },
  { id: 'Chinese (Mandarin)_Radio_Host', label: '电台男主播' },
  { id: 'Chinese (Mandarin)_Male_Announcer', label: '播报男声' },
  { id: 'Chinese (Mandarin)_Reliable_Executive', label: '沉稳高管' },
  { id: 'Chinese (Mandarin)_Gentleman', label: '温润男声' },
  { id: 'Chinese (Mandarin)_Unrestrained_Young_Man', label: '不羁青年' },
  { id: 'male-qn-badao', label: '霸道青年' },
  { id: 'Robot_Armor', label: '机械战甲' },
  { id: 'Chinese (Mandarin)_News_Anchor', label: '新闻女声' },
  { id: 'female-yujie', label: '御姐' },
  { id: 'female-chengshu', label: '成熟女性' },
  { id: 'Chinese (Mandarin)_Wise_Women', label: '阅历姐姐' },
];
const DEFAULT_MINIMAX_VOICE = MINIMAX_VOICES[0].id;

let enabled = true;
let rate = 1.05;
let volume = 1.0;
let source = 'minimax';
let minimaxVoice = DEFAULT_MINIMAX_VOICE;
let lastEngine = '';
let audioCtx = null;
let currentAudio = null;
let debugHidden = true;
try { if (localStorage.getItem('ttsDebugHidden') === '0') debugHidden = false; } catch (_) {}
let cachedZhVoice = null;
let browserVoicesHooked = false;
let kokoroReady = false;
let minimaxReady = false;
let minimaxInfo = null;

function desktopApi() {
  try { return (typeof window !== 'undefined' && window.wastelandDesktop) || null; } catch (_) { return null; }
}

function loadSourcePref() {
  try {
    const s = localStorage.getItem(SOURCE_STORAGE);
    if (s === 'voice') source = 'voice';
    else source = 'minimax';
  } catch (_) {}
}

function loadVoicePref() {
  try {
    const v = localStorage.getItem(VOICE_STORAGE);
    if (v && MINIMAX_VOICES.some((x) => x.id === v)) minimaxVoice = v;
    else minimaxVoice = DEFAULT_MINIMAX_VOICE;
  } catch (_) {}
}

function sourceOrder() {
  if (source === 'voice') return ['voice'];
  if (source === 'local') return ['kokoro'];
  return ['minimax'];
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

function mp3ToBlob(mp3) {
  if (!mp3) return null;
  if (mp3 instanceof Blob) return mp3;
  if (mp3 instanceof ArrayBuffer) return new Blob([mp3], { type: 'audio/mpeg' });
  if (mp3 instanceof Uint8Array) {
    const copy = mp3.byteOffset === 0 && mp3.byteLength === mp3.buffer.byteLength
      ? mp3
      : mp3.slice();
    return new Blob([copy], { type: 'audio/mpeg' });
  }
  if (ArrayBuffer.isView(mp3)) return new Blob([mp3], { type: 'audio/mpeg' });
  if (Array.isArray(mp3)) return new Blob([Uint8Array.from(mp3)], { type: 'audio/mpeg' });
  if (mp3.type === 'Buffer' && Array.isArray(mp3.data)) {
    return new Blob([Uint8Array.from(mp3.data)], { type: 'audio/mpeg' });
  }
  if (mp3.data) return new Blob([Uint8Array.from(mp3.data)], { type: 'audio/mpeg' });
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

async function ensureKokoro() {
  const desk = desktopApi();
  if (!desk || !desk.kokoro) return false;
  if (kokoroReady) return true;
  try {
    const info = await desk.kokoro.init();
    kokoroReady = !!(info && info.ok);
    if (!kokoroReady) console.warn('[TTS] Kokoro init 未就绪', info && info.error);
    return kokoroReady;
  } catch (e) {
    console.warn('[TTS] Kokoro init 失败', e && e.message);
    return false;
  }
}

async function ensureMinimax() {
  const desk = desktopApi();
  if (!desk || !desk.minimax) return false;
  if (minimaxReady) return true;
  try {
    const info = await desk.minimax.init();
    minimaxInfo = info || null;
    minimaxReady = !!(info && info.ok);
    if (!minimaxReady) console.warn('[TTS] MiniMax init 未就绪', info && info.error);
    else console.warn('[TTS] MiniMax 就绪', info.model, info.voice);
    return minimaxReady;
  } catch (e) {
    console.warn('[TTS] MiniMax init 失败', e && e.message);
    return false;
  }
}

function pcmToWavBlob(pcm, sampleRate) {
  const samples = pcm instanceof Float32Array
    ? pcm
    : Float32Array.from(pcm && pcm.length != null ? pcm : []);
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function wavToBlob(wav) {
  if (!wav) return null;
  let u8 = null;
  if (wav instanceof Uint8Array) u8 = wav;
  else if (wav instanceof ArrayBuffer) u8 = new Uint8Array(wav);
  else if (Array.isArray(wav)) u8 = Uint8Array.from(wav);
  else if (wav.data) u8 = Uint8Array.from(wav.data);
  if (!u8 || u8.byteLength < 64) return null;
  return new Blob([u8], { type: 'audio/wav' });
}

function kokoroSpeedFromUi(uiRate) {
  if (uiRate <= 0.95) return 0.85;
  if (uiRate >= 1.3) return 1.12;
  return 0.95;
}

function minimaxSpeedFromUi(uiRate) {
  const n = Number(uiRate);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(2, n));
}

async function speakKokoro(text) {
  const desk = desktopApi();
  if (!desk || !desk.kokoro) return false;
  if (!(await ensureKokoro())) return false;
  const result = await desk.kokoro.speak(text, { speed: kokoroSpeedFromUi(rate) });
  if (!result) return false;
  const blob = result instanceof Blob
    ? result
    : (result.blob instanceof Blob ? result.blob : wavToBlob(result.wav));
  if (blob) {
    lastEngine = 'kokoro';
    await playBlob(blob);
    return true;
  }
  if (result.pcm && result.sampleRate) {
    lastEngine = 'kokoro';
    await playBlob(pcmToWavBlob(result.pcm, result.sampleRate));
    return true;
  }
  return false;
}

async function speakMinimax(text) {
  const desk = desktopApi();
  if (!desk || !desk.minimax) {
    console.warn('[TTS] MiniMax 不可用：非桌面壳');
    return false;
  }
  if (!(await ensureMinimax())) return false;
  const result = await desk.minimax.speak(text, { speed: minimaxSpeedFromUi(rate), voice: minimaxVoice });
  if (!result || !result.ok) {
    console.warn('[TTS] MiniMax 合成失败', result && result.error);
    return false;
  }
  const blob = mp3ToBlob(result.mp3);
  if (!blob || blob.size < 64) {
    console.warn('[TTS] MiniMax 音频为空');
    return false;
  }
  lastEngine = 'minimax';
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
  const res = await fetch(VOICE_DIR + '/' + entry.file);
  if (!res.ok) return false;
  const blob = await res.blob();
  if (!blob || blob.size < 64) return false;
  lastEngine = 'voice';
  await playBlob(blob);
  return true;
}

async function speakOne(text) {
  const order = sourceOrder();
  for (const eng of order) {
    try {
      if (eng === 'minimax') {
        const ok = await speakMinimax(text);
        if (ok) return;
        continue;
      }
      if (eng === 'kokoro') {
        const ok = await speakKokoro(text);
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
  loadVoicePref();
  if (source === 'minimax') ensureMinimax().catch(() => {});
  else if (source === 'local') ensureKokoro().catch(() => {});
  else if (source === 'voice') loadVoiceManifest();
  try {
    console.warn('[TTS] initTTS 完成, source:', source, 'desktop:', !!desktopApi());
  } catch (_) {}
  return true;
}

export function preloadTTS() {
  if (source === 'voice') loadVoiceManifest();
  else if (source === 'local') ensureKokoro().catch(() => {});
  else ensureMinimax().catch(() => {});
  return Promise.resolve(true);
}

export function ttsSupported() { return true; }

export function ttsEngineStatus() {
  try {
    if (!enabled) return 'disabled';
    if (source === 'voice') {
      if (lastEngine === 'voice') return 'voice';
      if (voicePackState === 'ready') return 'voice-ready';
      if (voicePackState === 'none') return 'voice-none';
      return 'voice-pending';
    }
    if (source === 'local') {
      if (lastEngine === 'kokoro') return 'kokoro';
      if (desktopApi() && desktopApi().kokoro) return kokoroReady ? 'kokoro-ready' : 'kokoro-pending';
      return 'kokoro-missing';
    }
    if (lastEngine === 'minimax') return 'minimax';
    if (desktopApi() && desktopApi().minimax) return minimaxReady ? 'minimax-ready' : 'minimax-pending';
    return 'minimax-missing';
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
      <div>MiniMax: ${desk && desk.minimax ? (minimaxReady ? '✓ ' + ((minimaxInfo && minimaxInfo.model) || 'online') : '…') : '✗ 非桌面'}</div>
      <div>音色: ${minimaxVoice}</div>
      <div>Kokoro: ${desk && desk.kokoro ? (kokoroReady ? '✓' : '待命') : '✗'}</div>
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
  if (s === 'minimax' || s === 'local' || s === 'voice' || s === 'auto') {
    source = s === 'auto' ? 'minimax' : s;
    lastEngine = '';
    try { localStorage.setItem(SOURCE_STORAGE, source); } catch (_) {}
    try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
    if (source === 'minimax') ensureMinimax().catch(() => {});
  }
}
export function getVoiceSource() { return source; }

export function setMinimaxVoice(id) {
  const hit = MINIMAX_VOICES.find((x) => x.id === id);
  minimaxVoice = hit ? hit.id : DEFAULT_MINIMAX_VOICE;
  lastEngine = '';
  try { localStorage.setItem(VOICE_STORAGE, minimaxVoice); } catch (_) {}
  try { window.dispatchEvent(new Event('wasteland-tts-changed')); } catch (_) {}
}
export function getMinimaxVoice() { return minimaxVoice; }

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
  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
}

const MAX_QUEUE = 3;
let _pending = 0;

export function ttsSpeak(text) {
  const t = cleanText(text);
  if (!enabled || !t) return;
  if (_pending >= MAX_QUEUE) {
    console.warn('[TTS] 播报队列已满，丢弃:', t.slice(0, 20));
    return;
  }
  _pending++;
  _chain = _chain.then(() => speakOne(t)).catch(() => {}).finally(() => { _pending--; });
  return _chain;
}

/** 过场 / 固定旁白：与 ttsSpeak 同一条 MiniMax 链，不受队列上限丢弃 */
export function ttsSpeakPrerecorded(text) {
  const t = cleanText(text);
  if (!enabled || !t) return Promise.resolve(false);
  _pending++;
  _chain = _chain.then(() => speakOne(t)).catch(() => {}).finally(() => { _pending--; });
  return _chain;
}
