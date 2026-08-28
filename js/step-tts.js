// 阶跃星辰 Step Plan 在线 TTS（方案 A：浏览器直连，Key 存 localStorage）
// 文档：https://platform.stepfun.com/docs/zh/step-plan/integrations/audio-api

export const STEP_SPEECH_URL = 'https://api.stepfun.com/step_plan/v1/audio/speech';

export const STEP_VOICES = [
  { id: 'cixingnansheng', label: '磁性男声（废土电台推荐）' },
  { id: 'magnetic-voiced-male', label: 'Magnetic Male（有声书）' },
  { id: 'linjiajiejie', label: '邻家姐姐' },
  { id: 'wenrounvsheng', label: '温柔女声' },
  { id: 'yuanqinansheng', label: '元气男声' },
];

const KEY_STORAGE = 'wasteland_step_api_key';
const VOICE_STORAGE = 'wasteland_step_voice';
const INSTR_STORAGE = 'wasteland_step_instruction';

const DEFAULT_INSTRUCTION = '语气沉稳，略带沙哑，像废土电台战报播报员，语速适中';

export function getStepApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { return ''; }
}

export function setStepApiKey(key) {
  const k = (key || '').trim();
  try {
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (_) {}
}

export function stepConfigured() {
  return getStepApiKey().length > 8;
}

export function getStepVoice() {
  try { return localStorage.getItem(VOICE_STORAGE) || 'cixingnansheng'; } catch (_) { return 'cixingnansheng'; }
}

export function setStepVoice(v) {
  if (v) {
    try { localStorage.setItem(VOICE_STORAGE, v); } catch (_) {}
  }
}

export function getStepInstruction() {
  try { return localStorage.getItem(INSTR_STORAGE) || DEFAULT_INSTRUCTION; } catch (_) { return DEFAULT_INSTRUCTION; }
}

export function setStepInstruction(s) {
  try {
    const t = (s || '').trim();
    if (t) localStorage.setItem(INSTR_STORAGE, t);
    else localStorage.removeItem(INSTR_STORAGE);
  } catch (_) {}
}

/** 调用 Step Plan 非流式 TTS，返回 mp3 Blob */
export async function stepSpeak(text, opts = {}) {
  const apiKey = getStepApiKey();
  if (!apiKey) throw new Error('未配置阶跃 API Key');

  const body = {
    model: opts.model || 'stepaudio-2.5-tts',
    input: String(text).slice(0, 1000),
    voice: opts.voice || getStepVoice(),
    response_format: 'mp3',
    speed: opts.speed ?? 1.05,
    volume: opts.volume ?? 1.0,
    text_normalization: 'enhanced',
  };
  const instr = opts.instruction ?? getStepInstruction();
  if (instr) body.instruction = String(instr).slice(0, 200);

  const res = await fetch(STEP_SPEECH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = res.status + '';
    try {
      const j = await res.json();
      if (j.error && j.error.message) msg = j.error.message;
      else if (j.message) msg = j.message;
    } catch (_) {
      try { msg = (await res.text()).slice(0, 160); } catch (_) {}
    }
    throw new Error('阶跃 TTS: ' + msg);
  }

  const blob = await res.blob();
  if (!blob || blob.size < 64) throw new Error('阶跃 TTS 返回空音频');
  return blob;
}
