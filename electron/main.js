// electron/main.js —— 桌面客户端主进程
// 把 www/ 装进 BrowserWindow；在线语音走自定义 OpenAI 兼容 TTS 或小米 MiMo TTS
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { normalizeTtsBaseUrl, sameOrigin } from './tts-endpoint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');
const APP_INDEX = path.join(WWW_DIR, 'index.html');
const APP_URL = pathToFileURL(APP_INDEX).href;
const MAX_TTS_TEXT = 5000;

let mainWindow = null;

/** 只把应用自己的 index.html 视为可信页面（比较解码后的绝对路径，忽略大小写）。 */
function isAppUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'file:') return false;
    const target = decodeURIComponent(u.pathname).replace(/\\/g, '/').toLowerCase();
    const app = decodeURIComponent(new URL(APP_URL).pathname).replace(/\\/g, '/').toLowerCase();
    return target === app;
  } catch (_) { return false; }
}

/** IPC 来源校验：必须是本窗口主框架、且当前页面是应用自身。
 *  没有这层校验，任何被导航到远程页面的窗口都能直接调用 preload 桥。 */
function isTrustedSender(event) {
  if (!mainWindow || !event || event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || !frame.url) return false;
  return isAppUrl(frame.url);
}

/** 统一包一层：来源不可信时直接拒绝，并把结果收敛成 { ok:false }。 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn('[ipc] 拒绝来自非应用页面的调用:', channel);
      return { ok: false, error: 'untrusted sender' };
    }
    return fn(event, ...args);
  });
}

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
      sandbox: true,
      // 生产包关掉 DevTools：远程调试入口本身就是一条「让任意脚本进渲染层」的路径
      devTools: !app.isPackaged,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(APP_INDEX);

  // 导航守卫：只允许停留在应用页面。window.open 由 setWindowOpenHandler 管，
  // 但 location.href / 页面内链接 / meta refresh 走的是 will-navigate，必须单独拦。
  const denyForeignNav = (event, url) => { if (!isAppUrl(url)) event.preventDefault(); };
  mainWindow.webContents.on('will-navigate', denyForeignNav);
  mainWindow.webContents.on('will-redirect', denyForeignNav);
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!isAppUrl(event.url)) event.preventDefault();
  });

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
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        void shell.openExternal(u.href).catch(() => {});
      }
    } catch (_) {}
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

handle('app:getVersion', () => app.getVersion());
handle('app:getPlatform', () => process.platform);

let customTts = null;
async function getCustom() {
  if (!customTts) customTts = await import('./custom-tts.js');
  return customTts;
}

const KEY_FILE_BY_PROVIDER = {
  mimo: '.mimo-api-key',
  custom: '.custom-tts-api-key',
};

function userKeyPath(provider, userData = app.getPath('userData')) {
  return path.join(userData, KEY_FILE_BY_PROVIDER[provider] || `.${provider}-api-key`);
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
    cacheDir: path.join(userData, `${provider}-tts-cache`),
  };
}

function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (!key || key.length > 512 || /[\r\n\0]/.test(key)) return '';
  return key;
}

// ---------- 自定义 TTS：Key 与「保存时的服务地址」绑定 ----------
// 端点原本完全由渲染层决定，而 Key 只在主进程解密 —— 被注入的渲染层只要改一个
// baseUrl 就能把 Key 发到任意服务器。现在把 origin 与 Key 一起落盘：
// 之后只认这份 origin，想换地址必须重新保存 Key（那时用户必须重新输入 Key）。
const CUSTOM_CONFIG_FILE = 'custom-tts-config.json';

function customConfigPath(userData = app.getPath('userData')) {
  return path.join(userData, CUSTOM_CONFIG_FILE);
}

function readCustomConfig(userData) {
  try {
    const raw = JSON.parse(readFileSync(customConfigPath(userData), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch (_) { return null; }
}

function writeCustomConfig(userData, cfg) {
  try {
    mkdirSync(userData, { recursive: true });
    writeFileSync(customConfigPath(userData), JSON.stringify(cfg), 'utf8');
    return true;
  } catch (_) { return false; }
}

function sanitizeLabel(value, fallback) {
  const s = String(value ?? '').trim().slice(0, 128);
  return s || fallback;
}

function customOptionsFrom(url, model, voice) {
  return {
    ...providerOptions('custom'),
    baseUrl: url,
    model: sanitizeLabel(model, 'tts-1'),
    voice: sanitizeLabel(voice, 'alloy'),
  };
}

/** 校验渲染层传入的地址，并检查它是否与已保存的 Key 绑定同一个 origin。
 *  渲染层没填地址时回退到 CUSTOM_TTS_BASE_URL：环境变量/本地文件是文档中的开发配置路径。 */
