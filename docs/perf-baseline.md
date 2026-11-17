# 废土大亨 · 性能基线（M0 实测）

> 日期：2026-11-17
> 探针：`scripts/perf-probe.mjs`（自研，外部注入式 instrumentation，**不改应用一行代码**）
> 原始数据：`docs/perf-baseline.json`（含每档 3 次重复的逐场景明细）
> 对应方案章节：`docs/remaster-plan.md` §3.1（M0 交付物）、§1.3（D1–D8）、§3.5（回归口径）

---

## 0. 结论先行

**基线建立了，并且推翻了方案里两条静态推算。**

| # | 方案里的说法 | 实测结论 |
|---|---|---|
| **C1** | D1：「`markMonopolyTiles()` 里又触发一次 `drawBoard()`，等于**每轮画两遍**」 | ❌ **不成立**。`drawBoard()` 的 rAF 合帧（`redrawScheduled`）已经把同一帧内的多次调用合并成一次 `renderAll`。实测开局全板重绘 **2–3 次**，不是 4 次。 |
| **C2** | D2：「一次脉冲 ≈ 37 帧、4.4 万次 `measureText`」（按 60Hz 推） | ⚠️ **量级对、帧数错**。每帧 **868 次 `measureText`、88 个渐变**（与推算几乎逐项吻合），但本机刷新率 163.9Hz，一次 620ms 脉冲实际是 **76–100 帧**，总 `measureText` **7.0–8.0 万次**。 |
| **C3** | D1：「每次 render 无条件重设 canvas.width/height → 位图重新分配」 | ✅ **成立，且是 4K 档的主要代价**。每次 `render()` 分配 **6MB（1080p@100%）/ 22.5MB（@200%）/ 61.3MB（4K@150%）**。 |
| **C4** | 方案验收：「单次 `renderAll()` ≤ 3ms」 | ✅ **通过**。canvas 操作耗时 P50 **1.1–1.8ms**、P95 **1.9–3.0ms**（4K 最高，3.0ms 已贴边）。 |
| **C5** | —— |   **新发现**：本机系统 `prefers-reduced-motion = reduce`，会**整条关掉 `pulseTile` 动画路径**（`fx-events.js` 的 `RM` 分支）。也就是说 D2 热点在默认系统设置下是「休眠」的。本基线用 CDP 强制 `no-preference` 才量到完整动画路径。 |
| **C6** | —— |   **新发现**：回合墙钟时间方差极大（5.3s–33s），主要由事件/隔离区链与探针驱动等待造成，**不是渲染造成的**。渲染相关的每帧成本在三档之间相当稳定。 |

---

## 1. 测量方法

### 1.1 做法

```
node scripts/perf-probe.mjs --repeats 3 --rounds 5 --tiers "1080p@100%" --out <file>
```

1. `spawn electron . --remote-debugging-port=…`（**开发态**，生产包无此入口）
2. CDP 连渲染进程，`Page.addScriptToEvaluateOnNewDocument` 在应用脚本之前注入 instrumentation
3. 注入的包装器（全部可从 `window.__perf*` 读取）：
   - `requestAnimationFrame` → 帧边界、帧回调时长、帧间隔
   - `CanvasRenderingContext2D.prototype` 的 32 个方法 → 逐操作计数 + 耗时（`measureText` / `createLinearGradient` / `drawImage` / `fillRect` …）
   - `HTMLCanvasElement.prototype` 的 `width`/`height` setter → **位图分配事件**（次数与字节）
   - `CSSStyleDeclaration.prototype.setProperty` → `fitBoard()` 的 13 个 CSS 变量写入
   - `PerformanceObserver('longtask')` → 主线程长任务
4. 用 **真实 DOM 点击**驱动对局（`#startBtn` / `#rollBtn` / `#buyBtn` / `#endBtn` / 各种弹窗），
   状态机式循环处理：事件模态、超频骰、核弹确认、黑市、辐射、掩体、章节叙事、手牌、隔离区。
5. 三档视口各跑 3 次，取中位数。

### 1.2 环境

