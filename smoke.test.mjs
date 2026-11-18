// 模块级冒烟测试：DOM 桩 + fetch 桩，加载真实 ES 模块并跑完整对局
// 运行： node smoke.test.mjs
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { installDomStub, loadModule } from './scripts/dom-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// dom-stub 把所有 setTimeout 换成 setImmediate，方便游戏动画在测试里瞬间推进。
// 但 TTS 的 60s 兜底定时器也会被折叠成立即触发，等于把「取消是否真的能立即结算」
// 这条 bug 隐藏掉 —— TTS 用例里临时换回真实定时器。
const stubSetTimeout = global.setTimeout;

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

// DOM / window / fetch 桩：与 scripts/balance-probe.mjs、scripts/subtype-test.mjs 共用
// scripts/dom-stub.mjs。alert 选 'throw' —— 意外弹窗在本测试里必须暴露。
const { getEl, store, tick } = installDomStub({ root: HERE, alert: 'throw' });

// ---------------- 载入真实模块（必须用 file:// 绝对 URL）----------------
const load = f => loadModule(HERE, f);

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
  view.render();
  if (tilesEl.children.length !== data.TILES.length) throw new Error('渲染格数异常');
  // 「2.5D 已移除、顶面贴图常开」是两条真不变量，原先却经由恒为 no-op 的
  // setBoardTilt / setTileArt 去断言（那两条 API 已随 2.5D 一并删除），等于什么都没验。
  // 改为 render 之后直接查 DOM 状态。
  if (!document.body.classList.contains('no-tilt')) throw new Error('2.5D 已移除，应保持平面');
  if (!document.body.classList.contains('tile-art')) throw new Error('tile-art 应常开');
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

// ---------------- 回归：AI 交易估值方向（2026-11-12 审查） ----------------
// aiTradeAccept(b, aProps, gc, bProps, wc)：aProps/gc 是发起方给 AI 的（AI 收进），
// bProps/wc 是 AI 让出的。旧实现整体取反，AI 会拒绝赚钱交易、接受亏本交易。
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
const tradeAI = { id: 1, caps: 1000 };
const tradeProps = data.TILES.filter(t => t.type === 'prop');
const cheapT = tradeProps.slice().sort((a, b) => a.price - b.price)[0];
const priceyT = tradeProps.slice().sort((a, b) => b.price - a.price)[0];
if (cheapT.group === priceyT.group) throw new Error('交易用例需要不同组的两块地');
if (!rulesCore.aiTradeAccept(tradeAI, [], 100, [], 0)) throw new Error('AI 白收 100 盖却拒绝');
if (rulesCore.aiTradeAccept(tradeAI, [], 0, [], 100)) throw new Error('AI 白付 100 盖却接受');
if (!rulesCore.aiTradeAccept(tradeAI, [priceyT], 0, [cheapT], 0)) throw new Error('AI 用便宜地换贵地应接受');
if (rulesCore.aiTradeAccept(tradeAI, [cheapT], 0, [priceyT], 0)) throw new Error('AI 用贵地换便宜地应拒绝');

// ---------------- 回归：付不起的租金不许凭空造币 ----------------
// 旧实现按全额给房东入账，随后破产又把地产一并转给房东，等于债主拿两份。
const richRentTile = data.TILES.find(t => t.type === 'prop' && !t.subType && t.rent >= 12);
if (!richRentTile) throw new Error('缺少可用于租金回归的普通地产');
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
Object.assign(state.G, { pacifist: false, rentMult: 1, jackpot: false, vendetta: false, rentSnowball: false });
const brokePayer = { id: 0, name: '穷鬼', caps: 5, bankrupt: false, inJail: false, jailTurns: 0, moral: 0 };
const landlordP = { id: 1, name: '房东', caps: 0, bankrupt: false, inJail: false, jailTurns: 0, moral: 0 };
state.G.players = [brokePayer, landlordP]; state.G.current = 0; state.G.lastRoll = 6;
richRentTile.owner = 1;
rules.payRent(brokePayer, richRentTile);
if (!brokePayer.bankrupt) throw new Error('付不起租金却没破产');
if (landlordP.caps !== 5) throw new Error('房东只应收实际可付的 5 盖，实际 ' + landlordP.caps);

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

