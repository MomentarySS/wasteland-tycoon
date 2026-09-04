# Windows 桌面方向

> 日期：2026-09-02（二次确认，不再是「临时暂停网页/Android」）
> 状态：**现行开发方向**
> 产品：仅 Windows Electron

---

## 决策

1. **主力攻坚 Windows 桌面**。网页版、Android **停做**，相关工程与启动通道已从仓库移除。
2. **游戏内建语音全面转向本地 TTS**（Kokoro Node + `assets/tts-models/`）。
3. **MiniMax 预录 `assets/voice/` 保留作兜底**（固定文案 0ms / 5★）。
4. **Plan B**：若本地 TTS 音质或延迟不理想，再做**用户可配置的网上 TTS 模型接口**（自备 URL / Key / 音色）。现在不接线、不进设置面板。

HTML/CSS/JS 内核仍在，只作为 Electron 的渲染层（`sync-www` → `www/` → BrowserWindow）。这不是网页产品。

## 语音链（以 `js/tts.js` 为准）

| 优先级 | 引擎 | 现状 |
|---|---|---|
| 1 | 本地 Kokoro（`electron/kokoro-node.js`） | **已出声**（FP32 `model.onnx`，默认 `zm_045`）。覆盖动态战报；过场旁白仍走预录 |
| 2 | MiniMax 预录 | **在用**，124 条 |
| 3 | 系统 `speechSynthesis` | 临时档：本地未就绪且预录未命中 |
| — | 阶跃 / Edge / Capacitor | **已删** |
| — | 自定义远程 TTS | Plan B，未做 |

过场旁白仍只走预录（`ttsSpeakPrerecorded`），避免推理/网络打乱分镜。

## 已落地 / 未做

| 项 | 状态 |
|---|---|
| Electron 壳 + Windows 打包脚本 | ✅ |
| 预录兜底 + 去掉在线/Android TTS | ✅ |
| Kokoro Node 真正推理 | ✅ 无窗烟测已出声；待游戏内测音验收 |
| `desktop:build` 打出验收过的 .exe | ❌ |
| 自定义远程 TTS 接口 | ❌ Plan B |

## 回滚

网页/Android **不回滚**。若本地 TTS 失败，走 Plan B 远程接口，而不是恢复阶跃/Edge。
