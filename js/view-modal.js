// 弹窗：任务、黑市、胜利、章节叙事
import { render, log } from './view-core.js';
import { eventArtHtml, flashLightning, nukeArtHtml } from './assets-art.js';
import { applyMissionEffects, blackMarketSteal, blackMarketCard } from './rules.js';
import { afterHumanAction, humanActionUI, resolveTile } from './game.js';
import { canLaunchNuke, launchNuke } from './nuke.js';
import { G } from './state.js';
import { TILES } from './data.js';
import { sfx } from './audio.js';
import { flashScreen, screenShake, haptic, coinRain } from './fx.js';
import { playEventIntro, showChoiceResult, formatChoiceResult } from './fx-events.js';
import { ttsSpeak } from './tts.js';
import { missionSpeakText, chapterSpeakText } from './voice-lines.js';
import { escapeHtml } from './view-util.js';
import { getChapterIntro, getCampaignEnding } from './campaign.js';
import { isChainMission, isFactionMission, isNukeMission } from './missions.js';
import { radiationMine, bunkerRest, bunkerFortify, blackMarketBuyCard } from './rules.js';
import { cardDef, canUseCard, removeCard, HAND_LIMIT,
  applyPass, applyShield, applyPardon, applyPlunder, applyMarch, applyDeed,
  applyDemolish, applySwap, applyEqualizer, applyRemoteDice } from './cards.js';

let modal, modalBox, winEl;

export function initModalRefs() {
  modal = document.getElementById('modal');
  modalBox = document.getElementById('modalBox');
  winEl = document.getElementById('win');
}

export function openModal(html, opts) {
  const o = opts || {};
  modalBox.innerHTML = html; modal.style.display = 'flex';
  modal.classList.add('open');
  modalBox.classList.remove('in', 'flip', 'badEvt');
  void modalBox.offsetWidth;
  modalBox.classList.add(o.flip ? 'flip' : 'in');
  if (o.bad) modalBox.classList.add('badEvt');
}

export function closeModal() { modal.style.display = 'none'; }

export function showWin(name, sub) {
  const box = winEl ? winEl.querySelector('.box') : null;
  if (box) box.classList.remove('win-nuke');
  document.getElementById('winText').textContent = '🏆 ' + name + (sub ? ' · ' + sub : ' 称霸废土');
  winEl.style.display = 'flex';
  coinRain();
}

export function showNukeWin(name) {
  const box = winEl ? winEl.querySelector('.box') : null;
  if (box) box.classList.add('win-nuke');
  document.getElementById('winText').innerHTML =
    `<div class="nukeWinArt has-img">${nukeArtHtml('strike')}</div>` +
    `<div class="nukeWinTitle">${escapeHtml(name)}</div>` +
    `<div class="nukeWinSub">核平阿帕拉契亚 · 隐藏结局</div>`;
  winEl.style.display = 'flex';
  flashScreen('rgba(255,200,100,.35)');
  haptic('heavy');
}

/** 「超频骰」突变：掷骰后付费加步的选择弹窗 */
export function showSpeedDieChoice(caps, onPick) {
  const html = `<div class="deckTag" style="color:var(--tech)">⚡ 超频骰</div>
    <h2 style="color:var(--tech);text-align:center">向骰子注入能量</h2>
    <div class="evtText">消耗瓶盖为本次移动超频：+1 步或 +2 步。</div>
    <div id="modalActions" style="margin-top:14px">
      <button id="sd1" ${caps >= 30 ? '' : 'disabled'}>⚡ +1 步 (-30盖)</button>
      <button id="sd2" ${caps >= 60 ? '' : 'disabled'}>⚡⚡ +2 步 (-60盖)</button>
      <button class="alt" id="sd0">不用了</button>
    </div>`;
  openModal(html);
  haptic('light');
  const pick = n => { closeModal(); if (onPick) onPick(n); };
  document.getElementById('sd1').onclick = () => pick(1);
  document.getElementById('sd2').onclick = () => pick(2);
  document.getElementById('sd0').onclick = () => pick(0);
}

