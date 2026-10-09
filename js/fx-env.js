// 表现层环境探测的公共小工具
//
// fx.js / fx-events.js / cutscene.js 此前各自内联一份逐字相同的 reducedMotion 与
// sleep（报告 §4.4 记为三份重复），rectOf 又在 fx.js 与 fx-events.js 各存一份。
// 三者都是纯表现层辅助，不参与任何规则判定，集中到此处避免改一处漏两处。
//
// 注意：各模块的 ENABLED 口径**不统一**，本模块只提供共同的前置条件 DOM_READY。
// fx.js 额外要求 document.body 为对象，另两个只要求 documentElement —— 该差异是
// 各模块自身的既有判断，不在本次合并范围内，调用方请自行组合。

/** document 与 documentElement 均可用（三个表现层模块的共同前置条件） */
export const DOM_READY = typeof document !== 'undefined' && !!document.documentElement;

/** 用户是否偏好降低动效；无法探测时按「未开启」处理 */
export function reducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 元素的视口矩形；元素不存在、不支持测量或尺寸全为 0 时返回 null */
export function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return null;
  return r;
}