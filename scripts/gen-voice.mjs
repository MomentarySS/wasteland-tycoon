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
//   node scripts/gen-voice.mjs --only r1              # 只重录 id 含 "r1" 的条目（配合 --force）
//
// 鉴权：环境变量 MINIMAX_API_KEY / MINIMAX_GROUP_ID，或项目根目录 .minimax-api-key / .minimax-group-id 文件
//
// 注意：hash 逻辑必须与 js/voice-lines.js 完全一致（直接 import 它），文案改动后重跑即可，
// 未重录的条目运行时查不到 hash 会静默回退普通 TTS，不会播错。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missionSpeakText, chapterSpeakText, endingSpeakText,
  narrativeSpeakText, chapterClearSpeakText, cutsceneSpeakText, GAMEOVER_LINES, NUKE_SCENES,
  cleanVoiceText, voiceHash, VOICE_DIR
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
  for (const deck of ['radio', 'manual', 'faction', 'ruins']) {
    for (const m of events[deck] || []) {
      lines.push({ id: `mission-${deck}-${m.id}`, text: missionSpeakText(m) });
    }
  }
  CHAPTER_INTROS.forEach((block, ci) => {
    block.variants.forEach((v, vi) => {
      lines.push({ id: `chapter-${ci}-${vi}`, text: chapterSpeakText(v) });
    });
  });
  CAMPAIGN_ENDINGS.forEach((e, i) => {
    lines.push({ id: `ending-${i}`, text: endingSpeakText(e) });
  });
  // 上局结局→下局开场的叙事种子（7 种固定文案）
  Object.entries(NARRATIVE_SEEDS).forEach(([key, seed]) => {
    lines.push({ id: `seed-${key}`, text: narrativeSpeakText(seed) });
  });
  // 章节达成播报（章节名固定集）
  for (const c of CAMPAIGNS) {
    lines.push({ id: `chapter-clear-${c.id}`, text: chapterClearSpeakText(c.name) });
  }
  // 终局固定播报（coop 全灭 / 合作通关 / 闯关倒下）
  Object.entries(GAMEOVER_LINES).forEach(([key, text]) => {
    lines.push({ id: `gameover-${key}`, text });
  });
  // 核弹过场旁白（分镜 sub）
  NUKE_SCENES.forEach((sc) => {
    lines.push({ id: `cutscene-${sc.id}`, text: cutsceneSpeakText(sc) });
  });
  // 清洗规则与运行时 ttsSpeak 完全一致，hash 才能对上
  return lines.map((l) => ({ ...l, text: cleanVoiceText(l.text) })).filter((l) => l.text);
}

// ── 鉴权 ──────────────────────────────────────────────
function readSecret(envName, file) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
}

function requireAuth() {
  const apiKey = readSecret('MINIMAX_API_KEY', KEY_FILE);
  const groupId = readSecret('MINIMAX_GROUP_ID', GROUP_FILE);
  if (!apiKey || !groupId) {
    console.error('缺少鉴权：请设置环境变量 MINIMAX_API_KEY / MINIMAX_GROUP_ID，');
    console.error(`或在项目根目录放置 ${path.basename(KEY_FILE)} / ${path.basename(GROUP_FILE)}（groupId 在开放平台控制台「账户管理」可见）。`);
    process.exit(1);
  }
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
  const res = await fetch(`${API_URL}?GroupId=${encodeURIComponent(groupId)}`, {
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
function pruneOrphans(manifest) {
  // 清理孤儿 mp3（换音色/改文案后 hash 变了，旧文件不再被 manifest 引用）
  const referenced = new Set(Object.values(manifest.lines).map((e) => e.file));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.mp3') && !referenced.has(f)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log(`清理孤儿文件: ${f}`);
    }
  }
}
function writeManifest(manifest) {
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  // 预录内容变了 → SW 预缓存的 manifest.json 随之失效，自动 bump 版本号清缓存
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
  pruneOrphans(manifest);
  writeManifest(manifest);
  console.log(`manifest.json 已重建：${manifest.meta.count} 条 / ${(manifest.meta.totalBytes / 1024 / 1024).toFixed(1)}MB${missing ? `；缺 ${missing} 条（运行时对缺失条目自动回退普通 TTS）` : ''}`);
  process.exit(0);
}

// ── 模式：清单预览 ────────────────────────────────────
if (hasFlag('--list')) {
  const lines = collectLines();
  const chars = lines.reduce((a, l) => a + l.text.length, 0);
  for (const l of lines) console.log(`${l.id.padEnd(24)} ${l.text.length}字  ${l.text.slice(0, 36)}…`);
  console.log(`\n共 ${lines.length} 条 / ${chars} 字（speech-2.8-hd 约 ¥${(chars / 10000 * 3.5).toFixed(2)}）`);
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

pruneOrphans(manifest);
writeManifest(manifest);

console.log(`\n完成：新增 ${done}，复用 ${skipped}，失败 ${failed}；共 ${manifest.meta.count} 条 / ${(manifest.meta.totalBytes / 1024 / 1024).toFixed(1)}MB`);
if (failed > 0) process.exit(2);