/** 发射确认弹窗（替代原生 confirm） */
export function showNukeLaunchConfirm(p, onCancel) {
  const html = `<div class="deckTag" style="color:#ff6b00">☢ 三井待发</div>
    <h2 style="color:#ff6b00;text-align:center">发射核弹</h2>
    <div class="evtArt has-img nukeLaunchArt" style="border-color:#ff6b00">${nukeArtHtml('launch')}</div>
    <div class="evtText">阿尔法、布拉沃、查理三井密钥已对齐，靶场锁定棋盘中央。发射后棋盘将被核平，<strong>无论当前战局输赢，你都将获得绝对胜利</strong>。</div>
    <div class="moralHint">⚠ 此操作不可撤销</div>
    <div id="modalActions" style="margin-top:14px">
      <button class="nuke" id="nukeGo">☢ 确认发射</button>
      <button class="alt" id="nukeWait">稍后决定</button>
    </div>`;
  openModal(html, { bad: true });
  screenShake(0.5);
  haptic('medium');
  document.getElementById('nukeGo').onclick = () => { closeModal(); void launchNuke(p); };
  document.getElementById('nukeWait').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };
}

/** 任务结算收尾：warp 效果与核弹确认互不阻塞（取消发射后 warp 仍要结算） */
function continueAfterMission(p, c) {
  if (G.gameOver) return;
  if (c.effects && c.effects.warp) {
    if (p.bankrupt) { afterHumanAction(p); return; }
    resolveTile(p, { afterWarp: true });
    return;
  }
  afterHumanAction(p);
}

export function showMission(m, p) {
  const col = m.bad ? 'var(--gang)' : 'var(--phos)';
  const chain = isChainMission(m);
  const tagLabel = isNukeMission(m) ? '☢ 机密频道' : isFactionMission(m) ? '⚑ 派系密使' : (chain ? '🔗 连锁任务' : escapeHtml(m.deckName));
  const choices = (m.choices || []).map((c, i) => `<button id='mc${i}'>${escapeHtml(c.text)}</button>`).join('');
  const html = `<div class='deckTag' style='color:${col}'>${tagLabel} · ${escapeHtml(m.deckTag || '')}</div>
    <h2 style='color:${col};text-align:center'>${escapeHtml(m.title)}</h2>
    <div class='evtArt has-img art-${escapeHtml(m.art || 'caps')}' style='color:${col};border-color:${col}'>${eventArtHtml(m)}</div>
    <div class='evtText'>${escapeHtml(m.story)}</div>
    ${m.moral ? `<div class='moralHint'>⚖ ${escapeHtml(m.moral)}</div>` : ''}
    <div id='modalActions' style='margin-top:14px'>${choices}</div>`;
  openModal(html, { flip: true, bad: m.bad });
  playEventIntro(modalBox, m);
  if (m.bad) { flashLightning(); flashScreen(); screenShake(.8); haptic('heavy'); }
  else haptic('medium');
  ttsSpeak(missionSpeakText(m));
  (m.choices || []).forEach((c, i) => {
    const el = document.getElementById('mc' + i);
    if (el) el.onclick = async () => {
      // 防连点：结算动画窗口内禁用全部选项，避免二次结算/重复推进回合
      (m.choices || []).forEach((_, j) => {
        const b = document.getElementById('mc' + j);
        if (b) b.disabled = true;
      });
      const summary = formatChoiceResult(c.effects);
      await showChoiceResult(modalBox, summary, m.bad, null);
      closeModal();
      // 坏事件有闪屏/震动特效，稍作等待避免 modal 与 render() 在同一帧内切换造成闪屏
      if (m.bad) await new Promise(r => setTimeout(r, 120));
      applyMissionEffects(p, c.effects, m, c);
      sfx(m.bad ? 'bad' : 'good');
      render();
      if (canLaunchNuke(p)) {
        showNukeLaunchConfirm(p, () => continueAfterMission(p, c));
        return;
      }
      continueAfterMission(p, c);
    };
  });
}