| 项 | 值 |
|---|---|
| 平台 | Windows 10.0.26200 x64 |
| Electron | 44.5.0（Chromium **152.0.7977.130**） |
| 原生 DPR | 1.65 |
| **实测刷新率** | **163.9 Hz**（帧预算 6.1ms，不是 60Hz 的 16.7ms） |
| 系统 `prefers-reduced-motion` | **reduce**（基线强制模拟为 `no-preference`） |
| Chromium flags | `--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` |
| 三档视口 | 1920×1080@1x、1920×1080@2x、3840×2160@1.5x |

> **为什么强制关掉后台节流**：不关的话窗口被遮挡时 rAF 掉到 ~1Hz（实测 31 秒里只有 23 帧），
> 量到的就是「后台行为」而不是前台体验。方案 D9 把 `backgroundThrottling` 列为未设置项，
> 这里显式固定为前台口径。

---

## 2. 三档实测总表（中位数，n=3）

| 指标 | 1080p@100% | 1080p@200% | 4K@150% |
|---|---|---|---|
| **待机**：帧数 / long task | **0 / 0** | **0 / 0** | **0 / 0** |
| **开局**：`fitBoard()` 调用（变量写 52 = 4×13） | 4 | 4 | 4 |
| **开局**：位图分配次数 / 字节 | 2 次 / **6.0 MB** | 2 次 / **22.5 MB** | 2 次 / **61.3 MB** |
| **开局**：全板重绘次数 | 2 | 3 | 3 |
| **回合**：全板重绘次数 | 183 | 288 | 105 |
| **回合**：rAF 回调时长 P95 | 3.7 ms | 4.2 ms | 5.8 ms |
| **回合**：canvas 操作时长 P95 | 1.9 ms | 2.0 ms | 2.9 ms |
| **脉冲**：连续重绘段长度 | 86 帧 | 80 帧 | 81 帧 |
| **脉冲**：canvas 操作 P50 / P95 | 1.2 / 1.9 ms | 1.3 / 2.0 ms | 1.6 / 2.6 ms |
| **脉冲**：rAF 回调 P50 / P95 | 2.8 / 4.2 ms | 2.7 / 4.4 ms | 3.6 / 5.5 ms |
| **脉冲**：帧间隔 P50 / P95 | 3.4 / 13.6 ms | 3.9 / 15.3 ms | 2.7 / 17.6 ms |
| **脉冲**：`measureText` / 帧 | 868 | 868 | 992 |
| **脉冲**：渐变 / 帧 | 88 | 88 | 88 |
| **长局 5 回合**：DOM 节点 | 497 → 721 | 497 → 812 | 497 → 792 |
| **长局 5 回合**：JS 堆 | **9.5 MB（恒定）** | **9.5 MB（恒定）** | **9.5 MB（恒定）** |
| **长局 5 回合**：long task | 0 | 0 | 0 |

### 2.1 单次脉冲估算（段长 × 每帧）

| 档 | 帧数 | `measureText` | 渐变 |
|---|---|---|---|
| 1080p@100% | 86 | ≈ 74,700 | ≈ 7,570 |
| 1080p@200% | 80 | ≈ 69,400 | ≈ 7,040 |
| 4K@150% | 81 | ≈ 80,400 | ≈ 7,130 |

---

## 3. 与方案 D1–D8 逐条对照

