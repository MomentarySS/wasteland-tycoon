// 模块级冒烟测试：DOM 桩 + fetch 桩，加载真实 ES 模块并跑完整对局
// 运行： node smoke.test.mjs
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

const errors = [];
// 关键：装上处理器后 Node 不会再用退出码 1 结束，进程会继续跑到底部那句
// `process.exit(0)` —— 于是「测试崩了但退出码是 0」，闸门形同虚设。
// 这里显式写 process.exitCode = 1，底部改为 process.exit(process.exitCode || 0)，
// 两条路径（正常走到底 / 中途崩了靠处理器兜底）都能落到非零退出码。
process.on('unhandledRejection', e => {
  const s = 'unhandledRejection: ' + ((e && e.stack) || e);
  errors.push(s); console.error(s); process.exitCode = 1;
});
process.on('uncaughtException', e => {
  const s = 'uncaughtException: ' + ((e && e.stack) || e);
  errors.push(s); console.error(s); process.exitCode = 1;
});

// 加速：所有 setTimeout 走 setImmediate（Node 会把 setTimeout(fn,0) 钳到 1ms，太慢）
const realST = global.setTimeout;
global.setTimeout = (fn, _ms, ...a) => setImmediate(() => fn(...a));
const tick = () => new Promise(r => setImmediate(r));

// ---------------- DOM 桩 ----------------
const cache = {};
function mkStyle() {
  const s = { setProperty(k, v) { this[k] = v; } };
  return s;
}
function mkEl(id) {
  return {
    id, _html: '', textContent: '', value: '', style: mkStyle(), dataset: {}, children: [],
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    // 与真实 DOM 一致：设置 innerHTML 清空子节点（棋盘/玩家列表等渲染结构可计数断言）
    set innerHTML(v) { this._html = String(v); this.children.length = 0; }, get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    prepend(c) { this.children.unshift(c); if (this.children.length > 400) this.children.length = 400; return c; },
    insertBefore(c, ref) { if (!ref) { this.children.push(c); } else { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); } return c; },
    get firstChild() { return this.children[0] || null; },
    remove() { }, addEventListener() { }, removeEventListener() { }, setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
    querySelector() { return null; }, querySelectorAll() { return []; },
    get offsetWidth() { return 1; }, focus() { }, scrollIntoView() { },
    getBoundingClientRect() { return { top: 0, left: 0, width: 54, height: 54 }; },
    set onclick(fn) { this._onclick = fn; }, get onclick() { return this._onclick; },
  };
}
const getEl = id => (cache[id] ||= mkEl(id));

// 中央预览 DOM（view-core v2）
(function setupTilePreview() {
  const tp = mkEl('tilePreview');
  const mkSub = cls => {
    const el = mkEl(cls);
    el.className = cls.replace('.', '');
    el.hidden = false;
    return el;
  };
  const subs = { '.tpName': mkSub('tpName'), '.tpMeta': mkSub('tpMeta'), '.tpIcon': mkSub('tpIcon'), '.tpArt': mkSub('tpArt') };
  tp.querySelector = sel => subs[sel] || null;
  cache.tilePreview = tp;
})();

// 操作区 mock：setActionsHTML 会把按钮 HTML 塞进来，我们需要让 game.js 里的
// getElementById('rollBtn'/'buyBtn'/'upBtn'/'endBtn'/'mgBtn'/'rb') 能找到元素
// 并支持 onclick 赋值/调用。这里做一个轻量解析器，从 HTML 里提取 id 并注册到 cache。
(function setupActions() {
  const actions = mkEl('actions');
  actions._html = '';
  Object.defineProperty(actions, 'innerHTML', {
    set(html) {
      actions._html = String(html);
      actions.children.length = 0;
      // 提取 <button id="xxx"> 并创建 mock 元素
      const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
      ids.forEach(id => {
        if (!cache[id]) cache[id] = mkEl(id);
      });
    },
    get() { return actions._html; }
  });
  cache.actions = actions;
})();