/** 目标选择列表弹窗（拆迁令 / 换地卡等二级选择用） */
function openTargetList(p, title, items, label, onPick) {
  const rows = items.map((t, i) =>
    `<div class="row" style="justify-content:space-between;gap:8px"><span style="font-size:12px">${label(t)}</span><button id="tg${i}">选择</button></div>`
  ).join('');
  const html = `<div class="deckTag" style="color:var(--tech)">🎯 选择目标</div>
    <h2 style="color:var(--tech);text-align:center">${title}</h2>
    <div style="max-height:44vh;overflow:auto">${rows}</div>
    <div id="modalActions" style="margin-top:14px"><button class="alt" id="tgBack">返回手牌</button></div>`;
  openModal(html);
  items.forEach((t, i) => {
    const el = document.getElementById('tg' + i);
    if (el) el.onclick = () => onPick(t);
  });
  const back = document.getElementById('tgBack');
  if (back) back.onclick = () => showHand(p);
}

/** 手牌弹窗：展示并使用道具卡（不消耗回合） */
export function showHand(p) {
  const cards = Array.isArray(p.cards) ? p.cards : [];
  const rows = cards.map((id, i) => {
    const c = cardDef(id);
    if (!c) return '';
    const usable = canUseCard(p, id);
    return `<div class="row" style="justify-content:flex-start;gap:8px;border-bottom:1px dotted #1d2426;padding:5px 0">
      <span style="font-size:20px;flex:0 0 auto">${c.icon}</span>
      <span style="flex:1 1 auto;min-width:0;font-size:12px;line-height:1.4"><b style="color:var(--amber)">${c.name}</b><br><span style="color:#9fb0a6">${c.desc}</span></span>
      <button id="uc${i}" ${usable ? '' : 'disabled'} style="flex:0 0 auto">使用</button></div>`;
  }).join('');
  const html = `<div class="deckTag" style="color:var(--tech)">🎒 道具</div>
    <h2 style="color:var(--tech);text-align:center">手牌（${cards.length}/${HAND_LIMIT}）</h2>
    <div>${rows || '<div class="evtText">手牌空空如也</div>'}</div>
    <div class="moralHint">卡在自己回合内使用，不消耗回合</div>
    <div id="modalActions" style="margin-top:14px"><button class="alt" id="hdClose">关闭</button></div>`;
  openModal(html);
  haptic('light');
  document.getElementById('hdClose').onclick = () => closeModal();
  cards.forEach((id, i) => {
    const el = document.getElementById('uc' + i);
    if (el) el.onclick = () => useHandCard(p, id);
  });
}