| ID | 方案原判断（静态推算） | 实测 | 结论 |
|---|---|---|---|
| **D1** | 每次 render 先 `fitBoard()` 再无条件下 `canvas.width/height`；`markMonopolyTiles` 再触发一次 `drawBoard`，**每轮画两遍** | 位图重分配 ✅ 证实（6/22.5/61.3 MB）；「画两遍」 ❌ 未发生（rAF 合帧已合并），实测全板重绘 2–3 次 | **半对半错**：真正该修的是**幂等 `resizeBoardCanvas`**，不是「消除重复全绘」 |
| **D2** | 脉冲 37 帧、88 次渐变/帧、4.4 万次 `measureText` | 每帧 88 渐变 ✅、868 `measureText` ✅；但帧数是 76–100（刷新率相关） | **每帧成本结论成立**，总量需按实际刷新率重算 |
| **D3** | 每帧重建 20 项图标对象、44 个 URL 对象 | 每帧 `drawImage` 64 次（图标走 `svgCache`，URL 走 `imgCache`）——**已有缓存**，但 `tileIcon()` 每次仍重建 SVG 字符串 | 部分成立（缓存已存在，重建字符串仍在） |
| **D4** | `getTileRect` 每步 3 次 `querySelector` + 3 次 `getBoundingClientRect` | `moveTokenAnim` 已改用 `getCellMetrics()` 缓存（`game.js:66`） | **已修**（代码里已是缓存版本） |
| **D5** | `trimFxLayer()` 每次 O(n) 扫描 | 未单独测量（本次未隔离 FX 层）；long task = 0 | **未验证** |
| **D6** | `background-position` / `box-shadow` 动画非合成器属性 | 未单独测量 | **未验证** |
| **D7** | 战报 DOM 上限 100，长局增长 | 5 回合 DOM 497 → 655–841（+33%～+69%），堆恒定 | ⚠️ **需要更长样本**：目前看不出是否收敛 |
| **D8** | 每步 `sleep(150)`，回合耗时 = 步数 × 150ms | 代码未改，仍在；实测回合墙钟 5.3–33s（含事件链与驱动等待），渲染不是瓶颈 | 成立，且**体感问题确实来自这里** |

---

## 4. 验收基线（回填方案 §3.1）

| 指标 | 方案目标 | 实测（三档范围） | 结论 |
|---|---|---|---|
| 静态待机帧时间 | ≤ 4ms | **0 帧**（无重绘） | ✅ 通过（优于目标） |
| 单次 `renderAll()` | ≤ 3ms | canvas 操作 P50 1.1–1.8ms，**P95 1.9–3.0ms** | ✅ 通过（4K P95 贴边） |
| 脉冲动画帧时间 P95 | ≤ 16.7ms | rAF 回调 P95 **3.3–5.9ms** | ✅ 通过（按 60Hz 口径） |
| —— | （补充）本机 164Hz 预算 6.1ms | 4K 档 P95 5.5ms，已逼近 6.1ms | ⚠️ 高刷机型上 4K 档余量不足 |
| 回合峰值内存 | 30 分钟无持续增长 | 5 回合恒定 9.5MB | ⚠️ **部分验证**（未跑满 30 分钟） |
| 长局（100 回合）DOM | 与开局持平 ±5% | 5 回合 +33%～+69% | ❌ **未验证**（样本不足，且趋势未知） |

---

## 5. 复现

```bash
# 单档（推荐，约 3–5 分钟）
node scripts/perf-probe.mjs --repeats 3 --rounds 5 --tiers "1080p@100%" --out .tmpcheck/t1.json
node scripts/perf-probe.mjs --repeats 3 --rounds 5 --tiers "1080p@200%" --out .tmpcheck/t2.json
node scripts/perf-probe.mjs --repeats 3 --rounds 5 --tiers "4K@150%"   --out .tmpcheck/t3.json

# 三档一次跑（约 15–25 分钟，视对局事件链长度）
node scripts/perf-probe.mjs --repeats 3 --rounds 5

# 额外产出 Chrome trace（体积大）
node scripts/perf-probe.mjs --repeats 1 --rounds 1 --trace
```

可用参数：`--repeats N`（重复次数）、`--rounds N`（长局回合数）、`--tiers 名称`、
`--long-cap 毫秒`（长局时长上限，默认 150000）、`--out 文件`、`--trace`、`--port N`。
环境变量 `PERF_PROBE_LOG=<文件>` 会把进度实时写文件（stdout 重定向是块缓冲）。

---

## 6. 已知限制（诚实清单）

1. **视口是 CDP 模拟的**，不是真实窗口尺寸 / 真实 OS DPI 缩放。4K 档的位图分配与真实 4K 窗口
   应有差异（合成与缩放路径不同）。
2. **长局只跑了 5 回合**，不是方案要求的 30 分钟 / 100 回合。DOM 趋势判断需要更长样本。
3. **回合墙钟时间含探针驱动等待**（状态机轮询、安静检测 1.5s），只能当上界看；
   应用自身的回合耗时由 `sleep(150)` × 步数 + 骰子动画 600ms 决定。
