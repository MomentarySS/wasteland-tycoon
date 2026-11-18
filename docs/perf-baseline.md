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

---

## 8. M1.3-A：静态烘焙层（实测）

> 日期：2026-11-17。对应 `docs/remaster-plan.md` §2.2 / §3.2 的「静态底板烘焙」。
> 探针：`scripts/perf-probe.mjs --repeats 3 --rounds 5`，A0 = 当前分支（M1.1+M1.2 后），A2 = 加静态层后。

### 8.1 做法

`js/board-canvas.js` 新增**离屏静态层**（`document.createElement('canvas')`，不进 DOM），
把「不随对局状态变」的部分（底色 / 贴图 cover / 底部渐变 / 区域纹理 / 内壁高光 / 顶边色条 / 边框）
烘焙进去；每帧只把静态层**逐格**回填到主画布，再画名称 / 角标 / HUD / 光效。

失效条件（惰性，重烘焙在 `renderAll()` 里做，rAF 合帧自动合并）：

1. `TILES` 数组**身份**变化（`shuffleBoard` / `restoreBoardOrder` / `loadContent` 会整体重建数组）；
2. `resizeBoardCanvas()` 真正重分配位图（布局 / DPR 变）；
3. 静态贴图 `img.onload`（地块插画 / 区域纹理）。

### 8.2 性能（A0 vs A2，摘要中位数）

| 档 | 指标 | A0（无静态层） | A2（静态层） | 结论 |
|---|---|---|---|---|
| 1080p@100% | 脉冲 canvas P50 / P95 | 0.6 / 1.2 ms | **0.4 / 0.6 ms** | ✅ 约 -35% / -50% |
| 1080p@100% | 每帧渐变 | 88 | **0** | ✅ 静态渐变不再每帧重建 |
| 1080p@100% | 每帧 drawImage | 64 | 44 | ✅ |
| 1080p@100% | 回合 canvas P95 | 1.1 ms | 0.7 ms | ✅ |
| 4K@150% | 脉冲 canvas P50 / P95 | 1.2 / 1.8 ms | **0.9 / 1.8 ms** | ✅ P50 改善，P95 持平 |
| 4K@150% | 每帧渐变 | 88 | **0** | ✅ |
| 4K@150% | 回合 canvas P95 | 1.6 ms | 3.3 ms | ⚠️ 见下「噪声说明」 |

- 开局位图分配从 2 次（6MB / 61.3MB）变成 4 次（12.1MB / 122.6MB）——**多出的是离屏层那次**，
  只在布局变化时发生，不是每帧。
- **4K 档回合 P95 从 1.6 → 3.3ms 是噪声**：A0 的三次重复里有一次 `drawImage` 耗时 126.6ms（其余 3.5 / 19.8ms），
  A2 三次稳定在 11.6 / 15.5 / 13.3ms。脉冲口径（真正的热点）A2 不劣于 A0。

### 8.3 画面一致性：逐格回填是必须的

验收脚本 `scripts/shot-baseline.mjs --mode shoot`（同一份状态）+ `scripts/shot-diff.mjs`。
**只比较棋盘画布环带**（`#boardInner` 内、中央 DOM 预览区外），因为 DOM 侧（右侧幸存者面板、
中央预览）本身存在**逐次跑不定的重栅格化噪声**（旧代码自己两次跑也差 0.09%–0.54%，全在画布外）。

- 整幅拷贝（先画完整张静态层，再画所有动态）→ 画布环带 **122–144 像素、通道差 ≤2**。
  根因：**砖块名的阴影（`shadowBlur=3`）会越过砖块下缘 1–2px**；旧顺序里邻格静态会盖住它，
  整幅拷贝顺序则让它渗进下一格。差异全部落在**最右列**（c11）。
- **逐格回填**（每格先回填静态，再画该格名称/角标/HUD）→ 画布环带 **0 像素、通道差 0**（6/6 张）。

判定：**像素级一致**。