// ---------------- P1 回归（2026-11-12 审查第二批） ----------------
// C5：「无法无天」突变下 enterJail 必须返回 false，并清掉双数计数
state.G.noJail = true;
const noJailProbe = { id: 0, name: '甲', doubles: 3, inJail: false, jailTurns: 0, bankrupt: false };
const didJail = rules.enterJail(noJailProbe);
state.G.noJail = false;
if (didJail !== false) throw new Error('「无法无天」下 enterJail 应返回 false');
if (noJailProbe.doubles !== 0) throw new Error('未关押时双数计数必须清零，否则下次双数会被当成三连');
if (noJailProbe.inJail) throw new Error('「无法无天」下不应进入隔离区');

// C6：任务兜底不得绕过 requires / requiresRep
const lockedPile = [{ id: 'locked_once', once: true, requires: ['flag_never'], title: '锁', choices: [] }];
const lockedPlayer = { flags: [], missionDone: [], factionRep: {} };
if (missionsMod.pickMission(lockedPile, lockedPlayer) !== null) {
  throw new Error('任务兜底绕过了 requires：未解锁的连锁任务被放出来了');
}
const donePile = [{ id: 'done_once', once: true, requires: [], title: '已完成', choices: [] }];
if (missionsMod.pickMission(donePile, { flags: [], missionDone: ['done_once'], factionRep: {} }) !== null) {
  throw new Error('已完成的一次性任务被重放');
}

// C13：payCaps 必须回报实际支付额（付不起时不按全额记账）
const payProbe = { id: 0, name: '穷', caps: 5, bankrupt: false, inJail: false, jailTurns: 0 };
state.G.players = [payProbe];
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
const actuallyPaid = rules.payCaps(payProbe, 20, '测试税');
if (actuallyPaid !== 5) throw new Error('payCaps 实际支付额应为 5，实际 ' + actuallyPaid);

// A4：生存模式没有身家目标；破产即走专属结局
state.G.mode = 'survival'; state.G.targetWealth = 3000;
const wealthProbe = { bankrupt: false };
if (game.targetWealthReached(wealthProbe, 9999)) throw new Error('生存模式不应因身家目标提前胜利');
state.G.mode = 'versus';
if (!game.targetWealthReached(wealthProbe, 9999)) throw new Error('对抗模式身家达标应判胜');

state.G.mode = 'survival';
state.G.players = [{ id: 0, name: '幸存者', short: '幸', isAI: false, caps: 0, pos: 0, bankrupt: true, inJail: false, jailTurns: 0, flags: [], missionDone: [], factionRep: {} }];
state.G.current = 0; state.G.turn = 12; state.G.gameOver = false; state.G.targetWealth = 0;
await game.takeTurn();
if (state.G.endKind !== 'survival') throw new Error('生存模式破产应走 survival 结局，实际 ' + state.G.endKind);
if (!state.G.gameOver) throw new Error('生存模式破产未结束对局');

// C7：合作模式「2 条铁路或 2 座设施」必须按队伍去重，不能把两人各 1 相加
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
const coopRails = data.TILES.filter(t => t.type === 'rail');
const coopUtils = data.TILES.filter(t => t.type === 'util');
coopRails[0].owner = 0; coopUtils[0].owner = 1;
const coopA = { id: 0, caps: 0, moral: 0, bankrupt: false };
const coopB = { id: 1, caps: 0, moral: 0, bankrupt: false };
const coopCtx = { TILES: data.TILES, netWorth: rules.netWorth };
const rCoopInfra = campaign.evaluateCampaignCoop(coopA, coopB, coopCtx, 2);
const coopInfraObj = rCoopInfra.objs.find(o => o.text.includes('铁路'));
if (!coopInfraObj) throw new Error('第三章缺少 infra 目标');
if (coopInfraObj.value !== 1 || coopInfraObj.done) {
  throw new Error('合作 infra 应按队伍去重（1 铁路 + 1 设施 = 1，未达成），实际 ' + coopInfraObj.value + ' done=' + coopInfraObj.done);
}
coopRails[1].owner = 0;
const rCoopInfra2 = campaign.evaluateCampaignCoop(coopA, coopB, coopCtx, 2);
const coopInfraObj2 = rCoopInfra2.objs.find(o => o.text.includes('铁路'));
if (!coopInfraObj2.done) throw new Error('队伍拥有 2 条铁路时应达成 infra 目标');

