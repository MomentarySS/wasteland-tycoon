# 地形变种研究（terrain variants）

> 状态：草案 / 调研。  
> 适用：wasteland-tycoon 2D 桌游（`content/tiles.json` + `js/*.js`；`www/` 只是同步镜像）。  
> 调研日期：2026-09-02。

## 0. 摘要

当前 16 种地块类型已覆盖主要大富翁玩法，但可购地块（`prop`）只有 5 组（rust / market / gang / tech / bio），缺乏"同组不同质"的变化。  
本调研提出 **4 套可购地块子类型**（landmark / shack / volatile / cursed）+ **6 类新行动格** + **移动修正格** + **第六组 prop** + **mutator 联动视觉变种** + **战役专属 tile**。  
按性价比推荐落地路径：① prop subType → ② 1–2 个新行动格 → ③ mutator 视觉变种 → ④ ⑥ ⑤ 后续扩展。

---

## 1. 现状盘点

| 类别 | 类型 | 现数量 | 关键代码位置 |
|---|---|---|---|
| 可购 | `prop`（5 组）/ `rail` / `util` | 24+3+2 | `data.js:30-46` |
| 财富 | `start` / `tax` / `safe` / `wormhole` | 4 | `data.js:30-46` |
| 行动 | `event` / `blackmarket` / `bounty` / `oasis` / `radiation` / `bunker` | 8+ | `data.js:30-46`, `game.js:444-559` |
| 惩罚 | `quarantine` | 1 | `game.js:521` |

- 棋盘规格：12×12、44 格、N=12，详见 `config.js:2`。
- 渲染：canvas 路径在 `board-canvas.js:212-232`；DOM 回退在 `view-core.js`。
- 落地逻辑：所有 type 在 `game.js:resolveTile` 内 `else if` 分发。
- 已有 25 个 mutator（规则突变），见 `mutators.js:MUTATOR_POOL`。
- prop 颜色 / 图标已硬编码在 `board-canvas.js:21-26`（`WALL_COLORS`）和 `icons.js:tileIcon`。

---

## 2. 变种扩展方向

### 2.1 ① prop 子类型（推荐首选）

新增字段 `t.subType`（字符串），可选 4 值：`landmark` / `shack` / `volatile` / `cursed`。

| subType | 中文 | 视觉 | 机制 | JSON 改动 |
|---|---|---|---|---|
| `landmark` | 地标 | `★` 徽章 | price / rent 在 JSON 中直接 ×3；**不可抵押** | 写入新 price/rent |
| `shack` | 棚户 | `棚` 徽章 | 收租时地主持有者额外 `-10 盖` 维护费（现金不足则地块废弃） | 写入新 price/rent |
| `volatile` | 流动 | `骰` 徽章 | rent = base × (level+1) × `G.lastRoll`（跟骰子浮动 1×–12×） | 写入 base |
| `cursed` | 污染 | `☠` 徽章 | 收租时对手 `p.moral -= 1` | 写入新 price/rent |

**为什么首选**：
- 改动集中在 3 个文件（`data.js` / `rules-core.js` / `rules.js`）。
- 通过 `SUBTYPE_DEFS` 注册表驱动，新增 subType 只需扩 JSON + 扩注册表。
- 玩家感知最强：同组里出现"一栋锈塌的棚户"和"一栋国会交易所"，叙事感直接拉满。

### 2.2 ② 新行动格（每格 1 个独立规则）

仿 `blackmarket` / `bounty` 的"AI 走 / 人类弹窗"模式（参考 `game.js:548-559`）：

| 名称 (type) | 效果 | 复用代码 |
|---|---|---|
| `auctionHouse` 拍卖所 | 强制随机抽 1 名对手的 1 块 prop 公开拍卖 | 复用 `auction()` |
| `radioTower` 信号塔 | 抽 1 张事件卡，但 100% 是好事件 | 复用 `pickMission(INTEL)` |
| `bounty_swap` 替罪羊 | 自己选 1 名对手，让他被关 1 回合 | 复用 `enterJail()` |
| `campsite` 露营地 | 跳过下回合（自选），+30 盖补偿 | 加 `p.skip` 标记 |
| `vault` 应急金库 | 一次性取 200 盖，但下次过 `start` 不发工资 | 简单 if |
| `oilrig` 钻井 | 踩中 +100 盖，**且**地图随机多 1 块新 prop | 需动 `TILES` 长度 |

### 2.3 ③ 移动修正格（不影响购买链路）

| 名称 (type) | 效果 |
|---|---|
| `quicksand` 流沙 | 下一次骰子 -1 |
| `windfall` 顺风 | 下一次骰子 +1（与 `brokeRush` 突变联动） |
| `toll` 过路 | 踩中扣 50 盖（不像 `tax` 是静态） |

