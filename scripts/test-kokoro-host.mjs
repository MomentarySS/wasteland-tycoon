#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, speak, stop } from '../electron/kokoro-host.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WASTELAND_NODE = process.execPath;
process.env.WASTELAND_TTS_MODELS = path.join(ROOT, 'assets', 'tts-models');

const info = await init();
console.log('init:', info);
if (!info.ok) process.exit(1);

const r = await speak(process.argv[2] || '测试语音：废土大亨语音播报正常');
stop();
if (!r || !r.wav || r.wav.length < 1000) {
  console.error('speak 失败');
  process.exit(1);
}
console.log('via', info.via, 'voice', r.voice, 'wavBytes', r.wav.length);

const outDir = path.join(ROOT, 'www');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'kokoro-smoke.wav');
writeFileSync(out, r.wav);
console.log('wav:', out);