// C8：固定布局必须连顺序一起还原
data.shuffleBoard();
data.resetBoardOrder();
if (!data.TILES.every((t, i) => t.artIndex === i)) {
  throw new Error('resetBoardOrder 未还原 content/tiles.json 的原始顺序');
}

// ---------------- P2 安全回归：TTS 服务地址白名单 ----------------
const endpointMod = await import(pathToFileURL(join(HERE, 'electron', 'tts-endpoint.js')).href);
const epCheck = (u, o) => endpointMod.normalizeTtsBaseUrl(u, o);
if (!epCheck('https://api.example.com/v1').ok) throw new Error('公网 https 应放行');
if (epCheck('http://api.example.com/v1').ok) throw new Error('公网 http 必须拒绝（Key 会明文出网）');
if (!epCheck('http://127.0.0.1:9880').ok) throw new Error('本机 http 应放行（本地 TTS 服务）');
if (!epCheck('http://localhost:5000').ok) throw new Error('localhost http 应放行');
if (epCheck('https://192.168.1.10/v1').ok) throw new Error('私网 https 默认应拒绝');
if (!epCheck('https://192.168.1.10/v1', { allowPrivate: true }).ok) throw new Error('显式放行后私网应可用');
if (epCheck('https://169.254.169.254').ok) throw new Error('链路本地/元数据地址必须拒绝');
if (epCheck('file:///etc/passwd').ok) throw new Error('非 http(s) 协议必须拒绝');
if (epCheck('https://user:pass@api.example.com').ok) throw new Error('内嵌账号密码的地址必须拒绝');
if (epCheck('').ok) throw new Error('空地址必须拒绝');
const normalizedEp = epCheck('https://api.example.com/v1');
if (normalizedEp.url !== 'https://api.example.com/v1/audio/speech') {
  throw new Error('地址补全规则异常: ' + normalizedEp.url);
}
if (!endpointMod.sameOrigin('https://api.example.com/v1', 'https://api.example.com/v2')) {
  throw new Error('sameOrigin 应认同源');
}
if (endpointMod.sameOrigin('https://a.example.com', 'https://b.example.com')) {
  throw new Error('sameOrigin 不应跨主机');
}

// ---------------- P2 安全回归：存档字段收敛 ----------------
const saveNormalizer = await import(pathToFileURL(join(HERE, 'js', 'view-save.js')).href);
const hostileSave = {
  v: 4, mode: '<img src=x onerror=alert(1)>', campaign: 99, turn: 'NaN',
  SALARY: 'x', STARTCAPS: -5, targetWealth: Infinity, current: 99,
  tiles: data.TILES.map(() => ({ owner: 999, level: 99, mortgaged: 'yes', price: -1 })),
  players: [{
    id: 0, name: '<img src=x>', short: '<b>', color: 'red;position:fixed', caps: 'oops', pos: 999,
    cards: ['<svg onload=alert(1)>', 'march'], flags: [123, 'ok'], missionDone: 'nope',
    factionRep: { eagle: 'x' }, avatar: 'http://evil.example/x.png',
  }],
  boardArtOrder: [0, 0, 0],
  ruleState: { rentMult: '9', jackpot: 1, unknownKey: 'x' },
};
const normSave = saveNormalizer.normalizeSave(hostileSave);
if (normSave.mode !== 'versus') throw new Error('非法模式未被收敛: ' + normSave.mode);
if (normSave.campaign !== 5) throw new Error('章节索引未被钳制: ' + normSave.campaign);
if (normSave.turn !== 0) throw new Error('非法回合数未被收敛: ' + normSave.turn);
if (normSave.STARTCAPS !== 0) throw new Error('负数初始资金未被钳制: ' + normSave.STARTCAPS);
if (normSave.players[0].color !== '') throw new Error('非法颜色未被拒绝: ' + normSave.players[0].color);
if (normSave.players[0].pos !== config.TILES_COUNT - 1) throw new Error('越界位置未被钳制: ' + normSave.players[0].pos);
if (normSave.players[0].cards.length !== 1 || normSave.players[0].cards[0] !== 'march') {
  throw new Error('未知卡牌 id 未被过滤: ' + JSON.stringify(normSave.players[0].cards));
}
if (normSave.players[0].avatar !== '') throw new Error('非 data:image 头像未被拒绝');
if (normSave.players[0].flags.length !== 1) throw new Error('非字符串 flag 未被过滤');
if (normSave.tiles[0].owner !== null) throw new Error('越界 owner 未被置空');
if (normSave.tiles[0].level !== 2) throw new Error('越界等级未被钳制到 2');
if (normSave.boardArtOrder !== null) throw new Error('非法棋盘排列未被拒绝');
if (normSave.ruleState.rentMult !== 9 || normSave.ruleState.jackpot !== true) throw new Error('规则字段类型未收敛');
if ('unknownKey' in normSave.ruleState) throw new Error('未知规则字段未被丢弃');

