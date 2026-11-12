# 全仓代码审查（2026-11-12）

审查对象：`master` @ `3b66c3a`（v1.9.0），工作区干净。
范围：`js/`、`electron/`、`scripts/`、`smoke.test.mjs`、`index.html`。`www/` 为生成目录，只核对同步结果。
方法：逐文件通读 + 对照设计文档确认意图 + 运行现有测试 + 对已修项做变异校验（还原修复后测试必须失败）。

## 验证状态

- `npm test`：通过（2026-11-12 最后一批改动后重跑）。
- `node scripts/subtype-test.mjs`：通过，51 项。
- 四批修复共新增约 60 条断言，并对 13 处修复做了变异校验（临时还原 → 测试必须失败）。
- 测试环境注意：`dom-stub` 把 `setTimeout` 换成 `setImmediate`，会掩盖「60s 兜底定时器」类 bug；TTS 用例已临时切回真实定时器。
- CI（`.github/workflows/test.yml`）只跑 `npm test`，没有 lint / 类型检查 / 未使用导出检查。
- 未做：实机手玩验收、Electron 打包产物 / 真实窗口运行验证。Electron 侧结论按「待实机确认」对待。

## 第一批已修（5 项）

| ID | 位置 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| A1 | `js/rules-core.js` `aiTradeAccept` | 估值方向整体取反：AI 会拒绝白送的 100 盖、接受白付 100 盖，可被无限套现 | 改为站在 AI 立场：收进的地/盖为 `+`，让出的为 `-`；垄断溢价改挂到「收进」一侧 | `smoke.test.mjs` 新增 4 条断言（双向收款、双向换地） |
| A2 | `js/rules.js` `payRent` | 棚户维护费付反：缴租方付、地主收，陷阱地块变成最赚地块 | 按 `docs/terrain-variants.md:49` / `docs/v1.8.0-plan.md:69`：地主自付 10 盖，付不起则地块废弃 | `scripts/subtype-test.mjs` 改为断言 `净收入 = 租金 - upkeep`（实测净值 3，与设计表一致），并补「地主破产→地块废弃」 |
| C2 | `js/game.js` 遗产重抽 | `!confirm(...)` 把「取消」当重抽、「确定」当接受 | 去掉取反，`confirm` 返回 true 才重抽 | 无自动化（需 legacy 对局与 `confirm` 桩；`dom-stub` 的 confirm 恒真）。**待手玩确认** |
| C3 | `js/game.js` `wireMeta` | 落地面板（购买/强化）的「结束回合」只重建操作栏，要点两次；期间 `pendingTile` 被清、双数补掷被吞 | 新增 `endHumanTurn(p)`：清 pendingTile → 双数则走补掷 → 否则一步 `endTurn()` | `smoke.test.mjs` 新增「一步结束回合」用例，变异校验可失败 |
| C4 | `js/rules.js` `payRent` | 破产租金凭空造币：房东按全额入账，随后 `bankrupt` 又把地产转给房东，债主拿两份；奖池同样按全额累积 | 房东只收 `min(租金, 缴租方现金)`；奖池只累积实收部分；欠款仍以资产抵偿 | `smoke.test.mjs` 新增「房东只收 5 盖」用例，变异校验可失败 |

变异校验记录（逐项还原后运行）：

- 还原 `rules-core.js` → `Error: AI 白收 100 盖却拒绝`
- 还原 `rules.js` → `Error: 房东只应收实际可付的 5 盖，实际 14`；`subtype-test` 4 项 FAIL
- 还原 `game.js` → `Error: 落地面板「结束回合」没有一步结束回合`

## 第二批已修：P1 规则线（9 项，2026-11-12 下午）