### 2.4 ④ 第六组 prop（视觉/机制双拓展）

现有 5 组颜色都用上了（rust/market/gang/tech/bio）。可加：

- `farm` 农场 — 绿赭色，rent 公式不同（自家每块 +5）
- `enclave` 飞地 — 紫色，独立收费

需配套：
- CSS 变量（`style.css` 的 `--farm` / `--enclave`）
- `WALL_COLORS` 映射（`board-canvas.js:21-26`）
- `tileIcon` 新图标（`icons.js`）
- `GROUPS` 数据（`view-core.js` 的中文名）

### 2.5 ⑤ 战役专属 tile（剧情/关卡绑定）

`campaign.js` 已有"持有 N 块地产 / 道德 ≥ N"等目标。可加：

- `vault_door` 仅在第 3 章出现：所有人强制抽 1 张牌
- `rescue_pod` 仅在第 5 章：免费送回 start
- 解锁逻辑：`data.js:142 loadContent` 之后加 `unlockTiles(chapter)`

### 2.6 ⑥ 动态视觉变种（mutator 联动）

不强加新 type，而是让现有 type 在特定突变下换贴图：

- 突变 `wildfire`：所有 `prop.rust` 临时贴红色火焰 +50% rent
- 突变 `flood`：`oasis` 反向变成 -30 盖

实现：`board-canvas.js:212` 改读 `G.activeMutators` 选贴图，复用 100% 渲染管线。

---

## 3. 推荐落地路径

按"投入产出比"排序：

1. **① prop subType**（半天代码量，机制深度最高，玩家感知最强）
2. **② 1–2 个行动格**（`auctionHouse` 和 `campsite` 性价比最高）
3. **⑥ 视觉变种**（不需新规则，新贴图/新色 + 已有突变驱动，复用 100% 代码）
4. ③④⑤ 等数据 / 战役需求明确时再做

---

## 4. ① prop subType 完整实现草案

### 4.1 `www/content/tiles.json`

8 块地、4 种 subType 都覆盖（按价格区间不冲突 + 角色贴脸原则挑选）：

```json
[
  { "t": "start", "name": "避难所出口" },
  { "t": "prop", "group": "rust", "name": "摩根镇废场", "price": 60, "rent": 4 },
  { "t": "prop", "group": "rust", "name": "森林断墙", "price": 60, "rent": 4 },
  { "t": "radiation", "name": "莫诺加矿洞" },
  { "t": "prop", "group": "rust", "name": "锈蚀管道", "price": 80, "rent": 6 },
  { "t": "tax", "tax": 50 },
  { "t": "prop", "group": "rust", "name": "断裂天桥", "price": 90, "rent": 7, "subType": "shack" },
  { "t": "prop", "group": "rust", "name": "旧警备所", "price": 100, "rent": 8 },
  { "t": "event" },
  { "t": "prop", "group": "market", "name": "响应者摊位", "price": 120, "rent": 10 },
  { "t": "prop", "group": "market", "name": "毒谷枪铺", "price": 140, "rent": 12 },
  { "t": "quarantine" },
  { "t": "prop", "group": "market", "name": "格拉夫顿补给", "price": 160, "rent": 14 },
  { "t": "prop", "group": "market", "name": "改装工坊", "price": 180, "rent": 16 },
  { "t": "rail", "name": "阿尔法哨", "price": 200 },
  { "t": "event" },
  { "t": "prop", "group": "gang", "name": "灰堆掠夺堡", "price": 220, "rent": 22 },
  { "t": "tax", "tax": 100 },
  { "t": "prop", "group": "gang", "name": "掠夺者军阀", "price": 260, "rent": 26, "subType": "landmark" },
  { "t": "rail", "name": "布拉沃哨", "price": 200 },
  { "t": "prop", "group": "rust", "name": "森林加油站", "price": 70, "rent": 5, "subType": "shack" },
  { "t": "util", "name": "裂谷电站", "price": 150 },
  { "t": "safe" },
  { "t": "event" },
  { "t": "prop", "group": "gang", "name": "灰堆毒巢", "price": 240, "rent": 24, "subType": "cursed" },
  { "t": "prop", "group": "market", "name": "毒谷情报商", "price": 170, "rent": 15 },
  { "t": "tax", "tax": 75 },
  { "t": "prop", "group": "tech", "name": "裂谷数据塔", "price": 130, "rent": 11, "subType": "volatile" },
  { "t": "prop", "group": "tech", "name": "隔离电台阵列", "price": 150, "rent": 13 },
  { "t": "blackmarket" },
  { "t": "bunker", "name": "国会掩体" },
  { "t": "prop", "group": "bio", "name": "裂隙培养池", "price": 140, "rent": 12, "subType": "volatile" },
  { "t": "prop", "group": "bio", "name": "沼泽样本库", "price": 160, "rent": 14 },
  { "t": "rail", "name": "查理哨", "price": 200 },
  { "t": "safe" },
  { "t": "util", "name": "沼泽净水站", "price": 160 },
  { "t": "wormhole" },
  { "t": "bounty" },
  { "t": "oasis" },
  { "t": "event" },
  { "t": "prop", "group": "tech", "name": "裂谷量子站", "price": 190, "rent": 16, "subType": "landmark" },
  { "t": "prop", "group": "bio", "name": "蔓越莓基因场", "price": 180, "rent": 15 },
  { "t": "event" },
  { "t": "event" }
]
```

