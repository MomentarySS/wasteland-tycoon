// 混合语音：预录音频（MiniMax 离线包）→ Capacitor 原生（Android）→ 阶跃/Edge 在线 → 系统 speechSynthesis 兜底
import {
  stepSpeak, stepConfigured,
  setStepApiKey, getStepApiKey,
  setStepVoice, getStepVoice,
  setStepInstruction, getStepInstruction,
  STEP_VOICES
} from './step-tts.js';
import { nativeSpeak, nativeStop } from './capacitor-tts.js';
import { edgeSpeak, setEdgeVoice, getEdgeVoice, EDGE_VOICES } from './edge-tts.js';
// cleanVoiceText 复用为播报清洗（与生成脚本同一份规则，保证预录音频 hash 对得上）
import { cleanVoiceText as cleanText, voiceHash, VOICE_DIR, VOICE_MANIFEST_URL } from './voice-lines.js';

export {
  setStepApiKey, getStepApiKey,
  setStepVoice, getStepVoice,
  setStepInstruction, getStepInstruction,
  STEP_VOICES, stepConfigured,
  setEdgeVoice, getEdgeVoice, EDGE_VOICES
};

const SOURCE_STORAGE = 'wasteland_tts_source';

let enabled = true;
let rate = 1.05;
let volume = 1.0;
let source = 'auto';
let lastEngine = '';
let audioCtx = null;
let currentAudio = null;
// 调试面板关闭状态（记忆到 localStorage，避免刷新后又自动弹出）
let debugHidden = false;
try { debugHidden = localStorage.getItem('ttsDebugHidden') === '1'; } catch (_) {}
let cachedZhVoice = null;
let browserVoicesHooked = false;



function loadSourcePref() {
  try {
    const s = localStorage.getItem(SOURCE_STORAGE);
    if (s === 'sherpa') {
      source = 'auto';
      localStorage.setItem(SOURCE_STORAGE, 'auto');
      return;
    }
    if (s === 'auto' || s === 'step' || s === 'edge') source = s;
  } catch (_) {}
}

function sourceOrder() {
  // auto：Capacitor 原生优先 → step（配了 Key）→ browser 兜底
  // 注意：Edge 档不进 auto 链——微软对大陆 IP 封锁合成接口，默认链里只会白白增加降级延迟；
  // 它仅作为显式「Edge 免费(在线)」来源提供（有代理的用户可用），失败自动落系统语音
  // step：用户显式选择阶跃在线时不得被原生抢先，原生完全不参与
  if (source === 'step') {
    return stepConfigured() ? ['step', 'edge', 'browser'] : ['browser'];
  }
  if (source === 'edge') {
    return ['edge', 'browser'];
  }
  return ['capacitor', ...(stepConfigured() ? ['step'] : []), 'browser'];
}

export function nativeTtsSupported() {
  return !!window.Capacitor;
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

async function speakStep(text) {
  const blob = await stepSpeak(text, { speed: rate, volume });
  lastEngine = 'step';
  await playBlob(blob);
  return true;
}

async function speakEdge(text) {
  // edgeSpeak 失败会 reject，由 speakOne 捕获后降级下一档
  await edgeSpeak(text, { rate, volume, playBlob });
  lastEngine = 'edge';
  return true;
}

// ── 预录音频档（voice）：assets/voice/ 内 MiniMax 离线生成的 mp3，manifest.json 寻址 ──
// manifest 一次性懒加载；serve.mjs 对未知路径会 SPA 回退成 index.html，须校验 content-type/内容
let voiceManifestPromise = null;
let voicePackState = 'unknown'; // unknown | ready | none

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
        console.warn('[TTS] 无预录语音包，走常规引擎链:', e && e.message);
        return null;
      }
    })();
  }
  return voiceManifestPromise;
}

