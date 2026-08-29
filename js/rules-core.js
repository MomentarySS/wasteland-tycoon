// 纯规则计算（无 DOM / 音效 / 日志副作用，便于单测）
import { TILES } from './data.js';
import { G } from './state.js';

export function netWorth(p) {
  let w = p.caps;
  TILES.forEach(t => {
    if ((t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner === p.id && !t.mortgaged)
      w += t.price + (t.level > 0 ? t.level * t.price * 0.5 : 0);
  });
  return Math.floor(w);
}

export function isMonopoly(t) {
  if (t.type !== 'prop') return false;
  const g = TILES.filter(x => x.type === 'prop' && x.group === t.group);
  return g.length > 0 && g.every(x => x.owner === t.owner && !x.mortgaged);
}

export function railRent(t) {
  const n = TILES.filter(x => x.type === 'rail' && x.owner === t.owner).length;
  return 25 * Math.pow(2, Math.max(0, n - 1));
}

export function utilMult(t) {
  const n = TILES.filter(x => x.type === 'util' && x.owner === t.owner).length;
  return n >= 2 ? 10 : 4;
}

export function rentDisplay(t) {
  if (t.owner === null) return '—';
  if (t.mortgaged) return '0';
  if (t.type === 'rail') return String(railRent(t));
  if (t.type === 'util') return (utilMult(t) === 10 ? '×10' : '×4');
  return String(t.rent * (t.level + 1)) + (isMonopoly(t) ? '★' : '');
}

export function canUpgrade(p, t) {
  if (t.type !== 'prop') return false;
  const g = TILES.filter(x => x.type === 'prop' && x.group === t.group);
  return g.every(x => x.owner === p.id) && t.level < 2;
}

export function aiBid(x, t) {
  // 合作模式：AI 不对人类队友正在竞价的物品出价
  if (G.mode === 'coop' && x.isAI) {
    const human = G.players.find(p => !p.isAI);
    if (human) {
      // 「战友情谊」叙事种子：AI 按概率把拍卖机会让给人类队友
      if (G.aiCoopBonus && Math.random() < G.aiCoopBonus) return 0;
      const grp = t.type === 'prop' ? TILES.filter(y => y.type === 'prop' && y.group === t.group) : [];
      const ownedByHuman = grp.filter(y => y.owner === human.id).length;
      if (ownedByHuman > 0) return 0; // 让人类拿这个区域
    }
  }
  const aggro = G.aiBidAggro || 1;
  const max = Math.floor(x.caps * 0.6 * aggro);
  if (max < Math.floor(t.price * 0.4)) return 0;
  const grp = t.type === 'prop' ? TILES.filter(y => y.type === 'prop' && y.group === t.group) : [];
  const want = grp.some(y => y.owner === x.id);
  const bid = want ? Math.floor(t.price * 1.3) : Math.floor(t.price * 0.8);
  return Math.min(max, bid);
}

export function aiShouldBuy(p, t) {
  if (p.caps < t.price) return false;
  const aggro = G.aiBuyAggro || 1;
  const buffer = Math.max(150, t.price * 0.4) / aggro;
  if (p.caps - t.price < buffer) return false;
  const grp = TILES.filter(x => x.type === 'prop' && x.group === t.group);
  const ownedByP = grp.filter(x => x.owner === p.id).length;
  if (ownedByP >= 1) return true;
  const ownedByOther = grp.filter(x => x.owner != null && x.owner !== p.id).length;
  // 合作模式：避免与人类队友竞争同一区域
  if (G.mode === 'coop' && p.isAI) {
    const human = G.players.find(x => !x.isAI);
    const ownedByHuman = grp.filter(x => x.owner === human.id).length;
    if (ownedByHuman > 0) return false;
  }
  if (ownedByOther === 0) return true;
  // 有对手持有同组地块时，现金充裕仍可买入：避免 AI 全面弃购导致租金经济停滞、对局拖到近千轮
  return ownedByOther === 1 && p.caps > t.price * 2;
}

export function aiUpgrade(p, t) {
  if (t.level >= 2) return false;
  const grp = TILES.filter(x => x.type === 'prop' && x.group === t.group);
  const chance = G.aiUpgradeChance != null ? G.aiUpgradeChance : 0.6;
  return grp.every(x => x.owner === p.id) && p.caps > t.price * 2.5 && Math.random() < chance;
}

export function aiRaiseCashPlan(p, need) {
  const steps = [];
  let caps = p.caps;
  let guard = 0;
  while (caps < need && guard++ < 20) {
    const cand = TILES.filter(t => t.type === 'prop' && t.owner === p.id && !t.mortgaged && t.level === 0)
      .sort((a, b) => a.price - b.price)[0];
    if (!cand) break;
    steps.push(cand);
    caps += Math.floor(cand.price / 2);
  }
  return steps;
}

export function aiTradeAccept(b, aProps, gc, bProps, wc) {
  let delta = 0;
  aProps.forEach(t => { delta -= (t.mortgaged ? 0 : t.price + t.level * t.price * 0.5); });
  bProps.forEach(t => {
    delta += (t.mortgaged ? 0 : t.price + t.level * t.price * 0.5);
    const grp = TILES.filter(x => x.type === 'prop' && x.group === t.group);
    if (grp.every(x => x.owner === b.id || x === t)) delta += t.price * 0.4;
  });
  delta += wc - gc;
  return delta > 0;
}

/** AI 选任务支：mode=campaign/coop 时更重视道德目标 */
export function aiMissionChoice(p, m, opts) {
  opts = opts || {};
  const campaignMode = !!opts.campaign || G.mode === 'coop';
  const moralGoal = opts.moralGoal || 0;
  let best = m.choices[0], bestScore = -Infinity;
  for (const c of m.choices) {
    const e = c.effects || {};
    let score = (e.caps || 0);
    if (p.caps + (e.caps || 0) < 80) score -= 1000;
    if (e.getOut) score += 60;
    if (e.moral) {
      score += e.moral * (campaignMode ? 14 : 8);
      if (campaignMode && p.moral < moralGoal && e.moral > 0) score += 25;
    }
    if (e.skip) score -= 50;
    if (e.upgrade) score += 40;
    if (e.bonusHalf) score += Math.floor(p.caps * 0.25);
    if (e.warp) score -= 25;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}
