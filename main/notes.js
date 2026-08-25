import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NOTE_W = 240;
const NOTE_H = 150;
const openNotes = new Set();

// The goose "delivers" a note: a small sticky-note window near its beak.
// Clicking the note dismisses it. Capped so a wrathful goose can't flood the desktop.
export function spawnNote(text, beakX, beakY) {
  if (openNotes.size >= 4) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(beakX), y: Math.round(beakY) });
  const wa = display.workArea;
  const x = Math.round(Math.min(Math.max(beakX - NOTE_W / 2, wa.x + 8), wa.x + wa.width - NOTE_W - 8));
  const y = Math.round(Math.min(Math.max(beakY - NOTE_H - 12, wa.y + 8), wa.y + wa.height - NOTE_H - 8));

  const win = new BrowserWindow({
    x, y,
    width: NOTE_W,
    height: NOTE_H,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.loadFile(path.join(__dirname, 'notes.html'), { query: { text } });
  win.once('ready-to-show', () => win.showInactive());
  openNotes.add(win);
  win.on('closed', () => openNotes.delete(win));

  // Notes that are ignored eventually flutter away on their own.
  setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 90_000);
  return win;
}

export function closeAllNotes() {
  for (const win of openNotes) if (!win.isDestroyed()) win.close();
  openNotes.clear();
}
