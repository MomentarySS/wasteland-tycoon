# Windows 桌面客户端

> 当前实现说明：v1.7.3。本文以仓库代码和 `package.json` 为准。

## 产品范围

当前产品是 Windows x64 Electron 桌面客户端。Web / PWA 与 Android 已停止维护并移除启动工程；macOS 和 Linux 不在支持范围内。

## 运行方式

Electron 主进程创建窗口并加载 `www/index.html`。`www/` 是生成目录：`npm run sync:www` 会从项目根目录复制 HTML、JavaScript、CSS、内容数据和资源。请修改源目录，不要直接编辑 `www/`。

```bash
npm install
npm run desktop:dev
```

构建 Windows x64 NSIS 安装包：

```bash
npm run desktop:build
```

打包脚本会先同步 `www/`，再调用 Electron Builder。安装包和解包目录位于 `release/`，该目录不提交到仓库。

## 语音

`js/tts.js` 当前提供三种来源：

| 来源 | 行为 |
|---|---|
| MiniMax 在线 | 默认来源；通过 Electron 主进程调用 MiniMax T2A，覆盖动态播报和固定旁白 |
| 小米 MiMo 在线 | 通过 Xiaomi MiMo-V2.5-TTS OpenAI 兼容接口合成完整播报；支持内置中文音色 |
| MiniMax 预录 | 只播放随包语音清单中已录制的固定语句；缺少对应录音时不会自动切换到在线或系统语音 |

系统 `speechSynthesis` 不作为运行时降级链路。在线语音需要有效的服务商 API Key 和网络连接。开局配置可录入并清除 MiniMax / MiMo Key；Electron 主进程使用 `safeStorage` 加密后保存在当前用户的应用数据目录，不传回页面、不进入存档。也可通过 `MINIMAX_API_KEY` / `MIMO_API_KEY` 环境变量，或本地 `.minimax-api-key` / `.mimo-api-key` 文件配置；这些文件已被 `.gitignore` 排除，切勿提交密钥。

MiniMax IPC 通过 `electron/preload.cjs` 暴露的受限接口调用；渲染进程不直接读取密钥。

## 主要目录

- `electron/main.js`：窗口、应用生命周期和语音 IPC
- `electron/preload.cjs`：向渲染进程提供受限桌面接口
- `electron/minimax-tts.js`、`electron/mimo-tts.js`：在线合成、音频缓存和服务商调用
- `js/`、`css/`、`content/`、`assets/`：游戏渲染内容和数据
- `scripts/sync-www.mjs`：生成 Electron 页面镜像
- `scripts/build-desktop.mjs`：Windows 安装包构建入口

## 验收提示

`npm test` 运行仓库冒烟检查。每次发布仍需在目标 Windows 环境检查安装、启动、存档和语音；构建成功本身不代表安装包已完成用户环境验收。

## v1.7.1 发布候选验收（2026-09-27）

- `npm run desktop:build` 已生成 `release/废土大亨 Setup 1.7.1.exe`（Windows x64 NSIS）。
- 已在工作区隔离目录完成静默安装，安装程序退出码为 0。
- 已从安装目录启动客户端并确认 Electron 进程正常运行，随后关闭验收进程。
- `npm test` 已通过，覆盖回合流程、买地/升级、存档与剧情模块。
- 本轮路径残影、事件结果摘要和指挥中枢层级修复已重新同步进 `www/`；ASAR 含对应脚本、样式和背景资源，1541×912 Electron 窗口已检查中央态势、操作和目标信息布局。
- 最新安装包再次静默安装成功（退出码 0），从安装目录启动进程保持运行后正常关闭。
- 在线 MiniMax / MiMo 合成仍需要用户自己的 API Key 和网络；本轮确认 IPC、预加载和配置链路存在，没有伪造在线服务成功。

## v1.7.2 发布候选验收（2026-10-08）

