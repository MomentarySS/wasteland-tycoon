// ============================================================
// cards.js — 道具卡系统（#16）
// 玩家通过黑市淘卡 / 事件奖励 / 遗产遗物获得道具卡，
// 在自己回合内使用（不消耗回合），手牌上限 4 张。
// 本模块只放数据与效果原语；目标选择 UI 在 view-modal.js。
// ============================================================
import { G } from './state.js';
import { TILES } from './data.js';
import { log } from './view-core.js';

export const HAND_LIMIT = 4;
export const CARD_PRICE = 120;   // 黑市淘卡价

/**
 * 卡定义：rarity 影响黑市随机淘卡权重（common 72% / rare 20% / epic 8%）
 */
export const CARDS = [
  { id: 'march', name: '急行军', icon: '🏃', rarity: 'common', price: 60, desc: '本回合掷骰 +2 步（掷骰前使用）' },
  { id: 'pass', name: '通行证', icon: '🎁', rarity: 'common', price: 80, desc: '获得 1 张出狱卡' },
  { id: 'pardon', name: '特赦令', icon: '🕊', rarity: 'common', price: 90, desc: '道德 +2' },
  { id: 'shield', name: '护盾', icon: '🛡', rarity: 'common', price: 100, desc: '下次被收租或缴税时全额免除' },
  { id: 'plunder', name: '掠夺卡', icon: '💸', rarity: 'common', price: 110, desc: '从最富对手处抢 100 盖' },
  { id: 'deed', name: '购地卡', icon: '🏴', rarity: 'rare', price: 130, desc: '免费获得脚下无主地块' },
  { id: 'demolish', name: '拆迁令', icon: '💣', rarity: 'rare', price: 150, desc: '选对手一块地降 1 级' },
  { id: 'remote_dice', name: '遥控骰', icon: '🎲', rarity: 'rare', price: 150, desc: '指定下一次掷骰的点数和（2~12）' },
  { id: 'swap', name: '换地卡', icon: '🔄', rarity: 'epic', price: 200, desc: '与对手各选一块产权地对换' },
  { id: 'equalizer', name: '均富卡', icon: '⚖', rarity: 'epic', price: 200, desc: '全体存活玩家现金平均（致敬大富翁4）' },
];

export function cardDef(id) { return CARDS.find(c => c.id === id) || null; }
export function cardName(id) { const c = cardDef(id); return c ? c.name : id; }

