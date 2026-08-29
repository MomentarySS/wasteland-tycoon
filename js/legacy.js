// ============================================================
// legacy.js — 遗产系统：跨局永久成长
// localStorage 持久化，遗产点购买永久加成
// ============================================================

const LEGACY_KEY = 'wasteland_legacy_meta';

export function getDefaultLegacy() {
  return {
    points: 0,
    totalRuns: 0,
    bestScore: 0,
    unlockedBonuses: [],    // 已购买的永久加成 id
    unlockedMutators: [],   // 已解锁的突变因子 id
    lastEndKind: null,      // 上局结局
    lastMoral: 0,           // 上局道德值
  };
}

export function getLegacyMeta() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return getDefaultLegacy();
    const data = JSON.parse(raw);
    return { ...getDefaultLegacy(), ...data };
  } catch {
    return getDefaultLegacy();
  }
}

export function saveLegacyMeta(meta) {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('遗产数据保存失败', e);
  }
}

/** 根据对局结果计算遗产点 */
export function awardLegacyPoints(run) {
  let pts = 0;
  pts += (run.turns || 0) * 1;           // 存活回合
  pts += (run.chaptersCompleted || 0) * 50; // 章节完成
  pts += Math.max(0, run.moral || 0) * 10; // 道德值
  if (run.endKind === 'nuke') pts += 100;  // 核弹结局
  if (run.endKind === 'campaign' || run.endKind === 'coop') pts += 80; // 通关（单人/合作）
  if (run.endKind === 'survival') pts += Math.floor((run.turns || 0) * 2);
  if (run.bankrupt) pts = Math.floor(pts * 0.5); // 破产减半
  return Math.floor(pts);
}

/** 永久加成定义 */
export const LEGACY_BONUSES = [
  { id: 'start_caps_100', name: '起始瓶盖 +100', desc: '每局起始瓶盖增加 100', cost: 50, effect: { startCaps: 100 } },
  { id: 'start_caps_250', name: '起始瓶盖 +250', desc: '每局起始瓶盖增加 250', cost: 120, effect: { startCaps: 250 } },
  { id: 'salary_bonus', name: '据点补给 +25%', desc: '经过据点时补给增加 25%', cost: 80, effect: { salaryMult: 1.25 } },
  { id: 'moral_bonus', name: '道德起步 +2', desc: '每局起始道德值 +2', cost: 100, effect: { startMoral: 2 } },
  { id: 'getout_start', name: '起始出狱卡 +1', desc: '每局起始获得 1 张出狱卡', cost: 60, effect: { startGetOut: 1 } },
  { id: 'reroll_once', name: '每日重抽', desc: '突变因子可重抽 1 次', cost: 150, effect: { mutatorReroll: 1 } },
];

/** 应用遗产加成到游戏状态 */
export function applyLegacyToGame(G) {
  const meta = getLegacyMeta();
  for (const id of meta.unlockedBonuses) {
    const bonus = LEGACY_BONUSES.find(b => b.id === id);
    if (!bonus) continue;
    const e = bonus.effect;
    if (e.startCaps) G.STARTCAPS = (G.STARTCAPS || 1500) + e.startCaps;
    if (e.salaryMult) G.SALARY_MULT = (G.SALARY_MULT || 1) * e.salaryMult;
    if (e.startMoral) G.START_MORAL = (G.START_MORAL || 0) + e.startMoral;
    if (e.startGetOut) G.START_GETOUT = (G.START_GETOUT || 0) + e.startGetOut;
    if (e.mutatorReroll) G.MUTATOR_REROLL = (G.MUTATOR_REROLL || 0) + e.mutatorReroll;
  }
  return meta;
}

/** 购买加成 */
export function purchaseBonus(bonusId) {
  const meta = getLegacyMeta();
  const bonus = LEGACY_BONUSES.find(b => b.id === bonusId);
  if (!bonus) return { success: false, reason: 'bonus_not_found' };
  if (meta.unlockedBonuses.includes(bonusId)) return { success: false, reason: 'already_owned' };
  if (meta.points < bonus.cost) return { success: false, reason: 'insufficient_points' };
  meta.points -= bonus.cost;
  meta.unlockedBonuses.push(bonusId);
  saveLegacyMeta(meta);
  return { success: true, meta };
}

/** 记录对局结果 */
export function recordRun(runResult) {
  const meta = getLegacyMeta();
  const pts = awardLegacyPoints(runResult);
  meta.points += pts;
  meta.totalRuns++;
  meta.bestScore = Math.max(meta.bestScore, pts);
  meta.lastEndKind = runResult.endKind;
  meta.lastMoral = runResult.moral || 0;
  saveLegacyMeta(meta);
  return { pointsEarned: pts, totalPoints: meta.points, meta };
}

export { LEGACY_KEY };
