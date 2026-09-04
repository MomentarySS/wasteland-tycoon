# 废土大亨：末世大富翁 Wasteland Tycoon

废土末世题材的 **2D 大富翁类桌游**。内核是原生 ES Module，**唯一产品形态是 Windows Electron 桌面客户端**。网页版与 Android 已停做、工程已移除。

> **📌 2026-09-02 方向**：攻坚 Windows 桌面。语音 = 本地 TTS + MiniMax 预录兜底；本地不理想时再上用户自定义远程 TTS 接口。详见 `docs/desktop-client-migration.md`。

## 特性

- **2D 阿帕拉契亚棋盘**：44 格环形路径，Canvas 格子层，棋子与特效走 DOM
- **四种游戏模式**：对抗 / 单人闯关 / 合作闯关 / 遗产模式
- **16 条任务链 + 四牌堆**、道具卡、核弹结局、战报面板、遗产 / 肉鸽 / 叙事传承
- **语音**：本地 Kokoro FP32（桌面 Node）→ MiniMax 预录 124 条 → 系统语音（临时）。无阶跃 / Edge / Capacitor

## 运行

```bash
npm install
npm run desktop:dev    # 同步 www/ → 开 Electron
npm run desktop:build  # Windows NSIS 安装包 → release/
```

```bash
npm test
```

## 平台

| 平台 | 状态 |
|---|---|
| **Windows 桌面（Electron）** | 唯一产品线。本地 Kokoro 已能推理出声，安装包尚未验收 |
| 网页 / PWA | 停做，已拆 Service Worker 与网页启动通道 |
| Android | 停做，`android/` 已删 |
| macOS / Linux | 不做 |

## 目录

```
electron/          Windows 壳（main / preload / kokoro-node 推理）
js/ css/ content/  游戏内核（Electron 渲染进 www/）
assets/voice/      MiniMax 预录（兜底，保留）
assets/tts-models/ Kokoro-82M 本地模型
scripts/           desktop-dev / build-desktop / sync-www / 生图 / 预录生成
www/               同步镜像（gitignore），Electron 加载这里
```

## 文档

- [开发备忘.md](开发备忘.md)
- [游玩手册.md](游玩手册.md)
- [docs/desktop-client-migration.md](docs/desktop-client-migration.md)
- [封包说明.md](封包说明.md)
