// 共享游戏状态（单一可变对象，避免散落的全局变量）
export const G = {
  players: [],
  current: 0,
  SALARY: 200,
  STARTCAPS: 1500,
  targetWealth: 3000,
  gameOver: false,
  endKind: null,        // 'win' | 'draw' | 'campaign' | 'campaignLose' | 'nuke'
  endWinnerId: null,
  awaitingRoll: false,
  pendingTile: null,
  turnPlayer: null,
  lastRoll: 0,
  mode: 'versus',        // 'versus' 对抗 | 'campaign' 单人闯关
  campaign: 0,           // 当前章节索引
  turn: 0,               // 已进行回合数（用于 MAX_TURNS 上限）
  difficulty: 'standard',
  taxMult: 1,
  aiBuyAggro: 1,
  aiBidAggro: 1,
  aiUpgradeChance: 0.6,
};

/** 新局 / 读档前重置回合级状态（不重置 players / 规则参数） */
export function resetSession() {
  G.gameOver = false;
  G.endKind = null;
  G.endWinnerId = null;
  G.awaitingRoll = false;
  G.pendingTile = null;
  G.turnPlayer = null;
  G.lastRoll = 0;
  G.current = 0;
  G.turn = 0;
  G.campaign = 0;
  G.difficulty = 'standard';
  G.taxMult = 1;
  G.aiBuyAggro = 1;
  G.aiBidAggro = 1;
  G.aiUpgradeChance = 0.6;
  // 遗产 / 突变 / 叙事字段必须逐局重置，否则跨局累加污染新对局
  // （applyLegacyToGame / applyMutators / applyNarrativeStart 在 resetSession 之后重新写入）
  G.rentMult = 1;
  G.noJail = false;
  G.badEventBonus = 0;
  G.goodEventBonus = 0;
  G.radiationLeak = 0;
  G.noSafe = false;
  G.priceMult = 1;
  G.moralDrain = 0;
  G.luckyDice = 0;
  G.warpMult = 1;
  G.auctionAll = false;
  G.pacifist = false;
  G.aiCoopBonus = 0;
  G.startRepPenalty = null;
  G.randomStart = false;
  G.SALARY_MULT = 1;
  G.START_MORAL = 0;
  G.START_GETOUT = 0;
  G.START_CARDS = 0;
  G.MUTATOR_REROLL = 0;
  G.activeMutators = [];
  G.narrativeSeed = null;
}
