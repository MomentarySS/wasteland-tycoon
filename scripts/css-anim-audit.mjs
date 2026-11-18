#!/usr/bin/env node
/**
 * D6 动画白名单静态审计（不改应用代码）。
 *
 * 背景：docs/remaster-plan.md §2.7-4 要求「所有 @keyframes 只允许动 transform / opacity；
 * background-position / box-shadow / border-color 改为等价方案或降级为静态」。
 * scripts/css-anim-probe.mjs 只能测「跑起来有多贵」，测不出「是否合规」；
 * 而 D6b 清掉的剩余动画大多是弹窗 / 核弹 / 过场 host-gated，idle 探针根本采不到。
 * 本脚本做确定性的合规判定，作为 D6 的静态门。
 *
 * 用法：
 *   node scripts/css-anim-audit.mjs            # 检查 css/*.css，有违规退出码 1
 *   node scripts/css-anim-audit.mjs --list     # 额外列出全部 keyframes 及其属性
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = join(ROOT, 'css');

/** 白名单：合成器属性。filter 不在内——它会触发重绘（D6a/D6b 已把 filter 动画全部降级）。 */
const ALLOWED = new Set(['transform', 'opacity', '-webkit-transform', '-webkit-opacity']);

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取出所有 @keyframes 块：{name, body, line} */
function extractKeyframes(src, file) {
  const out = [];
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const body = src.slice(start, i - 1);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ name, body, line, file });
  }
  return out;
}

/** keyframes 内部结构是 `选择器{声明}`，逐块取声明。 */
function declarationsOf(body) {
  const decls = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(body))) {
    const selector = m[1].trim().replace(/^[\s,]+|[\s,]+$/g, '');
    for (const raw of m[2].split(';')) {
      const d = raw.trim();
      if (!d || !d.includes(':')) continue;
      const prop = d.split(':')[0].trim();
      decls.push({ selector, prop, decl: d });
    }
  }
  return decls;
}

const list = process.argv.includes('--list');
const files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
const summary = [];
let violations = 0;

for (const f of files) {
  const src = stripComments(readFileSync(join(CSS_DIR, f), 'utf8'));
  for (const kf of extractKeyframes(src, f)) {
    const decls = declarationsOf(kf.body);
    const props = [...new Set(decls.map((d) => d.prop))].sort();
    const bad = decls.filter((d) => !ALLOWED.has(d.prop));
    summary.push({ file: f, name: kf.name, line: kf.line, props, bad: bad.length });
    for (const b of bad) {
      violations++;
      console.log(`✗ ${f}:${kf.line} @keyframes ${kf.name} → 属性 ${b.prop}（${b.decl}）`);
    }
  }
}

if (list) {
  console.log('\n--- 全部 @keyframes ---');
  for (const s of summary) {
    console.log(`${s.file}:${s.line}  ${s.name}  { ${s.props.join(', ') || '(空)'} }`);
  }
}

console.log(`\n扫描 ${files.length} 个样式文件，${summary.length} 个 @keyframes，违规 ${violations} 处。`);
if (violations) {
  console.log('判定：不通过 —— 存在非 transform/opacity 的动画属性。');
  process.exit(1);
}
console.log('判定：通过 —— 所有 keyframes 仅含白名单属性。');