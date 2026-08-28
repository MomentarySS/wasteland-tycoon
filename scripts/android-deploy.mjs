#!/usr/bin/env node
/**
 * Capacitor Android 一键部署：sync www → Gradle assembleDebug → adb install → 启动
 * 用法：node scripts/android-deploy.mjs [--skip-sync] [--no-launch]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const APK = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP_ID = 'cn.terence.wastelandtycoon';
const MAIN_ACTIVITY = `${APP_ID}/.MainActivity`;

const SDK = process.env.ANDROID_HOME
  ?? process.env.ANDROID_SDK_ROOT
  ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const ADB = path.join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const GRADLEW = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

const args = new Set(process.argv.slice(2));
const skipSync = args.has('--skip-sync');
const noLaunch = args.has('--no-launch');

function run(cmd, cmdArgs, cwd = ROOT) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npmScript(name) {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name]);
}

if (!existsSync(ADB)) {
  console.error(`adb 未找到：${ADB}\n请设置 ANDROID_HOME 或安装 Android SDK Platform-Tools。`);
  process.exit(1);
}

if (!skipSync) {
  npmScript('cap:sync');
}

run(GRADLEW, ['assembleDebug'], ANDROID);

if (!existsSync(APK)) {
  console.error(`APK 未生成：${APK}`);
  process.exit(1);
}

const devices = spawnSync(ADB, ['devices'], { encoding: 'utf8' });
const serials = (devices.stdout ?? '')
  .split('\n')
  .slice(1)
  .map((line) => line.split('\t')[0]?.trim())
  .filter((s) => s && s !== '');

if (serials.length === 0) {
  console.error('\n没有已连接的设备/模拟器。请在 Android Studio 启动模拟器或连接真机后重试。');
  console.error('APK 已构建：', APK);
  process.exit(1);
}

console.log(`\n检测到 ${serials.length} 台设备：${serials.join(', ')}`);
run(ADB, ['install', '-r', APK]);

if (!noLaunch) {
  run(ADB, ['shell', 'am', 'start', '-n', MAIN_ACTIVITY]);
}

console.log('\n部署完成。');
