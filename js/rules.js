// 游戏核心规则（副作用层：日志、渲染、音效；纯计算见 rules-core.js）
import { G } from './state.js';
import { TILES } from './data.js';
import { TILES_COUNT } from './config.js';
import { log, render, openModal, closeModal, placeToken, setActiveTile } from './view.js';
import { sfx } from './audio.js';
import { landDust, screenShake, haptic } from './fx.js';
import { playTileBuildFx, floatUpgrade } from './fx-events.js';
import { addPlayerFlags, markMissionDone, addFactionRep } from './missions.js';
import { tryGrantNukeKey } from './nuke.js';
import { FACTIONS as FACTION_LABELS, STEAL_PRICE } from './config.js';
import { cardName, giveCard, randomCardId, canUseCard, removeCard, HAND_LIMIT, CARD_PRICE,
  applyShield, applyPlunder, applyDemolish, applyMarch,
  applyEqualizer, applyDeed, applyRemoteDice } from './cards.js';
import {
  netWorth, isMonopoly, railRent, utilMult, rentDisplay, canUpgrade,
  aiBid, aiShouldBuy, aiTradeAccept, aiMissionChoice, aiUpgrade as aiUpgradeCheck,
  aiRaiseCashPlan
} from './rules-core.js';
import { propBaseRent, upkeepOf, moralHitOf, canMortgageTile, subTypeDef } from './subtypes.js';
import { campaignMoralGoal } from './campaign.js';

export {
  netWorth, isMonopoly, railRent, utilMult, rentDisplay, canUpgrade,
  aiBid, aiShouldBuy, aiTradeAccept
} from './rules-core.js';

export function gain(p, a) { p.caps += a; log(`${p.name} ${p.short}  +${a} 瓶盖`); }
export function lose(p, a) { payCaps(p, a, '事件损失'); }

export function enterJail(p) {
  // 「无法无天」突变：隔离区失效
  if (G.noJail) { log(`⛓ 无法无天：${p.name} 无视隔离区`); return; }
  p.inJail = true; p.jailTurns = 0; p.doubles = 0;
  const qIdx = TILES.findIndex(t => t.type === 'quarantine');
  if (qIdx >= 0) { p.pos = qIdx; placeToken(p, qIdx); setActiveTile(qIdx); }
  render();
}

