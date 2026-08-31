// 回合流程与游戏编排
import { G, resetSession } from './state.js';
import { TILES, positions, ALERTS, INTEL, FACTIONS, RUINS, shuffleBoard, resetTiles } from './data.js';
import { TILES_COUNT, JAIL_FEE, COLORS, SHORT, GAME_TITLE, MAX_TURNS, MAX_TURNS_CAMPAIGN } from './config.js';
import {
  render, showMission, buildTokens, log, setDice, placeToken,
  setActionsHTML, showSetupScreen, showBlackMarket, getSlotAvatars, WASTELAND_EMOJI,
  showChapterIntro, showCampaignEnding, showWin, showNukeLaunchConfirm, renderManage, showSpeedDieChoice, showHand,
  showRadiation, showBunker, setActiveTile, renderPlayers, fitBoard, repositionAllTokens
} from './view.js';
import {
  buy, upgrade, payRent, payCaps, auction, canUpgrade, aiShouldBuy, aiUpgrade, netWorth, enterJail,
  oasis, bounty, warp, aiBlackMarket, aiMission, applyMissionEffects, aiRadiation, aiBunker, aiUseCards
} from './rules.js';
import { CAMPAIGNS, evaluateCampaign, campaignCount, campaignDecayPerTurn } from './campaign.js';
import { applyDifficulty, getDifficultyPreset } from './difficulty.js';
import { pickMission, isChainMission, isFactionMission, isNukeMission } from './missions.js';
import { sfx, NUKE_LAUNCH_SFX_MS } from './audio.js';
import { rollDice3D, hopToken, landDust, haptic, screenShake, footprint } from './fx.js';
import { playTileLandFx } from './fx-events.js';
// playNukeCutscene / playNukeStrike 已随 launchNuke 迁至 nuke.js
import { applyLegacyToGame, getLegacyMeta, recordRun } from './legacy.js';
import { rollMutators, applyMutators, resetMutatorFields } from './mutators.js';
import { getNarrativeSeed, applyNarrativeStart, formatNarrativeIntro } from './narrative.js';
import { setTtsEnabled, setTtsRate, unlockTts, cancelTts, preloadTTS, setVoiceSource, setStepApiKey, setStepVoice, setStepInstruction } from './tts.js';
import { canLaunchNuke, tryNukeKeyFromChipFactory, launchNuke } from './nuke.js';
import { narrativeSpeakText, chapterClearSpeakText, GAMEOVER_LINES } from './voice-lines.js';
import { giveCard, randomCardId, applyForcedRoll } from './cards.js';

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function roll() { return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]; }

// 「超频骰」突变：AI 自动决策（现金充裕时 40% 概率加步）
function aiSpeedDie(p) {
  return (p.caps > 300 && Math.random() < 0.4) ? (Math.random() < 0.5 ? 1 : 2) : 0;
}
// 「超频骰」突变：人类弹窗选择；无交互环境（node 测试）自动跳过
function askSpeedDie(p) {
  return new Promise(res => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') { res(0); return; }
    showSpeedDieChoice(p.caps, n => res(n));
  });
}

// 回合链守卫：对局结束、或「再来一局」重建玩家后，旧局遗留的异步链必须立即中止。
// 另用 turnAt 绑定每条链启动时的回合号：若链恢复时 G.turn 已推进（僵尸链），
// 一律忽略，防止重复结算/重复推进回合导致的并发交错与卡死。
function aliveInGame(p) {
  return !G.gameOver && G.players.indexOf(p) !== -1;
}
function isCurrentTurn(turnAt) {
  return turnAt === undefined || turnAt === G.turn;
}

async function animateDice(a, b) {
  setDice('掷骰中…');
  // UI 面板骰子动画始终播放
  const uiDice = rollDice3D(a, b);
  for (let i = 0; i < 4; i++) { sfx('roll'); await sleep(150); }
  await uiDice;
  sfx('roll');
  setDice(`${a} + ${b} = ${a + b}`);
}
async function moveTokenAnim(p, steps) {
  const old = p.pos;
  // 缓存棋盘格尺寸，避免每步都触发 getComputedStyle 强制重排
  const metrics = typeof getCellMetrics === 'function' ? getCellMetrics() : null;
  for (let i = 1; i <= steps; i++) {
    const from = p.pos;
    p.pos = (old + i) % TILES_COUNT;
    leanToken(p, from, p.pos);
    footprint(p, from);
    if (typeof placeToken === 'function') {
      if (metrics) placeToken(p, p.pos, metrics);
      else placeToken(p, p.pos);
    }
    setActiveTile(p.pos);
    // DOM 更新完成后再触发弹跳与音效，减少主线程压力
    // 后台页签 / 后台 WebView 会把 rAF 节流到 0，必须加超时兜底，否则回合链会冻结
    await new Promise(resolve => {
      let done = false;
      const fin = () => { if (done) return; done = true; hopToken(p); sfx('tick'); resolve(); };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(fin);
        setTimeout(fin, 120);
      } else {
        fin();
      }
    });
    await sleep(150);
  }
  settleTokenLean(p);
  landDust(p);
  if (old + steps >= TILES_COUNT) {
    const salary = Math.floor(G.SALARY * (G.SALARY_MULT || 1));
    p.caps += salary; sfx('good');
    log(`${p.name} 经过据点，补给 +${salary} 瓶盖`, true);
    renderPlayers();
  }
}

