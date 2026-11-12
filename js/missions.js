// 迷你任务链：requires / requiresRep / once / flags 驱动的事件池筛选

export function playerHasFlags(p, required) {
  if (!required || !required.length) return true;
  const flags = p.flags || [];
  return required.every((f) => flags.includes(f));
}

export function playerHasRep(p, requiredRep) {
  if (!requiredRep || typeof requiredRep !== 'object') return true;
  const rep = p.factionRep || {};
  return Object.entries(requiredRep).every(([k, v]) => (rep[k] || 0) >= v);
}

export function addPlayerFlags(p, flagList) {
  if (!flagList || !flagList.length) return [];
  if (!p.flags) p.flags = [];
  const added = [];
  for (const f of flagList) {
    if (!p.flags.includes(f)) {
      p.flags.push(f);
      added.push(f);
    }
  }
  return added;
}

export function missionEligible(m, player) {
  if (m.once && (player.missionDone || []).includes(m.id)) return false;
  if (!playerHasFlags(player, m.requires)) return false;
  if (!playerHasRep(player, m.requiresRep)) return false;
  return true;
}

/** 从牌堆中按 flags / rep / once 筛选；真正的连锁任务权重更高。
 *  没有可接任务时返回 null（调用方按「空频道」处理）。旧兜底会把旗标/声望未解锁的
 *  任务重新放出来，导致连锁、核弹、派系内容提前触发——宁可空频道，也不绕过解锁条件。 */
export function pickMission(pile, player) {
  const pool = pile.filter((m) => missionEligible(m, player));
  if (!pool.length) return null;

  const weighted = [];
  for (const m of pool) {
    const w = isChainMission(m) ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(m);
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

export function markMissionDone(p, mission) {
  if (!mission || !mission.once) return;
  if (!p.missionDone) p.missionDone = [];
  if (!p.missionDone.includes(mission.id)) p.missionDone.push(mission.id);
}

/** 连锁任务 = 需要前置旗标 / 声望的任务。
 *  旧实现把「一次性」也当成连锁，导致 36 个电台事件里 20 个独立事件被标成
 *  「🔗 连锁任务」并拿到 3 倍抽取权重，稀释了真正的连锁内容。 */
export function isChainMission(m) {
  return !!(m && ((m.requires && m.requires.length) || (m.requiresRep && Object.keys(m.requiresRep).length)));
}

export function isFactionMission(m) {
  return !!(m && m.deck === 'faction');
}

export function isNukeMission(m) {
  return !!(m && m.id && String(m.id).startsWith('nuke_chain_'));
}

export function addFactionRep(p, delta, labels) {
  if (!delta || typeof delta !== 'object') return [];
  if (!p.factionRep) p.factionRep = { eagle: 0, survivor: 0, tech: 0 };
  const parts = [];
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v !== 'number' || !v) continue;
    p.factionRep[k] = (p.factionRep[k] || 0) + v;
    const name = (labels && labels[k]) || k;
    parts.push(`${name}${v > 0 ? '+' : ''}${v}`);
  }
  return parts;
}

export function formatFactionRep(p, labels) {
  if (!p.factionRep) return '';
  return Object.entries(p.factionRep)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${(labels && labels[k]) || k}${v}`)
    .join(' ');
}