- `npm run desktop:build` 已生成 `release/废土大亨 Setup 1.7.2.exe`（Windows x64 NSIS，132,713,565 字节）。
- 已在工作区隔离目录完成静默安装，安装程序退出码为 0；随后从安装目录启动客户端，进程保持运行 12 秒以上后正常关闭；卸载程序退出码同样为 0，无快捷方式残留。
- 启动日志确认渲染层链路：`[TTS] initTTS 完成, source: minimax desktop: true` 与 `[TTS] MiniMax 就绪 speech-2.8-turbo male-qn-jingying`，说明 preload / IPC / 密钥配置链路可用；**本轮未验证真实在线合成**（账户额度不足），不作成功断言。
- `npm test` 在 `package.json` 版本为 `1.7.2` 的状态下通过，覆盖回合流程、买地 / 升级、存档与剧情模块。
- 打包链路：Electron **44.5.0** + electron-builder **25.1.8**，解包（`--dir`）与 NSIS 安装包均成功；Electron 运行时经 npmmirror 镜像下载。
- **体积变化**：v1.7.1 安装包 106,039,562 字节（101.1 MiB）→ v1.7.2 132,713,565 字节（126.6 MiB），**增加 25.4 MiB**。原因是 Electron 33.4.11 → 44.5.0 的运行时体积增长（win32-x64 压缩包 115 MB → 约 158 MB），预录语音孤儿清理省下的约 5.6 MB 被完全盖过。要压回体积，唯一杠杆是回退 Electron 主版本。
- **已知遗留**：窗口 / 任务栏图标仍指向 `logo.svg`（`electron/main.js:28`），而 Electron `nativeImage` 不支持 SVG，启动时产生告警并回落到默认图标；本次发布未修复。
- 验收环境（隔离安装目录、临时 userData、启动日志）已在验收后清理，未改动用户实际应用数据目录。

## v1.7.3 发布候选验收（2026-10-08）

### 内容

- **预录语音补齐至 286 / 286 条**：此前仓库只有 41 条能与当前文案匹配（`missionSpeakText` 自2026-09-04 起拼接 `story` 字段，导致 80 条任务开场与 1 条章节旁白 hash 失配；另有 164 条从未录制）。本版补齐全部缺项，语音资源 15.6 MB。
- **预录语音解码缓存**（`js/tts.js`）：按文件（内容 hash 名）缓存解码后的 Blob，LRU 上限 320，避免每次播报重复 `fetch` + MP3 解码；失败不写缓存，避免网络抖动永久毒化条目。
- **窗口 / 任务栏图标修复**（`electron/main.js`）：Electron 的 `nativeImage` 不支持 SVG，此前图标静默回落到系统默认。改为使用 `logo.png`，并把 `logo.png` 纳入 `scripts/sync-www.mjs` 的镜像清单（`build.files` 只收 `electron/`、`www/`、`package.json`，不同步则图标进不了包）。

### 验证

- `npm run desktop:build` 产出 `release/废土大亨 Setup 1.7.3.exe`（142,320,723 字节，约 135.7 MiB）。
- 7-Zip 完整性校验通过（`Everything is Ok`，NSIS-3 Unicode，载荷141,893,582 字节）。
- ASAR 内容核对：`www/assets/voice/` 下 **286 个 mp3**、`manifest.json` 与 `logo.png` 均在包内（`app.asar` 27.83 MB，v1.7.2 为 18.1 MB）。
- `npm test`：通过（`SMOKE TEST PASSED`）。
- **完整链路验收通过**：静默安装退出码 0 → 从安装目录启动，进程存活 14 秒以上后正常关闭，**0 条 ERROR 级日志**，图标加载告警消失 → 卸载退出码 0、无残留文件、无快捷方式残留。验收环境（隔离安装目录、临时 userData、启动日志）已清理。

### 排查记录：一度出现的静默安装崩溃（已排除，非本版问题）

