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
