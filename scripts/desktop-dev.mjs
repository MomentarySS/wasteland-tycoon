#!/usr/bin/env node
// scripts/desktop-dev.mjs —— 启动 Electron 开发模式
// 流程：sync www → 启 electron，加载 www/index.html
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

console.log('=== 同步 www/ ===');
execSync('node scripts/sync-www.mjs', { stdio: 'inherit', cwd: ROOT });

console.log('\n=== 启动 Electron ===');
console.log('(按 Ctrl+C 退出)\n');

// Windows + Node 20+：spawn .cmd 会 EINVAL（CVE-2024-27980）。
// 跟 electron/cli.js 一样，直接拉 dist/electron.exe。
const electronBin = createRequire(import.meta.url)('electron');

const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  cwd: ROOT,
  windowsHide: false,
    env: { ...process.env, WASTELAND_DEV: '1', WASTELAND_NODE: process.execPath },
});

child.on('close', (code) => {
  console.log('Electron exited with code', code);
  process.exit(code || 0);
});
