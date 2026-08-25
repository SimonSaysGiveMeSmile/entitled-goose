const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  getState: () => ipcRenderer.invoke('panel:get'),
  setSettings: (partial) => ipcRenderer.send('panel:set', partial),
  setPhrases: (phrases) => ipcRenderer.send('panel:set-phrases', phrases),
  apologize: () => ipcRenderer.send('panel:apologize'),
});
