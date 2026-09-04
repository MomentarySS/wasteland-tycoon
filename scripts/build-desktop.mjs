#!/usr/bin/env node
// scripts/build-desktop.mjs —— Electron 桌面客户端打包
// 流程：sync www → 拷贝 TTS 模型到 resources → electron-builder 出 .exe
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const isLite = args.includes('--lite');  // 不带 Kokoro 模型（无 TTS）
const isWin = process.platform === 'win32';

function step(msg) { console.log('\n=== ' + msg + ' ==='); }
function run(cmd) { execSync(cmd, { stdio: 'inherit', cwd: ROOT }); }

// 1. 同步 www/
step('1/4 同步 www/');
run('node scripts/sync-www.mjs');

// 2. 准备 electron-builder extraResources
step('2/4 准备 extraResources');
const resDir = path.join(ROOT, 'electron', 'resources');
rmSync(resDir, { recursive: true, force: true });
mkdirSync(resDir, { recursive: true });
if (!isLite) {
  const ttsDir = path.join(ROOT, 'assets', 'tts-models');
  if (existsSync(ttsDir)) {
    cpSync(ttsDir, path.join(resDir, 'tts-models'), { recursive: true });
    const sz = (statSync(path.join(resDir, 'tts-models')).size / 1024 / 1024).toFixed(1);
    console.log('  Kokoro 模型已拷贝 (' + sz + ' MB)');
  } else {
    console.warn('  ! 警告：未找到 assets/tts-models/，将用 --lite 模式');
  }
}

// 3. 调用 electron-builder
step('3/4 electron-builder 打包 Windows');
if (!isWin) {
  console.error('当前只打 Windows 包。请在 Windows 上运行 npm run desktop:build');
  process.exit(1);
}
const cmd = 'npx electron-builder --win --x64 --publish never';
try {
  run(cmd);
} catch (e) {
  console.error('  electron-builder 失败:', e.message);
  process.exit(1);
}

// 4. 显示产物
step('4/4 产物');
const releaseDir = path.join(ROOT, 'release');
if (existsSync(releaseDir)) {
  const files = readdirSync(releaseDir);
  files.filter(f => /\.(exe|zip|7z)$/i.test(f)).forEach(f => {
    const fpath = path.join(releaseDir, f);
    const sz = (statSync(fpath).size / 1024 / 1024).toFixed(1);
    console.log('  ' + f + '  (' + sz + ' MB)');
  });
}
console.log('\n✓ 打包完成');