/* 2.5D 移动倾斜：按格子位移方向给 token 写 --leanZ/--leanX（CSS 组合进 transform） */
function leanToken(p, fromIdx, toIdx) {
  if (!p.tokenEl || !p.tokenEl.style || typeof p.tokenEl.style.setProperty !== 'function') return;
  if (!positions[fromIdx] || !positions[toIdx]) return;
  const [r0, c0] = positions[fromIdx], [r1, c1] = positions[toIdx];
  p.tokenEl.style.setProperty('--leanZ', Math.max(-10, Math.min(10, (c1 - c0) * 6)) + 'deg');
  p.tokenEl.style.setProperty('--leanX', Math.max(-8, Math.min(8, (r1 - r0) * 4)) + 'deg');
}
function settleTokenLean(p) {
  if (!p.tokenEl || !p.tokenEl.style || typeof p.tokenEl.style.setProperty !== 'function') return;
  p.tokenEl.style.setProperty('--leanZ', '0deg');
  p.tokenEl.style.setProperty('--leanX', '0deg');
}
async function humanRoll(p) {
  if (!G.awaitingRoll) return; G.awaitingRoll = false;
  let { a, b } = applyForcedRoll(...roll()); await animateDice(a, b); G.lastRoll = a + b;
  log(`${p.name} 掷出 ${a + b}${a === b ? ' (双数)' : ''}`);
  await handleAfterRoll(p, a, b, false, G.turn);
}
async function aiRoll(p) {
  const turnAt = G.turn;
  await sleep(400);
  if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
  let { a, b } = applyForcedRoll(...roll()); await animateDice(a, b); G.lastRoll = a + b;
  log(`${p.name} 🤖 掷出 ${a + b}${a === b ? ' (双数)' : ''}`); await sleep(150);
  if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
  await handleAfterRoll(p, a, b, true, turnAt);
}
async function handleAfterRoll(p, a, b, isAI, turnAt) {
  // 僵尸链防护：回合已推进或对局已结束 → 立即中止，不改变任何游戏状态
  if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
  if (a === b) p.doubles = (p.doubles || 0) + 1; else p.doubles = 0;
  if (p.doubles >= 3) { enterJail(p); log(`${p.name} 连续三次双数，被关进隔离区！`); sfx('bad'); await sleep(500); if (aliveInGame(p) && isCurrentTurn(turnAt)) endTurn(turnAt); return; }
  const gotDouble = a === b && !p.inJail && !p.bankrupt;
  if (gotDouble) p.extraRoll = true;
  let steps = a + b;
  // 「幸运开局」突变：本局首次掷骰额外前进
  if (G.luckyDice && !p.luckyUsed) {
    steps += G.luckyDice; p.luckyUsed = true;
    log(`🎲 幸运开局：${p.name} 首次掷骰额外 +${G.luckyDice} 步`);
  }
  // 「超频骰」突变：付盖加步（人类弹窗选择，AI 自动决策）
  if (G.speedDie && !p.inJail && !p.bankrupt) {
    const extra = isAI ? aiSpeedDie(p) : await askSpeedDie(p);
    if (extra > 0 && p.caps >= 30 * extra) {
      p.caps -= 30 * extra; steps += extra;
      log(`⚡ 超频骰：${p.name} +${extra} 步（-${30 * extra} 盖）`);
    }
  }
  // 「绝境狂奔」突变：现金告急者跑得更快
  if (G.brokeRush && p.caps < 200) {
    steps += 3;
    log(`🏃 绝境狂奔：${p.name} 现金告急，掷骰 +3 步`);
  }
  // 道具卡「急行军」：本回合掷骰额外步数
  if (p.marchBonus) {
    steps += p.marchBonus;
    log(`🏃 急行军：额外 +${p.marchBonus} 步`);
    p.marchBonus = 0;
  }
  await moveTokenAnim(p, steps);
  if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
  const turnEnded = await resolveTile(p, { turnAt });   // 隔离区等分支会在内部结束回合，避免重复 endTurn
  if (G.gameOver || turnEnded) return;
  if (canLaunchNuke(p)) {
    if (isAI) { await launchNuke(p); return; }
    return;
  }
  if (gotDouble && !p.bankrupt && isAI) {
    p.extraRoll = false;
    await sleep(400);
    if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
    await aiRoll(p);
    return;
  }
  // 破产的 AI 也要推进回合：endTurn() 内部会跳过破产玩家并判定胜负，否则游戏会永久卡死
  if (isAI) endTurn(turnAt);
}

