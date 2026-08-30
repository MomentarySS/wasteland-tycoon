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

/** 上局结局→下局开场的叙事种子播报（formatNarrativeIntro 同款组装） */
export function narrativeSpeakText(seed) {
  return seed ? `📖 ${seed.name}\n${seed.intro}` : '';
}

/** 章节达成进入下一章的播报（章节名来自 CAMPAIGNS 固定集） */
export function chapterClearSpeakText(name) {
  return `📖 章节达成，进入 ${name}！`;
}

/** 无插值的终局固定播报（coop 全灭 / 合作通关 / 闯关倒下），game.js 直接引用 */
export const GAMEOVER_LINES = {
  allDown: '所有幸存者都已倒下，协议中断。',
  coopClear: '📖 你们携手完成了全部章节，废土终于有了归属。',
  campaignOver: '💀 你在废土中倒下，闯关终止。',
};

// 核弹过场分镜数据：cutscene.js 负责演出，gen-voice.mjs 按 sub 生成预录旁白。
// 过场只读 sub（title 是屏幕字幕装饰，不进语音）。
export const NUKE_SCENES = [
  { id: 'alert', title: '战略警报 · ALERT', sub: '三座导弹井同时上电 — 扩散协议解锁', ms: 2000 },
  { id: 'keys', title: '发射密钥已对齐', sub: '阿尔法 · 布拉沃 · 查理 — 发射授权确认', ms: 2000 },
  { id: 'launch', title: '弹头离井', sub: '落点锁定：棋盘中央 · 无可拦截', ms: 1800 },
];

/** 过场分镜旁白文案（只读 sub） */
export function cutsceneSpeakText(scene) {
  return scene ? scene.sub : '';
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
