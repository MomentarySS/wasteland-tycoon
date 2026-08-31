// ============================================================
// player-row.js — 玩家行 DOM 引用管理（v1.6.0 接手轮）
// 目的：把原本挂在 player 对象上的 _rowEl 抽出,用 module-level
//       WeakMap 管理,数据/DOM 引用分离。
// 解决：(1) 存档 JSON.stringify 时 _rowEl 是 DOM 节点会爆栈;
//        (2) 数据/DOM 耦合;(3) 跨局未清理时占用内存。
// 依赖方向：view-core.js → player-row.js,fx.js → player-row.js
//           （两个消费者都单向 import 此模块,无循环）
// ============================================================
const rowElMap = new WeakMap();

/** 写入玩家行 DOM 引用（view-core 渲染玩家面板时调用） */
export function setPlayerRowEl(p, el) {
  if (p && el) rowElMap.set(p, el);
}

/** 读取玩家行 DOM 引用（fx 飘字/金币动画需要时调用） */
export function getPlayerRowEl(p) {
  return p ? rowElMap.get(p) : null;
}
