// 生成可分享给朋友的 Windows 测试包（zip）
// 用法:
//   node scripts/package-release.mjs           # 完整包（需本机 Node）
//   node scripts/package-release.mjs --lite    # 精简包（无 Sherpa）
//   node scripts/package-release.mjs --green   # 绿色完整包（内置 Node，免安装）
//   node scripts/package-release.mjs --green --lite
import {
  cpSync, mkdirSync, rmSync, readdirSync, statSync,
  readFileSync, writeFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const LITE = args.includes('--lite');
const GREEN = args.includes('--green');
const NODE_VERSION = '22.16.0';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.0.0';
const TAG = `${GREEN ? 'green-' : ''}${LITE ? 'lite' : 'full'}`;
const OUT_DIR = join(ROOT, 'release', `wasteland-tycoon-${VERSION}-test-win-${TAG}`);
const ZIP_PATH = `${OUT_DIR}.zip`;

const ROOT_FILES = [
  'index.html', 'manifest.json', 'service-worker.js',
  'logo.svg', 'icon-192.png', 'icon-512.png', 'icon.svg',
  '游玩手册.md',
];

const BAT = `@echo off
chcp 65001 >nul
title WASTELAND TYCOON - 本地服务器
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\\node.exe"
if exist "%NODE_EXE%" goto RUN

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_EXE=node"
  goto RUN
)

where python >nul 2>nul
if not errorlevel 1 goto PY

echo.
echo   [错误] 未找到 Node.js
echo   绿色版请确认 runtime\\node.exe 存在；否则请安装 Node.js: https://nodejs.org/
echo.
pause
goto END

:PY
echo.
echo   [警告] 未检测到 Node，使用 Python 简易服务器
echo   Sherpa 离线语音不可用；推荐安装 Node 或使用绿色版
echo.
python -m http.server 8823 --bind 127.0.0.1
pause
goto END

:RUN
echo.
echo   ============================================
echo     WASTELAND TYCOON  ^|  废土大亨
echo   ============================================
echo     本地地址: http://127.0.0.1:8823/
echo     使用: %NODE_EXE%
echo.
echo     若端口被占用，请先关闭旧的 Python/Node 黑窗口
echo     [ 关闭本窗口即停止服务器 ]
echo   ============================================
echo.
"%NODE_EXE%" scripts/start.mjs
if errorlevel 1 pause

:END
`;

function cpFiltered(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.endsWith('.orig.webp')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    const st = statSync(src);
    if (st.isDirectory()) cpFiltered(src, dst);
    else cpSync(src, dst);
  }
}

function dirSize(p) {
  let n = 0;
  for (const name of readdirSync(p)) {
    const fp = join(p, name);
    const st = statSync(fp);
    if (st.isDirectory()) n += dirSize(fp);
    else n += st.size;
  }
  return n;
}

