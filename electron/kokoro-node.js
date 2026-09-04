// electron/kokoro-node.js —— Kokoro-82M v1.1-zh（Node ORT，主进程推理）
// 对齐 sherpa-onnx kokoro-multi-lang-v1_1：
//   voices.bin = [103 speakers][510 token-length][256]
//   tokens 两端包 0；style 按下标 len(tokens)-2 取
//   中文 G2P = lexicon 最长匹配（不是逐字）

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanVoiceText } from '../js/voice-lines.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 24000;
const MAX_TOKEN_LEN = 510;
const STYLE_DIM = 256;

// 模型 metadata speaker_names：0-2 英文，3-57 女声 zf_*，58-102 男声 zm_*
// 默认 zm_010（sid 59）——中文男声里比较干净的一档
const SPEAKER_NAMES = [
  'af_maple', 'af_sol', 'bf_vale',
  'zf_001', 'zf_002', 'zf_003', 'zf_004', 'zf_005', 'zf_006', 'zf_007', 'zf_008',
  'zf_017', 'zf_018', 'zf_019', 'zf_021', 'zf_022', 'zf_023', 'zf_024', 'zf_026',
  'zf_027', 'zf_028', 'zf_032', 'zf_036', 'zf_038', 'zf_039', 'zf_040', 'zf_042',
  'zf_043', 'zf_044', 'zf_046', 'zf_047', 'zf_048', 'zf_049', 'zf_051', 'zf_059',
  'zf_060', 'zf_067', 'zf_070', 'zf_071', 'zf_072', 'zf_073', 'zf_074', 'zf_075',
  'zf_076', 'zf_077', 'zf_078', 'zf_079', 'zf_083', 'zf_084', 'zf_085', 'zf_086',
  'zf_087', 'zf_088', 'zf_090', 'zf_092', 'zf_093', 'zf_094', 'zf_099',
  'zm_009', 'zm_010', 'zm_011', 'zm_012', 'zm_013', 'zm_014', 'zm_015', 'zm_016',
  'zm_020', 'zm_025', 'zm_029', 'zm_030', 'zm_031', 'zm_033', 'zm_034', 'zm_035',
  'zm_037', 'zm_041', 'zm_045', 'zm_050', 'zm_052', 'zm_053', 'zm_054', 'zm_055',
  'zm_056', 'zm_057', 'zm_058', 'zm_061', 'zm_062', 'zm_063', 'zm_064', 'zm_065',
  'zm_066', 'zm_068', 'zm_069', 'zm_080', 'zm_081', 'zm_082', 'zm_089', 'zm_091',
  'zm_095', 'zm_096', 'zm_097', 'zm_098', 'zm_100',
];
const DEFAULT_VOICE = 59; // zm_010，中文男声里比较干净的一档

const PUNCT_MAP = {
  '，': ',', '、': ',', '：': ':', '；': ';',
  '。': '.', '？': '?', '！': '!',
};
const SENTENCE_PUNCT = new Set(['.', '!', '?', ';']);
const PUNCT = new Set([';', ':', ',', '.', '!', '?', '—', '…', '"', '(', ')', '“', '”']);
const HAN_DIGIT = '零一二三四五六七八九';

let session = null;
let tokens = null;       // Map<string, number>
let word2ids = null;     // Map<string, number[]>
let lexMaxLen = 1;
let voices = null;       // { speakers, maxLen, dim, data }
let modelDir = null;
let modelFile = null;
let enLexLoaded = false;

function resolveModelDir(app) {
  if (process.env.WASTELAND_TTS_MODELS) {
    return process.env.WASTELAND_TTS_MODELS;
  }
  if (app && app.isPackaged && process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'tts-models');
    if (existsSync(path.join(packed, 'model.onnx')) || existsSync(path.join(packed, 'model.int8.onnx'))) {
      return packed;
    }
  }
  const repo = path.join(__dirname, '..', 'assets', 'tts-models');
  if (existsSync(path.join(repo, 'model.onnx')) || existsSync(path.join(repo, 'model.int8.onnx'))) {
    return repo;
  }
  if (app) {
    const www = path.join(app.getAppPath(), 'www', 'assets', 'tts-models');
    if (existsSync(www)) return www;
  }
  return repo;
}