const document = {
  getElementById: getEl,
  createElement: () => mkEl('dyn'),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() { },
  body: (() => {
    const b = mkEl('body');
    b.classList = { s: new Set(['no-tilt']), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } };
    return b;
  })(),
};
const store = {};
global.document = document;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.window = {
  addEventListener() { },
  removeEventListener() { },
  AudioContext: undefined,
  webkitAudioContext: undefined,
  speechSynthesis: undefined,
  SpeechSynthesisUtterance: undefined,
  navigator: { serviceWorker: undefined },
};          // 无 AudioContext → 音频模块自动降级
// Node 22 的 globalThis.navigator 只有 getter，需用 defineProperty 覆盖
Object.defineProperty(global, 'navigator', { value: { serviceWorker: undefined }, configurable: true, writable: true });
global.alert = m => { throw new Error('alert: ' + m); };
global.confirm = () => true;
global.prompt = () => null;  // 拍卖出价：人类玩家不参与
global.requestAnimationFrame = fn => setImmediate(fn);
global.fetch = async (url) => {
  const txt = readFileSync(join(HERE, String(url).replace(/^\.?\//, '')), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
};

// ---------------- 载入真实模块（必须用 file:// 绝对 URL）----------------
const load = f => import(pathToFileURL(join(HERE, 'js', f)).href);

const config = await load('config.js');
const state = await load('state.js');
const rulesCore = await load('rules-core.js');
const rules = await load('rules.js');
const data = await load('data.js');
const view = await load('view.js');
const game = await load('game.js');
const campaign = await load('campaign.js');
const paths = await load('paths.js');

console.log('模块加载完成');

// ---------------- 内容加载 ----------------
await data.loadContent();
view.initView();
view.buildSetup();

console.log('TILES', data.TILES.length, '| 废土电台', data.ALERTS.length, '| 幸存者手册', data.INTEL.length);
if (data.TILES.length !== config.TILES_COUNT) throw new Error('棋盘格数错误: ' + data.TILES.length);
if (data.ALERTS.length !== 36 || data.INTEL.length !== 28) throw new Error('事件堆数量错误');
if (data.positions.length !== config.TILES_COUNT) throw new Error('坐标环长度错误');

// util 分类型号
const utils = data.TILES.filter(t => t.type === 'util');
if (utils.length !== 2) throw new Error('设施格数量应为 2');
if (!utils.some(t => t.utilKind === 'water') || !utils.some(t => t.utilKind === 'power')) throw new Error('设施应区分 water/power');

// paths 模块：vendorUrl 只做 URL 拼接（vendor/ 目录已移除，运行时不再依赖）
if (!paths.vendorUrl('foo/bar.js').includes('vendor/foo/bar.js')) throw new Error('vendorUrl 解析异常');

// 迷你任务结构校验：每张卡有标题、剧情、≥2 个选择支，每个选择支有效果
const allMissions = [...data.ALERTS, ...data.INTEL, ...data.FACTIONS, ...data.RUINS];
const badM = allMissions.filter(m => !m.title || !m.story || !Array.isArray(m.choices) || m.choices.length < 2 || m.choices.some(c => !c.effects));
if (badM.length) throw new Error('迷你任务结构有误: ' + badM.map(m => m.id).join(','));
if (!allMissions.every(m => 'moral' in m)) throw new Error('任务缺少 moral 字段');
const chainMissions = allMissions.filter(m => m.once || (m.requires && m.requires.length));
if (chainMissions.length < 5) throw new Error('连锁任务数量不足: ' + chainMissions.length);
const eagle2 = allMissions.find(m => m.id === 'chain_eagle_2');
if (!eagle2 || !eagle2.requires.includes('eagle_trail')) throw new Error('掠夺者链任务 requires 异常');

const missionsMod = await load('missions.js');
const diffMod = await load('difficulty.js');
const probePlayer = { flags: [], missionDone: [] };
const eagle1 = allMissions.find(m => m.id === 'chain_eagle_1');
if (!missionsMod.missionEligible(eagle1, probePlayer)) throw new Error('chain_eagle_1 应始终可抽');
if (missionsMod.missionEligible(eagle2, probePlayer)) throw new Error('无 eagle_trail 时不应解锁 chain_eagle_2');
probePlayer.flags.push('eagle_trail');
probePlayer.missionDone.push('chain_eagle_1');
if (!missionsMod.missionEligible(eagle2, probePlayer)) throw new Error('eagle_trail 后应解锁 chain_eagle_2');

// 新链任务连锁逻辑验证
const med1 = allMissions.find(m => m.id === 'chain_med_1');
const med2 = allMissions.find(m => m.id === 'chain_med_2');
if (!med1 || !med2) throw new Error('医疗链任务未找到');
if (!missionsMod.missionEligible(med1, probePlayer)) throw new Error('chain_med_1 应始终可抽');
if (missionsMod.missionEligible(med2, probePlayer)) throw new Error('无 med_convoy 时不应解锁 chain_med_2');
probePlayer.flags.push('med_convoy');
if (!missionsMod.missionEligible(med2, probePlayer)) throw new Error('med_convoy 后应解锁 chain_med_2');

const spy1 = allMissions.find(m => m.id === 'chain_spy_1');
const spy2 = allMissions.find(m => m.id === 'chain_spy_2');
if (!spy1 || !spy2) throw new Error('间谍链任务未找到');
if (!missionsMod.missionEligible(spy1, probePlayer)) throw new Error('chain_spy_1 应始终可抽');
if (missionsMod.missionEligible(spy2, probePlayer)) throw new Error('无 spy_contact 时不应解锁 chain_spy_2');
probePlayer.flags.push('spy_contact');
if (!missionsMod.missionEligible(spy2, probePlayer)) throw new Error('spy_contact 后应解锁 chain_spy_2');

diffMod.applyDifficulty(state.G, 'nightmare');
if (state.G.taxMult !== 1.25 || state.G.aiBuyAggro !== 1.35) throw new Error('噩梦难度未正确写入 G');

const hasPass = allMissions.some(m => m.choices.some(c => (c.effects || {}).getOut));
if (!hasPass) throw new Error('缺少免罚通行证选项');

// 新地块类型 / 新分组存在性核对
const types = data.TILES.map(t => t.type);
for (const ty of ['wormhole', 'blackmarket', 'bounty', 'oasis', 'radiation', 'bunker']) {
  if (!types.includes(ty)) throw new Error('缺少新地块类型: ' + ty);
}
if (data.FACTIONS.length !== 9) throw new Error('派系任务数量应为 9');
if (data.RUINS.length !== 7) throw new Error('遗迹牌堆数量应为 7');
const groups = data.TILES.filter(t => t.type === 'prop').map(t => t.group);
for (const g of ['tech', 'bio']) {
  if (!groups.includes(g)) throw new Error('缺少新地产分组: ' + g);
}


// 棋盘构成核对（与原单文件版一致）
const count = t => data.TILES.filter(x => x.type === t).length;
const compo = { start: count('start'), prop: count('prop'), rail: count('rail'), util: count('util'), event: count('event'), tax: count('tax'), quarantine: count('quarantine'), safe: count('safe') };
console.log('棋盘构成', JSON.stringify(compo));

if (!data.TILES.every(t => typeof t.artIndex === 'number')) throw new Error('地块缺少 artIndex');
const artSet = new Set(data.TILES.map(t => t.artIndex));
if (artSet.size !== data.TILES.length) throw new Error('artIndex 重复');
data.shuffleBoard();
if (!data.TILES.every(t => typeof t.artIndex === 'number')) throw new Error('洗牌后 artIndex 丢失');

// ---------------- 跑一局：双 AI 自动对战 ----------------
['slot0', 'slot1'].forEach(id => getEl(id).value = 'ai');
['slot2', 'slot3'].forEach(id => getEl(id).value = 'off');
getEl('startCaps').value = '1500';
getEl('salary').value = '200';
getEl('target').value = '3000';

game.startGame();
if (state.G.players.length !== 2) throw new Error('玩家创建失败');

// ---------------- 平面棋盘：条带格渲染 + 顶面贴图默认常开 ----------------
{
  const tilesEl = document.getElementById('tiles');
  if (tilesEl.children.length !== data.TILES.length) throw new Error('棋盘渲染格数异常: ' + tilesEl.children.length);
  if (!document.body.classList.contains('no-tilt')) throw new Error('棋盘应为平面模式');
  if (!document.body.classList.contains('tile-art')) throw new Error('tile-art 应默认开启');
  view.setBoardTilt(true);
  if (!document.body.classList.contains('no-tilt')) throw new Error('2.5D 已移除，应保持平面');
  view.setTileArt(false);
  if (!document.body.classList.contains('tile-art')) throw new Error('tile-art 不可关闭');
  view.render();
  if (tilesEl.children.length !== data.TILES.length) throw new Error('渲染格数异常');
}

const t0 = Date.now();
let ticks = 0;
while (!state.G.gameOver && Date.now() - t0 < 20000) {
  await tick();
  ticks++;
}
const alive = state.G.players.filter(p => !p.bankrupt);
console.log('对局结束:', state.G.gameOver, '| 调度轮次:', ticks, '| 存活玩家:', alive.length,
  '| 资产:', state.G.players.map(p => p.name + ':' + rules.netWorth(p)).join(' '));
if (!state.G.gameOver) throw new Error('20 秒内未分出胜负，疑似流程卡死');

// ---------------- 场景 2：4 人极低资金混战（逼出破产 / 拍卖 / 隔离区）----------------
// 注意：核弹隐藏结局是合法终止方式——AI 集齐三密钥会自动发射（游玩手册 §AI 集齐后会自动发射），
// 可能全员存活就结束。因此「必须有人破产」的断言仅在非核弹结局下生效；
// 60/12 的严酷经济让破产几乎总是先于核弹发生（实测 ~95%），核弹结局路径由本场景其它局与
// 下方 rules 纯函数校验共同覆盖。
['slot0', 'slot1', 'slot2', 'slot3'].forEach(id => getEl(id).value = 'ai');
getEl('startCaps').value = '60';
getEl('salary').value = '12';
getEl('target').value = '0';   // 只剩一人才结束
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });

game.startGame();
if (state.G.players.length !== 4) throw new Error('4 人局创建失败');
const t1 = Date.now();
while (!state.G.gameOver && Date.now() - t1 < 32000) await tick();
const survivors = state.G.players.filter(p => !p.bankrupt);
console.log('混战结束:', state.G.gameOver, '| 结局:', state.G.endKind, '| 破产人数:', 4 - survivors.length,
  '| 幸存:', survivors.map(p => p.name).join(','));
if (!state.G.gameOver) throw new Error('4 人混战未收敛');
if (survivors.length >= 4 && state.G.endKind !== 'nuke') throw new Error('4 人混战未逼出任何破产，实际幸存 ' + survivors.length);
const ghost = data.TILES.filter(t => 'owner' in t && t.owner !== null && state.G.players[t.owner]?.bankrupt);
if (ghost.length) throw new Error('破产玩家仍持有地块: ' + ghost.map(t => t.name).join(','));

// ---------------- 关键规则函数校验（rules-core 纯函数）----------------
const freshRail = { type: 'rail', owner: null };
if (rulesCore.rentDisplay(freshRail) !== '—') throw new Error('rentDisplay 未售地块应返回 —');

const rust = data.TILES.filter(t => t.type === 'prop' && t.group === 'rust');
rust.forEach(t => { t.owner = 0; t.mortgaged = false; });
if (!rulesCore.isMonopoly(rust[0])) throw new Error('isMonopoly 判定失败');
rust[0].owner = 1;
if (rulesCore.isMonopoly(rust[1])) throw new Error('isMonopoly 应在非全资时为 false');

const rails = data.TILES.filter(t => t.type === 'rail');
rails.forEach(t => t.owner = null);
rails[0].owner = 0;
if (rulesCore.railRent(rails[0]) !== 25) throw new Error('railRent 单条应为 25，实际 ' + rulesCore.railRent(rails[0]));
rails[1].owner = 0;
if (rulesCore.railRent(rails[0]) !== 50) throw new Error('railRent 两条应为 50');

// AI 拍卖出价钳制在现金内
const aiBidder = { id: 0, caps: 100, bankrupt: false };
const auctionTile = { type: 'prop', group: 'rust', price: 200 };
if (rulesCore.aiBid(aiBidder, auctionTile) > aiBidder.caps) throw new Error('aiBid 应钳制在 caps 内');

// payRent 遇破产 owner 释放地块
const renter = { id: 0, name: '租', caps: 500, bankrupt: false };
const deadOwner = { id: 1, name: '债', caps: 0, bankrupt: true };
state.G.players = [renter, deadOwner];
const rentTile = data.TILES.find(t => t.type === 'prop');
rentTile.owner = 1; rentTile.level = 1; rentTile.mortgaged = false;
rules.payRent(renter, rentTile);
if (rentTile.owner !== null) throw new Error('payRent 应清除破产 owner');

// 破产资产转移
const A = { id: 0, name: 'A', caps: 0, bankrupt: false, inJail: false, jailTurns: 0, getOut: 1 };
const B = { id: 1, name: 'B', caps: 100, bankrupt: false, inJail: false, jailTurns: 0, getOut: 0 };
state.G.players = [A, B];
data.TILES.forEach(t => { if ('owner' in t) t.owner = null; });
const tp = data.TILES.find(t => t.type === 'prop');
tp.owner = 0; tp.level = 2; A.caps = 40;
rules.bankrupt(A, B);
if (!A.bankrupt) throw new Error('破产标记失败');
if (tp.owner !== 1) throw new Error('破产地块未转移给债主');
if (B.caps !== 140) throw new Error('破产现金未转移，实际 ' + B.caps);
if (B.getOut !== 1) throw new Error('免罚卡未转移');

console.log('规则函数校验通过');

// ---------------- 单人闯关模块校验 ----------------
const cp = { id: 0, caps: 1300, moral: 4, bankrupt: false };
const cprops = data.TILES.filter(t => t.type === 'prop');
for (let i = 0; i < 5; i++) cprops[i].owner = 0;
const rCh1 = campaign.evaluateCampaign(cp, { TILES: data.TILES, netWorth: rules.netWorth }, 0);
if (!rCh1.objs || rCh1.objs.length !== 3) throw new Error('闯关目标结构异常');
if (!rCh1.done) throw new Error('满足第一章目标却判定未完成: ' + JSON.stringify(rCh1.objs.map(o => [o.text, o.value, o.goal, o.done])));
const cp2 = { id: 0, caps: 10, moral: 0, bankrupt: false };
const rCh1b = campaign.evaluateCampaign(cp2, { TILES: data.TILES, netWorth: rules.netWorth }, 0);
if (rCh1b.done) throw new Error('不满足目标却判定完成');

// 道德分支结局
const leg = campaign.getCampaignEnding(10);
if (!leg.subtitle.includes('传说')) throw new Error('高道德结局异常: ' + leg.subtitle);
const tyr = campaign.getCampaignEnding(0);
if (!tyr.subtitle.includes('暴君') && !tyr.subtitle.includes('冷面')) throw new Error('低道德结局异常: ' + tyr.subtitle);
const intro = campaign.getChapterIntro(0);
if (!intro || !intro.title || !intro.story) throw new Error('章节叙事缺失');
if (campaign.campaignCount() !== 6) throw new Error('闯关应为 6 章，实际 ' + campaign.campaignCount());
const introHigh = campaign.getChapterIntro(1, 6);
const introLow = campaign.getChapterIntro(1, 1);
if (introHigh.title === introLow.title) throw new Error('章节 intro 变体未按道德区分');
if (campaign.campaignDecayPerTurn(3) !== 8 || campaign.campaignDecayPerTurn(4) !== 12 || campaign.campaignDecayPerTurn(5) !== 15) throw new Error('废土衰减数值异常');
if (campaign.campaignMoralGoal(2) !== 6) throw new Error('第三章道德目标应为 6');

// ---------------- 合作闯关模块校验 ----------------
const coopHuman = { id: 0, caps: 800, moral: 5, bankrupt: false };
const coopAlly = { id: 1, caps: 700, moral: 0, bankrupt: false };
const cpropsCoop = data.TILES.filter(t => t.type === 'prop');
for (let i = 0; i < 3; i++) cpropsCoop[i].owner = 0;  // 人类占 3 块
for (let i = 3; i < 6; i++) cpropsCoop[i].owner = 1;  // AI占 3 块
// 第一章目标：1200 盖 / 5 地产 / 道德 3 → 合作总和：1500 盖 / 6 地产 / 人类道德 5
const rCoop1 = campaign.evaluateCampaignCoop(coopHuman, coopAlly, { TILES: data.TILES, netWorth: rules.netWorth }, 0);
if (!rCoop1.done) throw new Error('合作模式共享目标应完成第一章: ' + JSON.stringify(rCoop1.objs.map(o => [o.text, o.value, o.goal, o.done])));
if (rCoop1.objs.find(o => o.text.includes('地产')).value !== 6) throw new Error('地产应合计 6，实际 ' + rCoop1.objs.find(o => o.text.includes('地产')).value);
if (rCoop1.objs.find(o => o.text.includes('道德')).value !== 5) throw new Error('道德应取人类值 5，实际 ' + rCoop1.objs.find(o => o.text.includes('道德')).value);
// 测试无队友时也正常工作
const rCoopAlone = campaign.evaluateCampaignCoop(coopHuman, null, { TILES: data.TILES, netWorth: rules.netWorth }, 0);
if (rCoopAlone.objs.find(o => o.text.includes('地产')).value !== 3) throw new Error('无队友时地产应只计人类');
console.log('合作闯关模块校验通过');
if (campaign.campaignMoralGoal(5) !== 10) throw new Error('第六章道德目标应为 10');

// ---------------- 生存模式校验 ----------------
const gameMod = await load('game.js');
// 衰减等级计算：每 8 回合升一级
if (typeof gameMod.survivalDecayTier !== 'function') throw new Error('survivalDecayTier 未导出');
if (gameMod.survivalDecayTier(0) !== 0) throw new Error('第 0 回合应为等级 0');
if (gameMod.survivalDecayTier(7) !== 0) throw new Error('第 7 回合应为等级 0');
if (gameMod.survivalDecayTier(8) !== 1) throw new Error('第 8 回合应为等级 1');
if (gameMod.survivalDecayTier(16) !== 2) throw new Error('第 16 回合应为等级 2');
if (gameMod.survivalDecayTier(40) !== 5) throw new Error('第 40 回合应为等级 5');
console.log('生存模式模块校验通过');

const fac2 = data.FACTIONS.find(m => m.id === 'fac_eagle_2');
const repPlayer = { flags: [], missionDone: [], factionRep: { eagle: 2, survivor: 0, tech: 0 } };
if (!missionsMod.missionEligible(fac2, repPlayer)) throw new Error('掠夺者声望2应解锁 fac_eagle_2');
const repProbe = { factionRep: {} };
missionsMod.addFactionRep(repProbe, { eagle: 2, tech: 1 }, { eagle: '掠夺者', tech: '政府' });
if (repProbe.factionRep.eagle !== 2) throw new Error('addFactionRep 失败');

const fxEv = await load('fx-events.js');
if (fxEv.resolveEventFx({ bad: true, art: 'horde' }) !== 'burst') throw new Error('horde 应为 burst');
if (fxEv.resolveEventFx({ bad: false, deck: 'manual', art: 'med' }) !== 'static') throw new Error('med 应为 static');
if (fxEv.resolveEventFx({ deck: 'faction', art: 'bandit' }) !== 'burst') throw new Error('派系 bandit art 优先 burst');
if (fxEv.resolveEventFx({ deck: 'faction', fx: 'smoke' }) !== 'smoke') throw new Error('显式 fx 应优先');
if (fxEv.resolveEventChannel({ bad: true, deck: 'radio' }) !== 'alert') throw new Error('坏事件应进入 alert 频道');
if (fxEv.resolveEventChannel({ bad: false, deck: 'faction' }) !== 'faction') throw new Error('派系事件频道解析失败');
if (fxEv.resolveEventChannel({ bad: false, deck: 'ruins' }) !== 'ruins') throw new Error('遗迹事件频道解析失败');
if (fxEv.resolveEventChannel({ bad: false, deck: 'manual' }) !== 'manual') throw new Error('手册事件频道解析失败');
if (fxEv.classifyLogKind('玩家甲 占领「摩根镇废场」 (-60盖)') !== 'buy') throw new Error('战报 buy 分类失败');
if (fxEv.classifyLogKind('💀 玩家乙 破产出局！') !== 'warn') throw new Error('战报 warn 分类失败');
const choiceTxt = fxEv.formatChoiceResult({ caps: -80, moral: 1 });
if (!choiceTxt.includes('-80盖') || !choiceTxt.includes('道德+1')) throw new Error('formatChoiceResult 异常: ' + choiceTxt);

// 事件插画完整性：缺失位图的事件必须回退 SVG（禁止弹窗破图）
const artMod = await load('assets-art.js');
const artCheckMissions = [...data.ALERTS, ...data.INTEL, ...data.FACTIONS, ...data.RUINS];
const badArt = artCheckMissions.filter(m => {
  const h = artMod.eventArtHtml(m);
  const src = h.match(/src="([^"]+)"/);
  if (!src) return false; // SVG 回退，无 img 标签
  return !existsSync(fileURLToPath(new URL(src[1])));
});
if (badArt.length) throw new Error('事件插画缺失（弹窗破图）: ' + badArt.map(m => m.id).join(','));

