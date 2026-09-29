# 废土大亨：末世大富翁 · Wasteland Tycoon

> 当前版本：v1.7.1

《废土大亨》是一款 Windows 桌面末世主题大富翁游戏，使用原生 JavaScript ES Modules 和 Electron。网页和 Android 版本已停止维护。

## 游戏内容

- 44 格环形棋盘，支持随机重排地点
- 对抗、单人闯关、合作闯关、生存和遗产五种模式
- 事件任务、道德选择、派系声望、道具卡与核弹结局
- 可选择 MiniMax 在线语音、小米 MiMo 在线语音，或仅播放随包提供的预录语音

## 开发环境

- Windows x64
- Node.js 20 或更新版本
- npm

```bash
npm install
npm run desktop:dev
```

构建 Windows 安装包：

```bash
npm run desktop:build
```

安装包输出到 `release/`。运行自动化冒烟检查：

```bash
npm test
```

在线语音可在开局配置中选择服务并录入 API Key；密钥由 Electron `safeStorage` 加密后保存在当前 Windows 用户的应用数据目录，不进入存档或 GitHub。也可通过 `MINIMAX_API_KEY` / `MIMO_API_KEY` 环境变量，或本地 `.minimax-api-key` / `.mimo-api-key` 文件配置。不要提交密钥。选择“仅 MiniMax 预录”时，只能播放预录包中已有的固定语句。

## 平台支持

| 平台 | 状态 |
|---|---|
| Windows x64 / Electron | 当前产品 |
| Web / PWA | 已停止，启动入口已移除 |
| Android | 已停止，工程已移除 |
| macOS / Linux | 不支持 |

## 项目结构

```text
electron/   Electron 主进程、预加载脚本与 MiniMax / MiMo TTS
js/         游戏规则、回合流程、视图和语音
css/        游戏界面样式
content/    棋盘和事件数据
assets/     游戏插画、音效与预录语音
scripts/    开发、打包、语音和素材工具
www/        sync:www 生成的 Electron 页面镜像，不提交
```

## 文档

### 开始使用

- [游玩手册](游玩手册.md)
- [Windows 桌面构建与语音配置](docs/desktop-client-migration.md)
- [Windows 封包说明](封包说明.md)

### 开发与设计

- [文档索引](docs/README.md)
- [单人剧情闯关设计](单人剧情闯关设计.md)
- [废土大亨世界观正典](世界观/世界观设定_废土大亨.md)
- [预录语音清单](docs/voice-pack.md)
- [视觉特效与背景计划](docs/visual-effects-plan.md)
- [地形变种研究（未实现）](docs/terrain-variants.md)

### 调研与规划

- 内部调研、路线图和资产制作记录不随仓库分发。
- [世界观文档索引与草案归档说明](世界观/README.md)
