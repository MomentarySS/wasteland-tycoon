#!/usr/bin/env node
// MiniMax TTS 离线预录生成器：把任务卡/章节叙事/结局的固定播报文案批量合成 mp3。
// 产物：assets/voice/<hash>.mp3 + assets/voice/manifest.json（运行时 tts.js 按文案 hash 寻址）。
//
// 用法：
//   node scripts/gen-voice.mjs --list                 # 只打印清单与字数（无需 Key）
//   node scripts/gen-voice.mjs --export-tasks         # 导出任务清单给 MiniMax Agent 等外部合成（无需 Key）
//   node scripts/gen-voice.mjs --manifest-only        # 外部音频拷回 assets/voice/ 后本地重建 manifest（无需 Key）
//   node scripts/gen-voice.mjs --audition             # 候选音色各生成一条试听 → assets/voice-audition/
//   node scripts/gen-voice.mjs                        # 全量生成（增量：已存在的条目跳过）
//   node scripts/gen-voice.mjs --force --voice <id>   # 换音色/强制全部重录
//   node scripts/gen-voice.mjs --only r1              # 只重录 id 含 "r1" 的条目（配合 --force；局部重录不重建 manifest，收口再跑一次全量）
//
// 鉴权：MINIMAX_API_KEY（必需）+ MINIMAX_GROUP_ID（可选），或项目根目录 .minimax-api-key / .minimax-group-id 文件
//
// 注意：hash 逻辑必须与 js/voice-lines.js 完全一致（直接 import 它），文案改动后重跑即可，
// 未重录的条目运行时查不到 hash 会静默回退普通 TTS，不会播错。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missionSpeakText, choiceResultSpeakText, chapterSpeakText, endingSpeakText,
  narrativeSpeakText, chapterClearSpeakText, cutsceneSpeakText, GAMEOVER_LINES, NUKE_SCENES,
  SET_PIECE_LINES, cleanVoiceText, voiceHash, VOICE_DIR
} from '../js/voice-lines.js';
import { CAMPAIGNS, CHAPTER_INTROS, CAMPAIGN_ENDINGS } from '../js/campaign.js';
import { NARRATIVE_SEEDS } from '../js/narrative.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = 'https://api.minimaxi.com/v1/t2a_v2';
const OUT_DIR = path.join(ROOT, VOICE_DIR);
const AUDITION_DIR = path.join(ROOT, 'assets/voice-audition');
const SW_FILE = path.join(ROOT, 'service-worker.js');

// 与项目现有 Key 文件约定一致（.gitignore 已忽略）
const KEY_FILE = path.join(ROOT, '.minimax-api-key');
const GROUP_FILE = path.join(ROOT, '.minimax-group-id');

const DEFAULT_MODEL = 'speech-2.8-hd';
const DEFAULT_VOICE = 'male-qn-jingying';   // 精英青年，沉稳偏电台感；先用 --audition 试听再定
const DEFAULT_SPEED = 1.0;
const SAMPLE_RATE = 32000;                  // 语音够用，体积/音质平衡
const BITRATE = 64000;

// 试听候选：废土电台主播向的男声优先；无效 id 会在试听时报错跳过
const CANDIDATE_VOICES = [
  'male-qn-jingying',   // 精英青年
  'male-qn-qingse',     // 青涩青年
  'male-qn-badao',      // 霸道青年
  'presenter_male',     // 主持人男声
  'audiobook_male_1',   // 有声书男声
];
const AUDITION_TEXT = '收音机滋啦一声响了。这里是废土电台，为你播报今日战况：小型尸潮来袭，东区的铁栅栏被撞开了。幸存者们，捂好你们的瓶盖。';

// ── 参数 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);
const FORCE = hasFlag('--force');
const ONLY = getArg('--only');
const MODEL = getArg('--model') || DEFAULT_MODEL;
const VOICE = getArg('--voice') || DEFAULT_VOICE;
const SPEED = parseFloat(getArg('--speed') || '') || DEFAULT_SPEED;