// 回合流程必须串行执行（单链），否则多条异步链并发推进回合会导致交错与卡死。
// takeTurn 为 async：AI 回合 / 监狱回合 / 跳过回合全部 await，保证同一时刻只有一条回合链在推进。
export async function takeTurn() {
  if (G.gameOver) return;
  const p = G.players[G.current];
  const turnAt = G.turn;
  p.extraRoll = false;
  if (p.bankrupt) { nextPlayer(); return; }
  // 每回合突变效果：和平主义补贴 / 道德困境流失
  if (G.pacifist) { p.caps += 20; log(`☮ 和平主义：${p.name} 获得 +20 盖补给`); }
  if (G.moralDrain) { p.moral = (p.moral || 0) - G.moralDrain; log(`😈 道德困境：${p.name} 道德值 -${G.moralDrain}（现 ${p.moral}）`); }
  // 「废土银行」突变：现金利息（上限 +50 盖）
  if (G.bankInterest) {
    const int = Math.min(50, Math.floor((p.caps || 0) * 0.05));
    if (int > 0) { p.caps += int; log(`🏦 废土银行：${p.name} 获得利息 +${int} 盖`); }
  }
  // 「地产维护费」突变：每块地每回合 -5 盖（可能直接压破产）
  if (G.landTax) {
    const n = TILES.filter(t => (t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner === p.id).length;
    if (n > 0) { log(`🏚 地产维护费：${p.name} ${n} 块地`); payCaps(p, n * G.landTax, '地产维护费'); }
    if (p.bankrupt) { nextPlayer(); return; }
  }
  if (p.inJail) {
    if (p.isAI) await aiJailTurn(p, turnAt);
    else startJailTurn(p);
    return;
  }
  if (p.skipNext) { p.skipNext = false; log(`${p.name} 因事件影响，跳过本回合`); render(); await sleep(600); if (aliveInGame(p) && isCurrentTurn(turnAt)) nextPlayer(); return; }
  if (p.isAI && canLaunchNuke(p)) { await launchNuke(p); return; }
  // AI 使用道具卡（护盾/掠夺/拆迁/超频等，在掷骰前结算）
  if (p.isAI) aiUseCards(p);
  if (p.isAI) { await aiRoll(p); }
  else {
    G.turnPlayer = p; G.awaitingRoll = true;
    humanActionUI(p);
  }
}

/** 手牌按钮 HTML（有手牌才显示） */
function handBtnHtml(p) {
  return (Array.isArray(p.cards) && p.cards.length)
    ? `<button class="alt" id="handBtn">🎒 道具(${p.cards.length})</button>` : '';
}
function wireHandBtn(p) {
  const hb = document.getElementById('handBtn');
  if (hb) hb.onclick = () => showHand(p);
}

/** 人类回合操作条统一入口：掷骰前显示掷骰条，掷骰后显示资产/道具/结束条 */
export function humanActionUI(p) {
  G.turnPlayer = p;
  if (G.awaitingRoll) {
    setActionsHTML('<button id="rollBtn">🎲 掷骰</button>' + handBtnHtml(p) + nukeBtnHtml(p));
    document.getElementById('rollBtn').onclick = () => humanRoll(p);
    wireHandBtn(p);
    wireNukeBtn(p);
    return;
  }
  afterHumanAction(p);
}

export function startGame() {
  // 用户点击「启动」→ 立即解锁音频通道，避免 Android WebView 首音静音
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    // 播放极短测试音，触发 WebView 音频通道
    const t = ac.currentTime || 0;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 800;
    o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.start(t); o.stop(t + 0.05);
  } catch (_) { /* ignore */ }
  // 语音播报设置（点击「启动」本身即用户手势，可在此解锁语音）
  const ttsOn = document.getElementById('ttsOn') ? document.getElementById('ttsOn').value === 'on' : true;
  const ttsRate = document.getElementById('ttsRate') ? document.getElementById('ttsRate').value : '1.05';
  const ttsSrc = document.getElementById('ttsSrc') ? document.getElementById('ttsSrc').value : 'auto';
  setVoiceSource(ttsSrc);
  const keyIn = document.getElementById('stepApiKey');
  if (keyIn) setStepApiKey(keyIn.value.trim());
  const voiceSel = document.getElementById('stepVoice');
  if (voiceSel) setStepVoice(voiceSel.value);
  const instrIn = document.getElementById('stepInstruction');
  if (instrIn) setStepInstruction(instrIn.value.trim());
  setTtsEnabled(ttsOn); setTtsRate(ttsRate); cancelTts();
  if (ttsOn) {
    unlockTts();
    preloadTTS();
  }

  // 随机棋盘：每局开局重排格子位置（保持「据点」起点固定）
  const randomBoard = document.getElementById('randBoard') ? document.getElementById('randBoard').value === 'on' : true;
  resetSession();
  if (randomBoard) shuffleBoard();
  else resetTiles();

  const diffSel = document.getElementById('difficulty');
  const diffId = diffSel ? diffSel.value : 'standard';
  const diffPreset = applyDifficulty(G, diffId);

  G.STARTCAPS = +document.getElementById('startCaps').value || diffPreset.startCaps;
  G.SALARY = +document.getElementById('salary').value || diffPreset.salary;
  G.targetWealth = +document.getElementById('target').value || diffPreset.targetWealth;
  G.mode = document.getElementById('mode') ? document.getElementById('mode').value : 'versus';
  const slotAvatars = getSlotAvatars();
  // 清空旧战报，随后叙事/突变日志才能正确显示
  const logEl = document.getElementById('log'); if (logEl) logEl.innerHTML = '';

  // 遗产模式：先应用遗产加成 + 叙事传承 + 突变因子（写入 STARTCAPS/START_MORAL 等全局量），
  // 再据此创建玩家，保证各项加成真正生效
  if (G.mode === 'legacy') {
    applyLegacyToGame(G);
    const meta = getLegacyMeta();
    if (meta.lastEndKind) {
      const seed = getNarrativeSeed(meta.lastEndKind, meta.lastMoral);
      applyNarrativeStart(G, seed);
      if (seed.intro) log(narrativeSpeakText(seed), true);
    }
    const unlockedMuts = meta.unlockedMutators.length > 0 ? meta.unlockedMutators : null;
    let mutators = rollMutators(3, unlockedMuts);
    // 「每日重抽」遗产加成：开局可确认重抽突变因子
    let rerolls = G.MUTATOR_REROLL || 0;
    while (rerolls > 0 && mutators.length
      && !confirm('本局突变因子：\n' + mutators.map(m => `${m.icon} ${m.name} — ${m.desc}`).join('\n')
        + `\n\n是否重抽？（剩余 ${rerolls} 次）`)) {
      rerolls--;
      mutators = rollMutators(3, unlockedMuts);
    }
    resetMutatorFields(G);
    applyMutators(G, mutators);
    if (mutators.length) {
      log('☢ 突变因子：' + mutators.map(m => `${m.icon} ${m.name}`).join(' · '), true);
    }
  }

  G.players = [];
  for (let i = 0; i < 4; i++) {
    const v = document.getElementById('slot' + i).value;
    if (v === 'off') continue;
    const nameVal = (document.getElementById('name' + i).value || '').trim();
    // 未选头像则系统随机选一个，保证每个幸存者都有头像
    const av = slotAvatars[i] || WASTELAND_EMOJI[Math.floor(Math.random() * WASTELAND_EMOJI.length)];
    // 「命运中断」叙事种子：初始瓶盖随机波动 ±15%
    const variance = G.randomStart ? (0.85 + Math.random() * 0.3) : 1;
    const startCaps = Math.max(100, Math.floor(G.STARTCAPS * variance));
    const rep = { eagle: 0, survivor: 0, tech: 0 };
    // 「暴君余波」等种子：人类玩家的初始派系声望受罚
    if (v !== 'ai' && G.startRepPenalty) {
      for (const k of Object.keys(rep)) if (G.startRepPenalty[k]) rep[k] += G.startRepPenalty[k];
    }
    G.players.push({
      id: G.players.length, name: nameVal || ('玩家' + SHORT[i]), short: SHORT[i], isAI: v === 'ai',
      color: COLORS[i], caps: startCaps, pos: 0, skipNext: false, bankrupt: false,
      inJail: false, jailTurns: 0, getOut: G.START_GETOUT || 0, doubles: 0, tokenEl: null,
      moral: G.START_MORAL || 0, rollsTaken: 0, luckyUsed: false,
      avatar: av, flags: [], missionDone: [],
      cards: [], shield: 0, marchBonus: 0,
      factionRep: rep
    });
    // 遗产遗物「起始手牌」：开局随机获得道具卡
    if (G.START_CARDS) giveCard(G.players[G.players.length - 1], randomCardId());
  }
  if (G.mode === 'survival') {
    // 生存模式：仅 1 名人类，无 AI 对手
    if (G.players.length !== 1 || G.players[0].isAI) { alert('生存模式需要恰好 1 名人类玩家（无 AI）'); return; }
  } else {
    if (G.players.length < 2) { alert('至少需要 2 名幸存者'); return; }
  }
  if (G.mode === 'campaign' && !G.players.some(p => !p.isAI)) { alert('单人闯关需要至少 1 名人类玩家'); return; }
  if (G.mode === 'coop') {
    const humans = G.players.filter(p => !p.isAI);
    const ais = G.players.filter(p => p.isAI);
    if (humans.length !== 1 || ais.length !== 1) { alert('合作闯关需要恰好 1 名人类 + 1 名 AI'); return; }
  }
  if (G.mode === 'legacy') {
    // 遗产模式：1 人类 + 1-2 AI
    const humans = G.players.filter(p => !p.isAI);
    if (humans.length !== 1) { alert('遗产模式需要恰好 1 名人类玩家'); return; }
  }
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('win').style.display = 'none';
  buildTokens();

  // 地产价格类突变（泡沫/抄底）：开局一次性缩放价格
  // resetTiles 每局会把价格还原为基础价，不会跨局复利
  if (G.priceMult && G.priceMult !== 1) {
    TILES.forEach(t => {
      if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
        t.price = Math.max(20, Math.floor(t.price * G.priceMult));
      }
    });
    log(`💰 地产价格 ×${G.priceMult.toFixed(1)}`, true);
  }

  log(`${GAME_TITLE} 启动，幸存者已就位。` + (G.mode === 'campaign' || G.mode === 'coop' ? ` 进入${CAMPAIGNS[0].name}。` : (G.targetWealth > 0 ? ` 目标净身家 ${G.targetWealth} 盖。` : ''))
    + ` 难度：${getDifficultyPreset(G.difficulty).label}。`, true);
  render();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { fitBoard(); repositionAllTokens(); });
  }
  if (G.mode === 'campaign' || G.mode === 'coop') {
    showChapterIntro(0, () => takeTurn(), 0);
  } else takeTurn();
}

