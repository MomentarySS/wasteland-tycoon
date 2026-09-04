// electron/preload.cjs —— 主进程 ↔ 渲染进程的安全桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wastelandDesktop', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  minimax: {
    init: () => ipcRenderer.invoke('minimax:init'),
    speak: (text, opts) => ipcRenderer.invoke('minimax:speak', text, opts),
    status: () => ipcRenderer.invoke('minimax:status'),
  },
});
