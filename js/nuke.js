// 隐藏结局：辐射76 式核弹发射（三密钥 → 核平棋盘 → 绝对胜利）

import { log } from './view-core.js';
import { addPlayerFlags } from './missions.js';

export const NUKE_FLAGS = ['nuke_alpha', 'nuke_beta', 'nuke_gamma'];

/** 事件外掉落：按「下一枚缺失密钥」随机授予（仍须 阿尔法→布拉沃→查理 顺序） */
export const NUKE_KEY_CHANCES = {
  radiation_deep: 0.24,
  radiation_shallow: 0.11,
  blackmarket_steal: 0.20,
  blackmarket_card: 0.14,
  chip_factory: 0.16,
  chip_factory_owner: 0.26,
  manual: 0.15,
};

const KEY_LABEL = { nuke_alpha: '阿尔法', nuke_beta: '布拉沃', nuke_gamma: '查理' };

const SOURCE_HINT = {
  radiation_deep: '莫诺加矿渣的铅封罐里',
  radiation_shallow: '浅层矿脉的金属碎片中',
  blackmarket_steal: '黑市赃物堆底部',
  blackmarket_card: '黑市旧货箱夹层',
  chip_factory: '隔离电台阵列废弃产线',
  chip_factory_owner: '你的隔离电台阵列机密保险柜',
  manual: '手册夹层的加密页',
};

export function nukeCodesHeld(p) {
  if (!p || !Array.isArray(p.flags)) return 0;
  return NUKE_FLAGS.filter((f) => p.flags.includes(f)).length;
}

export function nextNukeKeyNeeded(p) {
  if (!p || !Array.isArray(p.flags)) return null;
  for (const f of NUKE_FLAGS) {
    if (!p.flags.includes(f)) return f;
  }
  return null;
}

/** 玩家信息栏：发射密钥进度（仅已有密钥时显示） */
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

/** 已集齐三枚发射密钥且未破产 */
export function canLaunchNuke(p) {
  return !!(p && !p.bankrupt && nukeCodesHeld(p) === NUKE_FLAGS.length);
}

export function isChipFactoryTile(t) {
  return !!(t && t.type === 'prop' && t.name === '隔离电台阵列');
}

/**
 * 尝试从指定来源授予下一枚密钥
 * @returns {boolean} 是否新获得密钥
 */
export function tryGrantNukeKey(p, source) {
  if (!p || p.bankrupt) return false;
  const need = nextNukeKeyNeeded(p);
  if (!need) return false;
  const chance = NUKE_KEY_CHANCES[source] || 0;
  if (chance <= 0 || Math.random() >= chance) return false;
  addPlayerFlags(p, [need]);
  const hint = SOURCE_HINT[source] || '废土深处';
  log(`☢ ${p.name} 在${hint}截获发射密钥 ${KEY_LABEL[need] || need}`, true);
  return true;
}

/** 踩到隔离电台阵列时调用 */
export function tryNukeKeyFromChipFactory(p, tile) {
  if (!isChipFactoryTile(tile)) return false;
  const src = tile.owner === p.id ? 'chip_factory_owner' : 'chip_factory';
  return tryGrantNukeKey(p, src);
}
