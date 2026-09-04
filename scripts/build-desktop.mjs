#!/usr/bin/env node
// scripts/build-desktop.mjs —— Electron 桌面客户端打包
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function step(msg) { console.log('\n=== ' + msg + ' ==='); }
function run(cmd) { execSync(cmd, { stdio: 'inherit', cwd: ROOT }); }

step('1/3 同步 www/');
run('node scripts/sync-www.mjs');

step('2/3 electron-builder 打包 Windows');
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

step('3/3 产物');
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
