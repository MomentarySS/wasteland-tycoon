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

/** 从牌堆中按 flags / rep / once 筛选；连锁任务权重更高。
 *  牌堆全部为 once 且已完成时返回 null（调用方按「空频道」处理，绝不重放已完成任务重复结算） */
export function pickMission(pile, player) {
  const eligible = pile.filter((m) => missionEligible(m, player));
  const pool = eligible.length ? eligible : pile.filter((m) => !m.once || !(player.missionDone || []).includes(m.id));
  if (!pool.length) return null;

  const weighted = [];
  for (const m of pool) {
    const isChain = m.once || (m.requires && m.requires.length) || (m.requiresRep && Object.keys(m.requiresRep).length);
    const w = isChain ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(m);
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

export function markMissionDone(p, mission) {
  if (!mission || !mission.once) return;
  if (!p.missionDone) p.missionDone = [];
  if (!p.missionDone.includes(mission.id)) p.missionDone.push(mission.id);
}

export function isChainMission(m) {
  return !!(m && ((m.requires && m.requires.length) || (m.requiresRep && Object.keys(m.requiresRep).length) || m.once));
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