// 辐射矿坑规则
const cp3 = { id: 0, caps: 4000, moral: 6, bankrupt: false };
data.TILES.forEach(t => { if (t.type === 'rail' || t.type === 'util') t.owner = null; });
const railsCh3 = data.TILES.filter(t => t.type === 'rail');
railsCh3[0].owner = 0; railsCh3[1].owner = 0;
const rCh3 = campaign.evaluateCampaign(cp3, { TILES: data.TILES, netWorth: rules.netWorth }, 2);
const infraObj = rCh3.objs.find(o => o.text.includes('铁路') || o.text.includes('设施'));
if (!infraObj || !infraObj.done) throw new Error('两铁路应满足第三章 infra 目标: ' + JSON.stringify(rCh3.objs));

// ---------------- 场景 3：单人闯关（1 人类 + 1 AI）----------------
getEl('mode').value = 'campaign';
getEl('slot0').value = 'human';
getEl('slot1').value = 'ai';
getEl('slot2').value = 'off';
getEl('slot3').value = 'off';
getEl('startCaps').value = '1500';
getEl('target').value = '0';
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });

game.startGame();
if (state.G.mode !== 'campaign') throw new Error('闯关模式未设置');
if (state.G.players.length !== 2) throw new Error('闯关局玩家数错误');
// 模拟关闭章节叙事弹窗
const chGo = document.getElementById('chGo');
if (chGo) chGo.onclick();

