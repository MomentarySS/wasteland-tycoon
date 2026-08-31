// ============================================================
// view-nuke.js — 核弹相关视图层（v1.6.0 接手轮）
// 目的：把原本住在 nuke.js 的 UI 辅助函数 nukeKeyBadgeHtml
//       迁出，避免 view-core.js ↔ nuke.js 的循环依赖。
// 依赖方向：view-nuke.js → nuke.js（单向）
// ============================================================
import { NUKE_FLAGS, nukeCodesHeld, canLaunchNuke } from './nuke.js';

/**
 * 玩家信息栏：发射密钥进度（仅已有密钥时显示）
 * 直接复刻原 nuke.js 实现，仅迁出位置
 */
export function nukeKeyBadgeHtml(p) {
  const n = nukeCodesHeld(p);
  if (!n) return '';
  const parts = NUKE_FLAGS.map((f, i) => {
    const on = p.flags && p.flags.includes(f);
    const label = ['阿', '布', '查'][i];
    return `<span class="nukeKey${on ? ' on' : ''}">${label}</span>`;
  });
  const ready = canLaunchNuke(p) ? ' nukeReady' : '';
  return `<span class="nukeKeys${ready}" title="发射密钥 ${n}/3（阿尔法·布拉沃·查理）">${parts.join('')}</span>`;
}