| ID | 位置 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| C1 | `js/game.js` 隔离区 | 失败后立刻重开面板，人类一回合能连掷 3 次；AI 掷一次失败后同回合付保释金出狱 | 按选定方案走严格规则：失败即本回合结束；保释/出狱卡在回合开始使用，用掉后照常掷一次；关满 3 回合强制离开且不再掷骰 | `smoke.test.mjs` 桩定骰子为非双数，断言 `jailTurns=1` 且回合已推进 |
| C5 | `js/rules.js` `enterJail` + `js/game.js` | `no_jail` 下仍打印「被关进隔离区」并结束回合；`doubles` 未清零，之后每次双数都被当成三连 | `enterJail` 返回布尔值；无法无天时清 `doubles` 并返回 false，两处调用点按返回值决定日志 | 直接断言返回值、`doubles`、`inJail` |
| C6 | `js/missions.js` `pickMission` | 兜底池绕过 `requires`/`requiresRep`，未解锁的连锁/核弹/派系任务会被提前放出 | 没有可接任务就返回 null（调用方按「空频道」处理） | 旗标未解锁 → null；已完成 once → null |
| C7 | `js/campaign.js` | 合作模式把非线性 getter 相加：1 铁路 + 1 设施被算成 2 | 目标可带 `coopGet`，infra 按队伍去重后重算 | 1+1 → value=1 未达成；2 条铁路 → 达成 |
| C8 | `js/data.js` + `js/game.js` + `js/view-save.js` | 「固定布局」只清归属不还原顺序；旧档缺布局信息时把地块状态套到上一局随机布局 | 新增 `resetBoardOrder()`；固定布局与缺布局旧档都按原始顺序还原 | `shuffleBoard` 后 `resetBoardOrder`，断言 `artIndex === i` |
| C9 | `js/state.js` + `js/view-save.js` + `js/game.js` | `forcedRoll` 跨局泄漏；`luckyUsed` 不存档（读档白送幸运开局）；`extraRoll` 判断在 `pendingTile` 之前（双数落地买地的存档丢购买机会） | `resetSession` 清 `forcedRoll`；存档/读档补 `luckyUsed`；`restoreTurnUI` 改为 pendingTile 优先 | 存档含 `luckyUsed` 且读档恢复；pendingTile+extraRoll 同时存在时恢复购买面板 |
| C13 | `js/rules.js` `payCaps` + `js/game.js` 税务 | 付不起时日志与奖池仍按全额记账 | `payCaps` 返回实际支付额；税金只把实收部分放进奖池 | 现金 5 付 20 → 返回 5 |
| A4 | `js/game.js` | 生存模式身家达标会普通胜利；衰减破产被「全员破产→协议中断」抢先，`survivalLose` 不可达 | 抽出 `targetWealthReached()` 排除生存模式；`nextPlayer` 开头先判生存破产 | 生存模式身家 9999 不判胜；破产玩家 `takeTurn` → `endKind='survival'` |

变异校验记录（逐项还原后运行，均按预期失败）：

- 隔离区失败路径改回重开面板 → `Error: 隔离区失败后本回合未结束（同一回合还能再掷一次）`
- `targetWealthReached` 去掉生存排除 → `Error: 生存模式不应因身家目标提前胜利`
- `pickMission` 恢复旧兜底 → `Error: 任务兜底绕过了 requires：未解锁的连锁任务被放出来了`
- `evaluateCampaignCoop` 绕过 `coopGet` → `Error: 合作 infra 应按队伍去重（1 铁路 + 1 设施 = 1，未达成），实际 2 done=true`
- `resetBoardOrder` 改空函数 → `Error: resetBoardOrder 未还原 content/tiles.json 的原始顺序`
- `restoreTurnUI` 的 pendingTile 分支短路 → `Error: 恢复落地面板时操作区未渲染购买按钮`

## 第三批已修：P2 安全线（2026-11-12 晚）

