#!/usr/bin/env node
// 验证 MiniMax 在线 TTS（无需启动 Electron）
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { init, speak } = await import('../electron/minimax-tts.js');
const info = await init({ root: ROOT, cacheDir: path.join(ROOT, '.minimax-tts-cache') });
console.log('init:', { ok: info.ok, model: info.model, voice: info.voice, endpoint: info.endpoint, error: info.error || null });
if (!info.ok) process.exit(1);

const text = process.argv[2] || '废土电台测试，语音播报正常。';
const t0 = Date.now();
const r = await speak(text);
console.log('speak ms:', Date.now() - t0);
if (!r || !r.ok || !r.mp3 || r.mp3.length < 64) {
  console.error('speak 失败', r && r.error);
  process.exit(1);
}

const outDir = path.join(ROOT, '.minimax-tts-cache');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'minimax-smoke.mp3');
writeFileSync(out, r.mp3);
console.log('mp3:', out, (r.mp3.length / 1024).toFixed(1) + 'KB', 'cached:', !!r.cached);
