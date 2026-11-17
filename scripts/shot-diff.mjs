#!/usr/bin/env node
// scripts/shot-diff.mjs —— 截图像素 diff（M1 验收：「画面与重构前像素级一致」）
//
// 用法：
//   node scripts/shot-diff.mjs --a docs/shots/baseline --b docs/shots/current [--out docs/shots/diff]
//
// 依赖项目已有的 sharp（devDependency）。逐像素比较，输出：
//   - 每张图的差异通道数 / 差异像素数 / 占比 / 最大通道差 / 平均差
//   - 一张红色高亮的 diff 图（便于肉眼定位）
//   - 终端打印 Markdown 表 + JSON

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const DIR_A = path.resolve(argVal('a', 'docs/shots/baseline'));
const DIR_B = path.resolve(argVal('b', 'docs/shots/current'));
const OUT = path.resolve(argVal('out', path.join(DIR_B, 'diff')));
const TOL = Math.max(0, parseInt(argVal('tol', '0'), 10) || 0);   // 通道差容忍值（0 = 严格一致）

function readManifest(dir) {
  const f = path.join(dir, 'manifest.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; }
}

async function load(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

async function compare(name, fileA, fileB, outFile) {
  const A = await load(fileA);
  const B = await load(fileB);
  if (A.info.width !== B.info.width || A.info.height !== B.info.height || A.info.channels !== B.info.channels) {
    return { name, error: `尺寸/通道不一致 A=${A.info.width}x${A.info.height}x${A.info.channels} B=${B.info.width}x${B.info.height}x${B.info.channels}` };
  }
  const { width, height, channels } = A.info;
  const a = A.data, b = B.data;
  const totalCh = a.length;
  let diffCh = 0, maxDelta = 0, sumDelta = 0;
  const pixelDiff = new Uint8Array(width * height);   // 1 = 该像素有差异
  for (let i = 0; i < totalCh; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > TOL) {
      diffCh++; sumDelta += d; if (d > maxDelta) maxDelta = d;
      pixelDiff[i / channels | 0] = 1;
    }
  }
  let diffPixels = 0;
  for (let p = 0; p < pixelDiff.length; p++) if (pixelDiff[p]) diffPixels++;
  const totalPixels = width * height;

  // diff 图：相同像素保留灰度，差异像素标红
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0; p < totalPixels; p++) {
    const r = a[p * channels], g = channels > 1 ? a[p * channels + 1] : r, bl = channels > 2 ? a[p * channels + 2] : r;
    if (pixelDiff[p]) { out[p * 3] = 255; out[p * 3 + 1] = 0; out[p * 3 + 2] = 0; }
    else { out[p * 3] = r >> 3; out[p * 3 + 1] = g >> 3; out[p * 3 + 2] = bl >> 3; }
  }
  await sharp(out, { raw: { width, height, channels: 3 } }).png().toFile(outFile);

  return {
    name, width, height,
    diffChannels: diffCh,
    diffPixels,
    totalPixels,
    diffPixelPct: +(diffPixels / totalPixels * 100).toFixed(4),
    maxDelta,
    avgDelta: diffCh ? +(sumDelta / diffCh).toFixed(2) : 0,
    identical: diffPixels === 0,
  };
}

async function main() {
  if (!existsSync(DIR_A) || !existsSync(DIR_B)) throw new Error(`目录不存在: A=${DIR_A} B=${DIR_B}`);
  const manA = readManifest(DIR_A), manB = readManifest(DIR_B);
  const namesA = new Set(manA ? manA.shots.map(s => s.name) : []);
  const namesB = new Set(manB ? manB.shots.map(s => s.name) : []);
  const names = [...namesA].filter(n => namesB.has(n));
  if (!names.length) throw new Error('两边没有同名的截图可比较');

  mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const n of names) {
    const rows2 = await compare(n, path.join(DIR_A, n + '.png'), path.join(DIR_B, n + '.png'), path.join(OUT, n + '.diff.png'));
    rows.push(rows2);
  }

  const passed = rows.filter(r => r.identical).length;
  const report = {
    a: DIR_A, b: DIR_B, tolerance: TOL,
    total: rows.length, identical: passed, different: rows.length - passed,
    rows,
  };
  writeFileSync(path.join(OUT, 'diff-report.json'), JSON.stringify(report, null, 2));

  const L = [];
  L.push(`| 截图 | 尺寸 | 差异像素 | 占比 | 最大通道差 | 结论 |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const r of rows) {
    if (r.error) { L.push(`| ${r.name} | - | - | - | - | ⚠️ ${r.error} |`); continue; }
    L.push(`| ${r.name} | ${r.width}×${r.height} | ${r.diffPixels} | ${r.diffPixelPct}% | ${r.maxDelta} | ${r.identical ? '✅ 一致' : '❌ 有差异'} |`);
  }
  L.push('');
  L.push(`合计 ${rows.length} 张：一致 ${passed}，有差异 ${rows.length - passed}（容忍通道差 ≤ ${TOL}）`);
  L.push(`diff 图：${OUT}`);
  console.log(L.join('\n'));
  if (passed !== rows.length) process.exitCode = 2;
}

main().catch(e => { console.error('diff 失败:', e && e.message); process.exit(1); });