| ID | 位置 | 问题 | 修复 | 证据 |
|---|---|---|---|---|
| B1-1 | `electron/tts-endpoint.js`（新增）、`electron/main.js`、`electron/custom-tts.js` | 渲染层可指定 `baseUrl`，主进程把解密后的 Key 作为 Bearer 发往任意主机；http 明文出网；可被指向内网/链路本地（含云元数据） | 新增纯函数端点校验：只接受 https 公网或 http 本机回环；拒绝内嵌账号密码、私网、链路本地、`.local`；`WASTELAND_ALLOW_PRIVATE_TTS=1` 显式放行。保存 Key 时把 origin 与 Key 一起落盘绑定；`custom:speak` 只用绑定地址，渲染层只能影响 model/voice/speed；改地址必须重新保存 Key | `smoke.test.mjs` 新增 11 条端点断言；变异校验：关掉 http 检查 → `公网 http 必须拒绝` |
| B1-2 | `electron/main.js` `handle()` | 所有 IPC 无来源校验，被导航到任意页面的窗口可直接调 preload 桥 | 统一包一层 `handle()`：校验 `event.sender === mainWindow.webContents` 且 `senderFrame.url` 是应用自身 index.html；不匹配直接拒绝 | 静态（Node 测试无法启动 Electron 运行时） |
| B1-3 | `electron/main.js` | 只拦了 `window.open`，`location.href` / 链接 / meta refresh 可把应用导航到远程页面 | 增加 `will-navigate` / `will-redirect` / `will-frame-navigate` 守卫，只允许应用页面；`openExternal` 改 `new URL` 校验并吞掉拒绝 | 静态 |
| B1-4 | `js/view-modal.js`、`js/view-save.js`、`js/view-manage.js`、`js/view-core.js`、`js/view-legacy.js`、`js/legacy.js`、`js/tts.js` | XSS：玩家名经 `openTargetList` 原样进 innerHTML；存档字段只校验 `id/pos`，卡牌 id / 等级 / 颜色 / 头像 / 规则字段原样进入渲染与规则 | `openTargetList` 内部统一转义；新增完整 `normalizeSave()`（数字钳制、模式/结局/难度枚举、id 指向校验、卡牌白名单、颜色 `#hex` 白名单、头像仅 `data:image/`、棋盘排列校验、规则字段按默认值类型收敛）；`safeColor()` 阻止 style 注入；遗产 meta 逐字段收敛；调试面板转义；交易目标改按 id 查找 | `smoke.test.mjs` 新增 17 条收敛断言 + 一次手改存档 `loadGame` 端到端；变异校验：`normalizeSave` 退回浅拷贝 → `非法模式未被收敛` |
| B1-5 | `electron/custom-tts.js`、`electron/mimo-tts.js` | 错误体 / JSON / 音频响应无上限缓冲，对端可让主进程分配任意大内存 | 改为流式读取并在超限时取消：错误体 4KB、音频 20MB、JSON 1.4×音频上限 | 静态（需 mock fetch 才能单测） |
| B1-6 | `electron/main.js` | `mimo:speak` 展开渲染层 opts → 可改 `cacheDir` / `root` / 凭证来源，向任意目录写文件 | 只接受 `voice` / `speed`；文本截断 5000 字 | 静态 |
| B1-7 | `electron/mimo-tts.js` | 打包后从 `process.cwd()` 读取 `.mimo-api-key`，快捷方式「起始位置」可决定凭证来源 | 删除 cwd 回退，只认主进程传入的项目根 | 静态 |
| B1-8 | `electron/main.js`、`index.html` | 未显式 sandbox / DevTools / 权限策略，CSP 缺 frame-ancestors | `sandbox: true`、`devTools: !app.isPackaged`、拒绝全部权限请求、CSP 补 `frame-ancestors 'none'` | 静态 |
| B1-9 | `scripts/gen-voice.mjs` | `fetch` 无超时，卡住的连接会让批量生成永久挂起；401/403 也重试 3 次 | 60s AbortController；4xx（除 408/429）不再重试 | 静态 |

变异校验记录：

- 关闭端点 http/私网检查 → `Error: 公网 http 必须拒绝（Key 会明文出网）`
- `normalizeSave` 退回 `{...d}` → `Error: 非法模式未被收敛: <img src=x onerror=alert(1)>`

### P2 残余与明确未验证

- **未在真实 Electron 运行时验证**：本环境无法开窗口。需手动执行 `npm run desktop:dev` 并确认：应用能启动、TTS 状态可读、保存 Key 后能测音、改 Base URL 会提示重新保存、点击外部链接不导航。
- 升级路径：旧版本只把地址存在 localStorage，首次 `custom:init` 会把当前地址绑定到已有 Key。这一刻如果渲染层已被攻陷，仍可绑定攻击者 origin（一次性窗口）。此后不再可改。
- `style-src 'unsafe-inline'` 保留（大量内联 style 属性），颜色注入已用白名单收口，其余内联样式来自静态模板。
- 响应上限是单次响应体；流式读取本身不做跨请求总量限制（正常播报由队列串行）。