### 8.4 三个已踩的坑（记录备查）

1. **`#boardInner` 计算宽高带小数**（实测 920.994px）。若按 CSS 尺寸 `drawImage` 整幅静态层，
   会做亚像素缩放，整层轻微发虚（首次实测差异 0.43%–0.80%）。→ 改为**设备空间 1:1**：
   源用 `x*dpr, y*dpr, w*dpr, h*dpr`，目标用 CSS 坐标（主画布已是 dpr 变换）。
2. **逐格回填不要 `save()/setTransform(1,0,0,1,0,0)/restore()`**：4K 下每帧多出 44 次
   `setTransform`（探针记到 5588 次），脉冲 P50 从 0.9 反弹到 2.0ms。→ 直接用主画布的 dpr 变换，
   不要改变换矩阵。
3. **画布→画布 1:1 拷贝本身是逐位的**（微测试验证，含 DOM 挂载画布）。曾怀疑是拷贝发虚，
   实际不是；真正的差异来自绘制顺序（见 8.3）。

### 8.5 B（脏标记动态层）决策：**不做**

方案 §2.2 要求「净收益需实测确认」。实测：脉冲帧时间 1080p 0.6ms、4K 1.8ms，
相对本机 164Hz 的 6.1ms 预算余量充足；剩下的每帧成本主要是**逐格静态回填**（44 次 drawImage），
脏标记只能省掉动态重绘（名称/HUD），省不到静态回填。故 **M1.3 不做脏标记动态层**，
把预算留给 C（全局帧调度器）与 D（render-parity）。若日后 4K 高画质档吃紧，再重估。

### 8.6 全局帧调度器（M1.3-C）

新增 `js/render-scheduler.js`：把原本两条并存的 rAF 链（`drawBoard` 的合帧重绘、`pulseTile` 的脉冲
逐帧）合并到**同一条循环**。`drawBoard()` 与 `pulseTile()` 现在都只调 `scheduleFrameDraw()`，
由调度器决定何时渲染；后台节流兜底（100ms 定时器）沿用原语义。

- 验证：`npm test` 通过；脉冲路径实测仍在（1080p 单 repeat：P50/P95 = 0.4/0.6ms，连续重绘段 123 帧，
  每帧渐变 0）；截图 diff 画布环带仍 0 差异。
- 未改渲染语义，只合并调度。

### 8.7 render-parity（M1.3-D，红线 R7）

新增 `scripts/render-parity.mjs`（轻量版）：CDP 起两个真实 Electron 会话，载入**同一份存档**
（并做「稳定化」：强制人类当前玩家 + `awaitingRoll`，否则 AI 当前玩家读档后会立刻 `takeTurn()`，
两条路径的会面会随时间漂移）：

- **DOM 路径**：注入 `HTMLCanvasElement.prototype.getContext → null`，让 `initBoardCanvas` 探测失败，
  自动回退 `#tiles`；解析每格 `.tile` 的 class / 内联样式 / 文本。
- **Canvas 路径**：注入 recording 2D context，记录主画布最后一帧的 `fillText` / `fillRect` /
  `strokeRect` / `arc` / `drawImage`，按格几何归位。
- 逐格比对 **名称 / 抵押 / 主人颜色 / 等级 / 当前格 / 垄断**。

结果：`docs/shots/states` 的 5 个局面 **全部 0 语义差异**（`docs/parity/render-parity.json`）。

### 8.8 回归

- `npm test`：**通过**；`scripts/subtype-test.mjs`：51/51；`scripts/balance-probe.mjs`：平衡锚点无偏移。
- 红线：未改 `rules.js` / `rules-core.js` / `game.js`；渲染层未写 `G` / `TILES`；
  地块 `id` / `artIndex` / 顺序未动；`SAVE_VERSION=4` 未动；DOM 降级路径保留（无 DOM 时 `useStatic=false`，
  `npm test` 的 dom-stub 覆盖）。