// ---------- 隔离区 ----------
function startJailTurn(p) {
  if (p.isAI) { aiJailTurn(p, G.turn); return; }
  G.turnPlayer = p; G.awaitingRoll = false;
  let h = `<div style="font-size:12px;color:var(--dim)">⛓ 隔离区 · 第 ${p.jailTurns + 1} 回合</div>`;
  if (p.getOut > 0) h += `<button id="jb1">用出狱卡(${p.getOut})</button>`;
  h += `<button id="jb2">付 ${JAIL_FEE} 盖保释</button><button class="alt" id="jb3">掷骰逃出</button>`;
  setActionsHTML(h);
  if (p.getOut > 0) document.getElementById('jb1').onclick = () => { p.getOut--; leaveJail(p); };
  document.getElementById('jb2').onclick = () => { if (p.caps >= JAIL_FEE) { p.caps -= JAIL_FEE; leaveJail(p); } else alert('瓶盖不足'); };
  document.getElementById('jb3').onclick = () => jailRoll(p);
}
async function jailRoll(p) {
  const turnAt = G.turn;
  const [a, b] = roll(); await animateDice(a, b); G.lastRoll = a + b;
  if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
  log(`${p.name} 隔离区掷出 ${a + b}`);
  if (a === b) {
    log(`${p.name} 掷出双数，成功逃出隔离区！`);
    p.inJail = false; p.jailTurns = 0; p.doubles = 0; render(); sfx('good');
    // 经典规则：双数出狱后按点数前进并结算落地格
    await moveTokenAnim(p, a + b);
    if (!aliveInGame(p) || !isCurrentTurn(turnAt)) return;
    const turnEnded = await resolveTile(p, { turnAt });
    if (G.gameOver || turnEnded) return;
    if (p.isAI) endTurn(turnAt);
    return;
  }
  p.jailTurns++;
  if (p.jailTurns >= 3) { log(' 关满3回合，强制离开'); leaveJail(p, turnAt); return; }
  if (p.isAI) { await sleep(400); if (aliveInGame(p) && isCurrentTurn(turnAt)) await aiJailTurn(p, turnAt); }
  else { startJailTurn(p); }
}
async function aiJailTurn(p, turnAt) {
  if (p.getOut > 0) { p.getOut--; leaveJail(p, turnAt); return; }
  if (p.jailTurns >= 1 && p.caps > JAIL_FEE * 2) { p.caps -= JAIL_FEE; leaveJail(p, turnAt); return; }
  await jailRoll(p);
}
function leaveJail(p, turnAt) { p.inJail = false; p.jailTurns = 0; p.doubles = 0; render(); log(`${p.name} 离开隔离区`); sfx('good'); endTurn(turnAt); }