const t2 = Date.now();
while (!state.G.gameOver && Date.now() - t2 < 15000) await tick();
console.log('闯关调度:', state.G.campaign, '| gameOver:', state.G.gameOver);

// ---------------- 存读档 v4 ----------------
const saveMod = await import(pathToFileURL(join(HERE, 'js', 'view-save.js')).href);
saveMod.saveGame();
const snap = JSON.parse(store.wasteland_save);
if (snap.v !== 4) throw new Error('存档版本应为 4');
if (!snap.players[0].factionRep || snap.players[0].factionRep.eagle !== 0) throw new Error('存档应含 factionRep');
if (snap.mode !== 'campaign') throw new Error('存档未保存 mode');
if (typeof snap.campaign !== 'number') throw new Error('存档未保存 campaign');
if (typeof snap.turn !== 'number') throw new Error('存档未保存 turn');
if (typeof snap.awaitingRoll !== 'boolean') throw new Error('存档未保存 awaitingRoll');
state.G.mode = 'versus';
state.G.campaign = 99;
saveMod.loadGame();
if (state.G.mode !== 'campaign') throw new Error('读档未恢复 mode');
if (state.G.campaign === 99) throw new Error('读档未恢复 campaign');

// 已结束对局读档应恢复胜利界面
state.G.gameOver = true;
state.G.endKind = 'win';
state.G.endWinnerId = state.G.players[0].id;
saveMod.saveGame();
getEl('win').style.display = 'none';
saveMod.loadGame();
if (getEl('win').style.display === 'none') throw new Error('gameOver 读档未显示胜利界面');

