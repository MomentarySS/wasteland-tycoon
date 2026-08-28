#!/usr/bin/env node
/**
 * 从 logo.svg 导出 Android Launcher 图标（各密度 mipmap + adaptive foreground）
 *
 * 用法:
 *   node scripts/export-android-icon.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LOGO = join(ROOT, 'logo.svg');
const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const BG = { r: 12, g: 14, b: 13, alpha: 255 }; // #0c0e0d

/** Android launcher / adaptive foreground sizes (px) */
const DENSITIES = [
  { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

/** Adaptive icon safe zone ≈ 66/108; keep logo slightly inset */
const FOREGROUND_INSET = 0.06;

function renderLogoPng(size) {
  const svg = readFileSync(LOGO);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

async function fitSquare(png, size, insetRatio = 0) {
  const inner = Math.round(size * (1 - insetRatio * 2));
  const resized = await sharp(png).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  console.log(`源图: ${LOGO}`);
  const master = renderLogoPng(1024);

  for (const { dir, launcher, foreground } of DENSITIES) {
    const outDir = join(ANDROID_RES, dir);
    mkdirSync(outDir, { recursive: true });

    const launcherBuf = await fitSquare(master, launcher);
    const roundBuf = launcherBuf;
    const foregroundBuf = await fitSquare(master, foreground, FOREGROUND_INSET);

    const files = [
      ['ic_launcher.png', launcherBuf],
      ['ic_launcher_round.png', roundBuf],
      ['ic_launcher_foreground.png', foregroundBuf],
    ];

    for (const [name, buf] of files) {
      const dest = join(outDir, name);
      writeFileSync(dest, buf);
      console.log(`  ${dir}/${name} (${launcher}/${foreground}px)`);
    }
  }

  const bgXml = join(ANDROID_RES, 'values', 'ic_launcher_background.xml');
  writeFileSync(
    bgXml,
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<resources>\n` +
      `    <color name="ic_launcher_background">#0c0e0d</color>\n` +
      `</resources>\n`,
    'utf8'
  );
  console.log('  values/ic_launcher_background.xml → #0c0e0d');
  console.log('\nAndroid Launcher 图标已写入 android/app/src/main/res/mipmap-*');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