// ---------- 落地结算 ----------
function tileLandFx(p, type) {
  if (p && p.tokenEl) playTileLandFx(type, p.tokenEl);
}

export async function resolveTile(p, opts = {}) {
  const t = TILES[p.pos];
  if (!t) return;

  if (t.type === 'wormhole' && !opts.afterWarp) {
    tileLandFx(p, 'wormhole');
    warp(p);
    if (!G.gameOver && !p.bankrupt) await resolveTile(p, { afterWarp: true });
    return;
  }

  if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
    if (t.owner === null) {
      // 「拍卖狂潮」突变：所有未购地产自动进入拍卖
      if (G.auctionAll) {
        log(`🔨 拍卖狂潮：「${t.name}」自动进入拍卖`, true);
        await auction(t);
        if (p.isAI) { endTurn(opts.turnAt); return true; }
        afterHumanAction(p);
        return true;
      }
      if (p.isAI) { if (aiShouldBuy(p, t)) buy(p, t); }
      else {
        G.pendingTile = t;
        setActionsHTML(
          `<button id="buyBtn" ${p.caps < t.price ? 'disabled' : ''}>购买 (${t.price}盖)</button>
           <button class="alt" id="aucBtn">拍卖</button>
           <button class="alt" id="mgBtn">资产/交易</button>
           ${nukeBtnHtml(p)}
           <button class="alt" id="endBtn">结束回合</button>`);
        document.getElementById('buyBtn').onclick = () => { buy(p, t); afterHumanAction(p); };
        document.getElementById('aucBtn').onclick = async () => { await auction(t); afterHumanAction(p); };
        wireMeta(p);
        return;
      }
    } else if (t.owner === p.id) {
      if (p.isAI) { if (t.type === 'prop') aiUpgrade(p, t); }
      else if (t.type === 'prop' && t.level < 2) {
        const ok = canUpgrade(p, t);
        G.pendingTile = t;
        setActionsHTML(
          `<button id="upBtn" ${!ok || p.caps < t.price ? 'disabled' : ''}>强化为${t.level + 1 === 1 ? '棚户' : '地堡'} (${t.price}盖)</button>
           <button class="alt" id="mgBtn">资产/交易</button>
           ${nukeBtnHtml(p)}
           <button class="alt" id="endBtn">结束回合</button>`);
        document.getElementById('upBtn').onclick = () => { upgrade(p, t); afterHumanAction(p); };
        wireMeta(p);
        return;
      }
      // 人类玩家拥有该地块但无法升级（已升满 / 铁路 / 设施）→ 直接给出「资产/结束回合」，避免回合卡死
      if (!p.isAI) { afterHumanAction(p); return; }
    } else { payRent(p, t); }
  } else if (t.type === 'event') {
    tileLandFx(p, 'event');
    // 突变/叙事种子调整坏事件概率（尸潮频发 +30%、暴君余波 +30%、仁心传承 -30% 等）
    const badP = Math.min(0.6, Math.max(0.05, 0.30 + (G.badEventBonus || 0) - (G.goodEventBonus || 0)));
    const roll = Math.random();
    const pile = roll < badP ? ALERTS : roll < badP + 0.30 ? INTEL : roll < badP + 0.50 ? FACTIONS : RUINS;
    const m = pickMission(pile, p);
    if (!m) {
      // 牌堆任务全部 once 且已完成：播放空频道提示，回合照常继续（不重放、不重复结算）
      log(`${p.name} 调频到空频道，只有杂音…`);
      sfx('event');
    } else {
      const chainTag = isNukeMission(m) ? '☢ 机密频道' : isFactionMission(m) ? '⚑ 派系任务' : m.deck === 'ruins' ? '⛏ 遗迹猎人' : isChainMission(m) ? '🔗 连锁任务' : '迷你任务';
      if (p.isAI) {
        const c = aiMission(p, m);
        log(`${chainTag} // ${m.title}`, true);
        applyMissionEffects(p, c.effects, m, c);
        if (c.effects && c.effects.warp) {
          if (!G.gameOver && !p.bankrupt) await resolveTile(p, { afterWarp: true });
          return;
        }
        sfx(m.bad ? 'bad' : 'good'); render();
      } else { render(); showMission(m, p); return; }
    }
  } else if (t.type === 'tax') {
    tileLandFx(p, 'tax');
    const amount = Math.floor(t.tax * (G.taxMult || 1));
    // 道具卡「护盾」：抵挡本次税款
    if ((p.shield || 0) > 0) {
      p.shield--;
      log(`🛡 护盾生效：${p.name} 免缴${t.name} ${amount}盖`, true); sfx('good');
    } else {
      log(`${p.name} 缴纳${t.name} ${amount}盖`, true); sfx('bad'); payCaps(p, amount, t.name);
      // 「免费停车彩金」突变：税款进入奖池
      if (G.jackpot && amount > 0) { G.jackpotPool = (G.jackpotPool || 0) + amount; log(`🎁 彩金池累积至 ${G.jackpotPool} 盖`); }
    }
  } else if (t.type === 'quarantine') {
    tileLandFx(p, 'quarantine');
    enterJail(p); log(`${p.name} 被关进隔离区`, true); sfx('bad');
    screenShake(1.1); haptic('heavy');
    render(); endTurn(opts.turnAt); return true;   // 返回 true 表示本回合已在此结束
  } else if (t.type === 'safe') {
    tileLandFx(p, 'safe');
    if (G.noSafe) {
      log(`${p.name} 踩中安全地带，但废土没有免费的安宁（-15 盖）`); sfx('bad');
      payCaps(p, 15, '安全区占用费');
    } else {
      // 「免费停车彩金」突变：踩安全格卷走奖池
      if (G.jackpot && (G.jackpotPool || 0) > 0) {
        p.caps += G.jackpotPool;
        log(`🎁 免费停车彩金：${p.name} 卷走奖池 ${G.jackpotPool} 盖！`, true);
        G.jackpotPool = 0;
      }
      log(`${p.name} 在安全地带休整`); sfx('good');
    }
  } else if (t.type === 'wormhole') {
    /* 由函数开头 afterWarp 分支处理；此处为落地后不再重复传送 */
  } else if (t.type === 'oasis') {
    tileLandFx(p, 'oasis');
    oasis(p);
  } else if (t.type === 'bounty') {
    tileLandFx(p, 'bounty');
    bounty(p);
  } else if (t.type === 'blackmarket') {
    tileLandFx(p, 'blackmarket');
    if (p.isAI) aiBlackMarket(p);
    else { render(); showBlackMarket(p); return; }
  } else if (t.type === 'radiation') {
    tileLandFx(p, 'radiation');
    if (p.isAI) aiRadiation(p);
    else { render(); showRadiation(p); return; }
  } else if (t.type === 'bunker') {
    tileLandFx(p, 'bunker');
    if (p.isAI) aiBunker(p);
    else { render(); showBunker(p); return; }
  }
  if (!G.gameOver && !p.bankrupt) tryNukeKeyFromChipFactory(p, t);
  render();
  if (!p.isAI) afterHumanAction(p);
}
function wireMeta(p) {
  const mg = document.getElementById('mgBtn'); if (mg) mg.onclick = () => { G.turnPlayer = p; renderManage(); };
  const eb = document.getElementById('endBtn'); if (eb) eb.onclick = () => afterHumanAction(p);
  wireNukeBtn(p);
}
function nukeBtnHtml(p) {
  if (!canLaunchNuke(p) || p.isAI || G.gameOver) return '';
  return '<button class="nuke" id="nukeBtn" title="隐藏结局">☢ 发射核弹</button>';
}
function wireNukeBtn(p) {
  const nb = document.getElementById('nukeBtn');
  if (nb) nb.onclick = () => showNukeLaunchConfirm(p);
}
// launchNuke 已迁至 nuke.js（v1.6.0 接手轮 · 断 game ↔ view-modal 循环依赖）
export function afterHumanAction(p) {
  G.pendingTile = null; G.turnPlayer = p;
  // 人类玩家回合中破产：直接结算并推进回合，不再展示可操作按钮
  if (p.bankrupt) { setActionsHTML(''); endTurn(); return; }
  if (p.extraRoll) {
    p.extraRoll = false; G.awaitingRoll = true;
    humanActionUI(p);
    return;
  }
  setActionsHTML('<button class="alt" id="mgBtn">资产/交易</button>' + handBtnHtml(p) + nukeBtnHtml(p) + '<button id="endBtn">结束回合</button>');
  document.getElementById('mgBtn').onclick = () => renderManage();
  wireHandBtn(p);
  document.getElementById('endBtn').onclick = () => { setActionsHTML(''); endTurn(); };
  wireNukeBtn(p);
}

