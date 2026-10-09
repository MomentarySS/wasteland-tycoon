// electron/main.js —— 桌面客户端主进程
// 把 www/ 装进 BrowserWindow；在线语音走 MiniMax 或小米 MiMo TTS
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');

let mainWindow = null;

/** 窗口图标：Windows 的 nativeImage 需要真实文件路径，ASAR 内的图片无法直接使用，
 *  故打包态把 logo.png（由 sync-www 镜像进 www/）解出到临时目录再返回。
 *  解出失败时返回 null —— 让 Electron 用默认图标，而不是回退到同样读不到的 ASAR 路径。 */
function resolveWindowIcon() {
  const candidates = [path.join(WWW_DIR, 'logo.png'), path.join(ROOT, 'logo.png')];
  for (const src of candidates) {
    try {
      if (!existsSync(src)) continue;
      const out = path.join(tmpdir(), 'wasteland-tycoon-icon.png');
      if (!existsSync(out) || statSync(out).size !== statSync(src).size) {
        writeFileSync(out, readFileSync(src));
      }
      return out;
    } catch (_) {
      // 试下一个候选源
    }
  }
  return null;
}

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
    // Electron 的 nativeImage 不支持 SVG：传 svg 会静默回落到系统默认图标并产生告警。
    // 这里用 logo.png；开发态读项目根，打包后从 ASAR 内解出临时文件给 Windows。
    icon: resolveWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(WWW_DIR, 'index.html'));

  // F12 调试入口只在开发包保留。生产包开着 DevTools，等于把渲染进程的
  // 任意脚本执行面连同下面的 openExternal 一起对外暴露。
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
      }
    });
  }

  // 只放行 http(s)：shell.openExternal 还接受 file: 与任意已注册的自定义协议，
  // 渲染进程一旦能决定这个 URL，file: 指向可执行文件即等于任意程序执行。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);

let minimaxTts = null;
async function getMinimax() {
  if (!minimaxTts) minimaxTts = await import('./minimax-tts.js');
  return minimaxTts;
}

function userKeyPath(provider, userData = app.getPath('userData')) {
  return path.join(userData, provider === 'mimo' ? '.mimo-api-key' : '.minimax-api-key');
}

function readUserApiKey(provider, userData) {
  try {
    const stored = readFileSync(userKeyPath(provider, userData), 'utf8').trim();
    if (!stored.startsWith('safe-v1:') || !safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(stored.slice(8), 'base64'));
  } catch (_) { return ''; }
}

function saveUserApiKey(provider, key, userData) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows 安全存储当前不可用，未保存 Key' };
  try {
    mkdirSync(userData, { recursive: true });
    const encrypted = safeStorage.encryptString(key).toString('base64');
    writeFileSync(userKeyPath(provider, userData), `safe-v1:${encrypted}`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true };
  } catch (_) { return { ok: false, error: '保存失败，请检查应用数据目录权限' }; }
}

function deleteUserApiKey(provider, userData) {
  try { unlinkSync(userKeyPath(provider, userData)); }
  catch (e) { if (e && e.code !== 'ENOENT') return { ok: false, error: '清除失败，请检查应用数据目录权限' }; }
  return { ok: true };
}

function providerOptions(provider) {
  const userData = app.getPath('userData');
  return {
    root: ROOT,
    userData,
    userDataApiKey: readUserApiKey(provider, userData),
    cacheDir: path.join(userData, provider === 'mimo' ? 'mimo-tts-cache' : 'minimax-tts-cache'),
  };
}

function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (!key || key.length > 512 || /[\r\n\0]/.test(key)) return '';
  return key;
}

ipcMain.handle('minimax:init', async () => {
  try {
    const m = await getMinimax();
    return await m.init(providerOptions('minimax'));
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
    return await m.init(providerOptions('minimax'));
  } catch (_) {
    return { ok: false };
  }
});

ipcMain.handle('minimax:saveKey', async (_evt, key) => {
  try {
    const normalized = normalizeApiKey(key);
    if (!normalized) return { ok: false, error: '请输入有效的 MiniMax API Key' };
    const options = providerOptions('minimax');
    const saved = saveUserApiKey('minimax', normalized, options.userData);
    if (!saved.ok) return saved;
    const m = await getMinimax();
    return await m.init({ ...options, userDataApiKey: normalized });
  } catch (e) {
    console.error('[minimax:saveKey] 失败:', e && e.message);
    return { ok: false, error: '保存 MiniMax API Key 失败' };
  }
});

ipcMain.handle('minimax:clearKey', async () => {
  try {
    const m = await getMinimax();
    const options = providerOptions('minimax');
    const deleted = deleteUserApiKey('minimax', options.userData);
    if (!deleted.ok) return deleted;
    return await m.init({ ...options, userDataApiKey: '' });
  } catch (e) {
    console.error('[minimax:clearKey] 失败:', e && e.message);
    return { ok: false, error: '清除 MiniMax API Key 失败' };
  }
});

let mimoTts = null;
async function getMimo() {
  if (!mimoTts) mimoTts = await import('./mimo-tts.js');
  return mimoTts;
}

function mimoOptions() {
  return providerOptions('mimo');
}

ipcMain.handle('mimo:init', async () => {
  try { return await (await getMimo()).init(mimoOptions()); }
  catch (e) {
    console.error('[mimo:init] 失败:', e && e.message);
    return { ok: false, error: 'MiMo 初始化失败' };
  }
});

ipcMain.handle('mimo:status', async () => {
  try { return await (await getMimo()).init(mimoOptions()); }
  catch (_) { return { ok: false }; }
});

ipcMain.handle('mimo:saveKey', async (_evt, key) => {
  try {
    const normalized = normalizeApiKey(key);
    if (!normalized) return { ok: false, error: '请输入有效的小米 MiMo API Key' };
    const opts = mimoOptions();
    const saved = saveUserApiKey('mimo', normalized, opts.userData);
    if (!saved.ok) return saved;
    const m = await getMimo();
    return await m.init({ ...opts, userDataApiKey: normalized });
  } catch (e) {
    console.error('[mimo:saveKey] 失败:', e && e.message);
    return { ok: false, error: '保存小米 MiMo API Key 失败' };
  }
});

ipcMain.handle('mimo:clearKey', async () => {
  try {
    const opts = mimoOptions();
    const deleted = deleteUserApiKey('mimo', opts.userData);
    if (!deleted.ok) return deleted;
    return await (await getMimo()).init({ ...opts, userDataApiKey: '' });
  }
  catch (e) {
    console.error('[mimo:clearKey] 失败:', e && e.message);
    return { ok: false, error: '清除小米 MiMo API Key 失败' };
  }
});

ipcMain.handle('mimo:speak', async (_evt, text, opts) => {
  try {
    const m = await getMimo();
    const result = await m.speak(text, { ...mimoOptions(), ...(opts || {}) });
    if (!result || !result.ok) return { ok: false, error: (result && result.error) || 'MiMo synthesis failed' };
    const audio = result.audio instanceof Uint8Array ? new Uint8Array(result.audio) : Uint8Array.from(result.audio || []);
    return { ok: true, audio, format: result.format || 'wav', cached: !!result.cached, voice: result.voice };
  } catch (e) {
    console.error('[mimo:speak] 失败:', e && e.message);
    return { ok: false, error: 'MiMo 语音合成失败' };
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  getMinimax().then((m) => {
    m.init(providerOptions('minimax')).catch((e) => console.error('[minimax] 预热失败', e));
  }).catch((e) => console.error('[minimax] 模块加载失败', e));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
