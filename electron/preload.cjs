// electron/preload.cjs —— 主进程 ↔ 渲染进程的安全桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wastelandDesktop', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  minimax: {
    init: () => ipcRenderer.invoke('minimax:init'),
    speak: (text, opts) => ipcRenderer.invoke('minimax:speak', text, opts),
    status: () => ipcRenderer.invoke('minimax:status'),
    saveKey: (key) => ipcRenderer.invoke('minimax:saveKey', key),
    clearKey: () => ipcRenderer.invoke('minimax:clearKey'),
  },
  mimo: {
    init: () => ipcRenderer.invoke('mimo:init'),
    speak: (text, opts) => ipcRenderer.invoke('mimo:speak', text, opts),
    status: () => ipcRenderer.invoke('mimo:status'),
    saveKey: (key) => ipcRenderer.invoke('mimo:saveKey', key),
    clearKey: () => ipcRenderer.invoke('mimo:clearKey'),
  },
});