function resolveModelFile(dir) {
  const fp32 = path.join(dir, 'model.onnx');
  if (existsSync(fp32)) return fp32;
  const int8 = path.join(dir, 'model.int8.onnx');
  if (existsSync(int8)) return int8;
  return null;
}

function parseTokenLine(line) {
  const idx = line.lastIndexOf(' ');
  if (idx < 0) return null;
  const id = parseInt(line.slice(idx + 1), 10);
  if (!Number.isFinite(id)) return null;
  return { tok: line.slice(0, idx), id };
}

async function loadTokens(filePath) {
  const text = await readFile(filePath, 'utf8');
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const parsed = parseTokenLine(line);
    if (parsed) m.set(parsed.tok, parsed.id);
  }
  return m;
}

function ingestLexiconText(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0].toLowerCase();
    if (word2ids.has(word)) continue;
    const ids = [];
    for (let i = 1; i < parts.length; i++) {
      const id = tokens.get(parts[i]);
      if (id !== undefined) ids.push(id);
    }
    if (!ids.length && word !== '呣') continue;
    word2ids.set(word, ids);
    if (word.length > lexMaxLen) lexMaxLen = word.length;
  }
}

async function loadLexicon(filePath) {
  if (!existsSync(filePath)) return;
  ingestLexiconText(await readFile(filePath, 'utf8'));
}

async function ensureEnLexicon() {
  if (enLexLoaded || !modelDir) return;
  enLexLoaded = true;
  await loadLexicon(path.join(modelDir, 'lexicon-us-en.txt'));
}

async function loadVoices(filePath) {
  const buf = await readFile(filePath);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const speakers = SPEAKER_NAMES.length;
  const expected = speakers * MAX_TOKEN_LEN * STYLE_DIM;
  if (f32.length !== expected) {
    console.warn('[kokoro-node] voices.bin 长度异常:', f32.length, 'expected', expected);
  }
  return {
    speakers,
    maxLen: MAX_TOKEN_LEN,
    dim: STYLE_DIM,
    data: f32,
  };
}

function resolveSid(opts) {
  if (opts && typeof opts.voice === 'string' && opts.voice) {
    const i = SPEAKER_NAMES.indexOf(opts.voice);
    if (i >= 0) return i;
  }
  const n = Number(opts && (opts.sid ?? opts.voice));
  if (Number.isFinite(n) && n >= 0 && n < SPEAKER_NAMES.length) return n | 0;
  return DEFAULT_VOICE;
}

function getStyleEmbedding(sid, tokenLenWithoutPad) {
  const { speakers, maxLen, dim, data } = voices;
  let s = sid;
  if (s < 0 || s >= speakers) s = DEFAULT_VOICE;
  let len = tokenLenWithoutPad | 0;
  if (len < 0) len = 0;
  if (len >= maxLen) len = maxLen - 1;
  const offset = (s * maxLen + len) * dim;
  return data.slice(offset, offset + dim);
}

function isHan(ch) {
  const c = ch.codePointAt(0);
  return c >= 0x4e00 && c <= 0x9fff;
}

