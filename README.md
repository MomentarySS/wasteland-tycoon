# 废土大亨：末世大富翁 Wasteland Tycoon

废土末世题材的 **2D 大富翁类桌游**，基于 **原生 ES Module + PWA**，无需构建工具。棋盘环绕阿帕拉契亚废土地形，角色在平面棋盘上移动。

## 特性

- **2D 阿帕拉契亚棋盘**：44 格环形路径，Canvas 渲染格子层（贴图/徽章/垄断发光），棋子与特效走 DOM 叠加层
- **四种游戏模式**：对抗 / 单人闯关 / 合作闯关 / 遗产模式（肉鸽+传承）
- **16 条任务链 + 四牌堆**：废土电台 / 幸存者手册 / 派系密使 / 遗迹猎人
- **道具卡系统**：10 张功能卡（护盾/掠夺/拆迁令/遥控骰/均富卡等），黑市淘卡、事件奖励、AI 也会用
- **隐藏核弹结局**：三井密钥齐 → 三幕全屏过场（警报 / 密钥对齐 / 弹头离井）→ 蘑菇云终结棋盘
- **战报面板**：分类标签 + 类别过滤 + 关键字搜索 + 折叠
- **遗产系统**：跨局永久成长，遗产点解锁加成
- **肉鸽突变因子**：每局随机 3 个因子改变规则（25 个，含风险收益/互动/混沌型）
- **叙事传承**：上局结局影响下局开局
- **PWA 离线**：Service Worker 缓存全部资源
- **语音播报**：阶跃在线 TTS + 系统语音兜底

## 运行

```bash
npm start
# 浏览器打开 http://127.0.0.1:8824
```

或双击 `启动游戏.bat`。

## 测试

```bash
npm test
```

## Android 打包（Android Studio）

Web 改完后先同步，再用 Android Studio 打开 **`android/`** 目录构建（推荐，比纯命令行更直观）。

```bash
npm run sync:www      # 根目录 → www/
npm run cap:sync      # www/ → android/app/src/main/assets/
npm run icon:android  # 从 logo.svg 更新 Launcher 图标（改图标时执行）
```