const WEATHER_CLASSES = ['weather-dust', 'weather-acid', 'weather-dusk'];
let _weatherTimer = null;
function triggerWeather() {
  if (G.gameOver) return;
  if (_weatherTimer) { clearTimeout(_weatherTimer); _weatherTimer = null; }
  WEATHER_CLASSES.forEach(c => document.body.classList.remove(c));
  const roll = Math.random();
  let cls = null;
  if (roll < 0.45) cls = 'weather-dust';
  else if (roll < 0.80) cls = 'weather-acid';
  else if (roll < 0.95) cls = 'weather-dusk';
  if (cls) {
    document.body.classList.add(cls);
    const duration = 4000 + Math.random() * 5000;
    _weatherTimer = setTimeout(() => {
      document.body.classList.remove(cls);
      _weatherTimer = null;
    }, duration);
  }
}
function endTurn(turnAt) {
  // 僵尸链防护：仅当前回合的链可以结算；turnAt 落后说明回合已被推进，忽略
  if (!isCurrentTurn(turnAt)) return;
  const me = G.players[G.current];
  if (G.mode === 'campaign' || G.mode === 'coop') {
    const human = G.players.find(p => !p.isAI);
    const ally = G.players.find(p => p.isAI);
    // 合作模式：任一玩家破产即失败；单人模式：人类破产即失败
    if (G.mode === 'coop' && human && human.bankrupt) { campaignLose(human); return; }
    if (G.mode === 'coop' && ally && ally.bankrupt) { campaignLose(ally); return; }
    if (G.mode === 'campaign' && human && human.bankrupt) { campaignLose(human); return; }
    if (human && !human.bankrupt) {
      const r = G.mode === 'coop'
        ? evaluateCampaignCoop(human, ally, { TILES, netWorth }, G.campaign)
        : evaluateCampaign(human, { TILES, netWorth }, G.campaign);
      if (r.done) {
        if (G.campaign >= campaignCount() - 1) { campaignWin(human); return; }
        G.campaign++;
        G.turn = 0;   // 章节轮次上限按章计算，进入新章节重新计数
        log(chapterClearSpeakText(CAMPAIGNS[G.campaign].name), true);
        render();
        const decay = campaignDecayPerTurn(G.campaign);
        if (decay > 0) log(`☢ 警告：本章起每回合废土衰减 -${decay} 盖（全员）`, true);
        showChapterIntro(G.campaign, () => takeTurn(), human.moral || 0);
        return;
      }
    }
  } else {
    if (G.targetWealth > 0 && !me.bankrupt && netWorth(me) >= G.targetWealth) { gameWin(me); return; }
  }
  // 生存模式：破产即结束，显示存活回合数
  if (G.mode === 'survival') {
    const human = G.players[0];
    if (human.bankrupt) { survivalLose(human); return; }
    // 无回合上限，永远继续
    nextPlayer();
    return;
  }
  const alive = G.players.filter(p => !p.bankrupt);
  if (alive.length === 0) { gameDraw(); return; }
  if (G.mode !== 'campaign' && alive.length <= 1) { gameWin(alive[0]); return; }
  const turnLimit = (G.mode === 'campaign' || G.mode === 'coop') ? MAX_TURNS_CAMPAIGN : MAX_TURNS;
  if (G.turn >= turnLimit) {
    // 闯关/合作模式到达上限 = 未达成章节目标 → 闯关失败，而不是把资产最高的 AI 判为「胜利者」
    if (G.mode === 'campaign' || G.mode === 'coop') {
      log(`⏳ 已达 ${turnLimit} 回合上限，章节目标未达成。`);
      const human = G.players.find(p => !p.isAI);
      campaignLose(human || alive[0]); return;
    }
    const winner = alive.reduce((a, b) => netWorth(b) > netWorth(a) ? b : a);
    log(`⏳ 已达 ${turnLimit} 回合上限，按净身家判胜。`);
    gameWin(winner); return;
  }
  triggerWeather();
  nextPlayer();
}
function applyWastelandDecay() {
  if (G.gameOver) return;
  let amount = 0;
  if (G.mode === 'campaign' || G.mode === 'coop') {
    amount = campaignDecayPerTurn(G.campaign);
  } else if (G.mode === 'survival') {
    // 生存模式：每 8 回合衰减 +5，从第 8 回合开始
    const tier = Math.floor((G.turn || 0) / 8);
    amount = tier > 0 ? tier * 5 : 0;
  }
  // 「辐射泄漏」突变 / 「核爆余烬」叙事种子：任何模式每回合额外扣盖
  const leak = G.radiationLeak || 0;
  if (!amount && !leak) return;
  let any = false;
  for (const p of G.players) {
    if (p.bankrupt) continue;
    any = true;
    if (amount) p.caps -= amount;
    if (leak) p.caps -= leak;
    if (p.caps < 0) bankrupt(p);
  }
  if (any) {
    if (amount) log(`☢ 废土衰减：全员 -${amount} 盖`, true);
    if (leak) log(`☢ 辐射泄漏：全员额外 -${leak} 盖`, true);
  }
}
/** 生存模式计算当前衰减等级 */
export function survivalDecayTier(turn) {
  return Math.floor((turn || 0) / 8);
}
function survivalLose(p) {
  G.gameOver = true; setGameEnd('survival', p.id); render(); sfx('bad');
  const survived = G.turn || 0;
  showWin(p.name, `生存 ${survived} 回合`);
  haptic('heavy');
  log(`💀 你在第 ${survived} 回合倒下了。废土记住了你的名字。`, true);
}
function setGameEnd(kind, winnerId) {
  G.endKind = kind;
  G.endWinnerId = winnerId != null ? winnerId : null;
}
function gameDraw() {
  G.gameOver = true; setGameEnd('draw', null); render(); sfx('bad');
  showWin('协议中断', '无人幸存');
  haptic('heavy');
  log(GAMEOVER_LINES.allDown, true);
  if (G.mode === 'legacy') recordLegacyRun();
}
function nextPlayer() {
  let n = G.current;
  let tries = 0;
  let wrapped = false;
  do {
    n = (n + 1) % G.players.length;
    if (n === 0) wrapped = true;
    tries++;
    if (tries > G.players.length) { gameDraw(); return; }
  } while (G.players[n].bankrupt);
  // 「均富协议」突变：一轮结束，全体现金取平均
  if (wrapped && G.equalWealth) equalizeWealth();
  G.current = n; G.turn = (G.turn || 0) + 1;
  applyWastelandDecay();
  if (G.gameOver) return;
  // 衰减/辐射可能直接把玩家打死：生存模式走专属结局，全员死亡走协议中断
  if (G.players.every(p => p.bankrupt)) { gameDraw(); return; }
  if (G.mode === 'survival' && G.players[0].bankrupt) { survivalLose(G.players[0]); return; }
  render(); takeTurn();
}
/** 「均富协议」突变：全体现金重新平均分配（致敬大富翁4 均富卡） */
function equalizeWealth() {
  const alive = G.players.filter(p => !p.bankrupt);
  if (alive.length < 2) return;
  const sum = alive.reduce((s, p) => s + Math.max(p.caps, 0), 0);
  const avg = Math.floor(sum / alive.length);
  if (alive.every(p => p.caps === avg)) return;
  alive.forEach(p => { p.caps = avg; });
  log(`⚖ 均富协议：本轮结束，全体现金均分为 ${avg} 盖`, true);
}
function gameWin(w) {
  G.gameOver = true; setGameEnd('win', w.id); render(); sfx('win');
  showWin(w.name);
  haptic('win');
  log('协议终止。' + w.name + ' 是最后的赢家。', true);
  if (G.mode === 'legacy') recordLegacyRun();
}
/** 记录遗产模式对局 */
function recordLegacyRun() {
  const human = G.players.find(p => !p.isAI) || G.players[0];
  const result = recordRun({
    turns: G.turn || 0,
    moral: human.moral || 0,
    endKind: G.endKind,
    bankrupt: human.bankrupt,
    chaptersCompleted: G.campaign || 0,
  });
  if (result && result.pointsEarned > 0) {
    log(`📜 获得 ${result.pointsEarned} 遗产点（共 ${result.totalPoints}）`, true);
  }
}
function campaignWin(p) {
  G.gameOver = true;
  // coop 用专属 endKind，叙事种子的「战友情谊」分支才能命中
  setGameEnd(G.mode === 'coop' ? 'coop' : 'campaign', p.id);
  render(); sfx('win');
  if (G.mode === 'coop') {
    const ally = G.players.find(x => x.isAI);
    showWin(p.name + (ally ? ' & ' + ally.name : ''), '合作通关');
    log(GAMEOVER_LINES.coopClear, true);
  } else {
    showCampaignEnding(p);
  }
  haptic('win');
}
function campaignLose(p) {
  G.gameOver = true; setGameEnd('campaignLose', p.id); render(); sfx('bad');
  showWin(p.name, '闯关失败');
  haptic('heavy');
  log(GAMEOVER_LINES.campaignOver, true);
  if (G.mode === 'legacy') recordLegacyRun();
}
export function restoreTurnUI() {
  if (G.gameOver) return;
  const p = G.players[G.current];
  if (!p || p.bankrupt) { takeTurn(); return; }
  if (p.inJail) { startJailTurn(p); return; }
  if (p.extraRoll) {
    G.turnPlayer = p;
    afterHumanAction(p);
    return;
  }
  if (G.awaitingRoll) {
    G.turnPlayer = p;
    humanActionUI(p);
    return;
  }
  if (G.pendingTile != null) {
    G.turnPlayer = p;
    resolveTile(p);
    return;
  }
  takeTurn();
}

export function restart() { showSetupScreen(); }