async function ensurePortableNode(destRuntimeDir) {
  const cacheDir = join(HERE, '.cache', 'node');
  const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipPath = join(cacheDir, zipName);
  const extractDir = join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
  const nodeExe = join(extractDir, 'node.exe');
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;

  mkdirSync(cacheDir, { recursive: true });

  if (!existsSync(nodeExe)) {
    console.log(`  下载 Node.js v${NODE_VERSION} …`);
    if (!existsSync(zipPath)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Node 下载失败 (${res.status}): ${url}`);
      writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
      console.log(`  已缓存 ${zipPath}`);
    }
    rmSync(extractDir, { recursive: true, force: true });
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${cacheDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'inherit' }
    );
    if (!existsSync(nodeExe)) throw new Error('解压后未找到 node.exe');
  }

  mkdirSync(destRuntimeDir, { recursive: true });
  cpSync(nodeExe, join(destRuntimeDir, 'node.exe'));
  console.log(`  已内置 runtime/node.exe (${(statSync(join(destRuntimeDir, 'node.exe')).size / 1024 / 1024).toFixed(1)} MB)`);
}

function readmeText() {
  const kind = GREEN ? '绿色版' : '标准版';
  const voice = LITE
    ? '精简包不含 Sherpa 离线语音，请用游戏内「阶跃在线」或关闭播报'
    : '完整包含 Sherpa 离线语音（首次加载较慢）';
  const nodeHint = GREEN
    ? '无需安装 Node.js，解压即用（已内置 runtime/node.exe）'
    : '电脑需已安装 Node.js 18+（https://nodejs.org/ 选 LTS）';

  return `废土大亨 · 测试包（${kind} / ${LITE ? '精简' : '完整'}）
版本 ${VERSION}

【怎么玩】
1. ${nodeHint}
2. 双击「启动游戏.bat」
3. 浏览器会自动打开 http://127.0.0.1:8823/
4. 玩完关闭黑色命令行窗口即可

【说明】
- 不能直接双击 index.html（会白屏），必须走 bat 启动的服务器
- ${voice}
- 可添加到浏览器主屏幕当 PWA（Chrome / Edge）
- 详细规则见「游玩手册.md」

【局域网同玩（可选）】
绿色版在命令行进入本目录后：
  set HOST=0.0.0.0
  runtime\\node.exe scripts\\serve.mjs
让对方浏览器打开 http://你的电脑IP:8823/（需放行防火墙 8823）

【反馈】
试玩后欢迎反馈：卡顿、规则 bug、UI 问题、难度感受等。
`;
}

console.log(`打包模式: ${TAG}`);
console.log('1/5 同步 www/ …');
spawnSync(process.execPath, [join(HERE, 'sync-www.mjs')], { stdio: 'inherit', cwd: ROOT });

console.log('2/5 写入测试包目录 …');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const f of ROOT_FILES) {
  const src = join(ROOT, f);
  if (!statSync(src).isFile()) throw new Error('缺少文件: ' + f);
  cpSync(src, join(OUT_DIR, f));
}

writeFileSync(join(OUT_DIR, '启动游戏.bat'), BAT, 'utf8');

for (const d of ['css', 'js', 'content', 'assets']) cpFiltered(join(ROOT, d), join(OUT_DIR, d));

mkdirSync(join(OUT_DIR, 'scripts'), { recursive: true });
for (const s of ['serve.mjs', 'start.mjs']) {
  cpSync(join(HERE, s), join(OUT_DIR, 'scripts', s));
}

if (!LITE) cpFiltered(join(ROOT, 'vendor'), join(OUT_DIR, 'vendor'));

if (GREEN) {
  console.log('3/5 内置 Node.js …');
  await ensurePortableNode(join(OUT_DIR, 'runtime'));
} else {
  console.log('3/5 跳过内置 Node（标准包）');
}

writeFileSync(join(OUT_DIR, '给朋友-请先读.txt'), readmeText(), 'utf8');

console.log('4/5 压缩 zip …');
rmSync(ZIP_PATH, { force: true });
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${OUT_DIR.replace(/'/g, "''")}\\*' -DestinationPath '${ZIP_PATH.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  const zipName = ZIP_PATH.replace(/\\/g, '/').split('/').pop();
  const dirName = OUT_DIR.replace(/\\/g, '/').split('/').pop();
  execSync(`cd "${join(ROOT, 'release')}" && zip -rq "${zipName}" "${dirName}"`, { stdio: 'inherit' });
}

const folderMb = (dirSize(OUT_DIR) / 1024 / 1024).toFixed(1);
const zipMb = (statSync(ZIP_PATH).size / 1024 / 1024).toFixed(1);
console.log('');
console.log('5/5 完成');
console.log(`  文件夹: ${OUT_DIR}`);
console.log(`  压缩包: ${ZIP_PATH}`);
console.log(`  体积: 文件夹 ${folderMb} MB · zip ${zipMb} MB`);
console.log('');
if (GREEN) {
  console.log('发给朋友: 传 zip → 解压 → 双击「启动游戏.bat」，无需安装 Node.js。');
} else {
  console.log('发给朋友: 传 zip → 解压 → 双击「启动游戏.bat」（需本机 Node.js）。');
}
