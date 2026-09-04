// 入口：加载内容 → 初始化视图 → 装配界面（Electron 桌面；不再注册 PWA）
import { loadContent } from './data.js';
import { initView, buildSetup, wireTopButtons } from './view.js';
import { initTTS } from './tts.js';

async function main() {
  await loadContent();
  initView();
  initTTS();
  wireTopButtons();
  buildSetup();
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