// ── 文案清单 ──────────────────────────────────────────
function collectLines() {
  const events = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/events.json'), 'utf8'));
  const lines = [];
  const push = (group, id, text) => lines.push({ group, id, text });

  for (const deck of ['radio', 'manual', 'faction', 'ruins']) {
    for (const m of events[deck] || []) {
      push('mission-intro', `mission-${deck}-${m.id}`, missionSpeakText(m));
      (m.choices || []).forEach((c, i) => {
        if (c.result) push('mission-result', `mission-${deck}-${m.id}-c${i}`, choiceResultSpeakText(c));
      });
    }
  }
  CHAPTER_INTROS.forEach((block, ci) => {
    block.variants.forEach((v, vi) => {
      push('chapter', `chapter-${ci}-${vi}`, chapterSpeakText(v));
    });
  });
  CAMPAIGN_ENDINGS.forEach((e, i) => {
    push('ending', `ending-${i}`, endingSpeakText(e));
  });
  Object.entries(NARRATIVE_SEEDS).forEach(([key, seed]) => {
    push('seed', `seed-${key}`, narrativeSpeakText(seed));
  });
  for (const c of CAMPAIGNS) {
    push('chapter-clear', `chapter-clear-${c.id}`, chapterClearSpeakText(c.name));
  }
  Object.entries(GAMEOVER_LINES).forEach(([key, text]) => {
    push('gameover', `gameover-${key}`, text);
  });
  NUKE_SCENES.forEach((sc) => {
    push('cutscene', `cutscene-${sc.id}`, cutsceneSpeakText(sc));
  });
  Object.entries(SET_PIECE_LINES).forEach(([key, text]) => {
    push('set-piece', `setpiece-${key}`, text);
  });

  return lines.map((l) => ({ ...l, text: cleanVoiceText(l.text) })).filter((l) => l.text);
}

// ── 鉴权 ──────────────────────────────────────────────
function readSecret(envName, file) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
}

function requireAuth() {
  const apiKey = readSecret('MINIMAX_API_KEY', KEY_FILE);
  // groupId 可选：T2A v2 不带 GroupId 也能通过鉴权（缺鉴权时返回 1004，缺额度时返回 2056 业务错误）。
  // electron/minimax-tts.js 的运行时同样把 GroupId 当可选，这里与它保持一致。
  const groupId = readSecret('MINIMAX_GROUP_ID', GROUP_FILE);
  if (!apiKey) {
    console.error('缺少鉴权：请设置环境变量 MINIMAX_API_KEY，');
    console.error(`或在项目根目录放置 ${path.basename(KEY_FILE)}。`);
    process.exit(1);
  }
  if (!groupId) console.warn('未配置 groupId（MINIMAX_GROUP_ID / .minimax-group-id），按不带 GroupId 调用。');
  return { apiKey, groupId };
}