- 现象：`/S` 静默安装崩溃退出 `-1073741819`（`0xC0000005`，故障模块 `System.dll`），曾在连续多次重试中复现。
- 判别过程：同期的 **v1.7.2 包以完全相同的故障模块与时间戳崩溃**；交互模式（非 `/S`）下安装界面可正常弹出；`%LOCALAPPDATA%\wasteland-tycoon-updater\installer.exe`（electron-builder 缓存的另一份独立构建）与 v1.7.1 包静默安装均成功；安装包经 7-Zip 校验完好（`Everything is Ok`）。
- 结论：**属于本机的瞬态状态问题，与本版代码无关**，清理 NSIS 临时目录并完成若干次安装后自行恢复，随后 v1.7.3 的完整安装 → 启动 → 卸载链路一次性通过。
- 若日后再次遇到同类崩溃：先看应用程序事件日志的故障模块（`System.dll` + `0xC0000005` 通常指向安装器运行环境而非安装包），并用**另一个已知可用的安装包**做对照，即可快速区分「包的问题」与「环境的问题」。

## v1.8.0 发布候选验收（2026-10-08）

### 内容

- **prop subType 四变种**（`js/subtypes.js` + `content/tiles.json`）：地标（砍基础 45% 后 ×2.2、不可抵押）／棚户（×0.55 + 每次 10 盖维护费）／流动（租金随骰点浮动）／污染（×1.6、缴租方道德 −1）。数值锚定在 20 局实测基线中位终局净值 3043 盖的 8%（243 盖）以内。
- **预览面板显示 subType 标签**（`js/view-core.js`），并写出 `data-subtype` 钩子供CSS 配色。
- **mutator 视觉族**（`js/mutators.js` + `css/style.css`）：仅 5 个带灾害语义的 mutator 有映射，同局多族按固定优先级只显示一族；纯表现层，规则数值零改动，新增位图 0 张。

### 验证

- `npm run desktop:build` 产出 `release/废土大亨 Setup 1.8.0.exe`（**142,324,250 字节**，135.7 MiB），SHA256 `1A4F5B3FFFB9F780A2FEC9AC6F90A539D5D7AF3384521D5856668C84734AF924`，blockmap 149,174 字节。较 v1.7.3 仅 +3,476 字节。
- 闸门：`npm test` 通过；`scripts/subtype-test.mjs` 48/48；`scripts/subtype-design-check.mjs` PASS（越界退出码 1）。
- 平衡回归（各 20 局）：4P 中位净值 3032（基线 3043，−0.36%）、2P 中位 3072（+0.95%），两档均 **0 破产**、全员存活 20/20。
- 静默安装 `/S` → **退出码 0**（装入隔离目录 `test/acceptance-180/`，未改动用户实际应用数据目录）。
- ASAR 核对：10 个关键文件全部在包内，且与源码**逐字节一致**（`subtypes.js`、`mutators.js`、`view-core.js`、`rules-core.js`、`rules.js`、`data.js`、`style.css`、`tiles.json`、`logo.png`、`voice/manifest.json`）；`www/assets/voice/` 286 个 mp3；`app.asar` 29,197,807 字节。
- 启动：进程存活 16 秒以上（4 个进程），渲染层确实初始化（`Local Storage` / `Code Cache` / `minimax-tts-cache` 均生成）。日志含 `[TTS] initTTS 完成, source: minimax desktop: true` 与 `[UI] 测音按钮已绑定`（后者证明 `view-core.js` 及其 import 链全部解析成功），**图标加载告警未复现**（v1.7.2 的老问题保持修复）。
- 卸载 `/S` → **退出码 0**；安装器新建的桌面与开始菜单快捷方式均已移除，用户原有的 `桌面\开发\废土大亨.lnk` 保留未动。

### 两处偏离，如实记录

