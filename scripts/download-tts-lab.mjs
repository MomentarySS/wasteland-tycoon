// 下载 TTS 试听页所需的 sherpa-onnx 预编译 WASM 包 → vendor/tts-lab/
// 引擎 1（已验证可用）：ZipVoice 中英 int8（v1.13.4，官方预编译，与旧 download-sherpa.mjs 同款）
// 引擎 2（探测）：Kokoro v1.1-zh 预编译 WASM 包（命名按官方规律探测，404 则跳过）
// 走代理：开代理后设 HTTPS_PROXY 环境变量，curl 自动使用
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LAB = join(ROOT, 'vendor', 'tts-lab');

const MIRRORS = (path) => [
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/${path}`,
  `https://ghfast.top/https://github.com/k2-fsa/sherpa-onnx/releases/download/${path}`,
  `https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/${path}`,
];

// 官方 wasm TTS 包命名规律：sherpa-onnx-wasm-simd-{ver}-sherpa-onnx-{模型标识}.tar.bz2
const ENGINES = [
  {
    id: 'zipvoice',
    dir: join(LAB, 'zipvoice'),
    marker: '.model-zipvoice',
    candidates: ['v1.13.4/sherpa-onnx-wasm-simd-1.13.4-sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2'],
    minSizeMB: 20,
    required: ['sherpa-onnx-tts.js', 'sherpa-onnx-wasm-main-tts.js', 'sherpa-onnx-wasm-main-tts.wasm', 'sherpa-onnx-wasm-main-tts.data'],
  },
  {
    id: 'kokoro',
    dir: join(LAB, 'kokoro'),
    marker: '.model-kokoro',
    // 按官方命名规律探测候选（存在才下载，全 404 则跳过）
    candidates: [
      'v1.13.6/sherpa-onnx-wasm-simd-1.13.6-sherpa-onnx-kokoro-int8-multi-lang-v1_1.tar.bz2',
      'v1.13.6/sherpa-onnx-wasm-simd-1.13.6-sherpa-onnx-kokoro-multi-lang-v1_1.tar.bz2',
      'v1.13.5/sherpa-onnx-wasm-simd-1.13.5-sherpa-onnx-kokoro-int8-multi-lang-v1_1.tar.bz2',
      'v1.13.4/sherpa-onnx-wasm-simd-1.13.4-sherpa-onnx-kokoro-int8-multi-lang-v1_1.tar.bz2',
      'v1.13.4/sherpa-onnx-wasm-simd-1.13.4-sherpa-onnx-kokoro-multi-lang-v1_1.tar.bz2',
    ],
    minSizeMB: 60,
    required: ['sherpa-onnx-wasm-main-tts.wasm'],
  },
];

function probe(url) {
  // GET Range 探测：GitHub 资产 302 到 S3 签名 URL，S3 拒绝 HEAD（403），必须用 GET + Range 只取 1 字节
  try {
    const code = execSync(
      `curl -sL -r 0-0 -o /dev/null -w "%{http_code}" --connect-timeout 15 --max-time 30 "${url}"`,
      { encoding: 'utf8' },
    ).trim();
    return code === '206' || code === '200';
  } catch (_) { return false; }
}

// 直接尝试下载（curl --fail 时 404/镜像失败快速报错），成功返回 true
function tryDownload(dest, path) {
  for (const url of MIRRORS(path)) {
    try {
      console.log('尝试:', url);
      execSync(`curl -L --fail --connect-timeout 20 --retry 1 -o "${dest}" "${url}"`, { stdio: ['ignore', 'ignore', 'ignore'] });
      const size = statSync(dest).size;
      if (size < 1024) throw new Error('文件过小');
      console.log('  命中，共', (size / 1024 / 1024).toFixed(1), 'MB');
      return true;
    } catch (_) {
      try { rmSync(dest, { force: true }); } catch (_) { /* 忽略 */ }
    }
  }
  return false;
}

function download(dest, path) {
  for (const base of MIRRORS(path)) {
    const url = base;
    try {
      console.log('下载:', url);
      execSync(`curl -L --fail --connect-timeout 20 --retry 2 -o "${dest}" "${url}"`, { stdio: 'inherit' });
      const size = statSync(dest).size;
      console.log('  完成，共', (size / 1024 / 1024).toFixed(1), 'MB');
      return;
    } catch (e) {
      console.warn('  失败:', (e && e.message) || e);
    }
  }
  throw new Error('所有镜像均下载失败: ' + path);
}

function extract(archive, destDir, required, markerFile, marker) {
  const tmp = join(ROOT, '_ttslab_tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  console.log('解压:', archive);
  const posix = (p) => p.replace(/\\/g, '/');
  execSync(`tar --force-local -xjf "${posix(archive)}" -C "${posix(tmp)}"`, { stdio: 'inherit' });
  // 在解压结果里找含 wasm 主文件的目录（官方包通常带一层子目录）
  function findWasmDir(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (existsSync(join(p, 'sherpa-onnx-wasm-main-tts.wasm'))) return p;
      try {
        const sub = findWasmDir(p);
        if (sub) return sub;
      } catch (_) { /* 深度优先 */ }
    }
    return null;
  }
  const srcDir = findWasmDir(tmp);
  if (!srcDir) throw new Error('解压后未找到 sherpa-onnx-wasm-main-tts.wasm');
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    cpSync(join(srcDir, name), join(destDir, name), { recursive: true, force: true });
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(destDir, markerFile), marker);
  rmSync(archive, { force: true });
  const missing = required.filter((f) => !existsSync(join(destDir, f)));
  if (missing.length) throw new Error('缺少文件: ' + missing.join(', '));
  console.log('✓ 就绪:', destDir);
}

async function main() {
  mkdirSync(LAB, { recursive: true });
  let kokoroFound = false;
  for (const eng of ENGINES) {
    console.log(`\n===== 引擎 ${eng.id} =====`);
    if (existsSync(join(eng.dir, eng.marker))) {
      console.log('已存在，跳过。如需重装请删除', eng.dir);
      if (eng.id === 'kokoro') kokoroFound = true;
      continue;
    }
    // 逐个候选直接尝试下载（404 快速失败），命中即解压
    let hit = null;
    const archive = join(ROOT, '_ttslab_' + eng.id + '.tar.bz2');
    for (const cand of eng.candidates) {
      if (tryDownload(archive, cand)) { hit = cand; break; }
    }
    if (!hit) {
      console.warn(`⚠ 未找到 ${eng.id} 预编译包（尝试了 ${eng.candidates.length} 个候选），跳过`);
      continue;
    }
    console.log('命中预编译包:', hit);
    extract(archive, eng.dir, eng.required, eng.marker, hit);
    if (eng.id === 'kokoro') kokoroFound = true;
  }
  console.log('\n===== 完成 =====');
  console.log('ZipVoice :', existsSync(join(LAB, 'zipvoice')) ? '✓ 可用' : '✗ 未安装');
  console.log('Kokoro   :', kokoroFound ? '✓ 可用' : '✗ 官方暂无预编译包（试听页将禁用该引擎）');
  console.log('打开 http://127.0.0.1:8824/tts-lab.html 试听');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