1. 安装 [Android Studio](https://developer.android.com/studio)
2. **File → Open** → 选择本仓库下的 **`android/`** 文件夹
3. 等待 Gradle Sync 完成
4. **Build → Build APK(s)** 或点 ▶ 安装到真机/模拟器

Debug APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`

命令行备选：`cd android && gradlew.bat assembleDebug`

## 操作

- **🎲 掷骰**：点击按钮投掷双骰，棋子沿棋盘逐格移动
- **🖱 悬停/点按格子**：查看格子详情（中央预览窗）
- **📜 战报**：类别 chips 点击屏蔽/恢复该类战报，搜索框实时过滤，「折叠」收起面板
- **🎒 道具卡**：自己回合内点「🎒 道具」使用，不消耗回合；黑市可淘卡
- **☢ 核弹过场**：点击画面可跳过当前分镜

## 技术栈

- **原生 ES Module**：零构建，无打包
- **PWA**：离线可玩
- **Capacitor**：Android 打包（Android Studio 打开 `android/`）

## 目录结构

```
index.html            页面骨架
manifest.json         PWA 清单
service-worker.js     离线缓存（v70）
package.json          devDependency: Capacitor / sharp / resvg
css/                  样式
  style.css           全局样式 + 动效（55KB）
  board-v2.css        棋盘 v2 平面布局（16KB）
js/                   游戏逻辑（39 个 ES Module，~7000 行）
  main.js             入口
  game.js             回合流程与编排（async takeTurn / handleAfterRoll / 回合链守卫）
  view.js             视图层入口（聚合 view-core / view-modal / view-save / tts 状态机）
  view-core.js        视图核心：棋盘渲染 / 棋子 / 中央预览 / 自适应
  view-modal.js       弹窗：任务/黑市/胜利/章节/超频骰/手牌/掩体
  view-setup.js       开局配置面板（模式/玩家/难度/语音 Key）
  view-save.js        存档 v3（含 boardArtOrder 还原 + 校验）
  view-manage.js      抵押/赎回/交易 UI
  view-legacy.js      遗产商店 UI
  view-nuke.js        核弹 UI helper（nukeKeyBadgeHtml；v1.6.0 从 nuke.js 迁出）
  player-row.js       玩家行 DOM 引用 WeakMap（v1.6.0 接手轮 · 替代 p._rowEl）
  state.js            G 全局单例 + resetSession()
  config.js           常量（TOKEN_SLOT / FACTIONS / MAX_TURNS 等）
  data.js             content/ 加载 + 棋盘随机重排
  rules.js            规则副作用（买/租/税/拍卖/破产/缴租）
  rules-core.js       纯函数（netWorth / railRent / isMonopoly / AI 决策）
  campaign.js         闯关六章 + 道德分支结局 + 衰减
  mutators.js         25 个肉鸽因子（v1.4 扩 10 个）
  narrative.js        7 种叙事种子
  legacy.js           跨局遗产点 + 7 个永久加成
  cards.js            10 张道具卡 + AI 用卡
  missions.js         任务链 requires / requiresRep / once
  difficulty.js       三档难度（简单/标准/噩梦）
  nuke.js             核弹结局（三井密钥 + 发射判定）
  cutscene.js         全屏过场（核弹三幕分镜 + 通用 playCutscene API）
  log-panel.js        战报面板（分类/过滤/搜索/折叠）
  board-canvas.js     Canvas 格子层（v1.3 折中方案，含 DOM 降级）
  board-metrics.js    格尺寸缓存
  fx.js               WebAudio + 3D 骰子 + 棋子弹跳/震屏
  fx-events.js        事件分级动效（burst/smoke/warp/建造/战报 icon）
  audio.js            WebAudio 合成音效（无外部音频文件）
  tts.js              混合语音链：预录 → Capacitor → 阶跃 → Edge → 系统
  step-tts.js         阶跃在线 TTS 客户端
  edge-tts.js         Edge 在线 TTS 客户端
  capacitor-tts.js    Capacitor 原生 TTS 桥
  voice-lines.js      预录音频 hash + 文案组装（生成/运行双侧共用）
  assets-art.js       事件/格子/区域位图白名单 + URL 解析
  icons.js            SVG 头像/格图标/建造图标
  paths.js            静态资源 URL 解析（子路径部署）
  view-util.js        视图小工具（HTML 转义）
content/              JSON 数据
  tiles.json          44 格定义
  events.json         四牌堆 80 张事件卡（电台/手册/派系/遗迹）+ 16 条任务链
assets/               资源
  brand/              1  logo.svg
  ui/                 14 Tier A 装饰 + Tier B 氛围 + 核弹 UI
  events/             50 事件 16:9 插画（v2 纯场景重生成）
  tiles/              44 棋盘格 2:1 横条（v3 满画布地点场景）
  voice/              124 预录语音（MiniMax speech-2.8-hd）
scripts/              工具脚本（21 个）
  package-release.mjs 封包主脚本
  start.mjs / serve.mjs 本地服务器（COOP/COEP，端口 8824）
  sync-www.mjs        同步 www/（打包前自动调用）
  gen-voice.mjs       预录语音离线生成器（--list/--export-tasks/--manifest-only/--as-is）
  export-android-icon.mjs / icon-*.py  Android Launcher 导出
  android-deploy.mjs  Android 部署
  download-tts-lab.mjs  下载 tts-lab（WASIM 试听页用）
  download-sherpa.mjs  ⚠️ 已废弃（Sherpa 从运行时链移除，保留作历史参考）
  step-image-*.{py,json} StepFun 批量生图清单
  strip-watermark.py  生图后处理
  nuke-key-turns.mjs  核弹密钥投放概率调试
android/              Capacitor 6 工程（Android Studio 打开此目录构建 APK）
www/                  同步后的 web 资源（封包前 npm run sync:www）
```

## 游戏模式

| 模式 | 人数 | 特色 |
|---|---|---|
| 对抗（大富翁）| 2-4 | 经典买地收租 |
| 单人闯关 | 1人+AI | 六章 + 道德结局 |
| 合作闯关 | 1人+1AI | 共享章节目标 |
| 遗产模式 | 1人+AI | 肉鸽 + 叙事传承 |

## 文档

- [开发备忘.md](开发备忘.md) — 开发进度与功能清单
- [游玩手册.md](游玩手册.md) — 玩家规则与界面说明
