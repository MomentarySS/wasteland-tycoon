// scripts/dom-stub.mjs —— Node 环境下加载真实 ES 模块所需的 DOM / window / fetch 桩
//
// 本文件此前以三份近 60 行的副本存在（smoke.test.mjs、scripts/balance-probe.mjs、
// scripts/subtype-test.mjs），并已开始漂移：setTimeout 桩在 smoke 里转发参数、在另
// 两个里不转发；data-* 属性的桩只有 subtype-test 是忠实实现。合并时统一取**超集 /
// 更忠实**的那一份：
//
//   * setAttribute / getAttribute / removeAttribute：采用 subtype-test 的忠实实现
//     （data-* 与 dataset 双向同步）。view-core.js 用 removeAttribute('data-subtype')
//     清除地块变体标记，在 no-op 桩下相关断言会因为错误的原因通过或失败。
//   * prepend 的 400 节点上限：采用 smoke / balance-probe 的版本。
//   * setTimeout：采用 smoke 的版本，转发额外参数。
//   * alert：三者原本不同（smoke 抛错以便暴露意外调用，另两个静默），故做成选项，
//     默认保持静默以免改变另两个脚本的现有行为。
//
// 每个使用方的**有效行为**保持不变：本次只是删掉复制粘贴，不是改变测试语义。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 安装 DOM 桩。
 * @param {object} opts
 * @param {string} opts.root       fetch 桩解析相对路径的基准目录（通常是仓库根）
 * @param {'noop'|'throw'} [opts.alert='noop']  alert 的行为
 * @returns {{cache: object, getEl: Function, store: object, tick: Function}}
 */
export function installDomStub(opts = {}) {
  const { root, alert: alertMode = 'noop' } = opts;
  if (!root) throw new Error('installDomStub 需要 opts.root（fetch 桩要解析相对路径）');

  // 加速：所有 setTimeout 走 setImmediate（Node 会把 setTimeout(fn,0) 钳到 1ms，太慢）
  global.setTimeout = (fn, _ms, ...a) => setImmediate(() => fn(...a));

  const cache = {};
  const store = {};

  const mkStyle = () => ({ setProperty(k, v) { this[k] = v; } });

  // data-* 属性名 → dataset 键：data-subtype -> subtype
  const dataKey = attr => attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  // 注意：非 data-* 属性的 getAttribute 一律返回 null。这是三份原实现共有的行为，
  // 合并时原样保留 —— 被测代码走 classList 而非 setAttribute('class')，不受影响。
  const attrOf = (el, attr) => (attr.startsWith('data-') ? el.dataset[dataKey(attr)] : null);

  function mkEl(id) {
    return {
      id, _html: '', textContent: '', value: '', style: mkStyle(), dataset: {}, children: [],
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      // 与真实 DOM 一致：设置 innerHTML 清空子节点（棋盘 / 玩家列表等渲染结构可计数断言）
      set innerHTML(v) { this._html = String(v); this.children.length = 0; }, get innerHTML() { return this._html; },
      appendChild(c) { this.children.push(c); return c; },
      prepend(c) { this.children.unshift(c); if (this.children.length > 400) this.children.length = 400; return c; },
      insertBefore(c, ref) {
        if (!ref) { this.children.push(c); return c; }
        const i = this.children.indexOf(ref);
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        return c;
      },
      get firstChild() { return this.children[0] || null; },
      remove() { }, addEventListener() { }, removeEventListener() { },
      setAttribute(k, v) { if (String(k).startsWith('data-')) this.dataset[dataKey(k)] = String(v); else this[k] = String(v); },
      getAttribute(k) { const v = attrOf(this, k); return v === undefined ? null : v; },
      removeAttribute(k) { if (String(k).startsWith('data-')) delete this.dataset[dataKey(k)]; else delete this[k]; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      get offsetWidth() { return 1; }, focus() { }, scrollIntoView() { },
      getBoundingClientRect() { return { top: 0, left: 0, width: 54, height: 54 }; },
      set onclick(fn) { this._onclick = fn; }, get onclick() { return this._onclick; },
    };
  }
  const getEl = id => (cache[id] ||= mkEl(id));

  // 中央预览 DOM（view-core v2）
  (function setupTilePreview() {
    const tp = mkEl('tilePreview');
    const mkSub = cls => { const el = mkEl(cls); el.className = cls.replace('.', ''); el.hidden = false; return el; };
    const subs = { '.tpName': mkSub('tpName'), '.tpMeta': mkSub('tpMeta'), '.tpIcon': mkSub('tpIcon'), '.tpArt': mkSub('tpArt') };
    tp.querySelector = sel => subs[sel] || null;
    cache.tilePreview = tp;
  })();

  // 操作区：setActionsHTML 把按钮 HTML 塞进来，需要能从 HTML 里提取 id 并注册元素，
  // 这样 game.js 里的 getElementById('rollBtn'/'buyBtn'/'endBtn'…) 才找得到。
  (function setupActions() {
    const actions = mkEl('actions');
    actions._html = '';
    Object.defineProperty(actions, 'innerHTML', {
      set(html) {
        actions._html = String(html);
        actions.children.length = 0;
        const ids = [...String(html).matchAll(/id="([^"]+)"/g)].map(m => m[1]);
        ids.forEach(id => { if (!cache[id]) cache[id] = mkEl(id); });
      },
      get() { return actions._html; },
    });
    cache.actions = actions;
  })();

  global.document = {
    getElementById: getEl,
    createElement: () => mkEl('dyn'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    body: (() => {
      const b = mkEl('body');
      b.classList = { s: new Set(['no-tilt']), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } };
      return b;
    })(),
  };
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  global.window = {
    addEventListener() { }, removeEventListener() { },
    AudioContext: undefined, webkitAudioContext: undefined,
    speechSynthesis: undefined, SpeechSynthesisUtterance: undefined,
    navigator: { serviceWorker: undefined },
  };
  // Node 22 的 globalThis.navigator 只有 getter，需用 defineProperty 覆盖
  Object.defineProperty(global, 'navigator', { value: { serviceWorker: undefined }, configurable: true, writable: true });
  global.alert = alertMode === 'throw' ? (m) => { throw new Error('alert: ' + m); } : () => { };
  global.confirm = () => true;
  global.prompt = () => null;   // 拍卖出价：人类玩家不参与
  global.requestAnimationFrame = fn => setImmediate(fn);
  global.fetch = async (url) => {
    const txt = fs.readFileSync(path.join(root, String(url).replace(/^\.?\//, '')), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  };

  const tick = () => new Promise(r => setImmediate(r));

  return { cache, getEl, store, tick };
}

/** 加载仓库 js/ 下的真实模块（必须用 file:// 绝对 URL） */
export function loadModule(root, f) {
  return import(pathToFileURL(path.join(root, 'js', f)).href);
}