- **既有 flaky（非本次引入）**：`smoke.test.mjs` 的「人类起始道德应为 2」断言约 5% 概率偶发失败
  （原始代码 20 次跑也出现 2 次，同一条断言）。与 M1.3 无关，留待后续单独排查。

---

## 9. M2.1 战报折叠 / M2.2 FX 淘汰修复（实测）

> 日期：2026-11-18。对应 `docs/remaster-plan.md` M2。
> 探针：`scripts/perf-probe.mjs --rounds 100`（1080p，n=1）。

### 9.1 长局 DOM 对比

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 100 回合 DOM | **851** | **636 / 661**（两次跑） |
| 战报条目（`#log .logEntry`） | 100（顶格） | **40** |
| JS heap | 9.5MB | 9.5MB（恒定） |
| long task | 1 次（68ms） | **0** |
| 帧 canvas P95 | 0.5ms | 0.4ms |

战报 DOM 从 ~300 节点降到 ~123（40 条 × 3 + 1 条摘要），是总 DOM 下降的全部来源。

### 9.2 实现要点（`js/view-core.js` / `js/log-panel.js` / `css/style.css`）

- `LOG_KEEP = 40`：`log()` 里 `prepend` 后按 `.logEntry` 计数，超过 40 就从底部淘汰最旧的，
  被折叠条数累加到摘要行「已省略 N 条更早战报」。
- 摘要行 `div.logSummary`（`data-role=summary`）**不参与类别过滤与搜索**（`applyEntryFilter` 只处理
  `.logEntry`）；搜索时 `#log.logSearching .logSummary{display:none}`，避免混进空搜索结果。
- `ensureLogSummary()` 用 `children` 成员判断存活，`innerHTML=''`（`clearLog` 与 `js/game.js` 各一处）
  之后自检重建并把计数归零。
- 摘要文案用 `className` 字符串判断条目归属，兼容 dom-stub（其 `className` 与 `classList` 不同步）。
- CSS 把 `#log div` 收窄为 `#log .logEntry`，摘要行单独样式（去掉 `"> "` 前缀与点边框）。

### 9.3 测试与保真度

- `scripts/dom-stub.mjs` 补 `parentNode` / `removeChild` / `lastChild` / `remove()`（此前缺失，
  导致裁剪逻辑在 `npm test` 里完全不执行）。
- `smoke.test.mjs` 新增「战报折叠」断言：连写 50 条 → 40 条 + 1 条摘要，且摘要文案正确。
- `scripts/perf-probe.mjs` 的 `pageState` / `__perfState` 增加 `logSummary` / `logSummaryText` / `fxNodes`，
  供后续验收。

### 9.4 M2.2 评估：池化收益≈0，改为修缺陷

勘察（并行 Agent）+ 实测：`trimFxLayer()` 每次 append 前做 `Array.from(children).find()`，
n 上限 120 时每次几 µs；长局 100 回合 long task 仅 1 次，**没有 FX 的痕迹**。故环形池化不做。

改为修掉勘察发现的真实缺陷：旧实现 `... || nodes[0]` 兜底会在「整层都是受保护节点」时淘汰
`fxLabel` / `fxFloat`（结果标签 / 数值反馈），与注释承诺矛盾。现在只淘汰装饰节点；
再加 `FX_HARD_LIMIT = limit + 60` 硬顶——整层只剩受保护节点且超过硬顶时才动它，保证层体积有界。

### 9.5 独立评审抓到的问题（已修）

1. **HIGH**：dom-stub 缺 `parentNode`，`logSummaryEl.parentNode === logEl` 在桩里恒 false →
   每次 `log()` 新建摘要行，`#log` 被摘要污染。→ 改用 `children` 成员判断（§9.2），并补桩方法。