function resolveCustomEndpoint(config, userData) {
  const cfg = config || {};
  const rawUrl = (cfg.baseUrl && String(cfg.baseUrl).trim()) || process.env.CUSTOM_TTS_BASE_URL || '';
  const endpoint = normalizeTtsBaseUrl(rawUrl);
  if (!endpoint.ok) return { ok: false, error: endpoint.error };
  const stored = readCustomConfig(userData);
  const hasKey = !!readUserApiKey('custom', userData);
  if (hasKey && stored && stored.origin && !sameOrigin(stored.origin, endpoint.origin)) {
    return { ok: false, error: '服务地址已更改：请重新保存 API Key 后再测试' };
  }
  if (hasKey && !stored) {
    // 旧版本只把地址存在 localStorage：首次初始化时把当前地址绑定到已有 Key。
    writeCustomConfig(userData, {
      origin: endpoint.origin,
      baseUrl: endpoint.url,
      model: sanitizeLabel(cfg.model, 'tts-1'),
      voice: sanitizeLabel(cfg.voice, 'alloy'),
    });
  }
  return { ok: true, endpoint, model: cfg.model, voice: cfg.voice };
}

handle('custom:init', async (_evt, config) => {
  try {
    const userData = app.getPath('userData');
    const resolved = resolveCustomEndpoint(config, userData);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return await (await getCustom()).init(customOptionsFrom(resolved.endpoint.url, resolved.model, resolved.voice));
  } catch (e) {
    console.error('[custom:init] 失败:', e && e.message);
    return { ok: false, error: '自定义 TTS 初始化失败' };
  }
});

handle('custom:status', async (_evt, config) => {
  try {
    const userData = app.getPath('userData');
    const resolved = resolveCustomEndpoint(config, userData);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return await (await getCustom()).init(customOptionsFrom(resolved.endpoint.url, resolved.model, resolved.voice));
  } catch (_) { return { ok: false }; }
});

handle('custom:saveKey', async (_evt, key, config) => {
  try {
    const normalized = normalizeApiKey(key);
    if (!normalized) return { ok: false, error: '请输入有效的自定义 TTS API Key' };
    const rawUrl = (config && config.baseUrl && String(config.baseUrl).trim()) || process.env.CUSTOM_TTS_BASE_URL || '';
    const endpoint = normalizeTtsBaseUrl(rawUrl);
    if (!endpoint.ok) return { ok: false, error: endpoint.error };
    const opts = providerOptions('custom');
    const saved = saveUserApiKey('custom', normalized, opts.userData);
    if (!saved.ok) return saved;
    const model = sanitizeLabel(config && config.model, 'tts-1');
    const voice = sanitizeLabel(config && config.voice, 'alloy');
    const persisted = writeCustomConfig(opts.userData, {
      origin: endpoint.origin,
      baseUrl: endpoint.url,
      model,
      voice,
    });
    if (!persisted) return { ok: false, error: '保存服务地址配置失败，请检查应用数据目录权限' };
    return await (await getCustom()).init({
      ...opts,
      userDataApiKey: normalized,
      baseUrl: endpoint.url,
      model,
      voice,
    });
  } catch (e) {
    console.error('[custom:saveKey] 失败:', e && e.message);
    return { ok: false, error: '保存自定义 TTS API Key 失败' };
  }
});

