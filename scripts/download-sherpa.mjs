// ⚠️  此脚本已废弃（v1.4 之后不再使用）
// ============================================================
// 历史背景：v1.4 之前游戏运行时用 Sherpa-ONNX WASM 做离线 TTS，
// 此脚本下载模型到 vendor/sherpa/。
//
// v1.4+ 改用「预录语音 + 阶跃在线 + Edge + 系统语音」四级兜底链，
// Sherpa 已从 `tts.js` 运行时链中**完全移除**。
//
// 当前 vendor/tts-lab/zipvoice/（同一份 Sherpa-ONNX WASM）仍保留，
// 但**仅供本地试听页 `tts-lab.html` 调试用，与游戏运行无关**。
//
// npm 脚本中已无 `download:sherpa`；本文件保留为历史参考。
// ============================================================

// 下载 Sherpa-ONNX WASM 离线语音包 → vendor/sherpa/
// 模型：ZipVoice 中英（Emilia 蒸馏，int8）——音质优于旧版 Matcha-Baker
// 走代理：开代理后设 HTTPS_PROXY 环境变量（如 HTTPS_PROXY=http://127.0.0.1:7890），curl 会自动使用
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VENDOR = join(ROOT, 'vendor', 'sherpa');
const VERSION = '1.13.4';
const FILE = `sherpa-onnx-wasm-simd-${VERSION}-sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2`;
const URLS = [
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${FILE}`,
  `https://ghproxy.net/https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${FILE}`,
];
const ARCHIVE = join(ROOT, FILE);

const REQUIRED = [
  'sherpa-onnx-tts.js',
  'sherpa-onnx-tts.worker.js',
  'sherpa-onnx-wasm-main-tts.js',
  'sherpa-onnx-wasm-main-tts.wasm',
  'sherpa-onnx-wasm-main-tts.data',
];

async function download(dest) {
  for (const url of URLS) {
    try {
      console.log('下载:', url);
      // 用 curl：原生支持 HTTPS_PROXY 环境变量（直连慢时开代理提速）
      execSync(`curl -L --fail --connect-timeout 20 --retry 3 -o "${dest}" "${url}"`, { stdio: 'inherit' });
      const size = statSync(dest).size;
      console.log('  完成，共', (size / 1024 / 1024).toFixed(1), 'MB');
      if (size < 30 * 1024 * 1024) throw new Error('文件过小，可能下载失败');
      return;
    } catch (e) {
      console.warn('  失败:', e.message);
    }
  }
  throw new Error('所有镜像均下载失败');
}

function extract() {
  mkdirSync(VENDOR, { recursive: true });
  // 官方包解压后通常在子目录，先解到临时目录再扁平化
  const tmp = join(ROOT, '_sherpa_tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  console.log('解压:', ARCHIVE);
  // --force-local + 正斜杠：避免 Git Bash 的 GNU tar 把 D:\ 路径误判为远程主机
  const posix = (p) => p.replace(/\\/g, '/');
  execSync(`tar --force-local -xjf "${posix(ARCHIVE)}" -C "${posix(tmp)}"`, { stdio: 'inherit' });
  // 找含 wasm 的目录
  function findWasmDir(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (existsSync(join(p, 'sherpa-onnx-wasm-main-tts.wasm'))) return p;
      try {
        const sub = findWasmDir(p);
        if (sub) return sub;
      } catch (_) {}
    }
    return null;
  }
  const srcDir = findWasmDir(tmp);
  if (!srcDir) throw new Error('解压后未找到 sherpa-onnx-wasm-main-tts.wasm');
  rmSync(VENDOR, { recursive: true, force: true });
  mkdirSync(VENDOR, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    cpSync(join(srcDir, name), join(VENDOR, name), { recursive: true, force: true });
  }
  rmSync(tmp, { recursive: true, force: true });
  // 写入模型版本标记，避免升级后因旧包已存在而跳过
  writeFileSync(join(VENDOR, '.model-zipvoice'), 'v' + VERSION);
  // 解压完成，清理下载包
  rmSync(ARCHIVE, { force: true });
}

function verify() {
  const missing = REQUIRED.filter((f) => !existsSync(join(VENDOR, f)));
  if (missing.length) throw new Error('缺少文件: ' + missing.join(', '));
  console.log('✓ vendor/sherpa/ 就绪，共', REQUIRED.length, '个核心文件');
}

async function main() {
  if (existsSync(join(VENDOR, '.model-zipvoice'))) {
    console.log('vendor/sherpa/ 已包含 ZipVoice 模型，跳过下载');
    return;
  }
  if (existsSync(join(VENDOR, 'sherpa-onnx-wasm-main-tts.wasm'))) {
    console.log('检测到旧版（Matcha）离线包，升级中…');
  }
  if (!existsSync(ARCHIVE)) await download(ARCHIVE);
  extract();
  verify();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