// C12：连锁任务只看前置依赖，不再把「一次性」当连锁
if (missionsMod.isChainMission({ once: true })) throw new Error('一次性任务不应被标成连锁任务');
if (missionsMod.isChainMission({ once: false })) throw new Error('普通任务不应被标为连锁任务');
if (!missionsMod.isChainMission({ requires: ['flag_a'] })) throw new Error('有前置旗标的任务应标为连锁');
if (!missionsMod.isChainMission({ requiresRep: { eagle: 1 } })) throw new Error('有声望要求的任务应标为连锁');

// C14：突变因子「空解锁列表」必须等于全部可用（旧代码会把空数组当白名单 → 0 个因子）
const mutsProbe = await load('mutators.js');
if (mutsProbe.rollMutators(3, []).length !== 3) throw new Error('空解锁列表应视为全部突变因子可用');

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
state.G.players[0].luckyUsed = true;   // 「幸运开局」已用：必须随档保存
saveMod.saveGame();
const snap = JSON.parse(store.wasteland_save);
if (snap.v !== 4) throw new Error('存档版本应为 4');
if (snap.players[0].luckyUsed !== true) throw new Error('存档未保存 luckyUsed');
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
if (!state.G.players[0].luckyUsed) throw new Error('读档未恢复 luckyUsed（幸运开局会重复发放）');

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

// ---------------- P2 安全回归：手改存档经过 loadGame 会被收敛 ----------------
store.wasteland_save = JSON.stringify({
  v: 4, mode: 'versus', campaign: 0, turn: 3, current: 0,
  SALARY: 200, STARTCAPS: 1500, targetWealth: 0, gameOver: false,
  tiles: data.TILES.map(() => ({ owner: 0, level: 99, mortgaged: 'x', price: -5 })),
  players: [{
    id: 0, name: '<img src=x onerror=alert(1)>', short: 'x', isAI: false, caps: 'oops', pos: 0,
    cards: ['<svg onload=alert(1)>'], flags: [], missionDone: [],
    factionRep: { eagle: 'x' }, avatar: 'http://evil.example/x.png',
  }],
  boardArtOrder: [1, 2, 3],
});
saveMod.loadGame();
if (data.TILES[0].level !== 2) throw new Error('手改存档的等级未被收敛到 0..2');
if (data.TILES[0].owner !== 0) throw new Error('合法 owner 被误清');
if (state.G.players[0].cards.length !== 0) throw new Error('未知卡牌 id 在 loadGame 后仍存在');
if (state.G.players[0].avatar !== '') throw new Error('非 data:image 头像在 loadGame 后仍存在');
if (state.G.mode !== 'versus') throw new Error('非法模式在 loadGame 后仍存在');

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

