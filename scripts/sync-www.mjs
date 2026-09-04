// 同步脚本：把根目录静态资源镜像到 www/
//（node_modules / android / scripts / package*.json 等不进 App 包）
import { cpSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const DST = join(SRC, 'www');
const INCLUDE = new Set([
  'index.html', 'logo.svg', 'icon.svg',
  'css', 'js', 'content', 'assets'
]);

function rmQuiet(p) {
  try { rmSync(p, { recursive: true, force: true }); }
  catch (e) { console.warn('  跳过无法删除:', p, e && e.code); }
}

function cpFiltered(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.endsWith('.orig.webp')) continue;
    const srcPath = join(from, name);
    const dstPath = join(to, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) cpFiltered(srcPath, dstPath);
    else cpSync(srcPath, dstPath, { force: true });
  }
}

/** 删除 www 镜像里源目录已不存在的陈旧文件/子目录 */
function pruneMirror(from, to) {
  if (!existsSync(to)) return;
  for (const name of readdirSync(to)) {
    // 历史拷贝的流水线备份文件一律清除（源文件存在但被 cpFiltered 排除）
    if (name.endsWith('.orig.webp')) {
      rmQuiet(join(to, name));
      continue;
    }
    const srcPath = join(from, name);
    const dstPath = join(to, name);
    if (!existsSync(srcPath)) {
      rmQuiet(dstPath);
      continue;
    }
    if (statSync(srcPath).isDirectory() && statSync(dstPath).isDirectory()) {
      pruneMirror(srcPath, dstPath);
    }
  }
}

/** 顶层清理：从 INCLUDE 移除或源目录已删除的 www 顶层文件/目录不打入包内 */
function pruneTopLevel() {
  if (!existsSync(DST)) return;
  for (const name of readdirSync(DST)) {
    if (INCLUDE.has(name) && existsSync(join(SRC, name))) continue;
    rmQuiet(join(DST, name));
  }
}

mkdirSync(DST, { recursive: true });

let copied = 0, bytes = 0;
for (const name of readdirSync(SRC)) {
  if (!INCLUDE.has(name)) continue;
  const from = join(SRC, name), to = join(DST, name);
  if (!existsSync(from)) continue;
  if (name === 'assets') {
    cpFiltered(from, to);
    pruneMirror(from, to);
  } else if (statSync(from).isDirectory()) {
    cpFiltered(from, to);
    pruneMirror(from, to);
  } else {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { force: true });
  }
  copied++;
}
pruneTopLevel();
function walk(p) {
  for (const n of readdirSync(p)) {
    const s = statSync(join(p, n));
    if (s.isDirectory()) walk(join(p, n));
    else bytes += s.size;
  }
}
walk(DST);
console.log(`同步完成：${copied} 项 → www/，约 ${(bytes / 1024).toFixed(1)} KB`);