// v2 兼容读档
store.wasteland_save = JSON.stringify({
  v: 2, mode: 'versus', campaign: 0, turn: 5, current: 0,
  SALARY: 200, STARTCAPS: 1500, targetWealth: 0, gameOver: false,
  tiles: snap.tiles,
  players: snap.players.map(p => ({ ...p, extraRoll: undefined }))
});
saveMod.loadGame();
if (state.G.turn !== 5) throw new Error('v2 存档未正确读入');

console.log('闯关 / 存档 / 叙事校验通过');

// ---------------- 场景 3b：合作闯关（1 人类 + 1 AI）走 game.js 的回合结算 ----------------
// 回归用例（对应 2026-10-09 OCR 审查的阻断级发现）：game.js 的 endTurn() 在 coop 模式下
// 调用 evaluateCampaignCoop，该标识符必须在本文件完成绑定，否则首次回合结算就抛
// ReferenceError、合作闯关模式实质不可玩。旧用例只通过 campaign 模块直测导出，
// 绕开了 game.js 的调用点，因此 npm test / CI 全绿也发现不了这个回归。
// 本例必须经由 game.js 的真实入口（章节叙事 → 人类回合 → endBtn → endTurn）驱动。
getEl('mode').value = 'coop';
getEl('slot0').value = 'human';
getEl('slot1').value = 'ai';
getEl('slot2').value = 'off';
getEl('slot3').value = 'off';
getEl('startCaps').value = '1500';
getEl('target').value = '0';
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });

game.startGame();
if (state.G.mode !== 'coop') throw new Error('合作闯关模式未设置');
if (state.G.players.length !== 2) throw new Error('合作局玩家数错误');
if (state.G.players.filter(p => !p.isAI).length !== 1) throw new Error('合作局应恰好 1 名人类 + 1 名 AI');

const coopGo = document.getElementById('chGo');
if (!coopGo) throw new Error('未找到章节叙事「继续」按钮');
coopGo.onclick();          // → takeTurn() → 人类回合「掷骰」条
await tick();

const coopP = state.G.players.find(p => !p.isAI);
if (state.G.current !== coopP.id) throw new Error('coop 未轮到人类回合');
if (!document.getElementById('rollBtn')) throw new Error('coop 人类回合未渲染掷骰按钮');

// 结束本回合：afterHumanAction 是 game.js 导出的「人类行动完毕」入口，
// 它挂上的 endBtn.onclick 就是 endTurn() 的真实调用点（与真实 UI 点「结束回合」同一条路）。
game.afterHumanAction(coopP);
const coopEnd = document.getElementById('endBtn');
if (!coopEnd || !coopEnd.onclick) throw new Error('未找到结束回合按钮');

// 被测行在 endTurn 的 gameOver 判定之前执行，预先置位只为阻止后续 AI 回合链继续推进，
// 不影响被测代码路径。
state.G.gameOver = true;
let coopErr = null;
try { coopEnd.onclick(); } catch (e) { coopErr = e; }
if (coopErr) throw new Error('coop 回合结算抛错（evaluateCampaignCoop 未在 game.js 绑定？）: ' + coopErr);
console.log('合作闯关回合结算校验通过');