2. **MEDIUM**：`trimFxLayer` 去掉兜底后失去硬顶。→ 加 `FX_HARD_LIMIT` 两段式（§9.4）。
3. **MEDIUM**：文档与实现不符（行号、上限 100、O(1) 承诺）→ 已同步 `remaster-plan.md`。
4. **LOW**：摘要行每次 `log()` 都重写 `textContent` → 加变更判断；搜索时摘要残留 → 搜索时隐藏。

### 9.6 验收口径修正

方案原写「100 回合 DOM 与开局 ±5%」——开局 497 含大量固定 UI，而战报 40 条 + 摘要 ≈ 123 节点、
FX 上限 120、玩家缩略条随地产数增长，**±5% 按字面不可达**。改为：**无界增长消失（平台化）+ 改造前后对比**。

---

## 10. D6 动画白名单：测量手段 + 第一批（2026-11-18）

### 10.1 测量手段：`scripts/css-anim-probe.mjs`

原先 `perf-probe` 只量 rAF 回调 / canvas 方法，**CSS 动画走合成器，测不到**——所以 D6 无法验收。
新探针在**同一个真实 Electron 会话**里采两段 Chrome trace：

- **A 段**：CSS 动画照常（idle，环境/天气/玩家脉冲等持续动画在跑）
- **B 段**：注入 `*{animation:none!important;transition:none!important}` 关掉 CSS 动画

两段的 `Paint` / `UpdateLayoutTree` / `PrePaint` / `RasterTask` 差值 ≈ CSS 动画的绘制/合成/布局成本。
用法：`node scripts/css-anim-probe.mjs --seconds 8`。

### 10.2 改造前

5s 窗口：**827 次 `Paint` + 827 次 `UpdateLayoutTree` + 827 次 `PrePaint`**（≈165 次/秒，等于每帧一次），
合计 **+456ms/5s**。

### 10.3 归因与第一批（D6a）

- 主因：`playerPulse`（当前玩家行的 `border-color` + `box-shadow` 脉冲，1.8s 循环）。
- 次因：`ambGradShift`（环境背景 96s 的 `background-position` 漂移）。
- 只改 `ambGradShift` 时仍有 165 次/秒 → 证实 `playerPulse` 是主因。

**D6a 已落地**（两个持续动画降级为静态，方案允许「降级为静态」）：
- `ambGradShift`：改为静态中间相位 `background-position:50% 50%`。
- `playerPulse`：改为静态辉光 `box-shadow:0 0 6px #c9a22733`（取原 0%/100% 相位）。

**效果：CSS 动画成本 +456ms/5s → +1.0ms/8s（≈ −99.8%），Paint 165/秒 → ~0。** `npm test` 通过。

### 10.4 副作用与验收口径

移除 `.pl.cur` 的动画改变了合成器帧节奏，使**剩余动画（天气 / 突变可视 / 预览）的相位变得不稳定**：
`01-round-2` 与 `09-pending-buy` 在**同一份 D6a 代码的两次跑之间**就差 ~9%（通道差 ≤4）。
也就是说，「baseline vs D6a」的截图对比**被相位噪声淹没，不可用**；其中可归因的残余确定性差异约 ≤9。
肉眼基本不可见，但超出台旧「≤0.31% / 通道差 ≤2」。试过 `::after` 叠层 / `translateZ(0)` 保留合成层，都更糟。

**故 D6 的验收口径改为 `css-anim-probe` 的 Paint 次数 / 成本差**，不用截图像素
（截图对动画相位天然敏感，不适合当动画改造的像素门）。

### 10.5 未做（用户决定停在第一批；已在 §10.6 清理完毕）

其余瞬态 keyframes 未处理：`nukePulse` / `mushStem` / `chromaticShift` / `shockwave` / `dash` /
`modalGlow` / `borderBlink` / `artImgPulse` / `artImgFlicker` / `tbuildPop` / `tbuildUp` / `csKeyOn` /
`csKeyDotOn` / `csMissileUp` / `tpPulse`。（标题写「14 个」，实际名单 15 个名字。）
其中 `nukePulse`（`button.nuke`）/ `chromaticShift` / `dash` / `modalGlow` / `borderBlink` / `artImg*`
其实是 **infinite**，并非纯瞬态——只是宿主（弹窗 / 核弹 / 过场 / 事件插画）不常开。

