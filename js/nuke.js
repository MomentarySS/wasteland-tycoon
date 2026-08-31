// 隐藏结局：辐射76 式核弹发射（三密钥 → 核平棋盘 → 绝对胜利）
//
// 模块归属（v1.6.0 接手轮）：
//   纯逻辑：NUKE_FLAGS / nukeCodesHeld / nextNukeKeyNeeded / canLaunchNuke
//           / tryGrantNukeKey / tryNukeKeyFromChipFactory
//   发射流程：launchNuke（从 game.js 迁入）— 音效/过场/蘑菇云/胜利/遗产结算
//   UI 渲染：已迁出 nukeKeyBadgeHtml → view-nuke.js（消除 view-core.js → nuke.js 箭头）
//
// 循环依赖现状（v1.6.0）：
//   nuke.js → view-core.js（log/render/setActionsHTML，launchNuke 用）
//   nuke.js → view-modal.js（showNukeWin，launchNuke 用）
//   都是 ESM lazy 访问（函数体内才用，模块顶层不立即求值），能跑但不是单向干净。
//   真正完全单向化的方案：launchNuke 改接受 deps 注入，由 game.js/view-modal.js
//   在调用时把 render/log/setActionsHTML/showNukeWin 传进来。改动面大、收益小，
//   建议短期接受现状。
import { G } from './state.js';
import { log, render, setActionsHTML } from './view-core.js';
import { showNukeWin } from './view-modal.js';
import { sfx, NUKE_LAUNCH_SFX_MS } from './audio.js';
import { haptic } from './fx.js';
import { playNukeStrike } from './fx-events.js';
import { playNukeCutscene } from './cutscene.js';
import { recordRun } from './legacy.js';
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

/** 玩家信息栏的发射密钥进度 UI 已迁出至 view-nuke.js（v1.6.0 接手轮 · 断 nuke.js ↔ view-core.js 循环）*/

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
  // 「核军备竞赛」突变：密钥掉落概率翻倍（AI 集齐后会在其回合自动发射）
  const chance = (NUKE_KEY_CHANCES[source] || 0) * (G.nukeRace ? 2 : 1);
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

// ============================================================
// 发射流程（从 game.js 迁入，v1.6.0 接手轮）
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 核弹发射完整流程
 * - 检查 G.gameOver / canLaunchNuke（防重复发射）
 * - 设置 endKind='nuke'（内联 game.js 原 setGameEnd 的 2 行赋值）
 * - 关闭动作条与活动弹窗
 * - 启动音效 + 1.5s 延迟 + 全屏三幕分镜 + 蘑菇云
 * - 胜利弹窗 + 重 haptic
 * - 遗产模式：调用 recordRun 结算（+100 点）
 *
 * @returns {boolean} 是否成功发射
 */
export async function launchNuke(p) {
  if (G.gameOver || !canLaunchNuke(p)) return false;
  G.gameOver = true;
  // 内联 game.js setGameEnd('nuke', p.id)
  G.endKind = 'nuke';
  G.endWinnerId = p.id;
  G.awaitingRoll = false;
  G.pendingTile = null;
  setActionsHTML('');
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'none';
  log(`☢ ${p.name} 启动三座导弹井，靶场锁定棋盘中央！`, true);
  render();
  sfx('nukeLaunch');
  await sleep(NUKE_LAUNCH_SFX_MS);
  // 全屏分镜过场：警报 → 密钥对齐 → 弹头离井，随后蘑菇云在棋盘升起
  await playNukeCutscene();
  await playNukeStrike();
  showNukeWin(p.name);
  haptic('heavy');
  log(`☢ 蘑菇云在阿帕拉契亚升起——无论战局如何，${p.name} 以绝对火力终结协议。`, true);
  // 遗产模式：核弹结局同样结算遗产点（awardLegacyPoints 对 nuke 有 +100）
  if (G.mode === 'legacy') {
    const human = G.players.find(x => !x.isAI) || G.players[0];
    const result = recordRun({
      turns: G.turn || 0,
      moral: human.moral || 0,
      endKind: G.endKind,
      bankrupt: human.bankrupt,
      chaptersCompleted: G.campaign || 0,
    });
    if (result && result.pointsEarned > 0) {
      log(`📜 获得 ${result.pointsEarned} 遗产点（共 ${result.totalPoints}）`, true);
    }
  }
  return true;
}