function intToHan(n) {
  if (n === 0) return '零';
  if (n < 10) return HAN_DIGIT[n];
  if (n < 20) return n === 10 ? '十' : '十' + HAN_DIGIT[n % 10];
  if (n < 100) {
    const o = n % 10;
    return HAN_DIGIT[(n / 10) | 0] + '十' + (o ? HAN_DIGIT[o] : '');
  }
  if (n < 1000) {
    const h = (n / 100) | 0;
    const rest = n % 100;
    if (!rest) return HAN_DIGIT[h] + '百';
    if (rest < 10) return HAN_DIGIT[h] + '百零' + HAN_DIGIT[rest];
    return HAN_DIGIT[h] + '百' + intToHan(rest);
  }
  if (n < 10000) {
    const th = (n / 1000) | 0;
    const rest = n % 1000;
    if (!rest) return HAN_DIGIT[th] + '千';
    if (rest < 100) return HAN_DIGIT[th] + '千零' + intToHan(rest);
    return HAN_DIGIT[th] + '千' + intToHan(rest);
  }
  const w = (n / 10000) | 0;
  const rest = n % 10000;
  if (!rest) return intToHan(w) + '万';
  if (rest < 1000) return intToHan(w) + '万零' + intToHan(rest);
  return intToHan(w) + '万' + intToHan(rest);
}

function foldDigits(s) {
  return s.replace(/\d+/g, (raw) => {
    if (raw.length === 1) return HAN_DIGIT[raw] || raw;
    if (raw.length <= 5 && raw[0] !== '0') {
      const v = Number(raw);
      if (Number.isInteger(v) && v >= 0 && v <= 99999) return intToHan(v);
    }
    return [...raw].map((d) => HAN_DIGIT[d] || d).join('');
  });
}

function normalizeText(text) {
  let t = foldDigits(text);
  for (const [a, b] of Object.entries(PUNCT_MAP)) t = t.split(a).join(b);
  return t.replace(/\s+/g, ' ').trim();
}

function longestWordIds(chars, i) {
  const maxn = Math.min(lexMaxLen, chars.length - i);
  for (let n = maxn; n >= 1; n--) {
    const w = chars.slice(i, i + n).join('');
    const ids = word2ids.get(w);
    if (ids) return { ids, n };
  }
  return null;
}

function textToSentences(text) {
  const chars = [...normalizeText(text)];
  const sentences = [];
  let cur = [0];

  function flush() {
    if (cur.length > 1) {
      cur.push(0);
      sentences.push(cur);
    }
    cur = [0];
  }

  function addIds(ids) {
    if (!ids || !ids.length) return;
    if (cur.length + ids.length > MAX_TOKEN_LEN - 2) flush();
    cur.push(...ids);
  }

  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === ' ') { i++; continue; }

    if (PUNCT.has(ch) && tokens.has(ch)) {
      addIds([tokens.get(ch)]);
      if (SENTENCE_PUNCT.has(ch)) flush();
      i++;
      continue;
    }

    if (isHan(ch)) {
      const hit = longestWordIds(chars, i);
      if (hit) {
        addIds(hit.ids);
        i += hit.n;
      } else {
        i++;
      }
      continue;
    }

    let j = i;
    while (j < chars.length && !isHan(chars[j]) && chars[j] !== ' ' && !PUNCT.has(chars[j])) j++;
    const word = chars.slice(i, j).join('').toLowerCase();
    i = j;
    const ids = word2ids.get(word);
    if (ids) {
      addIds(ids);
      const sp = tokens.get(' ');
      if (sp !== undefined) addIds([sp]);
    }
  }

  flush();
  return sentences;
}

function pickAudioTensor(results) {
  if (results.audio) return results.audio;
  const name = session.outputNames.find((n) => n === 'audio' || n.endsWith('audio'));
  if (name && results[name]) return results[name];
  // 绝不用 outputNames[0]：该导出把 onnx::Shape_* 排在 audio 前面
  for (const n of session.outputNames) {
    const t = results[n];
    if (t && t.data && t.data.length > 64) return t;
  }
  return results[session.outputNames[session.outputNames.length - 1]];
}

function tensorToF32(outTensor) {
  const data = outTensor && outTensor.data;
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) return new Float32Array(data.buffer, data.byteOffset, data.length);
  return new Float32Array(data || []);
}

export function pcmToWavBuffer(pcm, sampleRate = SAMPLE_RATE) {
  const n = pcm.length;
  const buf = Buffer.allocUnsafe(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0, 44 + i * 2);
  }
  return buf;
}