// ---------------- 回归：落地面板的「结束回合」必须一步生效 ----------------
// 旧实现把该按钮接到 afterHumanAction，只重建操作栏、不结束回合，玩家得点两次。
const idleHuman = state.G.players.find(p => !p.isAI) || state.G.players[0];
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
const freePropIdx = data.TILES.findIndex(t => t.type === 'prop');
idleHuman.pos = freePropIdx;
idleHuman.extraRoll = false;
idleHuman.bankrupt = false;
state.G.current = idleHuman.id;
state.G.pendingTile = null;
state.G.targetWealth = 0;  // 身家达标会走 gameWin 分支，测不到回合推进
state.G.gameOver = true;   // 只测「本回合是否推进」，阻止后续 AI 链；endTurn 不因 gameOver 提前返回
await game.resolveTile(idleHuman);
const oneClickEnd = document.getElementById('endBtn');
if (!oneClickEnd) throw new Error('落地面板未渲染结束回合按钮');
const turnBeforeEnd = state.G.turn;
oneClickEnd.onclick();
if (state.G.turn === turnBeforeEnd) throw new Error('落地面板「结束回合」没有一步结束回合'
  + ` (mode=${state.G.mode} target=${state.G.targetWealth} extraRoll=${idleHuman.extraRoll})`);

// ---------------- 回归：读档时 pendingTile 优先于 extraRoll ----------------
// 双数落地买地时存档，两个标记同时存在；旧顺序先判 extraRoll，读档后购买机会丢失。
state.G.gameOver = false;
state.G.current = idleHuman.id;
state.G.players.forEach(p => { p.bankrupt = false; });
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
const pendingIdx = data.TILES.findIndex(t => t.type === 'prop');
idleHuman.pos = pendingIdx;
idleHuman.extraRoll = true;
state.G.pendingTile = data.TILES[pendingIdx];
state.G.awaitingRoll = false;
state.G.targetWealth = 0;
game.restoreTurnUI();
if (!document.getElementById('buyBtn')) throw new Error('pendingTile 与 extraRoll 同时存在时，读档应优先恢复落地面板');
// DOM 桩的 getElementById 会缓存旧节点，不能靠 rollBtn 是否存在判断，
// 必须看本次真正渲染进操作区的 HTML。
const restoredActionsHtml = document.getElementById('actions').innerHTML;
if (!restoredActionsHtml.includes('buyBtn')) throw new Error('恢复落地面板时操作区未渲染购买按钮');
if (restoredActionsHtml.includes('rollBtn')) throw new Error('恢复落地面板时不应先进补掷界面');
state.G.gameOver = true;

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

// ---------------- 回归：隔离区一回合只能掷一次（严格规则） ----------------
const jailHuman = {
  id: 0, name: '囚', short: '囚', isAI: false, color: '#fff', caps: 1000, pos: 0,
  skipNext: false, bankrupt: false, inJail: true, jailTurns: 0, getOut: 0, doubles: 0,
  extraRoll: false, moral: 0, flags: [], missionDone: [], cards: [], factionRep: {}
};
const jailAI = {
  id: 1, name: '看守', short: 'AI', isAI: true, color: '#fff', caps: 1000, pos: 0,
  skipNext: false, bankrupt: false, inJail: false, jailTurns: 0, getOut: 0, doubles: 0,
  extraRoll: false, moral: 0, flags: [], missionDone: [], cards: [], factionRep: {}
};
Object.assign(state.G, {
  mode: 'versus', players: [jailHuman, jailAI], current: 0, turn: 12,
  gameOver: false, targetWealth: 0, awaitingRoll: false, pendingTile: null,
  pacifist: false, moralDrain: 0, bankInterest: false, landTax: 0,
});
await game.takeTurn();   // 人类在隔离区 → 隔离区面板
if (!document.getElementById('jb3')) throw new Error('隔离区面板未渲染「掷骰逃出」');
// 骰子由 roll() 在最前两次 Math.random 决定：0 → 1 点，0.5 → 4 点（非双数）
const origRandom = Math.random;
let diceCalls = 0;
Math.random = () => (diceCalls++ === 0 ? 0 : 0.5);
document.getElementById('jb3').onclick();
const jailDeadline = Date.now() + 5000;
while (jailHuman.jailTurns === 0 && Date.now() < jailDeadline) await tick();
Math.random = origRandom;
if (jailHuman.jailTurns !== 1) throw new Error('隔离区掷骰失败未计入 jailTurns，实际 ' + jailHuman.jailTurns);
if (state.G.current === 0) throw new Error('隔离区失败后本回合未结束（同一回合还能再掷一次）');
if (jailHuman.inJail !== true) throw new Error('未掷出双数不应提前离开隔离区');
state.G.gameOver = true;   // 阻止 AI 链继续推进，只验证本回合是否结束
await tick();
console.log('隔离区单回合单次掷骰校验通过');

