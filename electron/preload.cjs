// electron/preload.cjs —— 主进程 ↔ 渲染进程的安全桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wastelandDesktop', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  custom: {
    init: (config) => ipcRenderer.invoke('custom:init', config),
    speak: (text, opts) => ipcRenderer.invoke('custom:speak', text, opts),
    status: (config) => ipcRenderer.invoke('custom:status', config),
    saveKey: (key) => ipcRenderer.invoke('custom:saveKey', key),
    clearKey: () => ipcRenderer.invoke('custom:clearKey'),
  },
  mimo: {
    init: () => ipcRenderer.invoke('mimo:init'),
    speak: (text, opts) => ipcRenderer.invoke('mimo:speak', text, opts),
    status: () => ipcRenderer.invoke('mimo:status'),
    saveKey: (key) => ipcRenderer.invoke('mimo:saveKey', key),
    clearKey: () => ipcRenderer.invoke('mimo:clearKey'),
  },
});