/** 使用一张手牌：无目标卡直接生效；目标卡进入二级选择 */
function useHandCard(p, id) {
  // 用卡后按阶段恢复操作条：掷骰前回到掷骰条，掷骰后回到资产条
  const finish = () => { render(); humanActionUI(p); };
  const consumeAnd = (fn) => { removeCard(p, id); if (fn() !== false) { sfx('good'); } finish(); };
  switch (id) {
    case 'demolish': {
      const targets = TILES.filter(t => t.type === 'prop' && t.owner != null && t.owner !== p.id && (t.level || 0) > 0);
      openTargetList(p, '拆除谁的地块？', targets,
        t => `💣 ${t.name}（Lv${t.level} · ${G.players[t.owner] ? G.players[t.owner].name : '?'}）`,
        t => { removeCard(p, id); if (applyDemolish(p, t) !== false) { sfx('good'); screenShake(0.6); } finish(); });
      return;
    }
    case 'swap': {
      const theirTiles = TILES.filter(t => t.type === 'prop' && t.owner != null && t.owner !== p.id);
      openTargetList(p, '换取谁的地块？', theirTiles,
        t => `🔄 ${t.name}（Lv${t.level || 0} · ${G.players[t.owner] ? G.players[t.owner].name : '?'}）`,
        theirTile => {
          const myTiles = TILES.filter(t => t.type === 'prop' && t.owner === p.id);
          openTargetList(p, '用你哪块地交换？', myTiles,
            t => `🔄 ${t.name}（Lv${t.level || 0}）`,
            myTile => {
              removeCard(p, id);
              if (applySwap(p, myTile, theirTile) !== false) { sfx('good'); }
              finish();
            });
        });
      return;
    }
    case 'remote_dice': {
      const sums = [];
      for (let s = 2; s <= 12; s++) sums.push(s);
      const btns = sums.map(s => `<button id="ds${s}" style="min-width:44px">${s}</button>`).join('');
      openModal(`<div class="deckTag" style="color:var(--tech)">🎲 遥控骰</div>
        <h2 style="color:var(--tech);text-align:center">锁定下一次点数</h2>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px">${btns}</div>
        <div id="modalActions" style="margin-top:14px"><button class="alt" id="dsBack">返回手牌</button></div>`);
      sums.forEach(s => {
        const el = document.getElementById('ds' + s);
        if (el) el.onclick = () => { removeCard(p, id); applyRemoteDice(p, s); sfx('good'); finish(); };
      });
      const back = document.getElementById('dsBack');
      if (back) back.onclick = () => showHand(p);
      return;
    }
    case 'pass': consumeAnd(() => applyPass(p)); return;
    case 'march': consumeAnd(() => applyMarch(p)); return;
    case 'shield': consumeAnd(() => applyShield(p)); return;
    case 'pardon': consumeAnd(() => applyPardon(p)); return;
    case 'plunder': consumeAnd(() => applyPlunder(p)); return;
    case 'deed': consumeAnd(() => applyDeed(p)); return;
    case 'equalizer': consumeAnd(() => applyEqualizer(p)); return;
    default: finish();
  }
}

export function showBlackMarket(p) {
  const canSteal = p.caps >= 80;
  const hand = Array.isArray(p.cards) ? p.cards : [];
  const canCard = p.caps >= 120 && hand.length < HAND_LIMIT;
  const html = `<h2 style='color:var(--amber);text-align:center'>⚑ 黑市交易</h2>
    <div class='evtText'>你溜进黑市，能捞点什么？</div>
    <div id='modalActions' style='margin-top:14px'>
      <button id='bmSteal' ${canSteal ? '' : 'disabled'}>偷袭 (-80盖，抢对手一块地)</button>
      <button id='bmBuyCard' ${canCard ? '' : 'disabled'}>🃏 淘卡 (-120盖${hand.length >= HAND_LIMIT ? '，手牌已满' : ''})</button>
      <button class='alt' id='bmCard'>搜刮 (免费，50%得通行证)</button>
      <button class='alt' id='bmLeave'>离开</button>
    </div>`;
  openModal(html);
  haptic('medium');
  document.getElementById('bmSteal').onclick = () => {
    closeModal(); blackMarketSteal(p); render();
    if (canLaunchNuke(p)) showNukeLaunchConfirm(p, () => afterHumanAction(p));
    else afterHumanAction(p);
  };
  document.getElementById('bmBuyCard').onclick = () => {
    closeModal(); blackMarketBuyCard(p); render();
    if (canLaunchNuke(p)) showNukeLaunchConfirm(p, () => afterHumanAction(p));
    else afterHumanAction(p);
  };
  document.getElementById('bmCard').onclick = () => {
    closeModal(); blackMarketCard(p); render();
    if (canLaunchNuke(p)) showNukeLaunchConfirm(p, () => afterHumanAction(p));
    else afterHumanAction(p);
  };
  document.getElementById('bmLeave').onclick = () => { closeModal(); afterHumanAction(p); };
}