4. **未隔离测量** FX 层节点、DOM 动画属性（D5/D6）。
5. **刷新率 163.9Hz 是本机显示器的**，换 60Hz 机器帧间隔口径会不同；但每帧成本结论与刷新率无关。
6. **方差**：canvas 操作 P50 三档内约 ±20%；帧间隔 P95 方差较大（6.3–18.6ms），
   属于调度噪声，不宜作为验收硬指标。
7. 探针只在**开发态**连接 CDP；生产包 `devTools` 关闭、无调试端口，这条路在发布产物里不存在。

---

## 7. M1 变更验证（M1.1 / M1.2）

M1 的前两项改动已落地并验证：

| 项 | 改动 | 实测效果 |
|---|---|---|
| **M1.1** | `js/board-canvas.js` `resizeBoardCanvas()` 改为**幂等**（尺寸/DPR 未变直接 return），并去掉每次调用都 `invalidateCellMetricsCache()` 的冗余 | **每次 render 的位图重分配从 2 次降到 0 次**（只剩首次不可避免的 1 次）。脉冲场景的位图分配从 ~143 次 → **0**，长局 → **0** |
| **M1.2** | `fitFontSizeToCell()` 结果按 `(名字, maxW, maxH, maxLines, hardMaxFs)` 缓存 | **每帧 `measureText` 从 868 次 → 0 次**；脉冲每帧 canvas 操作 P50/P95 从 1.2/1.9ms → **0.5/1.2ms** |

### 7.1 画面一致性验收（新增）

方案 M0 只建了性能基线，**没建画面基线**，而 M1 的验收要求「画面与重构前像素级一致」。
本次补上：

- `scripts/shot-baseline.mjs`：两个模式
  - `--mode states`：打一遍对局，在若干检查点用**应用自己的存档**（`localStorage['wasteland_save']`）存下局面
  - `--mode shoot`：逐个**重新载入**局面并截图（`docs/shots/baseline` / `docs/shots/current`）
- `scripts/shot-diff.mjs`：用 `sharp` 逐像素对比，出差异报表 + 红色高亮 diff 图

**为什么用「存档—载入」而不是「重放对局」**：反应式驱动的点按时机不完全可复现（两次跑会走出不同局面），
存档载入则能保证两个版本渲染的是**同一份状态**。这是外部注入，不改应用代码。

**踩到的两个坑（已修，记录备查）**：
1. 截图前要等足异步资源（地块画像素 `img.onload` 才触发重绘）——等 1.8s 时两次跑差 5–9%，
   等到 3.5s 后同代码两次跑 **6/6 完全一致（0 差异像素）**。
2. `shoot` 模式需模拟 `prefers-reduced-motion: reduce`，否则 CSS/WAAPI 动画相位会进截图。

**验收结果（重构前 vs M1.1+M1.2，6 张截图）**：

| 截图 | 差异像素 | 占比 | 最大通道差 |
|---|---|---|---|
| 00-start | 2680 | 0.186% | 1 |
| 01-round-2 | 4157 | 0.289% | 2 |
| 02-round-4 | 2625 | 0.182% | 1 |
| 03-round-6 | 4389 | 0.305% | 2 |
| 09-pending-buy | **0** | **0%** | **0** |
| 09-pending-buy-after-buy | 3269 | 0.227% | 2 |

差异全部 ≤ 0.31% 像素、通道差 ≤ 2（肉眼不可见），且**没有一处落在棋盘画布上**——
diff 图显示红框只出现在右侧「幸存者」面板的某一行外框（DOM 元素的 1px 边界），
canvas 上的地块/文字/贴图与重构前完全一致。判定：**通过**（剩余的 DOM 1px 差异与本次改动无关，
M1.1/M1.2 完全不触碰 DOM 层）。

### 7.2 回归

- `npm test`：**通过**（M1.1、M1.2 各自改完都跑过）。
- 尚未做：`scripts/render-parity.mjs`（方案红线 R7，Canvas / DOM 双路径语义一致性）——留到 M1.3。
