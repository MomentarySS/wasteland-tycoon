// 预录语音共享模块：播报文案组装 + 音频寻址 hash。
// 运行时与 scripts/gen-voice.mjs 共用。文案改动后必须重录，否则 hash 失配静音。
//
// 电台只念「节目」：任务开场、选项结果、章节/结局/过场、少数地块氛围。
// 不念账本：买地、交租、用卡、掷骰、带玩家名的战报。

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

/** 拼接旁白：去尾标点再以句号连接，避免「物资。。救人」这种双句号进预录。 */
function joinSpeakParts(...parts) {
  const cleaned = parts
    .map((p) => String(p || '').replace(/[。．.!?！？]+$/g, '').trim())
    .filter(Boolean);
  return cleaned.length ? cleaned.join('。') + '。' : '';
}

/** 任务开场：标题 + 故事 + 道德钩（不含选项按钮文案） */
export function missionSpeakText(m) {
  if (!m) return '';
  return joinSpeakParts(m.title, m.story, m.moral);
}

/** 选项结算旁白：只读 JSON 的 result，不拼玩家名 */
export function choiceResultSpeakText(choice) {
  return (choice && choice.result) || '';
}

export function chapterSpeakText(intro) {
  return joinSpeakParts(intro.title, intro.story);
}

export function endingSpeakText(e) {
  return e.log;
}

export function narrativeSpeakText(seed) {
  return seed ? `📖 ${seed.name}\n${seed.intro}` : '';
}

export function chapterClearSpeakText(name) {
  return `📖 章节达成，进入 ${name}！`;
}

export const GAMEOVER_LINES = {
  allDown: '所有幸存者都已倒下，协议中断。',
  coopClear: '📖 你们携手完成了全部章节，废土终于有了归属。',
  campaignOver: '💀 你在废土中倒下，闯关终止。',
};

/** 特殊格 / 发射确认：固定氛围句 */
export const SET_PIECE_LINES = {
  blackMarket: '你溜进黑市，能捞点什么？',
  radiation: '盖革计数器狂响。深采回报高，浅采省成本但会污染声誉。',
  bunker: '厚门后是无菌空气。休整恢复士气，或就地加固一处地产。',
  nukeConfirm: '阿尔法、布拉沃、查理三井密钥已对齐，靶场锁定棋盘中央。发射后棋盘将被核平，无论当前战局输赢，你都将获得绝对胜利。',
};

export const NUKE_SCENES = [
  { id: 'alert', title: '战略警报 · ALERT', sub: '三座导弹井同时上电 — 扩散协议解锁', ms: 2000 },
  { id: 'keys', title: '发射密钥已对齐', sub: '阿尔法 · 布拉沃 · 查理 — 发射授权确认', ms: 2000 },
  { id: 'launch', title: '弹头离井', sub: '落点锁定：棋盘中央 · 无可拦截', ms: 1800 },
];

export function cutsceneSpeakText(scene) {
  return scene ? scene.sub : '';
}

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