## 第四批已修：P2.5 玩法/语音收尾（2026-11-12 深夜）

| ID | 位置 | 问题 | 修复 | 证据 |
|---|---|---|---|---|
| A3 | `js/tts.js` | `cancelTts` 不真正取消：旧链条目继续执行；`playBlob` 暂停不结算、60s 定时器不清、blob URL 不 revoke；播放失败被当成成功；语速对预录源无效；清空 MiMo Key 后状态反而标就绪 | 候选引擎改为「只合成返回 Blob」，由 `speakOne` 统一播放并检查世代号；`playBlob` 返回 `true/false`，取消时立即结算并清理定时器/URL/音频；播放结束才写 `lastEngine`；`playbackRate` 对所有来源生效；清 Key 后 `mimoReady=false`；删除已停用的 browser TTS 死代码；`preloadTTS` 返回真实 Promise | 假 Audio 复现「pause 不触发 ended」；4 组断言（取消立即结算 / 排队不补播 / 语速生效 / 失败不报就绪）；变异校验：去掉 `currentStop` → `cancelTts 未让正在播放的播报立即结算` |
| C11 | `js/game.js` 玩家工厂 | 遗产 `getOut`/`moral`/`START_CARDS` 对 AI 也生效；`START_CARDS` 当布尔只发 1 张 | 三者的「人类专属」加成按 `isAI` 闸门；起始手牌按数量循环发放 | legacy 局断言人类 1 出狱卡/2 道德/1 手牌，AI 全 0；变异校验 → `AI 不应获得遗产出狱卡` |
| C12 | `js/missions.js` | `isChainMission` 把「一次性」也当连锁，20 个独立事件被标「🔗 连锁任务」并获 3 倍权重 | 连锁只看 `requires` / `requiresRep`；权重改用同一判定 | 4 条纯函数断言；变异校验 → `一次性任务不应被标成连锁任务` |
| C14 | `js/mutators.js`、`js/legacy.js`、`游玩手册.md` | `unlockedMutators` 没有任何写入路径，手册却写「用遗产点解锁」，且说 15 种（实际 25 种） | 判定为文档与实现不一致，而非缺功能：明确全部 25 种默认可用、遗产点用于「每日重抽」；`rollMutators` 的空解锁列表视为全部（旧代码传空数组会抽到 0 个）；手册同步更正 | `rollMutators(3, [])` 返回 3；变异校验 → `空解锁列表应视为全部突变因子可用` |

**C14 的取舍说明**：备选方案是按手册做成「基础因子池 + 遗产点解锁」。但现有内容没有「未解锁因子」这一层，采用该方案等于把玩家现在能抽到的因子收回去，属于改玩法而不是修 bug。因此选择让实现与文档对齐，并在报告里保留原提案。

**测试环境发现（重要）**：`scripts/dom-stub.mjs` 把所有 `setTimeout` 换成 `setImmediate`，导致 `playBlob` 的 60s 兜底定时器在测试里「立即触发」——这正是 A3 的 bug 一直测不出来的原因。TTS 用例已临时切回真实定时器（`node:timers`），否则取消类断言会假阳性。

### P2.5 残余

- `unlockTts()` 仍会创建独立的 `AudioContext` 且从不关闭；它也不解锁 `HTMLAudioElement`（真正起作用的是首次用户手势）。属于资源卫生问题，不影响本次修复的行为。
- 过场（`js/cutscene.js`）的 `playCutscene` 重入保护仍未做；当前只有核弹流程调用，风险低。

## 未修：性能

| ID | 位置 | 问题（数字为静态估算） |
|---|---|---|
| D1 | `js/view-core.js` `render` + `js/board-canvas.js` `resizeBoardCanvas` | 每次 render 先 `fitBoard()`（4-6 次布局读取 + 13 个 CSS 变量写入）再无条件下调 `canvas.width/height`：1425×921 @DPR2 约 21MB 位图重分配，一回合 2-6 次。`markMonopolyTiles` 里又触发一次 `drawBoard`，等于每轮画两遍 |
| D2 | `js/board-canvas.js` 脉冲/悬停 | 620ms 脉冲约 37 帧，每帧 88 次 `createLinearGradient`、44 格重新 `fitFontSizeToCell`；估算单次脉冲约 3,250 次渐变、4.4 万次 `measureText`。悬停扫过与每步移动同样全量重绘 |
| D3 | `js/icons.js` / `js/assets-art.js` | 每帧重建 20 项图标对象、44 个 `URL` 对象、建筑 SVG 字符串 |
| D4 | `js/board-metrics.js` `getTileRect` | 移动循环每步 3 次 `querySelector` + 3 次 `getBoundingClientRect`，与样式写入交错，布局抖动 |

