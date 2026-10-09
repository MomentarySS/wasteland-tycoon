// 全局常量与基础配置
export const N = 12, TILES_COUNT = 44, CELL = 57;
export const GROUPS = {
  rust: { name: '森林区' }, market: { name: '毒谷区' }, gang: { name: '灰堆区' },
  tech: { name: '裂谷区' }, bio: { name: '沼泽区' }
};
/** 派系声望（events.json faction deck；id 保留兼容存档） */
export const FACTIONS = {
  eagle: '掠夺者', survivor: '响应者', tech: '残存政府'
};
export const COLORS = ['#e84c3d', '#3498db', '#2ecc71', '#f1c40f'];
export const SHORT = ['甲', '乙', '丙', '丁'];
export const TOKEN_SLOT = [[0.18, 0.18], [0.82, 0.18], [0.18, 0.36], [0.82, 0.36]];
export const JAIL_FEE = 50;
/** 黑市偷袭费。此前散落 rules.js（门槛/扣费/战报文案）与 view-modal.js（按钮门槛/文案）
 *  共 4 处字面量，改价必然漏改 —— 与 cards.js 的 CARD_PRICE 是同一类问题。 */
export const STEAL_PRICE = 80;
export const GAME_TITLE = '废土大亨：末世大富翁';
export const BRAND_MARK_HTML =
  '<img class="brand-mark" src="logo.svg" alt="" width="28" height="28" decoding="async">';
export const MAX_TURNS = 1500;   // 对抗模式回合计上限
export const MAX_TURNS_CAMPAIGN = 1000;  // 五章闯关上限

/** 地块类型码 → 显示名。DOM（view-core）与 Canvas（board-canvas）两条渲染路径共用，
 *  此前两边各存一份逐字相同的 13 项映射，改一处必然漂移成可见的名称不一致。 */
export const TYPE_LABEL = {
  start: '避难所', event: '事件', tax: '税收', quarantine: '隔离区', safe: '安全地带',
  rail: '哨站', util: '设施', wormhole: '虫洞', blackmarket: '黑市', bounty: '赏金',
  oasis: '绿洲', radiation: '矿坑', bunker: '掩体',
};

/** 地块显示名：content 自带 name 优先，缺省回退到类型名，再缺省用类型码本身。 */
export function tileDisplayName(t) {
  if (t.name) return t.name;
  return TYPE_LABEL[t.type] || t.type;
}