export function buy(p, t) {
  if (t.owner != null || p.caps < t.price) return;
  p.caps -= t.price; t.owner = p.id; sfx('buy'); log(`${p.name} 占领「${t.name}」 (-${t.price}盖)`); render();
  playTileBuildFx(t.id, 'buy', '占领地块', p.color);
}
export function upgrade(p, t, free) {
  if (t.type !== 'prop' || t.level >= 2 || t.owner !== p.id) return;
  if (!free && p.caps < t.price) return;
  if (!free) p.caps -= t.price;
  t.level++; sfx('buy'); log(`${p.name} 强化「${t.name}」至 L${t.level}${free ? '（免费）' : ''}`); render();
  playTileBuildFx(t.id, 'upgrade', '', p.color, free);
  floatUpgrade(t.id, t.level, free);
}
export function mortgage(p, t, silent) {
  if (t.owner !== p.id || t.mortgaged || t.level > 0) return;
  // landmark 是战略资产，不可抵押（subType 机制，非普通地产）
  if (!canMortgageTile(t)) {
    if (!silent) { sfx('event'); log(`★ 「${t.name}」是${subTypeDef(t).label}，不可抵押`); }
    return;
  }
  const mv = Math.floor(t.price / 2); t.mortgaged = true; p.caps += mv;
  if (!silent) { sfx('event'); log(`${p.name} 抵押「${t.name}」 +${mv}盖`); }
  render();
}
export function unmortgage(p, t) {
  if (t.owner !== p.id || !t.mortgaged) return;
  const um = Math.floor(t.price * 0.55); if (p.caps < um) return;
  p.caps -= um; t.mortgaged = false; sfx('buy'); log(`${p.name} 赎回「${t.name}」 -${um}盖`); render();
}
export function payRent(p, t) {
  if (t.mortgaged) { log(`${p.name} 踩中「${t.name}」，地块已抵押，免租`); render(); return; }
  // 「和平主义」突变：无人收租
  if (G.pacifist) { log(`☮ 和平主义：${p.name} 免缴租金`); render(); return; }
  // 道具卡「护盾」：抵挡本次租金
  if ((p.shield || 0) > 0) { p.shield--; log(`🛡 护盾生效：${p.name} 免缴租金`); render(); return; }
  const o = G.players[t.owner];
  if (!o || o.bankrupt) { t.owner = null; t.level = 0; t.mortgaged = false; render(); return; }
  let r;
  if (t.type === 'rail') r = railRent(t);
  else if (t.type === 'util') r = G.lastRoll * utilMult(t);
  else { r = propBaseRent(t, G.lastRoll); if (isMonopoly(t)) r *= 2; }
  // 「连锁垄断」突变：同组每多一块地，该组租金 +15%
  if (G.rentSnowball && t.type === 'prop') {
    const ownedInGroup = TILES.filter(x => x.type === 'prop' && x.group === t.group && x.owner === t.owner).length;
    if (ownedInGroup > 1) r = Math.floor(r * (1 + 0.15 * (ownedInGroup - 1)));
  }
  // 「血债血偿」突变：上次向你缴过租的人，本次缴租 +50%（一次性）
  if (G.vendetta && G._vendettaFrom === p.id && G._vendettaTo === o.id) {
    r = Math.floor(r * 1.5);
    log(`🩸 血债血偿：${o.name} 向 ${p.name} 收租 +50%`);
    G._vendettaFrom = null; G._vendettaTo = null;
  }
  // 「双倍租金」突变
  r = Math.floor(r * (G.rentMult || 1));
  p.caps -= r; o.caps += r; sfx('rent'); log(`${p.name} 向 ${o.name} 缴租 ${r}盖`);
  // shack：收租方每次额外垫付维护费（缴租方付、收租方收，净效果为削弱该地产收益）
  const upkeep = upkeepOf(t);
  if (upkeep > 0) {
    p.caps -= upkeep; o.caps += upkeep;
    log(`🔧 棚户维护：${p.name} 另付 ${upkeep} 盖给 ${o.name}`);
  }
  // cursed：污染地块，缴租方良心不安
  const hit = moralHitOf(t);
  if (hit > 0) {
    p.moral = Math.max(0, (p.moral || 0) - hit);
    log(`☠ 污染侵蚀：${p.name} 道德 -${hit}`);
  }
  // 「免费停车彩金」突变：租金进入奖池
  if (G.jackpot) G.jackpotPool = (G.jackpotPool || 0) + r;
  // 「血债血偿」：记下这笔记号，等对方下次踩你的地
  if (G.vendetta) { G._vendettaFrom = p.id; G._vendettaTo = o.id; }
  if (p.caps < 0) bankrupt(p, o);
  render();
}
export function payCaps(p, amount, reason) {
  if (p.caps - amount < 0 && p.isAI) aiRaiseCash(p, amount);
  p.caps -= amount; log(`${p.name} 支付 ${amount} ${reason}`);
  if (p.caps < 0) bankrupt(p);
}
export function bankrupt(p, creditor) {
  p.bankrupt = true; sfx('bad'); log(`💀 ${p.name} 破产出局！`);
  if (creditor && creditor.id !== p.id) {
    TILES.forEach(t => {
      if ((t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner === p.id) t.owner = creditor.id;
    });
    creditor.caps += Math.max(p.caps, 0);
    if (p.getOut > 0) { creditor.getOut = (creditor.getOut || 0) + p.getOut; log(`${creditor.name} 接收了 ${p.getOut} 张通行证`); }
  } else {
    TILES.forEach(t => {
      if ((t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner === p.id) { t.owner = null; t.level = 0; t.mortgaged = false; }
    });
  }
  p.caps = 0; p.getOut = 0; p.inJail = false; p.jailTurns = 0; render();
}

export async function auction(t) {
  const bidders = G.players.filter(x => !x.bankrupt);
  let best = null, bestBid = 0;
  bidders.forEach(x => { if (x.isAI) { const bid = aiBid(x, t); if (bid > bestBid) { bestBid = bid; best = x; } } });
  const human = G.players.find(x => !x.bankrupt && !x.isAI);
  if (human) {
    const hb = await askHumanBid(t, bestBid, human.caps);
    if (hb > bestBid) { bestBid = hb; best = human; }
  }
  if (best && bestBid > 0 && best.caps >= bestBid) {
    best.caps -= bestBid; t.owner = best.id; t.level = 0; t.mortgaged = false;
    log(`${best.name} 拍卖购得「${t.name}」 -${bestBid}盖`); sfx('buy');
    playTileBuildFx(t.id, 'buy', '拍卖购得', best.color);
  } else log(`「${t.name}」拍卖流标，归银行`);
  render();
}
export function askHumanBid(t, minBid, maxCaps) {
  return new Promise(res => {
    const max = Math.max(0, maxCaps || 0);
    const maxText = max > 0 ? ` · 可出上限 ${max} 盖` : '';
    const defVal = max > 0 ? Math.min(minBid + 10, max) : minBid + 10;
    openModal(`<h2>拍卖 // ${t.name}</h2>
      <div style="font-size:12px;color:var(--dim)">参考价 ${Math.floor(t.price * 0.5)} 盖 · 当前最高 ${minBid} 盖${maxText}</div>
      <div style="margin-top:8px">你的出价 <input id="bid" type="number" value="${defVal}" style="width:80px"> 盖</div>
      <div id="modalActions" style="margin-top:10px"><button id="ok">出价</button><button class="alt" id="pass">放弃</button></div>`);
    document.getElementById('ok').onclick = () => { const v = Math.min(max, Math.max(0, +document.getElementById('bid').value || 0)); closeModal(); res(v); };
    document.getElementById('pass').onclick = () => { closeModal(); res(0); };
  });
}

export function aiUpgrade(p, t) {
  if (aiUpgradeCheck(p, t)) { upgrade(p, t); return true; }
  return false;
}
export function aiRaiseCash(p, need) {
  for (const cand of aiRaiseCashPlan(p, need)) mortgage(p, cand, true);
}

/** 玩家名下仍可升级（level < 2）的地产。任务的 upgrade 效果、bunkerFortify、
 *  aiBunker 三处此前各自内联同一份筛选，改条件必须同步三处。 */
function upgradeableProps(p) {
  return TILES.filter(t => t.type === 'prop' && t.owner === p.id && t.level < 2);
}

/** 随机挑一块可升级地产并免费强化；无可选时返回 null（不记日志，由调用方决定）。 */
function freeUpgradeRandom(p) {
  const c = upgradeableProps(p);
  if (!c.length) return null;
  const t = c[Math.floor(Math.random() * c.length)];
  upgrade(p, t, true);
  return t;
}

/** 他人持有且未抵押的可抢格（地产 / 哨站 / 设施）。blackMarketSteal 与
 *  aiBlackMarket 此前各存一份逐字相同的筛选。 */
function stealableTiles(p) {
  return TILES.filter(t => (t.type === 'prop' || t.type === 'rail' || t.type === 'util')
    && t.owner != null && t.owner !== p.id && !t.mortgaged);
}

export function applyMissionEffects(p, eff, mission, choice) {
  eff = eff || {};
  if (typeof eff.caps === 'number') {
    if (eff.caps >= 0) gain(p, eff.caps); else lose(p, -eff.caps);
  }
  if (eff.bonusHalf) { const g = Math.floor(p.caps * 0.5); if (g > 0) gain(p, g); }
  if (typeof eff.moral === 'number') {
    p.moral = (p.moral || 0) + eff.moral;
    log(`${p.name} 道德值 ${eff.moral > 0 ? '+' : ''}${eff.moral}（现 ${p.moral}）`);
  }
  if (eff.getOut) { p.getOut = (p.getOut || 0) + eff.getOut; log(`${p.name} 获得 ${eff.getOut} 张免罚通行证`); }
  // 事件奖励：直接发放指定道具卡
  if (eff.card) {
    if (giveCard(p, eff.card)) log(`🃏 ${p.name} 获得「${cardName(eff.card)}」`);
  }
  if (eff.skip) { p.skipNext = true; log(`${p.name} 下回合无法行动`); }
  if (eff.upgrade) {
    if (!freeUpgradeRandom(p)) log(`${p.name} 没有可强化的地产`);
  }
  if (eff.warp) warp(p);
  if (Array.isArray(eff.flags) && eff.flags.length) {
    const added = addPlayerFlags(p, eff.flags);
    if (added.length) log(`${p.name} 获得线索：${added.join('、')}`);
  }
  if (eff.rep && typeof eff.rep === 'object') {
    const parts = addFactionRep(p, eff.rep, FACTION_LABELS);
    if (parts.length) log(`${p.name} 派系声望 ${parts.join(' ')}`);
  }
  if (mission) markMissionDone(p, mission);
  if (mission && mission.deck === 'manual') tryGrantNukeKey(p, 'manual');
  if (choice && choice.result) log(`${p.name}：${choice.result}`);
}

export function aiMission(p, m) {
  const isStoryMode = G.mode === 'campaign' || G.mode === 'coop';
  const moralGoal = isStoryMode ? campaignMoralGoal(G.campaign) : 0;
  return aiMissionChoice(p, m, { campaign: isStoryMode, moralGoal });
}

export function warp(p) {
  // 「虫洞紊乱」突变：传送距离加倍
  const base = 1 + Math.floor(Math.random() * (TILES_COUNT - 1));
  const dest = (p.pos + Math.floor(base * (G.warpMult || 1))) % TILES_COUNT;
  p.pos = dest; placeToken(p, dest); setActiveTile(dest); landDust(p);
  log(`${p.name} 被卷入虫洞，传送到「${TILES[dest].name}」`);
  sfx('event'); screenShake(0.5); haptic('medium');
}
export function oasis(p) { gain(p, 25); sfx('good'); log(`${p.name} 在绿洲休整，补给 +25 盖`); }
export function bounty(p) {
  const alive = G.players.filter(x => !x.bankrupt);
  const richest = alive.reduce((a, b) => netWorth(b) > netWorth(a) ? b : a);
  if (richest.id === p.id) { gain(p, 100); log(`${p.name} 是头号通缉目标，领取赏金 +100 盖`); }
  else {
    const fee = Math.min(60, p.caps);
    p.caps -= fee; richest.caps += fee; sfx('rent');
    log(`${p.name} 被${richest.name}悬赏追猎，缴纳 ${fee} 盖`);
    if (p.caps < 0) bankrupt(p, richest);
  }
}
export function blackMarketSteal(p) {
  if (p.caps < STEAL_PRICE) { log(`${p.name} 瓶盖不足，偷袭失败`); return; }
  const pool = stealableTiles(p);
  if (!pool.length) { log(`${p.name} 黑市无隙可乘`); return; }
  const t = pool[Math.floor(Math.random() * pool.length)];
  p.caps -= STEAL_PRICE; t.owner = p.id; t.level = 0; sfx('buy');
  log(`${p.name} 黑市偷袭，抢下「${t.name}」(-${STEAL_PRICE}盖)`);
  tryGrantNukeKey(p, 'blackmarket_steal');
}
export function blackMarketCard(p) {
  if (Math.random() < 0.5) { p.getOut = (p.getOut || 0) + 1; log(`${p.name} 黑市搜出 1 张出狱卡`); }
  else log(`${p.name} 黑市一无所获`);
  tryGrantNukeKey(p, 'blackmarket_card');
}
/** 黑市淘卡：按 CARD_PRICE 盖随机获得一张道具卡（手牌满时拒收不扣费） */
export function blackMarketBuyCard(p) {
  if (p.caps < CARD_PRICE) { log(`${p.name} 瓶盖不足，淘卡失败`); return; }
  const id = randomCardId();
  p.cards = Array.isArray(p.cards) ? p.cards : [];
  if (p.cards.length >= HAND_LIMIT) { log(`🃏 ${p.name} 手牌已满（${HAND_LIMIT} 张），淘卡失败`); return; }
  p.caps -= CARD_PRICE;
  giveCard(p, id);
  sfx('buy');
  log(`${p.name} 在黑市淘到「${cardName(id)}」(-${CARD_PRICE}盖)`);
  tryGrantNukeKey(p, 'blackmarket_card');
}
export function aiBlackMarket(p) {
  const pool = stealableTiles(p);
  if (p.caps > 120 && pool.length && Math.random() < 0.7) blackMarketSteal(p);
  else if (p.caps > 250 && Math.random() < 0.3) blackMarketBuyCard(p);
  else if (Math.random() < 0.5) blackMarketCard(p);
}

/** AI 使用道具卡：在 AI 回合开始时调用，按简单阈值/概率决策 */
export function aiUseCards(p) {
  if (!Array.isArray(p.cards) || !p.cards.length) return;
  const alive = G.players.filter(x => x !== p && !x.bankrupt);
  if (!alive.length) return;
  const richest = alive.reduce((a, b) => (b.caps > a.caps ? b : a));
  const poorestSelf = p.caps <= Math.min(...alive.map(x => x.caps));
  for (const id of [...p.cards]) {
    if (!canUseCard(p, id)) continue;
    let use = false;
    switch (id) {
      case 'shield': use = p.caps < 300 && !(p.shield > 0); break;
      case 'plunder': use = richest.caps > 400; break;
      case 'demolish': use = Math.random() < 0.5; break;
      case 'march': case 'remote_dice': use = Math.random() < 0.3; break;
      case 'deed': use = true; break; // canUseCard 已限定脚下无主格
      case 'equalizer': use = poorestSelf; break;
      default: use = false; break; // pass 留作出狱（aiJailTurn 自会用 getOut）；swap/pardon AI 不主动用
    }
    if (!use) continue;
    removeCard(p, id);
    if (id === 'shield') applyShield(p);
    else if (id === 'plunder') applyPlunder(p);
    else if (id === 'march') applyMarch(p);
    else if (id === 'remote_dice') applyRemoteDice(p, 6 + Math.floor(Math.random() * 4));
    else if (id === 'deed') applyDeed(p);
    else if (id === 'equalizer') applyEqualizer(p);
    else if (id === 'demolish') {
      const targets = TILES.filter(t => t.type === 'prop' && t.owner != null && t.owner !== p.id && (t.level || 0) > 0);
      if (targets.length) applyDemolish(p, targets[Math.floor(Math.random() * targets.length)]);
    }
  }
}

/** 辐射矿坑开采费。此前扣费在 rules.js、按钮门槛与文案在 view-modal.js 各存一份字面量。 */
export const MINE_COST_DEEP = 80;
export const MINE_COST_SHALLOW = 40;
export function radiationMine(p, deep) {
  const cost = deep ? MINE_COST_DEEP : MINE_COST_SHALLOW;
  // 先确认付得起再扣费：此前「付不起也拿奖励」的漏洞（payCaps 破产清零后 p.caps>=0 恒真）
  if (p.caps < cost) { log(`${p.name} 瓶盖不足，放弃采矿`); sfx('bad'); return; }
  payCaps(p, cost, deep ? '辐射深采' : '辐射浅采');
  if (p.bankrupt) return;
  if (deep) {
    gain(p, 150);
    log(`${p.name} 深采辐射矿，高风险高回报`);
    tryGrantNukeKey(p, 'radiation_deep');
  } else {
    gain(p, 70);
    p.moral = (p.moral || 0) - 1;
    log(`${p.name} 道德值 -1（现 ${p.moral}）`);
    tryGrantNukeKey(p, 'radiation_shallow');
    log(`${p.name} 浅采辐射矿`);
  }
  sfx('bad');
  screenShake(0.6);
  haptic('medium');
}

export function aiRadiation(p) {
  if (p.caps >= 100) radiationMine(p, true);
  else if (p.caps >= 45) radiationMine(p, false);
  else log(`${p.name} 瓶盖不足，放弃采矿`);
}

export function bunkerRest(p) {
  gain(p, 35);
  p.moral = (p.moral || 0) + 1;
  log(`${p.name} 在掩体休整，道德值 +1（现 ${p.moral}）`);
  sfx('good');
}

export function bunkerFortify(p) {
  const fortified = freeUpgradeRandom(p);
  if (fortified) {
    log(`${p.name} 在掩体内免费加固「${fortified.name}」`);
  } else {
    gain(p, 20);
    log(`${p.name} 掩体应急补给 +20 盖`);
  }
  sfx('good');
}

export function aiBunker(p) {
  if (upgradeableProps(p).length && Math.random() < 0.55) bunkerFortify(p);
  else bunkerRest(p);
}