1. **启动日志存在 4 条 GPU ERROR**，因此**不能沿用 v1.7.3 的「0 条 ERROR 级日志」判据**：
   `SharedImageManager::ProduceSkia: Trying to Produce a Skia representation from a non-existent mailbox.`
   - 该报错出自 Chromium GPU 合成层（`gpu\command_buffer\service\shared_image\shared_image_manager.cc`），与本版的 JS 机制改动无直接关联，但**未完成对照实验**，不能断言为既有问题：原计划用 v1.7.3 做同条件对照，该安装器因与已安装的 1.8.0 同 `appId` 而挂起，已终止。
   - 另需注意：v1.7.3 文档记的「0 条 ERROR」**很可能是对空日志点的名**——本轮首次启动时 stdout 仅 2 字节、stderr 0 字节，同样会得到「0 ERROR」。改用 `--enable-logging --log-file=` 后才拿到真实日志。**日志判据必须在确认日志非空的前提下才成立。**
2. **卸载后残留 `resources\app.asar`（29,197,807 字节）**在隔离安装目录内，其余文件均已清除。退出码为 0，快捷方式无残留。该残留随隔离目录保留，且该文件当前被其他进程占用，`rm --` 可恢复删除多次失败（`DeleteDirectory` 报 "The system call level is not correct"，重命名探测报「另一个进程正在使用此文件」），未绕过可恢复删除强制清理，需人工处理。`test/acceptance-180/` 因此仍以 `??` 出现在 `git status`。

## v1.8.1 修复轮（2026-10-10）

**本版不是功能版。** 内容是 2026-10-09 OCR 全仓审查报告的执行结果，共 24 个 commit，范围 `0a1dc89..b9eef08`，39 文件 **+532 / −577**。按仓库发布流程「含新功能走 minor」，本轮无新增面向用户功能，故走 patch。

### 内容

**P0（1 项）**

- `js/game.js` 补 `evaluateCampaignCoop` 导入，修复**合作闯关回合结算直接崩溃**。回归用例走 `game.js` 的真实入口链（`chGo → takeTurn → afterHumanAction → endBtn → endTurn`），并用变异测试确认过该用例真能抓回归。

**P1 安全与一致性（6 项）**

- `js/tts.js`：`cancelTts` 用**世代号 `_gen` 隔离**队列，而不是把计数减到 0。
- `.gitignore` 忽略 `test/acceptance-*/`，验收产物不再污染 `git status`。
- 视图层三处 HTML 注入点收敛（`escapeHtml` 补单引号 + `short`/`moral` 转义与归整）。
- `electron/main.js`：`openExternal` 加 `http(s)` 白名单；生产包关闭 F12。
- `electron/minimax-tts.js`：补 `options` 转发，错误回显抹除 API Key。
- `index.html` 加 Content-Security-Policy。

**P2 清理与收敛（11 项）**

- 死代码清理：零引用死导出、失效的 `tokenIcon` / `uiArtUrl` / `UI_ART`、未接线的遗产结算界面与 2.5D 空壳 API、死分支与死条件、只写不读的 CSS 变量；顺带补上 `getCellMetrics` 的缺失导入。
- `js/config.js` 抽出 `TYPE_LABEL` / `tileDisplayName` 共用实现，去掉 `iconColor` 的重复副本。
- 价格字面量收进常量（`CARD_PRICE` / `STEAL_PRICE` / `MINE_COST_DEEP` / `MINE_COST_SHALLOW`），消除「改价只改一处不生效」。
- `js/view-modal.js`：弹窗动作收尾统一为 `settleAndContinue`，补上掩体缺失的核弹确认分支。
- `js/rules.js`：抽出两组重复的地块筛选。
- 新增 `js/fx-env.js`，抽取表现层环境探测小工具。

**脚手架修正与文档（4 项）**：`subtype-test` 的 volatile 确定性断言恒真、`balance-probe` 零局跑完改为硬失败、`desktop-dev` 补 `spawn` 的 error 监听、canvas 渐变 memo 的 A/B 实测结论落文档；以及 `layout-*-preview` 三处瑕疵与三份重复 DOM 桩合并为 `scripts/dom-stub.mjs`（删 241 行）。

### 验证

