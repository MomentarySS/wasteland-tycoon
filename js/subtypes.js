// prop 子类型（subType）：同一组地产内的「同质不同质」
//
// 设计依据（不是拍脑袋）：docs/v1.8.0-plan.md §3 记录了用 scripts/balance-probe.mjs
// 实测出的 20 局基线——中位终局净值 3043 盖，且 40 局 0 破产。
// 因此把「极端单次收租」锚定在净值的 8% = 243 盖以内；
// scripts/subtype-design-check.mjs 会在越界时以退出码 1 失败（可作 CI 闸门）。
//
// 纯计算 + 无副作用：租金、日志文案、能否抵押都在这里，view/rules 只做转调。
import { TILES } from './data.js';

// 骰子变体的除数：收租 = base × (level+1) × roll/6，12 点等价 ×2。
// 早先按「× 骰点」实现会在高价地块上算出 1872 盖（净值的 61%），故改为除法。
const DICE_DIVISOR = 6;

export const SUBTYPE_DEFS = {
  landmark: {
    label: '地标', glyph: '★', mortgageable: false,
    baseCut: 0.55, rentMult: 2.2,
    desc: '战略要冲。租金丰厚且不可抵押。',
  },
  shack: {
    label: '棚户', glyph: '棚', mortgageable: true,
    baseCut: 1, rentMult: 0.55, upkeep: 10,
    desc: '年久失修。每次收租需支付 10 盖维护费。',
  },
  volatile: {
    label: '流动', glyph: '骰', mortgageable: true,
    baseCut: 1, rentMult: 1, dice: true,
    desc: '信号不稳。租金随当次骰点浮动。',
  },
  cursed: {
    label: '污染', glyph: '☠', mortgageable: true,
    baseCut: 1, rentMult: 1.6, moralHit: 1,
    desc: '缴租者良心不安，道德 -1。',
  },
};

export function subTypeDef(t) {
  if (!t || t.type !== 'prop' || !t.subType) return null;
  return SUBTYPE_DEFS[t.subType] || null;
}

/** 该地块的基础租金（已应用 subType 的基础折减）。无 subType 时等于 t.rent。 */
export function baseRentOf(t) {
  const def = subTypeDef(t);
  if (!def) return t.rent;
  return Math.max(1, Math.round(t.rent * def.baseCut));
}

/**
 * prop 收租金额（不含垄断倍数，由调用方叠加）。
 * roll 为 volatile 用的当次骰点（1–12），缺省按 6（期望值）计算。
 */
export function propBaseRent(t, roll) {
  const def = subTypeDef(t);
  const base = baseRentOf(t) * ((t.level || 0) + 1);
  if (!def) return base;
  let r = base * def.rentMult;
  if (def.dice) r = r * (Number.isFinite(roll) ? roll : DICE_DIVISOR) / DICE_DIVISOR;
  return Math.max(1, Math.round(r));
}

/** volatile 在给定骰点下的单次收租（含垄断加成），供预览面板显示区间用。 */
export function propRentWithRoll(t, roll, monopolyMult = 1) {
  return propBaseRent(t, roll) * monopolyMult;
}

/** shack：收租方每次向缴租方收取的维护费。 */
export function upkeepOf(t) {
  const def = subTypeDef(t);
  return def && def.upkeep ? def.upkeep : 0;
}

/** cursed：缴租方受到的道德惩罚。 */
export function moralHitOf(t) {
  const def = subTypeDef(t);
  return def && def.moralHit ? def.moralHit : 0;
}

/** landmark 不可抵押；其它变体与普通地产一致。 */
export function canMortgageTile(t) {
  const def = subTypeDef(t);
  return def ? def.mortgageable !== false : true;
}

/** 预览面板用的显示标签，如「地标」「流动」；无 subType 返回空串。 */
export function subTypeLabel(t) {
  const def = subTypeDef(t);
  return def ? def.label : '';
}