建议：棋盘静态层画到离屏 canvas，只在「布局/归属/等级/抵押/垄断/尺寸」变化时失效；`resizeBoardCanvas` 宽高与 DPR 未变时直接 return；图标表与 URL 提到模块级。

## 未修：架构与死代码

- `js/game.js` 846 行承担 8 类职责（开局装配、回合引擎、骰子动画、落地结算、隔离区、人类操作栏、天气、结局/存档恢复）。建议先拆 `turn-engine.js`、`jail.js`、`endings.js`，`resolveTile` 的 11 分支改 `TILE_HANDLERS[type]`。
- `js/view-core.js` 651 行、约 25 个导出，混布局计算 / 棋盘 DOM / 标记层 / 玩家面板 / 指挥中心 / 日志 / 音频解锁。`board-canvas.js` 已证明拆分可行。
- `js/tts.js` 599 行：三个 provider 的 init + 合成 + 播放 + 写全局 `lastEngine` 交织，队列无法控制播放。建议 `tts/queue.js`、`tts/player.js`、`tts/providers/*`、`tts/settings.js`。
- 循环依赖：`rules.js → view.js`（聚合器，等于让规则层依赖整个 UI 图）、`view.js ↔ game.js`、`view-core → view-nuke → nuke → view-core`。当前靠 ESM 惰性绑定能跑，顶层取值即炸。
- 重复实现：`sleep` 三份（`js/game.js`、`js/nuke.js`、`js/fx-env.js` 已有 canonical）、`equalizeWealth` 两份、`recordLegacyRun` 整段复制、`escapeHtml` 两份（`view-util.js`、`main.js`）、合作模式垄断判定重复实现虽已有 `isMonopoly`。
- 已验证死代码：`game.js` 的 `NUKE_LAUNCH_SFX_MS` 与 `formatNarrativeIntro` 导入、`rollsTaken` 只写不读；`narrative.js` 的 `formatNarrativeIntro`；`view-core.js` 的 `applyBoardTilt(_on)`/`applyTileArt(_on)` 忽略参数、语义与名字不符。

## 测试缺口

- 交易、隔离区、维护费方向、生存结局：审查前 0 条测试（现已补：交易双向、维护费方向、破产租金、一步结束回合、隔离区单次掷骰、任务兜底、合作 infra、棋盘顺序、读档优先级、生存结局）。
- `subtype-test.mjs` 曾把维护费错误方向固化为预期（已改）。
- 仍缺：`no_jail` 的端到端、AI 保释决策、`enterJail` 返回值的 E2E 路径（现有用例是直接调用）。
- 建议：CI 增加 `node scripts/subtype-test.mjs`；继续按「纯函数直测 + 少量 `resolveTile`/`restoreTurnUI` 确定性 E2E」的模式补。

## 后续批次

1. ~~**P1**（规则正确性）：C1、C5–C10、C13、A4~~ —— 已完成。
2. ~~**P2**（发布前安全）：B1 的 1–5 步 + 端点绑定 / IPC 来源校验 / 响应上限~~ —— 已完成，见第三批表格；剩余「真实 Electron 运行时验证」待手动。
3. ~~**P2.5**（剩余规则/功能）：A3、C11、C12、C14~~ —— 已完成，见第四批表格。
4. **P3**（性能）：D1、D2（棋盘全量重绘 / 位图重分配 / 每帧分配）。
5. **P4**（结构）：game/view-core/tts 拆模块 + 死代码清理 + CI 扩容。

> 至此审查报告中的「Critical / Required」项已全部处理；剩余为 Optional 级（性能、结构、少量死代码）。