### 4.2 `www/js/data.js`

`buildTiles` 第 31 行：透传 `subType`。

```diff
-    else if (s.t === 'prop') { t.type = 'prop'; t.group = s.group; t.name = s.name; t.price = s.price; t.rent = s.rent; t.owner = null; t.level = 0; t.mortgaged = false; }
+    else if (s.t === 'prop') {
+      t.type = 'prop'; t.group = s.group; t.name = s.name;
+      t.price = s.price; t.rent = s.rent;
+      if (s.subType) t.subType = s.subType;
+      t.owner = null; t.level = 0; t.mortgaged = false;
+    }
```

`shuffleBoard` 不动 —— subType 跟着 prop 一起进桶、再随机铺出。

### 4.3 `www/js/rules-core.js`

文件顶新增注册表（放在 imports 之后）：

```js
// subType 注册表：每个 prop 可挂 1 个子类型；规则分支只认这里
export const SUBTYPE_DEFS = {
  landmark: { label: '地标',  noMortgage: true, rentMult: 3, badge: '★' },
  shack:    { label: '棚户',  maintenanceFee: 10, badge: '棚' },
  volatile: { label: '流动',  rollBased: true, badge: '骰' },
  cursed:   { label: '污染',  moralDrain: 1, badge: '☠' },
};
export function subTypeDef(t) {
  return t && t.subType ? SUBTYPE_DEFS[t.subType] : null;
}
```

`rentDisplay`（第 30 行）：

```diff
 export function rentDisplay(t) {
   if (t.owner === null) return '—';
   if (t.mortgaged) return '0';
   if (t.type === 'rail') return String(railRent(t));
   if (t.type === 'util') return (utilMult(t) === 10 ? '×10' : '×4');
-  return String(t.rent * (t.level + 1)) + (isMonopoly(t) ? '★' : '');
+  const def = subTypeDef(t);
+  if (def && def.rollBased) return `×${G.lastRoll || 6}`;
+  let r = t.rent * (t.level + 1);
+  if (isMonopoly(t)) r *= 2;
+  if (def && def.rentMult) r *= def.rentMult;
+  return String(Math.floor(r)) + (isMonopoly(t) ? '★' : '');
 }
```

### 4.4 `www/js/rules.js`

import 加一行：

```diff
 import { TILES } from './data.js';
+import { subTypeDef } from './rules-core.js';
```

`mortgage`（第 52 行）阻止地标抵押：

```diff
 export function mortgage(p, t, silent) {
-  if (t.owner !== p.id || t.mortgaged || t.level > 0) return;
+  if (t.owner !== p.id || t.mortgaged || t.level > 0) return;
+  if (t.subType === 'landmark') { log(`★ 地标「${t.name}」无法抵押`); return; }
   const mv = Math.floor(t.price / 2); t.mortgaged = true; p.caps += mv;
```

`payRent`（第 63 行）三处插入：

