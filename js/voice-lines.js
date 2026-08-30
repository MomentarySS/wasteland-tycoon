// 预录语音共享模块：播报文案组装 + 音频寻址 hash。
// 运行时（tts.js / view-modal.js）与生成脚本（scripts/gen-voice.mjs）共用同一套
// 组装与 hash 逻辑——任何一侧文案改动都会导致 hash 失配，运行时查不到音频
// 就静默回退到普通 TTS 引擎链，不会播错旧音频。
// 纯函数、无 DOM 依赖，Node 与浏览器均可 import。

export const VOICE_DIR = 'assets/voice';
export const VOICE_MANIFEST_URL = VOICE_DIR + '/manifest.json';

/** 播报清洗：剔除 emoji/装饰符号，压缩空白（与 tts.js 历史规则一致） */
export function cleanVoiceText(s) {
  return (s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/[☢⚑⛓🏆📖💀🤖⚠★✔○]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 播报文案组装（各调用点保持与 ttsSpeak 原始入参一字不差，清洗在 ttsSpeak 统一做）

export function missionSpeakText(m) {
  return m.title + (m.moral ? '。' + m.moral : '');
}

export function chapterSpeakText(intro) {
  return intro.title + '。' + intro.story;
}

export function endingSpeakText(e) {
  return e.log;
}

/**
 * 音频寻址 hash：key = hash(voiceId + '|' + 清洗后的文案)。
 * 双 32 位混合（FNV-1a + 乘法散列）拼成 64 bit，sync 无 crypto 依赖，
 * 千级条目碰撞概率可忽略；换音色/改文案都会得到全新 key。
 */
export function voiceHash(voice, text) {
  const bytes = new TextEncoder().encode(String(voice) + '|' + String(text));
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 + b, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
