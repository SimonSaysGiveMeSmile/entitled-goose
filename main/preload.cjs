const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
  'move-window',
  'goose-state',
  'click-through',
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
  'speak',
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
