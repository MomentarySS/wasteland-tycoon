// 棋盘几何共享：格尺寸缓存 + 格子视口矩形（DOM / Canvas 双模式共用）
import { CELL } from './config.js';
import { positions } from './data.js';

const ENABLED = typeof document !== 'undefined' && !!document.documentElement;
let _cached = null;

export function getCellMetrics() {
  if (_cached) return _cached;
  if (!ENABLED || typeof getComputedStyle !== 'function' || !document.documentElement) {
    _cached = { cellW: CELL, cellH: CELL, gap: 3 };
    return _cached;
  }
  const cs = getComputedStyle(document.documentElement);
  const w = parseFloat(cs.getPropertyValue('--cell-w'));
  const h = parseFloat(cs.getPropertyValue('--cell-h'));
  const g = parseFloat(cs.getPropertyValue('--gap'));
  _cached = {
    cellW: w > 0 ? w : CELL,
    cellH: h > 0 ? h : CELL,
    gap: g > 0 ? g : 3,
  };
  return _cached;
}

export function invalidateCellMetricsCache() { _cached = null; }

/**
 * 格子视口矩形：DOM 格元素优先；Canvas 模式（无 .tile 元素）按格几何推算。
 * 供 footprint / 建造动效 / 升级飘字等特效定位使用。
 */
export function getTileRect(idx) {
  if (!ENABLED) return null;
  const el = document.querySelector(`.tile[data-i="${idx}"]`);
  if (el && typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect();
    if (r && (r.width || r.height)) return r;
  }
  const pos = positions[idx];
  const inner = document.getElementById('boardInner');
  if (!pos || !inner || typeof inner.getBoundingClientRect !== 'function') return null;
  const br = inner.getBoundingClientRect();
  if (!br) return null;
  const { cellW, cellH, gap } = getCellMetrics();
  const [r, c] = pos;
  const left = br.left + c * (cellW + gap);
  const top = br.top + r * (cellH + gap);
  return { left, top, width: cellW, height: cellH, right: left + cellW, bottom: top + cellH };
}