export function showRadiation(p) {
  const canDeep = p.caps >= 80;
  const canShallow = p.caps >= 40;
  const tileName = (TILES[p.pos] && TILES[p.pos].name) || '莫诺加矿洞';
  const html = `<h2 style='color:#b8d84a;text-align:center'>☢ ${escapeHtml(tileName)}</h2>
    <div class='evtText'>盖革计数器狂响。深采回报高，浅采省成本但会污染声誉。</div>
    <div id='modalActions' style='margin-top:14px'>
      <button id='radDeep' ${canDeep ? '' : 'disabled'}>深采 (-80盖，+150盖)</button>
      <button class='alt' id='radShallow' ${canShallow ? '' : 'disabled'}>浅采 (-40盖，+70盖，道德-1)</button>
      <button class='alt' id='radLeave'>离开</button>
    </div>`;
  openModal(html);
  haptic('medium');
  document.getElementById('radDeep').onclick = () => {
    closeModal(); radiationMine(p, true); render();
    if (canLaunchNuke(p)) showNukeLaunchConfirm(p, () => afterHumanAction(p));
    else afterHumanAction(p);
  };
  document.getElementById('radShallow').onclick = () => {
    closeModal(); radiationMine(p, false); render();
    if (canLaunchNuke(p)) showNukeLaunchConfirm(p, () => afterHumanAction(p));
    else afterHumanAction(p);
  };
  document.getElementById('radLeave').onclick = () => { closeModal(); afterHumanAction(p); };
}

export function showBunker(p) {
  const canFort = TILES.some(t => t.type === 'prop' && t.owner === p.id && t.level < 2);
  const tileName = (TILES[p.pos] && TILES[p.pos].name) || '国会掩体';
  const html = `<h2 style='color:#9aa3ad;text-align:center'>⛟ ${escapeHtml(tileName)}</h2>
    <div class='evtText'>厚门后是无菌空气。休整恢复士气，或就地加固一处地产。</div>
    <div id='modalActions' style='margin-top:14px'>
      <button id='bkRest'>休整 (+35盖，道德+1)</button>
      <button class='alt' id='bkFort' ${canFort ? '' : 'disabled'}>掩体加固 (免费强化一处地产)</button>
      <button class='alt' id='bkLeave'>离开</button>
    </div>`;
  openModal(html);
  haptic('medium');
  document.getElementById('bkRest').onclick = () => { closeModal(); bunkerRest(p); render(); afterHumanAction(p); };
  document.getElementById('bkFort').onclick = () => { closeModal(); bunkerFortify(p); render(); afterHumanAction(p); };
  document.getElementById('bkLeave').onclick = () => { closeModal(); afterHumanAction(p); };
}

export function showChapterIntro(chapterIdx, onContinue, moral) {
  const intro = getChapterIntro(chapterIdx, moral != null ? moral : 0);
  if (!intro) { if (onContinue) onContinue(); return; }
  const html = `<div class="deckTag" style="color:var(--amber)">📖 章节叙事</div>
    <h2 style="color:var(--amber);text-align:center">${escapeHtml(intro.title)}</h2>
    <div class="evtArt" style="color:var(--amber);border-color:var(--amber)">${intro.art || ''}</div>
    <div class="evtText campIntro">${escapeHtml(intro.story)}</div>
    <div id="modalActions" style="margin-top:14px"><button id="chGo">继续</button></div>`;
  openModal(html, { flip: true });
  ttsSpeak(chapterSpeakText(intro));
  document.getElementById('chGo').onclick = () => { closeModal(); if (onContinue) onContinue(); };
}

export function showCampaignEnding(p) {
  const ending = getCampaignEnding(p.moral || 0);
  showWin(p.name, ending.subtitle);
  log(ending.log, true);
}

export function hideWin() { if (winEl) winEl.style.display = 'none'; }
