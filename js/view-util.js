// 视图层小工具（HTML 转义等）
// 单引号必须一并转义：view-modal.js:125 等处把本函数的产物放进单引号属性
// （class='evtArt has-img art-${...}'）。与 js/main.js:22 的项目内约定保持一致。
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
