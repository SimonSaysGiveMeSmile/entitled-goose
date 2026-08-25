import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let panel = null;

export function openPanel() {
  if (panel && !panel.isDestroyed()) {
    panel.show();
    panel.focus();
    return panel;
  }
  panel = new BrowserWindow({
    width: 400,
    height: 560,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    title: 'Goose Control Panel',
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.cjs'),
      contextIsolation: true,
    },
  });
  panel.loadFile(path.join(__dirname, 'panel.html'));
  panel.on('closed', () => { panel = null; });
  return panel;
}
