// Capacitor 原生 TTS 封装
// 仅在 Capacitor 运行时可用；浏览器/非 Android 环境自动降级
// 注意：无打包器的纯浏览器 ESM 无法 import('@capacitor-community/text-to-speech')，
// 必须通过 cap sync 注册的 window.Capacitor.Plugins.TextToSpeech 访问原生层。

const PROBE_RETRY_MS = 10000;
let _available = null;
let _lastProbeAt = 0;
let _speaking = false;

function isCapacitor() {
  return typeof window !== 'undefined' && !!window.Capacitor;
}

function getPlugin() {
  try {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    return (plugins && plugins.TextToSpeech) || null;
  } catch (_) {
    return null;
  }
}

export async function isNativeTtsAvailable() {
  if (_available === true) return true;
  // 检测失败后冷却重试，避免每句朗读都重复全量探测
  if (_available === false && Date.now() - _lastProbeAt < PROBE_RETRY_MS) return false;
  _lastProbeAt = Date.now();
  if (!isCapacitor()) {
    _available = false;
    return false;
  }
  const plugin = getPlugin();
  if (!plugin) {
    console.warn('[CapacitorTTS] TextToSpeech 插件未注册（是否已 npx cap sync android？）');
    _available = false;
    return false;
  }
  try {
    // 调用一次 lightweight 接口验证原生层真实可用
    if (typeof plugin.getSupportedLanguages === 'function') {
      await plugin.getSupportedLanguages();
    }
    _available = true;
    return true;
  } catch (e) {
    console.warn('[CapacitorTTS] 不可用:', e && e.message);
    _available = false;
    return false;
  }
}

function cleanText(text) {
  return (text || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/[☢⚑⛓🏆📖💀🤖⚠★✔○]/g, '')
    .trim();
}

export async function nativeSpeak(text, opts = {}) {
  const available = await isNativeTtsAvailable();
  if (!available) return false;
  const plugin = getPlugin();
  if (!plugin) return false;
  const cleaned = cleanText(text);
  if (!cleaned) return true;
  _speaking = true;
  try {
    await plugin.speak({
      text: cleaned,
      lang: 'zh-CN',
      rate: Math.max(0.5, Math.min(2, opts.rate || 1.0)),
      volume: opts.volume ?? 1.0,
      pitch: opts.pitch || 1.0,
      queueStrategy: 0,
    });
    return true;
  } catch (e) {
    console.warn('[CapTTS] speak 失败:', e && e.message);
    return false;
  } finally {
    _speaking = false;
  }
}

export async function nativeStop() {
  if (!(await isNativeTtsAvailable())) return;
  try {
    const plugin = getPlugin();
    if (plugin && typeof plugin.stop === 'function') await plugin.stop();
    _speaking = false;
  } catch (e) {
    // ignore
  }
}

export function isNativeSpeaking() {
  return _speaking;
}