---

## 11. D6b：剩余 keyframes 清理（2026-11-18）

对应 `docs/remaster-plan.md` §2.7-4 的白名单规则。原则：**能换等价 transform/opacity 就换，换不了就降级为静态**。

| # | 项 | 原动画属性 | 处理 |
|---|---|---|---|
| 1 | `nukePulse`（`button.nuke` + `.nukeKeys.nukeReady`） | `box-shadow` infinite | 静态中点辉光 `0 0 14px #ff6b0077` |
| 2 | `mushStem` | **`height`** 0→`min(42vh,140px)` | 高度写死 + `scaleY(0→1)`、`transform-origin:50% 100%`（从底部向上长，视觉等价） |
| 3 | `chromaticShift` | `filter` infinite alternate | 静态中点 filter（仅核弹后 3.2s 内） |
| 4 | `shockwave` | —— | **CSS keyframes 是死代码**（`.fxShockwave` 无 animation 引用），实际走 `fx-events.js` 的 WAAPI。删 CSS；WAAPI 去掉 `strokeWidth`，圆环加 `stroke-width="3"` + `vector-effect="non-scaling-stroke"` 抵消整体缩放 |
| 5 | `dash` | `stroke-dashoffset` infinite | 删动画，保留 `stroke-dasharray` 静态虚线（无 transform 等价） |
| 6 | `modalGlow` | `box-shadow` infinite | 静态相位 |
| 7 | `borderBlink` | `border-color` infinite | 静态 `var(--amber)` |
| 8 | `artImgPulse` | `filter` infinite | 静态 `brightness(1.09) saturate(1.05)` |
| 9 | `artImgFlicker` | `filter` infinite | 静态 `brightness(1.1)` |
| 10 | `tbuildPop` | `transform` + `filter` | 只留 `transform` |
| 11 | `tbuildUp` | `transform` + `box-shadow` | 金光改**静态**（类存活期常驻），动画只留 `transform` |
| 12 | `csKeyOn` | `opacity/transform/border-color/box-shadow` | 终态颜色与辉光写入 `.csKey` 基础样式，动画只留 `opacity/transform` |
| 13 | `csKeyDotOn` | `background` + `box-shadow` | 基础样式即终态，动画改为 `opacity` |
| 14 | `csMissileUp` | **`height`** + `filter` | `scaleY(0→1)`；RM 分支补 `transform:none`（否则导弹永久不可见） |
| 15 | `tpPulse`（board-v2.css） | `transform` + `box-shadow` | 金光改**静态**，动画只留 `transform` |

### 11.1 新增测量手段：`scripts/css-anim-audit.mjs`

`css-anim-probe` 只能测「跑起来多贵」，**测不出「是否合规」**；而本轮清掉的项都 host-gated，idle 探针根本采不到。
故补一个确定性静态门：解析 `css/*.css` 的全部 `@keyframes`，凡出现 `transform`/`opacity` 之外的属性即报错、退出码 1。

```
node scripts/css-anim-audit.mjs          # 门禁
node scripts/css-anim-audit.mjs --list     # 列出全部 keyframes 及属性
```

结果：**2 个样式文件、48 个 @keyframes、违规 0**（不止那 15 项，全仓已无例外）。

### 11.2 验收

