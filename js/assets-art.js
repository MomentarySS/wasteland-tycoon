// 生图资源路径（与 scripts/step-image-jobs.json 一致）
import { assetUrl } from './paths.js';
import { eventArt } from './icons.js';

/** 44 格棋盘插画，下标 = 格子序号 */
export const TILE_ART = [
  'assets/tiles/tile-00-start.webp',
  'assets/tiles/tile-01-feiche.webp',
  'assets/tiles/tile-02-duanbi.webp',
  'assets/tiles/tile-03-event.webp',
  'assets/tiles/tile-04-shuiguan.webp',
  'assets/tiles/tile-05-tax.webp',
  'assets/tiles/tile-06-tianqiao.webp',
  'assets/tiles/tile-07-xianbing.webp',
  'assets/tiles/tile-08-event.webp',
  'assets/tiles/tile-09-heishi.webp',
  'assets/tiles/tile-10-wuqi.webp',
  'assets/tiles/tile-11-jail.webp',
  'assets/tiles/tile-13-buji.webp',
  'assets/tiles/tile-14-gaizhuang.webp',
  'assets/tiles/tile-15-rail-s.webp',
  'assets/tiles/tile-15-event.webp',
  'assets/tiles/tile-16-lueduo.webp',
  'assets/tiles/tile-17-tax.webp',
  'assets/tiles/tile-18-junfa.webp',
  'assets/tiles/tile-19-rail-e.webp',
  'assets/tiles/tile-20-jiayou.webp',
  'assets/tiles/tile-21-power.webp',
  'assets/tiles/tile-22-safe.webp',
  'assets/tiles/tile-23-event.webp',
  'assets/tiles/tile-24-duxiao.webp',
  'assets/tiles/tile-25-qingbao.webp',
  'assets/tiles/tile-26-tax.webp',
  'assets/tiles/tile-27-shuju.webp',
  'assets/tiles/tile-28-xinpian.webp',
  'assets/tiles/tile-29-heishi2.webp',
  'assets/tiles/tile-30-event.webp',
  'assets/tiles/tile-31-peiyang.webp',
  'assets/tiles/tile-32-bingdu.webp',
  'assets/tiles/tile-33-rail-w.webp',
  'assets/tiles/tile-34-safe.webp',
  'assets/tiles/tile-35-water.webp',
  'assets/tiles/tile-36-wormhole.webp',
  'assets/tiles/tile-37-bounty.webp',
  'assets/tiles/tile-38-oasis.webp',
  'assets/tiles/tile-39-event.webp',
  'assets/tiles/tile-40-liangzi.webp',
  'assets/tiles/tile-41-jiyin.webp',
  'assets/tiles/tile-42-event.webp',
  'assets/tiles/tile-43-event.webp',
];

export const ZONE_TEX = {
  rust: 'assets/ui/zone-rust.webp',
  market: 'assets/ui/zone-market.webp',
  gang: 'assets/ui/zone-gang.webp',
  tech: 'assets/ui/zone-tech.webp',
  bio: 'assets/ui/zone-bio.webp',
};

export const UI_ART = {
  boardCenter: 'assets/ui/board-center-radar.webp',
  dust: 'assets/ui/bg-dust-layer.webp',
  lightning: 'assets/ui/bg-lightning.webp',
  boardContours: 'assets/ui/bg-board-contours.webp',
  boardIndustrial: 'assets/ui/bg-board-industrial.webp',
  boardRadiation: 'assets/ui/bg-board-radiation.webp',
  dustSpecks: 'assets/ui/fx-dust-specks.webp',
};

/** 核弹专用插画（SVG 内置；webp 可由 step-image-jobs 生成后自动优先） */
export const NUKE_ART = {
  launch: 'assets/ui/nuke-launch.webp',
  strike: 'assets/ui/nuke-strike.webp',
  launchSvg: 'assets/ui/nuke-launch.svg',
  strikeSvg: 'assets/ui/nuke-strike.svg',
};

export function nukeArtUrl(kind = 'strike') {
  const rel = kind === 'launch' ? NUKE_ART.launch : NUKE_ART.strike;
  return rel ? assetUrl(rel) : '';
}

export function nukeArtHtml(kind = 'strike') {
  const svg = assetUrl(kind === 'launch' ? NUKE_ART.launchSvg : NUKE_ART.strikeSvg);
  const webp = nukeArtUrl(kind);
  if (!svg && !webp) return eventArt('nuke');
  if (!webp) return `<img class="nukeArtImg" src="${svg}" alt="" loading="eager" decoding="async">`;
  return `<picture class="nukeArtPic"><source srcset="${webp}" type="image/webp"><img class="nukeArtImg" src="${svg}" alt="" loading="eager" decoding="async"></picture>`;
}

export function tileArtUrl(index) {
  const rel = TILE_ART[index];
  return rel ? assetUrl(rel.replace('assets/tiles/', 'assets/tiles-redrawn/')) : '';
}

export function zoneTexUrl(group) {
  const rel = ZONE_TEX[group];
  return rel ? assetUrl(rel) : '';
}

export function eventArtUrl(eventId) {
  if (!eventId) return '';
  return assetUrl(`assets/events/evt-${eventId}.webp`);
}

/** 已生成 16:9 位图的事件 id（与 scripts/step-image-jobs.json 的 assets/events/ 输出一致）。
 *  未在表内的事件（如 chain 系 / fac 系剧情与派系任务）回退 EVENT_ARTS SVG，避免弹窗破图。 */
const EVENT_ART_GENERATED = new Set([
  'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16',
  'fo76_cargobot', 'fo76_officer', 'fo76_reactor', 'fo76_blast',
  'nuke_chain_1', 'nuke_chain_2', 'nuke_chain_3',
  'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16', 'i17', 'i18',
  'chain_eagle_1', 'chain_eagle_2', 'chain_eagle_3', 'chain_map_1', 'chain_map_2',
  'fac_eagle_1', 'fac_survivor_1', 'fac_tech_1', 'fac_eagle_2',
  // 以下新链任务使用 SVG 回退插画（未生成位图）
  // 'chain_med_1', 'chain_med_2', 'chain_med_3',
  // 'chain_water_1', 'chain_water_2',
  // 'chain_tech_1', 'chain_tech_2', 'chain_tech_3',
  // 'chain_trade_1', 'chain_trade_2',
  // 'chain_spy_1', 'chain_spy_2', 'chain_spy_3',
]);

/** 事件弹窗：已生成位图的 id 用 <img>，其余回退 SVG 插画 */
export function eventArtHtml(m) {
  const url = m && m.id && EVENT_ART_GENERATED.has(m.id) ? eventArtUrl(m.id) : '';
  if (url) {
    return `<img class="evtImg" src="${url}" alt="" loading="lazy" decoding="async">`;
  }
  return eventArt(m && m.art ? m.art : 'caps');
}

export function uiArtUrl(key) {
  const rel = UI_ART[key];
  return rel ? assetUrl(rel) : '';
}

/** 坏事件闪电视效（Tier B） */
export function flashLightning(ms = 480) {
  if (typeof document === 'undefined') return;
  document.body.classList.add('bad-lightning');
  setTimeout(() => document.body.classList.remove('bad-lightning'), ms);
}
