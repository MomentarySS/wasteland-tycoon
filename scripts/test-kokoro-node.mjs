#!/usr/bin/env node
// 快速验证 Kokoro Node 推理（无需启动 Electron）
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WASTELAND_TTS_MODELS = path.join(ROOT, 'assets', 'tts-models');

const { init, speak } = await import('../electron/kokoro-node.js');

const info = await init();
console.log('init:', info);
if (!info.ok) process.exit(1);

const text = process.argv[2] || '废土电台测试，语音播报正常。';
const t0 = Date.now();
const r = await speak(text);
console.log('speak ms:', Date.now() - t0);
if (!r || !r.pcm) {
  console.error('speak 失败');
  process.exit(1);
}

let peak = 0;
for (let i = 0; i < r.pcm.length; i++) {
  const a = Math.abs(r.pcm[i]);
  if (a > peak) peak = a;
}
const dur = (r.pcm.length / r.sampleRate).toFixed(2);
console.log('samples:', r.pcm.length, 'dur_s:', dur, 'peak:', peak.toFixed(4), 'voice:', r.voice);

if (peak < 0.001) {
  console.error('音频近乎静音，G2P / style 仍有问题');
  process.exit(1);
}

function pcmToWav(pcm, sampleRate) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
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
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf;
}

const outDir = path.join(ROOT, 'www');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'kokoro-smoke.wav');
writeFileSync(out, pcmToWav(r.pcm, r.sampleRate));
console.log('wav:', out);