| 门 | 结果 |
|---|---|
| keyframes 白名单（静态审计） | ✅ 48/48 仅含 transform/opacity |
| `css-anim-probe --seconds 8`（idle） | **Paint 0 次**；合计 +3.61ms/8s（D6a 后基线 +1.0ms/8s，同量级；差值来自 TimerFire/HitTest/UpdateLayoutTree 的个位数次数） |
| 截图像素（棋盘环带，D6b 前=HEAD `c6cf369` vs 后=工作区，同一份 states） | 6 张中 5 张 **0 差异**；`09-pending-buy-after-buy` 0.2798% / 通道差 ≤1 —— 与「同代码跑两次」对照（0.3027% / 通道差 ≤2）一致，属跑动噪声 |
| 差异定位 | 所有通道差 >2 的像素包围盒 **x 413–790 / y 351–609**，全在中央 DOM 预览区，来源是 `tpPulse` 金光由「动画结束回到无辉光」改为「静态常驻」——**有意的观感变更，非回归** |
| `npm test` / `subtype-test.mjs` | ✅ 通过（51/51） |
| `scripts/render-parity.mjs`（R7） | ✅ 语义差异 0 |

> 口径说明：本轮改动**没有移除任何持续动画**（剩下的都是 host-gated / 一次性），所以截图相位噪声理论上不变；
> 实测也确实如此（差异全部落在唯一被有意改观的预览区）。截图像素在这里只用于确认「棋盘环带未受影响」，
> 不作为动画本身的成本证据。

### 11.3 诚实清单

1. `js/fx.js` `pulseRow()` 用 WAAPI 动 `background`（700ms，金钱变动时）。**不在方案 D6 名单内**（该条针对 `@keyframes`），本次未改；
   属同类成本，建议后续一并处理或明确豁免。
2. 其余 WAAPI 调用未逐条审计，只粗查了 `boxShadow` / `strokeWidth` / `filter` / `background` 关键字（现仅 `pulseRow` 一处）。
3. `docs/shots/baseline` 的 PNG 是当天 10:09 从**旧 states** 渲染的，与当前 states（14:06 重生成）不匹配：
   直接拿它当基准会得出无意义的巨差（本次首次 diff 报 66.67% 即是此因，棋盘布局与骰子都不同）。
   **states 变更后必须重渲染基准**，或改用「同一提交跑两次」对照（本次即用后者）。
4. `csMissile` 改 `scaleY` 后，其 `::after` 弹头圆点在动画中会随父级一起被纵向压缩（原 `height` 动画不会）。
   末态一致，过程中圆点略扁——过场一次性 1.5s，判定可接受。

---

## 12. M3a：棋盘方向光 + 接触阴影 + 文字对比度（2026-11-18）

对应 `docs/remaster-plan.md` §2.4 第 1–2 点与 §M3 验收。**只做了棋盘格子**（侧栏缩略条 / HUD 徽章的
「高度场」留 M3b，天气 tint 留 M3c）。改造前基准 = HEAD `a0bde88`（同份 states，见 §11.3 第 3 条）。

### 12.1 实现（`js/board-canvas.js`，全部落在静态烘焙层）

- `drawSlabLight()`：主光源固定左上 315°。每格四条边**非亮即暗**——顶 / 左受光（横向 / 纵向白色渐变，
  左强右弱、上强下弱），底 / 右背光（黑色渐变，右 / 下最强）。墙角自然叠加出「左上最亮、右下最暗」。
  带宽 = 格短边 × `bandRatio`（0.065 ≈ 4px @ 60px 格）。下表数值为**最终采用档**（用户 2026-11-18 确认；
  初版是它的一半，实测方向符号正确率明显偏低，见 §12.3）。
- 接触阴影：步骤 1 在底色之前先填一块偏移 `(1.5, 2)` 的黑底（α .42），底色盖上后只在格间空隙露出
  右 / 下两条投影——确定性绘制，不用 `shadowBlur`（避免 DPR 语义差异）。
- 文字可读性：`drawTileName()` 增加 ① **逐行窄底板**（α .84，随该行字形宽度，行间留贴图，避免两行名变成黑箱）
  ② **字形描边**（`strokeText`，α .85，深色 halo 属于字形本身）。底板宽度走新增的 `measureCached()`
  （带 font 的宽度缓存），否则每帧会多出 ~60 次 `measureText`，把 M1.2 的优化重新破坏（实测抓到并修掉）。