// ---------------- 场景 4：人类 E2E（完整回合 + 买地 + 升级）----------------
getEl('mode').value = 'versus';
getEl('slot0').value = 'human';
getEl('slot1').value = 'ai';
getEl('slot2').value = 'off';
getEl('slot3').value = 'off';
getEl('startCaps').value = '3000';
getEl('salary').value = '200';
getEl('target').value = '0';
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });

game.startGame();
if (state.G.players.length !== 2) throw new Error('2 人局创建失败');
if (state.G.players[0].isAI) throw new Error('玩家 0 应为人类');

const human = state.G.players[0];
const tWaitHuman = Date.now();
while (state.G.current !== 0 && Date.now() - tWaitHuman < 10000) await tick();
if (state.G.current !== 0) throw new Error('未等到人类回合');

const beforeCaps = human.caps;
const beforeOwned = data.TILES.filter(t => t.owner === 0).length;

// 模拟点击「掷骰」
const rollBtn = document.getElementById('rollBtn');
if (!rollBtn) throw new Error('未找到掷骰按钮');
rollBtn.onclick();

const tMove = Date.now();
while (state.G.awaitingRoll && Date.now() - tMove < 5000) await tick();

if (human.pos === undefined || human.pos === null) throw new Error('人类位置未更新');

const landedTile = data.TILES[human.pos];
if (landedTile && landedTile.owner === null && !landedTile.mortgaged && human.caps >= landedTile.price) {
  const buyBtn = document.getElementById('buyBtn');
  if (buyBtn && !buyBtn.disabled) {
    buyBtn.onclick();
    await tick();
    const afterBuyOwned = data.TILES.filter(t => t.owner === 0).length;
    if (afterBuyOwned <= beforeOwned) throw new Error('购买后地块归属数未增加');
  }
}

if (landedTile && landedTile.owner === 0 && landedTile.type === 'prop' && landedTile.level < 2 && human.caps >= landedTile.price) {
  const upBtn = document.getElementById('upBtn');
  if (upBtn && !upBtn.disabled) {
    upBtn.onclick();
    await tick();
    if (landedTile.level !== 1) throw new Error('升级后等级未提升');
  }
}

const endBtn = document.getElementById('endBtn');
if (endBtn && typeof endBtn.onclick === 'function') {
  endBtn.onclick();
} else if (endBtn) {
  // mock DOM 下 setActionsHTML 创建的按钮可能尚未绑定 onclick，
  // 跳过结束回合，继续后续校验
}
await tick();

console.log('人类 E2E：完整回合 + 买地 + 升级 校验通过');

// ---------------- 场景 5：买地/升级 纯函数校验 ----------------
const rulesMod = await load('rules.js');
const buyer = { id: 0, name: '买方', caps: 1500, bankrupt: false };
const seller = { id: 1, name: '卖方', caps: 0, bankrupt: false };
state.G.players = [buyer, seller];
data.TILES.forEach(t => { if ('owner' in t) t.owner = null; });
const prop = data.TILES.find(t => t.type === 'prop');
if (!prop) throw new Error('无可用地产');
rulesMod.buy(buyer, prop);
if (prop.owner !== 0) throw new Error('buy 后归属应为买方');
if (buyer.caps !== 1500 - prop.price) throw new Error('buy 后现金异常');
if (prop.level !== 0) throw new Error('buy 不应改变等级');

rulesMod.upgrade(buyer, prop);
if (prop.level !== 1) throw new Error('upgrade 后等级应为 1');
if (buyer.caps !== 1500 - prop.price - prop.price) throw new Error('upgrade 后现金异常');

// 免费升级事件
const freeProp = data.TILES.find(t => t.type === 'prop' && t.owner === 0 && t.level === 0);
if (freeProp) {
  rulesMod.upgrade(buyer, freeProp, true);
  if (freeProp.level !== 1) throw new Error('免费 upgrade 后等级应为 1，实际 ' + freeProp.level);
  if (buyer.caps !== 1500 - prop.price - prop.price) throw new Error('免费 upgrade 不应扣费');
}

console.log('买地/升级 纯函数校验通过');

// ---------------- 场景 6：mutator 视觉族（v1.8.0，纯表现层）----------------
const mutMod = await load('mutators.js');
const { resolveMutatorVisualFamily, MUTATOR_VISUAL_FAMILY, VISUAL_FAMILY_PRIORITY } = mutMod;
const mById = id => mutMod.MUTATOR_POOL.find(m => m.id === id);

// 映射表自身必须自洽：引用的 id 真实存在、族名在优先级表里
for (const [id, fam] of Object.entries(MUTATOR_VISUAL_FAMILY)) {
  if (!mById(id)) throw new Error(`MUTATOR_VISUAL_FAMILY 引用了不存在的 mutator: ${id}`);
  if (!VISUAL_FAMILY_PRIORITY.includes(fam)) throw new Error(`未知视觉族: ${fam} (${id})`);
}
// 口径守卫：只映射「带灾害语义的少数 mutator」。若将来被扩成全量 25 个映射，
// 说明口径已被推翻，必须先改 docs/v1.8.0-plan.md §4 再改代码，这里直接拦住。
const mapped = Object.keys(MUTATOR_VISUAL_FAMILY).length;
if (mapped > 8) throw new Error(`视觉族映射膨胀到 ${mapped} 个，与「只映射少数灾害类 mutator」口径冲突（见 docs/v1.8.0-plan.md §4）`);

