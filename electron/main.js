// electron/main.js —— 桌面客户端主进程
// 把 www/ 装进 BrowserWindow；语音默认走 MiniMax 在线 TTS（应急），Kokoro 仍可按需加载
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');
const TTS_MODELS_DIR = path.join(WWW_DIR, 'assets', 'tts-models');

let mainWindow = null;

function createWindow() {
  if (!existsSync(WWW_DIR)) {
    dialog.showErrorBox('启动失败', `找不到 www/ 目录: ${WWW_DIR}\n\n先跑 npm run sync:www`);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0c0e0d',
    title: '废土大亨：末世大富翁',
    icon: path.join(ROOT, 'logo.svg'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 允许本地资源（Kokoro 模型、预录包）
      webSecurity: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(WWW_DIR, 'index.html'));

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // 外链开系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC 处理器（暴露给渲染进程的 Node 能力） ──
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);
ipcMain.handle('app:getTtsModelsPath', () => TTS_MODELS_DIR);

// Kokoro：Node 子进程推理（失败再回退主进程）
let kokoroHost = null;
ipcMain.handle('kokoro:init', async () => {
  try {
    if (!kokoroHost) kokoroHost = await import('./kokoro-host.js');
    return await kokoroHost.init();
  } catch (e) {
    console.error('[kokoro:init] 失败:', e);
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('kokoro:speak', async (_evt, text, opts) => {
  if (!kokoroHost) {
    try { kokoroHost = await import('./kokoro-host.js'); }
    catch (e) {
      console.error('[kokoro:speak] host 加载失败:', e);
      return null;
    }
  }
  try {
    return await kokoroHost.speak(text, opts || {});
  } catch (e) {
    console.error('[kokoro:speak] 失败:', e);
    return null;
  }
});

// MiniMax 在线 TTS（Key 只留主进程）
let minimaxTts = null;
async function getMinimax() {
  if (!minimaxTts) minimaxTts = await import('./minimax-tts.js');
  return minimaxTts;
}

ipcMain.handle('minimax:init', async () => {
  try {
    const m = await getMinimax();
    return await m.init({
      root: ROOT,
      userData: app.getPath('userData'),
      cacheDir: path.join(app.getPath('userData'), 'minimax-tts-cache'),
    });
  } catch (e) {
    console.error('[minimax:init] 失败:', e);
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('minimax:speak', async (_evt, text, opts) => {
  try {
    const m = await getMinimax();
    const r = await m.speak(text, opts || {});
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'synth failed' };
    const raw = r.mp3;
    const mp3 = raw instanceof Uint8Array ? new Uint8Array(raw) : Uint8Array.from(raw || []);
    return { ok: true, mp3, cached: !!r.cached };
  } catch (e) {
    console.error('[minimax:speak] 失败:', e);
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('minimax:status', async () => {
  try {
    const m = await getMinimax();
    return m.status();
  } catch (_) {
    return { ok: false };
  }
});

// ── App 生命周期 ──
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  getMinimax().then((m) => {
    m.init({
      root: ROOT,
      userData: app.getPath('userData'),
      cacheDir: path.join(app.getPath('userData'), 'minimax-tts-cache'),
    }).catch((e) => console.error('[minimax] 预热失败', e));
  }).catch((e) => console.error('[minimax] 模块加载失败', e));
});

app.on('before-quit', () => {
  if (kokoroHost && typeof kokoroHost.stop === 'function') kokoroHost.stop();
});

app.on('window-all-closed', () => {
  // macOS 习惯：所有窗口关闭后 app 还在 dock
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