// ── MiniMax T2A v2 ────────────────────────────────────
async function synth({ text, voice, apiKey, groupId }) {
  const body = {
    model: MODEL,
    text,
    stream: false,
    voice_setting: { voice_id: voice, speed: SPEED, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: SAMPLE_RATE, bitrate: BITRATE, format: 'mp3', channel: 1 },
  };
  const qs = groupId ? `?GroupId=${encodeURIComponent(groupId)}` : '';
  const res = await fetch(API_URL + qs, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
  const j = await res.json();
  const base = j.base_resp || {};
  if (base.status_code !== 0) throw new Error('base_resp ' + base.status_code + ': ' + (base.status_msg || ''));
  const audio = j.data && j.data.audio;
  if (!audio) throw new Error('响应缺少 data.audio');
  // 国内站返回 hex 编码音频；Buffer.from 对非法 hex 不报错而是截断，必须显式校验
  const buf = /^[0-9a-fA-F]+$/.test(audio) && audio.length % 2 === 0
    ? Buffer.from(audio, 'hex')
    : Buffer.from(audio, 'base64');
  if (buf.length < 64) throw new Error('音频数据异常（' + buf.length + 'B）');
  return buf;
}

async function synthRetry(opts, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await synth(opts);
    } catch (e) {
      const msg = e && e.message || String(e);
      if (i === tries) throw new Error(msg);
      const wait = /429|rate|限流/i.test(msg) ? 10000 : 2000 * i;
      console.warn(`  重试 ${i}/${tries - 1}（${wait}ms 后）: ${msg}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ── 共用小工具 ────────────────────────────────────────
function newManifest() {
  return {
    meta: { model: MODEL, voice: VOICE, speed: SPEED, sampleRate: SAMPLE_RATE, bitrate: BITRATE, count: 0, totalBytes: 0, generatedAt: new Date().toISOString() },
    lines: {},
  };
}
function addManifestLine(manifest, l, file, bytes) {
  manifest.lines[voiceHash(VOICE, l.text)] = { file, text: l.text, bytes, id: l.id };
  manifest.meta.count++;
  manifest.meta.totalBytes += bytes;
}
function pruneOrphans(manifest, keepKeys) {
  // 清理孤儿 mp3（换音色/改文案后 hash 变了，旧文件不再被 manifest 引用）
  // keepKeys = 当前文案对应的 hash 集合：本轮未生成、生成失败或被 --only 跳过的条目据此保留，
  // 否则一次失败或局部重录就会把仍然有效的音频判成孤儿删掉。
  const referenced = new Set(Object.values(manifest.lines).map((e) => e.file));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.mp3') || referenced.has(f)) continue;
    if (keepKeys && keepKeys.has(f.replace(/\.mp3$/, ''))) continue;
    fs.unlinkSync(path.join(OUT_DIR, f));
    console.log(`清理孤儿文件: ${f}`);
  }
}
function writeManifest(manifest) {
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  // 预录内容变了 → SW 预缓存的 manifest.json 随之失效，自动 bump 版本号清缓存。
  // Web/PWA 已下线，仓库不再附带 service-worker.js；缺文件时跳过，避免生成流程在收尾处报错。
  if (!fs.existsSync(SW_FILE)) return;
  const sw = fs.readFileSync(SW_FILE, 'utf8');
  const swNew = sw.replace(/wasteland-tycoon-v(\d+)/, (_, n) => `wasteland-tycoon-v${Number(n) + 1}`);
  if (swNew !== sw) {
    fs.writeFileSync(SW_FILE, swNew);
    console.log('已 bump service-worker 缓存版本（manifest.json 是预缓存资源）');
  }
}

// ── 模式：导出任务清单（给 MiniMax Agent 等外部合成用，无需 Key）──
if (hasFlag('--export-tasks')) {
  const tasks = collectLines().map((l) => ({ id: l.id, filename: `${voiceHash(VOICE, l.text)}.mp3`, text: l.text }));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'agent-tasks.json');
  fs.writeFileSync(out, JSON.stringify({ meta: { model: MODEL, voice: VOICE, speed: SPEED, sampleRate: SAMPLE_RATE, bitrate: BITRATE, count: tasks.length }, tasks }, null, 1));
  const chars = tasks.reduce((a, t) => a + t.text.length, 0);
  console.log(`已导出 ${tasks.length} 条 / ${chars} 字 → ${path.relative(ROOT, out)}`);
  console.log(`音色已绑定 ${VOICE}（hash 含音色）：外部合成时不得更换音色；要换先重跑 voice:export -- --voice <id>。`);
  process.exit(0);
}

// ── 模式：仅重建 manifest（音频由外部生成后本地建索引，无需 Key）──
if (hasFlag('--manifest-only') || hasFlag('--as-is')) {
  // --as-is：文件名即 hash key，不重新计算（Agent 已用正确 voice 生成了文件名的情况）
  // --manifest-only：按 voice 参数重新算 hash 匹配（传统用法，文件须由本脚本生成）
  const asIs = hasFlag('--as-is');
  const lines = collectLines();
  const manifest = newManifest();
  manifest.meta.voice = VOICE; // 写入实际使用的音色
  let missing = 0;
  const targetKeys = new Set(lines.map((l) => voiceHash(VOICE, l.text)));
  for (const l of lines) {
    if (asIs) {
      // 文件名就是 hash（Agent 用正确 voice 生成时的命名）
      const file = l.filename || `${voiceHash(VOICE, l.text)}.mp3`;
      const p = path.join(OUT_DIR, file);
      if (fs.existsSync(p) && fs.statSync(p).size > 64) {
        const key = file.replace(/\.mp3$/, '');
        manifest.lines[key] = { file, text: l.text, bytes: fs.statSync(p).size, id: l.id };
        manifest.meta.count++;
        manifest.meta.totalBytes += fs.statSync(p).size;
      } else {
        missing++;
      }
    } else {
      // 传统模式：按 voice 参数重新算 hash
      const file = `${voiceHash(VOICE, l.text)}.mp3`;
      const p = path.join(OUT_DIR, file);
      if (fs.existsSync(p) && fs.statSync(p).size > 64) {
        addManifestLine(manifest, l, file, fs.statSync(p).size);
      } else {
        missing++;
      }
    }
  }
  console.log(`音色 ${VOICE}：命中 ${manifest.meta.count} 条，缺失 ${missing} 条`);
  if (manifest.meta.count === 0) {
    console.error('一条都没命中：');
    if (asIs) {
      console.error('  --as-is 模式：文件名应为 hash（形如 fd5bfa6d2add56c5.mp3），确认 mp3 已解压到 assets/voice/。');
    } else {
      console.error('  确认 mp3 已解压到 assets/voice/，且 --voice 与生成时一致。');
    }
    process.exit(1);
  }
  pruneOrphans(manifest, targetKeys);
  writeManifest(manifest);
  console.log(`manifest.json 已重建：${manifest.meta.count} 条 / ${(manifest.meta.totalBytes / 1024 / 1024).toFixed(1)}MB${missing ? `；缺 ${missing} 条（运行时对缺失条目自动回退普通 TTS）` : ''}`);
  process.exit(0);
}

// ── 模式：清单预览 ────────────────────────────────────
if (hasFlag('--list')) {
  const lines = collectLines();
  const chars = lines.reduce((a, l) => a + l.text.length, 0);
  const groups = new Map();
  for (const l of lines) {
    if (!groups.has(l.group)) groups.set(l.group, []);
    groups.get(l.group).push(l);
  }
  for (const [g, arr] of groups) {
    const gc = arr.reduce((a, l) => a + l.text.length, 0);
    console.log(`\n## ${g}  (${arr.length} 条 / ${gc} 字)`);
    for (const l of arr) console.log(`  ${l.id.padEnd(32)} ${String(l.text.length).padStart(3)}字  ${l.text.slice(0, 42)}${l.text.length > 42 ? '…' : ''}`);
  }
  console.log(`\n共 ${lines.length} 条 / ${chars} 字`);
  console.log('要录：任务开场（title+story+moral）、选项 result、章节/结局/种子/过场/地块氛围。');
  console.log('不录：选项按钮 text、结算条数字、买地/交租/用卡等带玩家名的战报。');
  process.exit(0);
}

if (hasFlag('--audition')) {
  const { apiKey, groupId } = requireAuth();
  fs.mkdirSync(AUDITION_DIR, { recursive: true });
  for (const v of CANDIDATE_VOICES) {
    const out = path.join(AUDITION_DIR, `${v}.mp3`);
    try {
      const buf = await synthRetry({ text: AUDITION_TEXT, voice: v, apiKey, groupId });
      fs.writeFileSync(out, buf);
      console.log(`✓ ${v} → ${path.relative(ROOT, out)} (${(buf.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.warn(`✗ ${v}: ${e.message}`);
    }
  }
  console.log('\n试听后用 node scripts/gen-voice.mjs --voice <id> 正式生成。');
  process.exit(0);
}

// ── 全量生成 ──────────────────────────────────────────
const { apiKey, groupId } = requireAuth();
const lines = collectLines();
const targets = ONLY ? lines.filter((l) => l.id.includes(ONLY)) : lines;
const targetKeys = new Set(lines.map((l) => voiceHash(VOICE, l.text)));
const chars = targets.reduce((a, l) => a + l.text.length, 0);
console.log(`模型 ${MODEL} · 音色 ${VOICE} · 语速 ${SPEED} · ${targets.length} 条 / ${chars} 字（约 ¥${(chars / 10000 * 3.5).toFixed(2)}）`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = newManifest();
let done = 0, skipped = 0, failed = 0;

for (const l of targets) {
  const key = voiceHash(VOICE, l.text);
  const file = `${key}.mp3`;
  const out = path.join(OUT_DIR, file);
  const exists = fs.existsSync(out) && fs.statSync(out).size > 64;
  if (exists && !FORCE) {
    addManifestLine(manifest, l, file, fs.statSync(out).size);
    skipped++;
    continue;
  }
  try {
    const buf = await synthRetry({ text: l.text, voice: VOICE, apiKey, groupId });
    fs.writeFileSync(out, buf);
    addManifestLine(manifest, l, file, buf.length);
    done++;
    console.log(`✓ [${done + skipped}/${targets.length}] ${l.id} (${(buf.length / 1024).toFixed(0)}KB)`);
    await new Promise((r) => setTimeout(r, 300)); // 轻微限速，避免触发限流
  } catch (e) {
    failed++;
    console.error(`✗ ${l.id}: ${e.message}`);
  }
}

if (ONLY) {
  // 局部重录：manifest 只统计本轮目标，直接重建会把未参与本轮的目标判成孤儿删除。
  // 文件名是文案 hash，同音色重录会原地覆盖，因此不动 manifest 也是自洽的；收口再跑全量即可。
  console.log('\n--only 局部重录：跳过孤儿清理与 manifest 重建（避免误删其它音频）。收口请再跑一次 node scripts/gen-voice.mjs。');
  console.log(`完成：新增 ${done}，复用 ${skipped}，失败 ${failed}（manifest.json 未改动）。`);
} else {
  pruneOrphans(manifest, targetKeys);
  writeManifest(manifest);
  console.log(`\n完成：新增 ${done}，复用 ${skipped}，失败 ${failed}；共 ${manifest.meta.count} 条 / ${(manifest.meta.totalBytes / 1024 / 1024).toFixed(1)}MB`);
}
if (failed > 0) process.exit(2);
