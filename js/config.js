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
/** @deprecated 保留兼容；请用 TOKEN_SLOT */
export const OFF = [[0, 0], [11, 0], [0, 11], [11, 11]];
export const JAIL_FEE = 50;
export const GAME_TITLE = '废土大亨：末世大富翁';
export const BRAND_MARK_HTML =
  '<img class="brand-mark" src="logo.svg" alt="" width="28" height="28" decoding="async">';
export const MAX_TURNS = 1500;   // 对抗模式回合计上限
export const MAX_TURNS_CAMPAIGN = 1000;  // 五章闯关上限