export async function init() {
  if (session) return { ok: true, cached: true, modelDir, modelFile: modelFile && path.basename(modelFile) };
  try {
    const ort = await import('onnxruntime-node');
    if (process.env.WASTELAND_TTS_MODELS) {
      modelDir = process.env.WASTELAND_TTS_MODELS;
    } else {
      try {
        const { app } = await import('electron');
        modelDir = resolveModelDir(app);
      } catch {
        modelDir = resolveModelDir(null);
      }
    }
    modelFile = resolveModelFile(modelDir);
    if (!modelFile) {
      throw new Error('未找到 model.onnx / model.int8.onnx: ' + modelDir);
    }

    word2ids = new Map();
    lexMaxLen = 1;

    const [tok, voc, sess] = await Promise.all([
      loadTokens(path.join(modelDir, 'tokens.txt')),
      loadVoices(path.join(modelDir, 'voices.bin')),
      ort.InferenceSession.create(modelFile, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      }),
    ]);
    tokens = tok;
    voices = voc;
    session = sess;
    await loadLexicon(path.join(modelDir, 'lexicon-zh.txt'));

    console.warn('[kokoro-node] 就绪:', path.basename(modelFile),
      'speakers=' + voices.speakers,
      'lexicon=' + word2ids.size,
      'tokens=' + tokens.size,
      'inputs=', session.inputNames,
      'outputs=', session.outputNames);

    return {
      ok: true,
      cached: false,
      modelDir,
      modelFile: path.basename(modelFile),
      speakers: voices.speakers,
      defaultVoice: SPEAKER_NAMES[DEFAULT_VOICE],
      layout: 'speaker x tokenLen x 256',
    };
  } catch (e) {
    console.error('[kokoro-node] init 失败:', e);
    session = null;
    return { ok: false, error: String(e && e.message || e) };
  }
}

export async function speak(text, opts = {}) {
  if (!session) {
    const info = await init();
    if (!info.ok) return null;
  }

  const t = cleanVoiceText(text);
  if (!t) return null;

  if (/[A-Za-z]/.test(t)) {
    await ensureEnLexicon();
  }

  const sentences = textToSentences(t);
  if (!sentences.length) {
    console.warn('[kokoro-node] 无可识别字符:', t.slice(0, 40));
    return null;
  }

  const ort = await import('onnxruntime-node');
  const sid = resolveSid(opts);
  const speed = Math.max(0.7, Math.min(1.4, Number(opts.speed ?? opts.rate) || 0.95));
  const chunks = [];

  for (const ids of sentences) {
    if (ids.length < 3) continue;
    const styleLen = ids.length - 2;
    const voiceEmb = getStyleEmbedding(sid, styleLen);
    const feeds = {};
    const names = session.inputNames;
    feeds[names[0]] = new ort.Tensor(
      'int64',
      BigInt64Array.from(ids, BigInt),
      [1, ids.length],
    );
    feeds[names[1]] = new ort.Tensor('float32', voiceEmb, [1, voices.dim]);
    if (names.length > 2) {
      feeds[names[2]] = new ort.Tensor('float32', Float32Array.of(speed), [1]);
    }

    const results = await session.run(feeds);
    chunks.push(tensorToF32(pickAudioTensor(results)));
  }

  if (!chunks.length) return null;

  const gap = chunks.length > 1 ? Math.round(SAMPLE_RATE * 0.16) : 0;
  const n = chunks.reduce((s, c) => s + c.length, 0) + gap * Math.max(0, chunks.length - 1);
  const audio = new Float32Array(n);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    audio.set(chunks[i], o);
    o += chunks[i].length;
    if (i < chunks.length - 1) o += gap;
  }

  return {
    wav: pcmToWavBuffer(audio, SAMPLE_RATE),
    pcm: opts.includePcm === false ? undefined : Array.from(audio),
    sampleRate: SAMPLE_RATE,
    voice: SPEAKER_NAMES[sid],
    sid,
  };
}

export function listVoices() {
  return SPEAKER_NAMES.slice();
}