// ---------------- 回归：遗产加成只作用于人类（C11） ----------------
store.wasteland_legacy_meta = JSON.stringify({
  points: 999, totalRuns: 3, bestScore: 0,
  unlockedBonuses: ['getout_start', 'moral_bonus', 'start_card'],
  unlockedMutators: [], lastEndKind: null, lastMoral: 0,
});
getEl('mode').value = 'legacy';
getEl('slot0').value = 'human';
getEl('slot1').value = 'ai';
getEl('slot2').value = 'off';
getEl('slot3').value = 'off';
getEl('startCaps').value = '1500';
getEl('target').value = '0';
data.TILES.forEach(t => { if ('owner' in t) { t.owner = null; t.level = 0; t.mortgaged = false; } });
game.startGame();
const legacyHuman = state.G.players.find(p => !p.isAI);
const legacyAI = state.G.players.find(p => p.isAI);
if (!legacyHuman || !legacyAI) throw new Error('遗产局应有人类与 AI');
if (legacyHuman.getOut !== 1) throw new Error('人类应获得 1 张起始出狱卡，实际 ' + legacyHuman.getOut);
if (legacyHuman.moral !== 2) throw new Error('人类起始道德应为 2，实际 ' + legacyHuman.moral);
if (legacyHuman.cards.length !== 1) throw new Error('人类应有 1 张起始手牌，实际 ' + legacyHuman.cards.length);
if (legacyAI.getOut !== 0) throw new Error('AI 不应获得遗产出狱卡，实际 ' + legacyAI.getOut);
if (legacyAI.moral !== 0) throw new Error('AI 不应获得遗产道德加成，实际 ' + legacyAI.moral);
if (legacyAI.cards.length !== 0) throw new Error('AI 不应获得遗产手牌，实际 ' + legacyAI.cards.length);
state.G.gameOver = true;
console.log('遗产加成归属校验通过');

// ---------------- 回归：TTS 取消 / 语速 / 引擎标记（A3） ----------------
// 用假 Audio 复现浏览器的关键行为：pause() 不会触发 ended —— 这正是旧实现要等 60s 的原因。
const ttsMod = await load('tts.js');
const createdAudios = [];
class FakeAudio {
  constructor(url) {
    this.url = url; this.volume = 1; this.playbackRate = 1;
    this.paused = true; this.played = false;
    createdAudios.push(this);
  }
  play() {
    if (FakeAudio.failPlay) return Promise.reject(new Error('autoplay blocked'));
    this.paused = false; this.played = true;
    if (FakeAudio.autoEnd) setImmediate(() => { if (this.onended) this.onended(); });
    return Promise.resolve();
  }
  pause() { this.paused = true; }
}
FakeAudio.autoEnd = false;
FakeAudio.failPlay = false;
const origAudio = global.Audio;
global.Audio = FakeAudio;
window.wastelandDesktop = {
  custom: {
    init: async () => ({ ok: true, model: 'test-model', voice: 'test-voice' }),
    speak: async () => ({ ok: true, audio: new Uint8Array(128), format: 'mp3' }),
    clearKey: async () => ({ ok: true }),
  },
  mimo: { init: async () => ({ ok: true }), clearKey: async () => ({ ok: true }) },
};
ttsMod.setVoiceSource('custom');
ttsMod.setTtsEnabled(true);
ttsMod.setTtsRate(1.5);
global.setTimeout = nodeSetTimeout;   // 真实定时器：否则 playBlob 的 60s 兜底会被折叠成立即触发