```diff
   let r;
   if (t.type === 'rail') r = railRent(t);
   else if (t.type === 'util') r = G.lastRoll * utilMult(t);
-  else { r = t.rent * (t.level + 1); if (isMonopoly(t)) r *= 2; }
+  else {
+    const def = subTypeDef(t);
+    if (def && def.rollBased) {
+      // volatile：rent 跟上一把骰子（1-12），强化版；不参与垄断翻倍
+      r = t.rent * (t.level + 1) * (G.lastRoll || 6);
+    } else {
+      r = t.rent * (t.level + 1);
+      if (isMonopoly(t)) r *= 2;
+      if (def && def.rentMult) r *= def.rentMult;
+    }
+  }
   if (G.rentSnowball && t.type === 'prop') { ... }
   if (G.vendetta && ...) { ... }
   r = Math.floor(r * (G.rentMult || 1));
   p.caps -= r; o.caps += r; sfx('rent'); log(`${p.name} 向 ${o.name} 缴租 ${r}盖`, true);
   if (G.jackpot) G.jackpotPool = (G.jackpotPool || 0) + r;
+  // subType 副作用
+  const def2 = subTypeDef(t);
+  if (def2 && def2.moralDrain) {
+    p.moral = (p.moral || 0) - def2.moralDrain;
+    log(`☠ 「${t.name}」污染：${p.name} 道德 -${def2.moralDrain}（现 ${p.moral}）`);
+  }
+  if (def2 && def2.maintenanceFee) {
+    const fee = def2.maintenanceFee;
+    if (o.caps >= fee) {
+      o.caps -= fee;
+      log(`棚「${t.name}」维护费：${o.name} -${fee}盖`);
+    } else {
+      log(`棚「${t.name}」塌了：${o.name} 现金不足${fee}盖，地块废弃`);
+      t.owner = null; t.level = 0; t.mortgaged = false;
+    }
+  }
   if (G.vendetta) { G._vendettaFrom = p.id; G._vendettaTo = o.id; }
   if (p.caps < 0) bankrupt(p, o);
   render();
 }
```

### 4.5 `www/js/view-core.js`

`tileMetaLine`（第 112 行）末尾加一行：

```diff
 function tileMetaLine(t) {
   if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
-    return `${t.price}盖 · 租${rentDisplay(t)}${t.level > 0 ? ' · Lv' + t.level : ''}`;
+    const sub = subTypeDef(t);
+    return `${t.price}盖 · 租${rentDisplay(t)}${t.level > 0 ? ' · Lv' + t.level : ''}${sub ? ' · ' + sub.label : ''}`;
   }
   ...
 }
```

`updateTilePreview`（第 197 行）把 subType 写到 dataset，方便后续 CSS 加颜色：

```diff
   previewEl.dataset.type = t.type;
   if (t.type === 'prop') previewEl.dataset.group = t.group || '';
+  if (t.type === 'prop' && t.subType) previewEl.dataset.subtype = t.subType;
+  else previewEl.removeAttribute('data-subtype');
```

---

## 5. 平衡估算

| subType | 极端场景 | 单次收租 | 备注 |
|---|---|---|---|
| landmark 掠夺者军阀 | Lv2 + 垄断 | 26 × 3 × 2 × 2 = **312 盖** | 原版 26 × 3 = 78，**4 倍**。AI 拿到即终局。 |
| shack 断裂天桥 | Lv2 + 垄断 | 7 × 2 × 2 = 28，盖主实收 **18** | 维护费 10 严重压制回本周期，对"贪便宜"的 AI 是陷阱。 |
| volatile 裂谷数据塔 | Lv0 + 骰 12 | 11 × 12 = **132 盖** | 平均期望 66（无升级）。方差大，鼓励刷骰子。 |
| cursed 灰堆毒巢 | Lv2 + 垄断 | 24 × 2 × 2 = **96 盖 + 道德 -1** | 道德已在 campaign 目标（≥3/5/6/7/8/10），踩一次降 1 很疼但不至于致命。 |

---

## 6. 验证清单

落盘后建议按顺序验证：

1. `tiles.json` 加载不报错 —— 控制台应无 "棋盘格数异常" 警告。
2. 8 块带 subType 的 prop 在棋盘渲染正常（name、颜色、图色不变）。
3. 鼠标悬停预览面板显示 `地标` / `棚户` / `流动` / `污染` 标签。
4. 走到 landmark 地块：租数字 +3 倍；尝试抵押时提示"无法抵押"。
5. 走到 shack：缴租后日志多一条维护费扣款。
6. 走到 volatile：rent 随 `G.lastRoll` 变动。
7. 走到 cursed：缴租方 `p.moral` -1。
8. AI 仍按原策略买卖（不强行加 AI 逻辑，避免行为突变）。
9. 战役模式不破（campaign.js 只读 `t.type === 'prop'`，不受 subType 影响）。
10. 存档 / 读档：subType 字段经 `JSON.stringify` / `parse` 透明传递，不需特殊处理。

---

## 7. 后续路线（待办）

- [ ] prop subType 落盘 + 试玩
- [ ] ② 1–2 个新行动格（建议 `auctionHouse` / `campsite`）
- [ ] ⑥ mutator 视觉变种（火焰 / 洪水 / 沙暴）
- [ ] ④ 第六组 prop（farm / enclave）—— 需扩 CSS 变量
- [ ] ⑤ 战役专属 tile
- [ ] AI 行为对 subType 的偏好（landmark 高目标、shack 回避）—— 优先级低