handle('custom:clearKey', async () => {
  try {
    const opts = providerOptions('custom');
    const deleted = deleteUserApiKey('custom', opts.userData);
    if (!deleted.ok) return deleted;
    // 解绑地址：没有 Key 之后，换服务地址不需要再重新保存。
    try { unlinkSync(customConfigPath(opts.userData)); } catch (_) {}
    return { ok: true };
  } catch (e) {
    console.error('[custom:clearKey] 失败:', e && e.message);
    return { ok: false, error: '清除自定义 TTS API Key 失败' };
  }
});

handle('custom:speak', async (_evt, text, opts) => {
  try {
    const userData = app.getPath('userData');
    let stored = readCustomConfig(userData);
    if (!stored || !stored.baseUrl || !stored.origin) {
      // 环境变量 / 本地文件配置的开发路径：地址也来自环境变量，而不是渲染层参数
      const envEndpoint = normalizeTtsBaseUrl(process.env.CUSTOM_TTS_BASE_URL || '');
      if (envEndpoint.ok) {
        stored = { origin: envEndpoint.origin, baseUrl: envEndpoint.url, model: 'tts-1', voice: 'alloy' };
      }
    }
    if (!stored || !stored.baseUrl || !stored.origin) {
      return { ok: false, error: '尚未绑定自定义 TTS 服务地址，请先在设置里保存 API Key' };
    }
    // 渲染层只能影响 model / voice / speed；baseUrl 一律用保存时绑定的那份，
    // 即使调用方在 opts 里塞了 baseUrl 也不会被采用。
    const o = opts || {};
    const m = await getCustom();
    const result = await m.speak(String(text || '').slice(0, MAX_TTS_TEXT), {
      ...providerOptions('custom'),
      baseUrl: stored.baseUrl,
      model: sanitizeLabel(o.model, stored.model || 'tts-1'),
      voice: sanitizeLabel(o.voice, stored.voice || 'alloy'),
      speed: Number(o.speed),
    });
    if (!result || !result.ok) return { ok: false, error: (result && result.error) || 'custom synthesis failed' };
    const audio = result.audio instanceof Uint8Array ? new Uint8Array(result.audio) : Uint8Array.from(result.audio || []);
    return { ok: true, audio, format: result.format || 'mp3', cached: !!result.cached, voice: result.voice };
  } catch (e) {
    console.error('[custom:speak] 失败:', e && e.message);
    return { ok: false, error: '自定义 TTS 语音合成失败' };
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

handle('mimo:init', async () => {
  try { return await (await getMimo()).init(mimoOptions()); }
  catch (e) {
    console.error('[mimo:init] 失败:', e && e.message);
    return { ok: false, error: 'MiMo 初始化失败' };
  }
});

handle('mimo:status', async () => {
  try { return await (await getMimo()).init(mimoOptions()); }
  catch (_) { return { ok: false }; }
});

handle('mimo:saveKey', async (_evt, key) => {
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

handle('mimo:clearKey', async () => {
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

handle('mimo:speak', async (_evt, text, opts) => {
  try {
    // 只接受 voice / speed：此前把渲染层 opts 整个展开，等于允许改 cacheDir / root /
    // userDataApiKey —— 可以指定任意缓存目录写文件，也能换掉凭证来源。
    const o = opts || {};
    const m = await getMimo();
    const result = await m.speak(String(text || '').slice(0, MAX_TTS_TEXT), {
      ...mimoOptions(),
      voice: sanitizeLabel(o.voice, undefined),
      speed: Number(o.speed),
    });
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
  // 应用不需要任何浏览器权限（摄像头/麦克风/通知/剪贴板读取等），一律拒绝。
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
  } catch (e) {
    console.warn('[permissions] 安装权限处理器失败:', e && e.message);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