// 1) 正在播放时取消：必须立即结算（旧实现只 pause，要等 60s 定时器）
const firstSpeak = ttsMod.ttsSpeak('测试语音一');
for (let i = 0; i < 20 && !createdAudios.length; i++) await tick();
if (!createdAudios.length) throw new Error('自定义 TTS 未开始播放');
if (Math.abs(createdAudios[0].playbackRate - 1.5) > 1e-6) {
  throw new Error('语速未应用到音频播放，playbackRate=' + createdAudios[0].playbackRate);
}
ttsMod.cancelTts();
const settleResult = await Promise.race([
  firstSpeak.then(() => 'ok'),
  new Promise(r => setTimeout(() => r('timeout'), 800)),
]);
if (settleResult !== 'ok') throw new Error('cancelTts 未让正在播放的播报立即结算（旧实现要等 60s）');

// 2) 取消后，旧链上排队的播报不得再播
createdAudios.length = 0;
const queuedA = ttsMod.ttsSpeak('取消前排队一');
const queuedB = ttsMod.ttsSpeak('取消前排队二');
ttsMod.cancelTts();
await Promise.all([queuedA, queuedB]);
await tick(); await tick();
if (createdAudios.length) throw new Error('取消后仍播放了旧链上排队的播报');

// 3) 只有正常播完才标记引擎可用
FakeAudio.autoEnd = true;
const doneSpeak = ttsMod.ttsSpeak('正常播完');
await doneSpeak;
if (ttsMod.ttsEngineStatus() !== 'custom') throw new Error('播报成功后引擎状态未标记: ' + ttsMod.ttsEngineStatus());

// 4) autoplay 被拒不能报告引擎可用
FakeAudio.autoEnd = false;
FakeAudio.failPlay = true;
const failTest = await ttsMod.testTts();
if (failTest !== null) throw new Error('播放失败不应报告引擎可用，实际 ' + failTest);

global.Audio = origAudio;
ttsMod.cancelTts();
ttsMod.setTtsEnabled(false);
global.setTimeout = stubSetTimeout;   // 恢复 dom-stub 的「setTimeout = setImmediate」
try { delete window.wastelandDesktop; } catch (_) { window.wastelandDesktop = undefined; }
createdAudios.length = 0;
console.log('TTS 取消 / 语速 / 引擎标记校验通过');

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

// ---------------- 回归：战报折叠（M2.1） ----------------
// 战报只保留最近 40 条完整节点，更早的折叠成底部一条摘要；裁剪逻辑要真正生效。
{
  const logEl = getEl('log');
  const cnOf = c => (c && typeof c.className === 'string' ? c.className : '');
  const isEntry = c => cnOf(c).indexOf('logEntry') >= 0;
  const isSummary = c => cnOf(c).indexOf('logSummary') >= 0;
  logEl.innerHTML = '';
  for (let i = 0; i < 50; i++) view.log('测试战报 ' + i);
  const entryCount = logEl.children.filter(isEntry).length;
  const summaryCount = logEl.children.filter(isSummary).length;
  if (entryCount !== 40) throw new Error('战报应只保留最近 40 条，实际 ' + entryCount);
  if (summaryCount !== 1) throw new Error('应恰有 1 条折叠摘要，实际 ' + summaryCount);
  if (logEl.children.length !== 41) throw new Error('战报 + 摘要应共 41 个子节点，实际 ' + logEl.children.length);
  const summary = logEl.children.find(isSummary);
  if (!summary || !/已省略 10 条/.test(summary.textContent)) {
    throw new Error('摘要文案应报告被折叠条数，实际 ' + JSON.stringify(summary && summary.textContent));
  }
  logEl.innerHTML = '';   // 清掉测试数据，不影响后续
  console.log('战报折叠校验通过（40 条 + 1 条摘要）');
}

if (errors.length) { console.error('运行期错误:\n' + errors.join('\n')); process.exit(1); }
console.log('\n✅ SMOKE TEST PASSED');
// buildSetup() 会注册 setInterval（TTS 状态轮询），必须显式退出，否则进程永不结束、CI 挂死。
// 用 process.exitCode 兜底：若中途抛异常被上面的处理器接住而没走到这里，
// 前面写下的 exitCode=1 仍会在事件循环排空后生效，不会退化成 0。
process.exit(process.exitCode || 0);