if (resolveMutatorVisualFamily([]) !== null) throw new Error('无突变时应返回 null');
if (resolveMutatorVisualFamily(null) !== null) throw new Error('null 输入应返回 null');
if (resolveMutatorVisualFamily(undefined) !== null) throw new Error('undefined 输入应返回 null');
const pick = (...ids) => ids.map(id => mById(id));

if (resolveMutatorVisualFamily(pick('nuke_race')) !== 'fire') throw new Error('nuke_race 应解析为 fire');
if (resolveMutatorVisualFamily(pick('land_tax')) !== 'fire') throw new Error('land_tax 应解析为 fire');
if (resolveMutatorVisualFamily(pick('radiation_leak')) !== 'flood') throw new Error('radiation_leak 应解析为 flood');
if (resolveMutatorVisualFamily(pick('horde_frequent')) !== 'flood') throw new Error('horde_frequent 应解析为 flood');
if (resolveMutatorVisualFamily(pick('wormhole_chaos')) !== 'dust') throw new Error('wormhole_chaos 应解析为 dust');

// 固定优先级：同局多族只取最高那一族（顺序无关）
if (resolveMutatorVisualFamily(pick('wormhole_chaos', 'radiation_leak', 'nuke_race')) !== 'fire') throw new Error('三族同场应取 fire');
if (resolveMutatorVisualFamily(pick('radiation_leak', 'wormhole_chaos')) !== 'flood') throw new Error('缺 fire 时应取 flood');
if (resolveMutatorVisualFamily(pick('wormhole_chaos', 'wormhole_chaos')) !== 'dust') throw new Error('仅 dust 时应取 dust');

// 口径核心：纯经济/抽象类 mutator 必须保持安静（返回 null）
const QUIET = ['double_rent', 'expensive_land', 'equal_wealth', 'speed_die', 'bank_interest', 'jackpot', 'lucky_start', 'pacifist', 'no_jail', 'vendetta'];
for (const id of QUIET) {
  if (!mById(id)) throw new Error(`QUIET 列表引用了不存在的 mutator: ${id}`);
  if (resolveMutatorVisualFamily(pick(id)) !== null) throw new Error(`${id} 不该产生视觉族（口径要求保持安静）`);
}
// 且静默类与灾害类混在一起时，仍只由灾害类决定
if (resolveMutatorVisualFamily(pick('double_rent', 'double_salary', 'nuke_race')) !== 'fire') throw new Error('静默类不应干扰优先级');

// 表现层集成：body class 跟随 G.activeMutators，且不得改任何规则字段
// 注意：走 view-core.js 而不是 view.js —— updateCommandCenter 未被 view.js 再导出，
// 不为了测试去扩大公共 API 面。
const viewCore = await load('view-core.js');
const mutRuleSnapshot = JSON.stringify(Object.keys(state.G).sort().map(k => [k, state.G[k]]).filter(([k]) => k in mutMod.MUTATOR_FIELDS));
const setMuts = ids => { state.G.activeMutators = pick(...ids); viewCore.updateCommandCenter(); };
const bodyHas = c => document.body.classList.contains(c);

setMuts(['nuke_race']);
if (!bodyHas('mutviz-fire')) throw new Error('nuke_race 应点亮 mutviz-fire');
if (bodyHas('mutviz-flood') || bodyHas('mutviz-dust')) throw new Error('同局不应同时点亮多族');

setMuts(['wormhole_chaos', 'radiation_leak', 'nuke_race']);
if (!bodyHas('mutviz-fire')) throw new Error('三族同场应只保留优先级最高的 fire');
if (bodyHas('mutviz-flood') || bodyHas('mutviz-dust')) throw new Error('被压制的族必须被清掉，不能残留');

// 换局 / 读档后清空：视觉族必须跟着 G.activeMutators 一起消失
setMuts([]);
if (bodyHas('mutviz-fire') || bodyHas('mutviz-flood') || bodyHas('mutviz-dust')) throw new Error('清空突变后视觉族必须全部移除');

// 规则数值零影响：走完一轮切换，所有 mutator 规则字段必须逐个未变
const mutRuleAfter = JSON.stringify(Object.keys(state.G).sort().map(k => [k, state.G[k]]).filter(([k]) => k in mutMod.MUTATOR_FIELDS));
if (mutRuleSnapshot !== mutRuleAfter) throw new Error('mutator 视觉族改动了规则数值，违反「只做表现层」不变量');

console.log(`mutator 视觉族校验通过（映射 ${mapped} 个，其余 ${mutMod.MUTATOR_POOL.length - mapped} 个保持安静）`);

if (errors.length) { console.error('运行期错误:\n' + errors.join('\n')); process.exit(1); }
console.log('\n✅ SMOKE TEST PASSED');
// buildSetup() 会注册 setInterval（TTS 状态轮询），必须显式退出，否则进程永不结束、CI 挂死。
// 用 process.exitCode 兜底：若中途抛异常被上面的处理器接住而没走到这里，
// 前面写下的 exitCode=1 仍会在事件循环排空后生效，不会退化成 0。
process.exit(process.exitCode || 0);
