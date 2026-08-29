# 废土大亨：末世大富翁 Wasteland Tycoon

废土末世题材的 **2D 大富翁类桌游**，基于 **原生 ES Module + PWA**，无需构建工具。棋盘环绕阿帕拉契亚废土地形，角色在平面棋盘上移动。

## 特性

- **2D 阿帕拉契亚棋盘**：44 格环形路径，Canvas 渲染格子层（贴图/徽章/垄断发光），棋子与特效走 DOM 叠加层
- **四种游戏模式**：对抗 / 单人闯关 / 合作闯关 / 遗产模式（肉鸽+传承）
- **16 条任务链 + 四牌堆**：废土电台 / 幸存者手册 / 派系密使 / 遗迹猎人
- **隐藏核弹结局**：三井密钥齐 → 三幕全屏过场（警报 / 密钥对齐 / 弹头离井）→ 蘑菇云终结棋盘
- **战报面板**：分类标签 + 类别过滤 + 关键字搜索 + 折叠
- **遗产系统**：跨局永久成长，遗产点解锁加成
- **肉鸽突变因子**：每局随机 3 个因子改变规则
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
- **☢ 核弹过场**：点击画面可跳过当前分镜

## 技术栈

- **原生 ES Module**：零构建，无打包
- **PWA**：离线可玩
- **Capacitor**：Android 打包（Android Studio 打开 `android/`）

## 目录结构

```
index.html            页面骨架
manifest.json         PWA 清单
service-worker.js     离线缓存
css/                  样式（style.css + board-v2.css）
js/                   游戏逻辑
  game.js             回合流程与编排
  rules.js            买卖/租金/交易规则
  view-core.js        视图核心（棋盘渲染调度）
  board-canvas.js     Canvas 格子层渲染 + 悬停命中检测
  board-metrics.js    格尺寸缓存 / 格子视口矩形
  cutscene.js         全屏过场（核弹三幕分镜）
  log-panel.js        战报面板（分类/过滤/搜索/折叠）
  campaign.js         闯关章节
  legacy.js           遗产系统
  mutators.js         肉鸽突变因子
  narrative.js        叙事传承
content/              JSON 数据（棋盘 + 事件）
assets/               位图资源
scripts/              工具脚本
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
