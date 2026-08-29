// ============================================================
// mutators.js — 肉鸽突变因子系统
// 每局随机抽取突变因子，改变游戏规则
// ============================================================

export const MUTATOR_POOL = [
  { id: 'double_rent', name: '双倍租金', desc: '所有租金翻倍', icon: '💰', apply: (G) => { G.rentMult = (G.rentMult || 1) * 2; } },
  { id: 'no_jail', name: '无法无天', desc: '监狱失效，无法关押', icon: '⛓', apply: (G) => { G.noJail = true; } },
  { id: 'horde_frequent', name: '尸潮频发', desc: '坏事件概率 +30%', icon: '💀', apply: (G) => { G.badEventBonus = (G.badEventBonus || 0) + 0.3; } },
  { id: 'radiation_leak', name: '辐射泄漏', desc: '每回合额外 -5 盖', icon: '☢', apply: (G) => { G.radiationLeak = (G.radiationLeak || 0) + 5; } },
  { id: 'rich_start', name: '富饶开局', desc: '起始瓶盖 +500', icon: '💎', apply: (G) => { G.STARTCAPS = (G.STARTCAPS || 1500) + 500; } },
  { id: 'ai_aggressive', name: 'AI 激进', desc: 'AI 买地激进度 +50%', icon: '🤖', apply: (G) => { G.aiBuyAggro = (G.aiBuyAggro || 1) * 1.5; } },
  { id: 'no_safe', name: '无安全区', desc: '安全格失效', icon: '⚠', apply: (G) => { G.noSafe = true; } },
  { id: 'double_salary', name: '双倍补给', desc: '经过据点补给翻倍', icon: '🏠', apply: (G) => { G.SALARY_MULT = (G.SALARY_MULT || 1) * 2; } },
  { id: 'expensive_land', name: '地产泡沫', desc: '地产价格 +50%', icon: '📈', apply: (G) => { G.priceMult = (G.priceMult || 1) * 1.5; } },
  { id: 'cheap_land', name: '抄底时机', desc: '地产价格 -30%', icon: '📉', apply: (G) => { G.priceMult = (G.priceMult || 1) * 0.7; } },
  { id: 'moral_drain', name: '道德困境', desc: '每回合道德 -1', icon: '😈', apply: (G) => { G.moralDrain = (G.moralDrain || 0) + 1; } },
  { id: 'lucky_start', name: '幸运开局', desc: '起始掷骰 +1', icon: '🎲', apply: (G) => { G.luckyDice = (G.luckyDice || 0) + 1; } },
  { id: 'wormhole_chaos', name: '虫洞紊乱', desc: '虫洞传送距离加倍', icon: '🌀', apply: (G) => { G.warpMult = (G.warpMult || 1) * 2; } },
  { id: 'auction_everywhere', name: '拍卖狂潮', desc: '所有未购地产自动拍卖', icon: '🔨', apply: (G) => { G.auctionAll = true; } },
  { id: 'pacifist', name: '和平主义', desc: '无法收取租金但每回合 +20 盖', icon: '☮', apply: (G) => { G.pacifist = true; } },
  // ---- v1.4.0 扩充：风险收益 / 互动 / 混沌 ----
  { id: 'bank_interest', name: '废土银行', desc: '每回合开始现金 +5% 利息（上限 +50 盖）', icon: '🏦', apply: (G) => { G.bankInterest = true; } },
  { id: 'rent_snowball', name: '连锁垄断', desc: '同组每多一块地，该组租金 +15%', icon: '🧲', apply: (G) => { G.rentSnowball = true; } },
  { id: 'tax_everything', name: '高税时代', desc: '税收格翻倍，据点补给 +50%', icon: '🧾', apply: (G) => { G.taxMult = (G.taxMult || 1) * 2; G.SALARY_MULT = (G.SALARY_MULT || 1) * 1.5; } },
  { id: 'land_tax', name: '地产维护费', desc: '每回合每块地 -5 盖', icon: '🏚', apply: (G) => { G.landTax = (G.landTax || 0) + 5; } },
  { id: 'equal_wealth', name: '均富协议', desc: '每轮结束时全体现金取平均', icon: '⚖', apply: (G) => { G.equalWealth = true; } },
  { id: 'vendetta', name: '血债血偿', desc: '缴租给某人后，对方下次向你收租 +50%', icon: '🩸', apply: (G) => { G.vendetta = true; } },
  { id: 'broke_rush', name: '绝境狂奔', desc: '现金不足 200 盖时掷骰 +3 步', icon: '🏃', apply: (G) => { G.brokeRush = true; } },
  { id: 'speed_die', name: '超频骰', desc: '掷骰后可付 30/60 盖额外 +1/+2 步', icon: '⚡', apply: (G) => { G.speedDie = true; } },
  { id: 'jackpot', name: '免费停车彩金', desc: '税与租金进入奖池，踩安全格全拿', icon: '🎁', apply: (G) => { G.jackpot = true; } },
  { id: 'nuke_race', name: '核军备竞赛', desc: '发射密钥掉落概率翻倍，AI 集齐会真的发射', icon: '☢', apply: (G) => { G.nukeRace = true; } },
];

/** 随机抽取 N 个突变因子 */
export function rollMutators(count = 3, unlockedIds = null) {
  // 如果未指定已解锁列表，使用全部
  const pool = unlockedIds
    ? MUTATOR_POOL.filter(m => unlockedIds.includes(m.id))
    : MUTATOR_POOL;

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** 突变因子会写入的全部规则字段（重抽/重置前先清零，避免重复应用时累加） */
const MUTATOR_FIELDS = {
  rentMult: 1, noJail: false, badEventBonus: 0, radiationLeak: 0,
  aiBuyAggro: 1, noSafe: false, SALARY_MULT: 1, priceMult: 1,
  moralDrain: 0, luckyDice: 0, warpMult: 1, auctionAll: false, pacifist: false,
  // v1.4.0
  bankInterest: false, rentSnowball: false, taxMult: 1, landTax: 0,
  equalWealth: false, vendetta: false, brokeRush: false, speedDie: false,
  jackpot: false, jackpotPool: 0, nukeRace: false,
  _vendettaFrom: null, _vendettaTo: null,
};

/** 清空所有突变因子写入的字段（保留遗产/叙事侧的 startCaps 等非重叠字段） */
export function resetMutatorFields(G) {
  for (const [k, v] of Object.entries(MUTATOR_FIELDS)) G[k] = v;
}

/** 应用突变因子到游戏状态（内部先重置字段，可安全重复调用） */
export function applyMutators(G, mutators) {
  G.activeMutators = mutators;
  for (const m of mutators) {
    const def = MUTATOR_POOL.find(d => d.id === m.id);
    if (def && def.apply) def.apply(G);
  }
}

/** 获取突变因子描述文本 */
export function formatMutatorEffect(mutatorId) {
  const def = MUTATOR_POOL.find(d => d.id === mutatorId);
  return def ? `${def.icon} ${def.name}: ${def.desc}` : mutatorId;
}

export { MUTATOR_POOL as ALL_MUTATORS };
