// electron/preload.cjs —— 主进程 ↔ 渲染进程的安全桥
// 必须用 CommonJS：Electron 沙箱预加载不支持 ESM import
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wastelandDesktop', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  getTtsModelsPath: () => ipcRenderer.invoke('app:getTtsModelsPath'),

  kokoro: {
    init: () => ipcRenderer.invoke('kokoro:init'),
    speak: (text, opts) => ipcRenderer.invoke('kokoro:speak', text, opts),
  },

  minimax: {
    init: () => ipcRenderer.invoke('minimax:init'),
    speak: (text, opts) => ipcRenderer.invoke('minimax:speak', text, opts),
    status: () => ipcRenderer.invoke('minimax:status'),
  },
});

if (process.env.WASTELAND_DEV) {
  contextBridge.exposeInMainWorld('wastelandDebug', {
    kokoroPath: () => ipcRenderer.invoke('app:getTtsModelsPath'),
  });
}
