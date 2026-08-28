// 难度档：影响初始经济、税率与 AI 激进度
export const DIFFICULTY_PRESETS = {
  easy: {
    label: '简单',
    startCaps: 1800,
    salary: 220,
    targetWealth: 2500,
    taxMult: 0.85,
    aiBuyAggro: 0.75,
    aiBidAggro: 0.85,
    aiUpgradeChance: 0.45,
  },
  standard: {
    label: '标准',
    startCaps: 1500,
    salary: 200,
    targetWealth: 3000,
    taxMult: 1,
    aiBuyAggro: 1,
    aiBidAggro: 1,
    aiUpgradeChance: 0.6,
  },
  nightmare: {
    label: '噩梦',
    startCaps: 1100,
    salary: 160,
    targetWealth: 3500,
    taxMult: 1.25,
    aiBuyAggro: 1.35,
    aiBidAggro: 1.15,
    aiUpgradeChance: 0.75,
  },
};

export function getDifficultyPreset(id) {
  return DIFFICULTY_PRESETS[id] || DIFFICULTY_PRESETS.standard;
}

/** 写入 G 的难度修正（税率 / AI），返回预设供开局数值使用 */
export function applyDifficulty(G, id) {
  const p = getDifficultyPreset(id);
  G.difficulty = id in DIFFICULTY_PRESETS ? id : 'standard';
  G.taxMult = p.taxMult;
  G.aiBuyAggro = p.aiBuyAggro;
  G.aiBidAggro = p.aiBidAggro;
  G.aiUpgradeChance = p.aiUpgradeChance;
  return p;
}