/** 供调试面板/设置页查询预录包状态 */
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
  // 预录音频永远最优先（音质最好且离线零成本）；未命中/加载失败静默落到常规链
  const order = ['voice', ...sourceOrder()];
  for (const eng of order) {
    try {
      if (eng === 'voice') {
        const ok = await speakVoice(text);
        if (ok) return; // 未命中是常态（动态战报无预录），静默走下一档
      }
      if (eng === 'capacitor') {
        const ok = await nativeSpeak(text, { rate, volume });
        if (ok) {
          lastEngine = 'capacitor';
          console.debug('[TTS] 原生引擎成功');
          return;
        }
        console.debug('[TTS] 原生引擎不可用，尝试下一档');
      }
      if (eng === 'step') {
        await speakStep(text);
        return;
      }
      if (eng === 'edge') {
        await speakEdge(text);
        return;
      }
      if (eng === 'browser') {
        const ok = await speakBrowser(text);
        if (ok) {
          lastEngine = 'browser';
          console.debug('[TTS] browser 引擎成功');
          return;
        }
        console.debug('[TTS] browser 引擎失败');
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
  initBrowserVoices();
  try {
    console.warn('[TTS] initTTS 完成, source:', source, 'browser:', browserTtsSupported(), 'capacitor:', nativeTtsSupported());
  } catch (_) {}
  return true;
}

export function preloadTTS() {
  initBrowserVoices();
  loadVoiceManifest(); // 预热 manifest，避免开局第一张任务卡才去拉
  return Promise.resolve(true);
}

export function ttsSupported() { return true; }

export function ttsEngineStatus() {
  try {
    if (!enabled) return 'disabled';
    if (lastEngine === 'voice') return 'voice';
    if (lastEngine === 'capacitor') return 'capacitor';
    if (lastEngine === 'step') return 'step';
    if (lastEngine === 'edge') return 'edge';
    if (lastEngine === 'browser') return 'browser';
    // auto 模式：按可用性显示最优先引擎
    if (source === 'auto') {
      if (nativeTtsSupported()) return 'capacitor-ready';
      if (stepConfigured()) return 'step-ready';
      if (browserTtsSupported()) return 'browser-ready';
      return 'pending';
    }
    if (source === 'edge') {
      return 'edge-ready';
    }
    if (source === 'step') {
      if (!stepConfigured()) return 'no-key';
      return 'step-ready';
    }
    return 'pending';
  } catch (e) {
    console.warn('[TTS] ttsEngineStatus 异常:', e && e.message);
    return 'pending';
  }
}

/** 强制测试 TTS：点击按钮可触发一次语音，用于真机调试 */
export async function testTts() {
  const text = '测试语音：废土大亨语音播报正常';
  console.warn('[TTS] testTts 开始:', text);
  try {
    const ok = await nativeSpeak(text, { rate: 1.0, volume: 1.0 });
    console.warn('[TTS] testTts nativeSpeak 结果:', ok);
    if (ok) return 'capacitor';
  } catch (e) {
    console.warn('[TTS] testTts nativeSpeak 异常:', e && e.message);
  }
  if (navigator.onLine) {
    try {
      await speakEdge(text);
      console.warn('[TTS] testTts edge 成功');
      return 'edge';
    } catch (e) {
      console.warn('[TTS] testTts edge 失败:', e && e.message);
    }
  }
  if (browserTtsSupported()) {
    try {
      // speakBrowser 失败时 resolve(false) 而不是 throw，必须检查返回值
      const ok = await speakBrowser(text);
      if (ok) {
        console.warn('[TTS] testTts browser 成功');
        return 'browser';
      }
      console.warn('[TTS] testTts browser 失败');
    } catch (e) {
      console.warn('[TTS] testTts browser 异常:', e && e.message);
    }
  }
  console.warn('[TTS] testTts 全部失败');
  return null;
}

/** 更新调试面板（仅在需要时调用） */
export function updateTtsDebugPanel() {
  try {
    const el = document.getElementById('debugTts');
    if (!el) return;
    // 已关闭则不再显示（刷新后仍保持关闭，除非清 localStorage）
    if (debugHidden) { el.style.display = 'none'; return; }
    const caps = nativeTtsSupported();
    const browser = browserTtsSupported();
    const step = stepConfigured();
    const status = ttsEngineStatus();
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:2px"><span>TTS 调试面板</span><span id="ttsDbgClose" title="关闭调试面板" style="cursor:pointer;padding:0 4px;border:1px solid #0f0;border-radius:2px;line-height:1.3">✕</span></div>
      <div>Voice: ${voicePackState === 'ready' ? '✓ 预录' : '✗'}</div>
      <div>Capacitor: ${caps ? '✓' : '✗'}</div>
      <div>Browser: ${browser ? '✓' : '✗'}</div>
      <div>Step: ${step ? '✓' : '✗'}</div>
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
  if (s === 'auto' || s === 'step' || s === 'edge') {
    source = s;
    try { localStorage.setItem(SOURCE_STORAGE, s); } catch (_) {}
  }
}
export function getVoiceSource() { return source; }

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
  initBrowserVoices();
}

export function cancelTts() {
  _chain = Promise.resolve();
  if (typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
  nativeStop().catch(() => {});
}

// 播报串行链 + 队列上限：事件密集时丢弃溢出播报，避免 backlog 越积越多、听到几分钟前的旧战报
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
