const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
  'goose-pos',
  'click-through',
  'spawn-note',
  'honked',
  'distraction-close',
]);
const ON_CHANNELS = new Set([
  'cursor',
  'window-moved',
  'work-area',
  'settings',
  'apologize',
  'distraction',
]);

contextBridge.exposeInMainWorld('goose', {
  send(channel, data) {
    if (SEND_CHANNELS.has(channel)) ipcRenderer.send('r:' + channel, data);
  },
  on(channel, cb) {
    if (ON_CHANNELS.has(channel)) ipcRenderer.on('m:' + channel, (_e, data) => cb(data));
  },
  getState() {
    return ipcRenderer.invoke('r:get-state');
  },
});
