// Capacitor 原生 TTS 封装
// 仅在 Capacitor 运行时可用；浏览器/非 Android 环境自动降级

let _available = null;
let _speaking = false;

function isCapacitor() {
  return typeof window !== 'undefined' && !!window.Capacitor;
}

export async function isNativeTtsAvailable() {
  if (_available !== null) {
    console.warn('[CapacitorTTS] isNativeTtsAvailable 缓存结果:', _available);
    return _available;
  }
  try {
    if (!isCapacitor()) {
      console.warn('[CapacitorTTS] 非 Capacitor 环境');
      _available = false;
      return false;
    }
    console.warn('[CapacitorTTS] 动态导入插件...');
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    console.warn('[CapacitorTTS] 插件导入成功，调用 getSupportedLanguages...');
    // 调用一次 lightweight 接口验证插件已注册
    await TextToSpeech.getSupportedLanguages();
    console.warn('[CapacitorTTS] 插件验证成功');
    _available = true;
    return true;
  } catch (e) {
    console.warn('[CapacitorTTS] 不可用:', e && e.message, e && e.stack);
    _available = false;
    return false;
  }
}

export async function nativeSpeak(text, opts = {}) {
  console.log('[CapTTS] nativeSpeak CALLED:', typeof text === 'string' ? text.slice(0, 30) : String(text));
  // 如果之前检测失败，强制重新检测
  if (_available === false) {
    console.warn('[CapTTS] 之前检测失败，强制重新检测...');
    _available = null;
  }
  const available = await isNativeTtsAvailable();
  console.log('[CapTTS] isNativeTtsAvailable:', available);
  if (!available) return false;
  try {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    const cleaned = (text || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/gu, '')
      .replace(/[☢⚑⛓🏆📖💀🤖⚠★✔○]/g, '').trim();
    if (!cleaned) {
      console.log('[CapTTS] empty text, skip');
      return true;
    }
    console.log('[CapTTS] speak start:', cleaned);
    _speaking = true;
    const result = await TextToSpeech.speak({
      text: cleaned,
      lang: 'zh-CN',
      rate: Math.max(0.5, Math.min(2, opts.rate || 1.0)),
      volume: opts.volume ?? 1.0,
      pitch: opts.pitch || 1.0,
      queueStrategy: 0,
    });
    console.log('[CapTTS] speak done:', result);
    _speaking = false;
    return true;
  } catch (e) {
    console.error('[CapTTS] speak FAIL:', e && e.message, e && e.stack);
    _speaking = false;
    return false;
  }
}

export async function nativeStop() {
  if (!(await isNativeTtsAvailable())) return;
  try {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    await TextToSpeech.stop();
    _speaking = false;
  } catch (e) {
    // ignore
  }
}

export function isNativeSpeaking() {
  return _speaking;
}
