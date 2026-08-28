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
}