### 12.2 测量手段：`scripts/lighting-check.mjs`

- `geom`：CDP 起真实会话，读 `--cell-w / --cell-h / --gap` + `#boardInner` 矩形（与应用同源，见 `js/board-metrics.js`）。
- `check --a <改造前> --b <改造后>`：
  - **方向性**：逐格四条边的平均相对亮度差 Δ（后 − 前）。贴图内容两张图相同，差值只剩光照贡献。
  - **对比度**：先从图像反推「文字行」（行均亮度显著低于该格中位行的行），在这些行内排除字形墨迹（L > 0.25）后
    取背景亮度 **p95**，按 WCAG 公式算字色 `#f8fbf9` 的比值。
    之所以不用「整带最亮像素」：带内没被文字覆盖的贴图画素再亮也与可读性无关（该口径恒 1.3 上下，无区分度）。

### 12.3 结果

| 指标 | 改造前 | M3a |
|---|---|---|
| 方向性 Δ（44 格均值，6 张截图合计） | — | Δtop **+0.0191** / Δleft **+0.0230** / Δbottom **−0.0163** / Δright **−0.0240** |
| 各边符号正确率 | — | 顶 >0 **87.9%**、左 >0 **97.7%**、底 <0 **100%**、右 <0 **100%** |
| 方向性（初版半档，对照） | — | Δtop +0.0078 / Δleft +0.0108 / Δbottom −0.0154 / Δright −0.0186；顶 / 左符号正确率仅 67.8% / 91.3% |
| 文字对比度（p95 口径） | 整带最亮像素 1.17–1.33:1 | 最差 **5.95:1** / 中位 **10.10:1**，**≥4.5:1 达标率 100%** |
| 文字对比度（逐格最大值口径） | — | 最差 3.37:1（抗锯齿杂点上限，单像素毛刺，不作为门） |
| `npm test` / `subtype-test` / `render-parity`(R7) / `css-anim-audit` | — | 全部通过（语义差异 0、keyframes 违规 0） |

> 顶边符号正确率偏低的原因：顶边带与墙色条、等级徽章 / 建造图标（右上）、多行名底板（两行名会顶到砖顶）
> 重叠，这些覆盖物在改造前后都存在，稀释甚至盖过光照增量。聚合均值与底 / 左边一致，方向模型本身成立。

### 12.4 性能 A/B（`perf-probe --repeats 2 --rounds 5 --tiers 1080p@100%`）

| 指标 | 改造前（`a0bde88`） | M3a |
|---|---|---|
| 脉冲 canvas P50 / P95 | 0.2 / 0.5 ms | **0.2 / 0.5 ms** |
| 脉冲 `measureText` / 帧 | 0 | **0**（首版曾变 60，已加宽度缓存修回） |
| 每帧渐变 / drawImage | 0 / 44 | **0 / 44** |
| 开局位图分配 | 4 次 / 12.1 MB | 4 次 / 12.1 MB |
| 待机 DOM / heap | 498 / 9.5 MB | 498 / 9.5 MB |

光照只在**烘焙期**新增绘制（布局 / 贴图失效时），逐帧路径不变；上表为**最终采用档**的复测结果，
与改造前（`a0bde88`）逐项一致。样本 n=2，回合耗时方差极大（方案 §0 C6），不作为判据。

### 12.5 诚实清单

1. **DOM 降级路径未同步**：无文字底板 / 描边，光照也还是 `.tile-v2` 原有的 box-shadow。
   `render-parity`（R7）只比语义，不比对画面的接受度；DOM 路径的视觉一致性留 M3b / M5。
2. 墙色条的群类别色未动（`WALL_COLORS` 映射不变），地块 `id` / `artIndex` / 顺序未动（R3）。
3. 「不再像贴纸」的盲测门（方案要求 ≥2/3）**尚未执行**，需要真人；本节给的是客观代理指标。
4. 天气 / 时段 tint（§2.4 第 4 点）未做。