/** 随机卡 id（按稀有度加权） */
export function randomCardId() {
  const r = Math.random();
  const tier = r < 0.72 ? 'common' : r < 0.92 ? 'rare' : 'epic';
  const pool = CARDS.filter(c => c.rarity === tier);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/** 发卡：手牌满时拒收（返回 false） */
export function giveCard(p, id) {
  if (!p || p.bankrupt) return false;
  p.cards = Array.isArray(p.cards) ? p.cards : [];
  if (p.cards.length >= HAND_LIMIT) {
    log(`🃏 ${p.name} 手牌已满（${HAND_LIMIT} 张），无法获得「${cardName(id)}」`);
    return false;
  }
  p.cards.push(id);
  return true;
}

/** 用掉一张卡（移除手牌中第一张同 id） */
export function removeCard(p, id) {
  if (!p.cards) return;
  const i = p.cards.indexOf(id);
  if (i >= 0) p.cards.splice(i, 1);
}

/** 当前时机能否使用（决定手牌弹窗中按钮是否可用） */
export function canUseCard(p, id) {
  const t = TILES[p.pos];
  switch (id) {
    case 'march':
    case 'remote_dice':
      return !!G.awaitingRoll;                       // 只在掷骰前可用
    case 'deed':
      return !!(t && (t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner == null);
    case 'demolish':
      return TILES.some(x => x.type === 'prop' && x.owner != null && x.owner !== p.id && (x.level || 0) > 0);
    case 'swap':
      return TILES.some(x => x.type === 'prop' && x.owner != null && x.owner !== p.id)
        && TILES.some(x => x.type === 'prop' && x.owner === p.id);
    case 'plunder':
      return G.players.some(x => x !== p && !x.bankrupt);
    default:
      return true;
  }
}

// ---------------- 效果原语（返回 true = 成功生效） ----------------

export function applyPass(p) {
  p.getOut = (p.getOut || 0) + 1;
  log(`🎁 ${p.name} 使用通行证，获得 1 张出狱卡`, true);
  return true;
}

export function applyMarch(p) {
  p.marchBonus = (p.marchBonus || 0) + 2;
  log(`🏃 ${p.name} 使用急行军，本回合掷骰 +2 步`, true);
  return true;
}

export function applyShield(p) {
  p.shield = (p.shield || 0) + 1;
  log(`🛡 ${p.name} 展开护盾，下次被收租/缴税全额免除`, true);
  return true;
}

export function applyPardon(p) {
  p.moral = (p.moral || 0) + 2;
  log(`🕊 ${p.name} 使用特赦令，道德 +2（现 ${p.moral}）`, true);
  return true;
}

export function applyPlunder(p) {
  const targets = G.players.filter(x => x !== p && !x.bankrupt);
  if (!targets.length) return false;
  const richest = targets.reduce((a, b) => (b.caps > a.caps ? b : a));
  const amount = Math.min(100, Math.max(richest.caps, 0));
  richest.caps -= amount; p.caps += amount;
  log(`💸 ${p.name} 掠夺了 ${richest.name} ${amount} 盖！`, true);
  return amount > 0;
}

export function applyDeed(p) {
  const t = TILES[p.pos];
  if (!t || (t.type !== 'prop' && t.type !== 'rail' && t.type !== 'util') || t.owner != null) return false;
  t.owner = p.id; t.mortgaged = false;
  log(`🏴 ${p.name} 使用购地卡，免费获得「${t.name}」！`, true);
  return true;
}

export function applyDemolish(p, tile) {
  if (!tile || tile.owner == null || tile.owner === p.id || (tile.level || 0) <= 0) return false;
  const ownerName = G.players[tile.owner] ? G.players[tile.owner].name : '?';
  tile.level -= 1;
  log(`💣 ${p.name} 用拆迁令拆毁 ${ownerName} 的「${tile.name}」→ Lv${tile.level}`, true);
  return true;
}

export function applySwap(p, myTile, theirTile) {
  if (!myTile || !theirTile || myTile.owner !== p.id || theirTile.owner === p.id) return false;
  const theirOwner = G.players[theirTile.owner];
  myTile.owner = theirTile.owner;
  theirTile.owner = p.id;
  log(`🔄 ${p.name} 用换地卡：「${myTile.name}」 ⇄ ${theirOwner ? theirOwner.name + ' 的' : ''}「${theirTile.name}」`, true);
  return true;
}

export function applyEqualizer(p) {
  const alive = G.players.filter(x => !x.bankrupt);
  if (alive.length < 2) return false;
  const sum = alive.reduce((s, x) => s + Math.max(x.caps, 0), 0);
  const avg = Math.floor(sum / alive.length);
  if (alive.every(x => x.caps === avg)) return false;
  alive.forEach(x => { x.caps = avg; });
  log(`⚖ ${p.name} 使用均富卡！全体现金均分为 ${avg} 盖`, true);
  return true;
}

/** 遥控骰：锁定下一次掷骰点数和 */
export function applyRemoteDice(p, sum) {
  const v = Math.min(12, Math.max(2, sum | 0));
  G.forcedRoll = v;
  log(`🎲 ${p.name} 使用遥控骰，下一次掷骰锁定为 ${v} 点`, true);
  return true;
}

/** 掷骰时消费 G.forcedRoll：把随机点数改写为锁定值（a/b 拆分保证各 1~6） */
export function applyForcedRoll(a, b) {
  if (G.forcedRoll == null) return { a, b };
  const x = Math.min(6, Math.max(1, G.forcedRoll - 6));
  const y = Math.min(6, Math.max(1, G.forcedRoll - x));
  log(`🎲 遥控骰锁定生效：掷出 ${x} + ${y} = ${x + y}`);
  G.forcedRoll = null;
  return { a: x, b: y };
}
