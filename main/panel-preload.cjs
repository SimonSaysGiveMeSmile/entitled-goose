const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  getState: () => ipcRenderer.invoke('panel:get'),
  setSettings: (partial) => ipcRenderer.send('panel:set', partial),
  setPhrases: (phrases) => ipcRenderer.send('panel:set-phrases', phrases),
  setBlocklist: (bl) => ipcRenderer.send('panel:set-blocklist', bl),
  apologize: () => ipcRenderer.send('panel:apologize'),
});