- `npm test`（smoke）**PASSED**，退出码 0。含新增的「合作闯关回合结算校验通过」。
- `scripts/subtype-test.mjs`：**pass=49 fail=0**（v1.8.0 为 48/48）。
- `scripts/subtype-design-check.mjs`：**PASS**，全部 subType 在 8% 上限内，退出码 0。
- `scripts/balance-probe.mjs --games 3`：4P 中位净值 3030，**0 破产**，全员存活 3/3，退出码 0。⚠️ **口径不同**：此处为 3 局快速抽样，基线 3043 与 v1.8.0 的验收均是 20 局；换算成 −0.43% 仅供粗判，**不可当作与 v1.8.0 同口径的平衡回归结论**。`balance-probe` 自带的判据是「中位偏移 >15% 才算动了」。
- mimo 端点失败回退有离线桩测试 **9/9**（该临时脚本已在验证后删除）。
- CSP、canvas 重构、fx 工具重构三处**实跑真实 Electron** 验证：`ELECTRON_ENABLE_LOGGING=1` + 临时 `console-message` 监听 + `executeJavaScript` 自动开局，探针已全部还原。
- DOM 桩合并后按 `HEAD` 逐项比对业务代码计数一致（smoke 断言 147/147、subtype-test `ok()` 33/33、常量 6/6、balance-probe 输出 17/17、`report` 16/16）。

### 未做的验收，如实记录

**本轮没有构建安装包，也没有实机安装验收。** 与上面 v1.7.1 / v1.7.2 / v1.7.3 / v1.8.0 四节不同，以下项目在本轮**缺失**，不能拿上面的闸门结果顶替：

- `npm run desktop:build` 未执行，因此无 `废土大亨 Setup 1.8.1.exe` 的字节数 / SHA256 / blockmap。
- 静默安装 `/S` 与卸载 `/S` 未执行，无对应退出码记录。
- ASAR 内容核对未执行。
- 安装后启动日志未采集，**GPU ERROR 是否仍为 4 条未复验**。

已做的替代验证是「**在开发态实跑真实 Electron**」（CSP / canvas / fx 三处），它能证明运行时不报错，但**不能替代打包后的产物核对**。发布前若需要与前四节同格式的完整验收，需补跑构建与安装环节。

### 与原审查报告的偏离，如实记录

原报告的 6 处建议经实测后未照原样执行。**后续若再拿到同一份报告，不要照单重施**：

1. 报告 P1-4 说「只改 `main.js:145`」——无效。**修复前** `minimax-tts.js:138` 实际是无参 `await init()`，只改 main 那一处兜底逻辑根本走不到；**两处一起改**才真修好。（该行现在是 `await init(opts)`，行号已被本轮修复占用，引用时以当前代码为准。）
2. 报告 P1-6 说「补 `_pending = 0`」——会引入负计数回归，改用世代号 `_gen` 隔离。
3. 报告 P1-9 说在 `validateSave` 归整不合适——结论采纳，改放到 `loadGame`。
4. `CARD_PRICE` 实为 **4 处**不是报告说的 3 处；处理时顺带收进 `STEAL_PRICE`（`config.js`）与 `MINE_COST_DEEP` / `MINE_COST_SHALLOW`（`rules.js`）。
5. 掩体缺核弹确认分支是**潜伏不一致、当前不可达**（`bunkerRest` / `bunkerFortify` 不调 `tryGrantNukeKey`）。已修，但已在代码注释中标明其真实性质，不应按「线上正在丢钥匙」理解。
6. `fx.js` 的 `ENABLED` 比另两个模块多一条 `document.body` 判定——**未借重构抹平**，各模块表达式原样保留。

另有三处经复核后判定**不需要改**：`sideOf()` 实测只有 `board-canvas.js` 一份实现，view-core 无第二份，未做合并；`setBoardTilt` / `setTileArt` 并非 0 调用（`js/view.js` barrel 与 `smoke.test.mjs` 都在用），且那两条断言恒真——改为 render 后直接查 DOM，保留真不变量；`campaign.js:151` 末位 return 是手写数据兜底，**保留**，仅补注释。
