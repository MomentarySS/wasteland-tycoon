// 入口：加载内容 → 初始化视图 → 装配界面 → 注册 PWA
import { loadContent } from './data.js';
import { initView, buildSetup, wireTopButtons } from './view.js';
import { initTTS } from './tts.js';

async function main() {
  await purgeLocalSwIfNeeded();
  await loadContent();
  initView();
  initTTS();
  wireTopButtons();
  buildSetup();
  registerSW();
}

function isLocalHost() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

/** 本地开发：卸载 SW 并清缓存，避免旧缓存干扰调试 */
async function purgeLocalSwIfNeeded() {
  if (!isLocalHost() || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    console.log('[PWA] 本地模式：已卸载 Service Worker 并清缓存');
  } catch (e) {
    console.warn('[PWA] 清理 SW 失败', e);
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (isLocalHost()) return;
  if (location.protocol !== 'https:' && !isLocalHost()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then((r) => console.log('[PWA] 已注册', r.scope))
      .catch((e) => console.warn('[PWA] 注册失败', e));
  });
}

main().catch((e) => {
  console.error('[废土大亨] 启动失败', e);
  const el = document.getElementById('setup');
  const msg = escapeHtml(String((e && e.message) || e));
  if (el) el.innerHTML = '<p style="color:#f88;padding:20px">加载失败：' + msg + '</p>';
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
