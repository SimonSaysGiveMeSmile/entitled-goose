import { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, loadNotes, notesPath } from './settings.js';
import { spawnNote, closeAllNotes } from './notes.js';
import { FocusWarden } from './focus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Honks must be able to play without a user gesture inside the window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const WIN_W = 660;
const WIN_H = 540;
const MOVE_QUANTUM = 16; // coarse reposition steps (px)
const MOVE_MIN_INTERVAL = 33; // ≤30 Hz window moves

let win = null;
let tray = null;
let settings = loadSettings();
let lastMoveAt = 0;
let quitting = false;
let warden = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function windowY() {
  const wa = workArea();
  return wa.y + wa.height - WIN_H;
}

function applyOverlayFlags() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, settings.polite ? 'floating' : 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
}

function sendToGoose(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send('m:' + channel, data);
}

function createWindow() {
  const wa = workArea();
  win = new BrowserWindow({
    x: Math.round(wa.x + wa.width / 2 - WIN_W / 2),
    y: windowY(),
    width: WIN_W,
    height: WIN_H,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Gotcha: click-through must be re-applied after every load of the renderer.
  win.webContents.on('did-finish-load', () => {
    applyOverlayFlags();
    sendToGoose('work-area', workArea());
    sendToGoose('window-moved', win.getBounds());
    sendToGoose('settings', settings);
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    applyOverlayFlags(); // re-assert on-top level after show (order matters on macOS)
  });
}

function repositionForGoose(gooseX) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  if (now - lastMoveAt < MOVE_MIN_INTERVAL) return;
  const wa = workArea();
  const bounds = win.getBounds();
  const margin = 210; // deadzone: goose can roam this far from window center
  const centerX = bounds.x + WIN_W / 2;
  if (Math.abs(gooseX - centerX) <= margin && bounds.y === windowY()) return;

  let targetX = Math.round((gooseX - WIN_W / 2) / MOVE_QUANTUM) * MOVE_QUANTUM;
  targetX = Math.min(Math.max(targetX, wa.x), wa.x + wa.width - WIN_W);
  win.setBounds({ x: targetX, y: windowY(), width: WIN_W, height: WIN_H });
  lastMoveAt = now;
  sendToGoose('window-moved', win.getBounds());
}

function buildTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🪿');
  tray.setToolTip('Entitled Goose');
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Entitled Goose', enabled: false },
      { type: 'separator' },
      {
        label: 'Apologize to the goose',
        click: () => sendToGoose('apologize', {}),
      },
      {
        label: 'Mute honks',
        type: 'checkbox',
        checked: settings.muted,
        click: (item) => {
          settings.muted = item.checked;
          saveSettings(settings);
          sendToGoose('settings', settings);
        },
      },
      {
        label: 'Polite mode (work-safe)',
        type: 'checkbox',
        checked: settings.polite,
        click: (item) => {
          settings.polite = item.checked;
          saveSettings(settings);
          applyOverlayFlags();
          sendToGoose('settings', settings);
        },
      },
      {
        label: 'Focus enforcement (close distractions)',
        type: 'checkbox',
        checked: settings.focusEnforce,
        click: (item) => {
          settings.focusEnforce = item.checked;
          saveSettings(settings);
        },
      },
      { label: 'Edit notes…', click: () => { loadNotes(); shell.openPath(notesPath()); } },
      { type: 'separator' },
      {
        label: 'About',
        click: () => dialog.showMessageBox({
          message: 'Entitled Goose',
          detail: 'A desktop goose that owns your desktop.\n\nOriginal art & audio. Not affiliated with House House, Panic, or samperson.\nMIT licensed.',
        }),
      },
      {
        label: 'Quit (the goose will remember this)',
        click: () => {
          settings.grudgePending = true;
          saveSettings(settings);
          quitting = true;
          app.quit();
        },
      },
    ]));
  };
  rebuild();
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  createWindow();
  buildTray();

  // Global cursor position: permission-free polling from the main process.
  setInterval(() => {
    const p = screen.getCursorScreenPoint();
    sendToGoose('cursor', p);
  }, 33);

  const onDisplayChange = () => {
    sendToGoose('work-area', workArea());
    repositionForGoose(workArea().x + workArea().width / 2);
  };
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  // The goose's productivity-enforcement instincts.
  warden = new FocusWarden({
    isEnabled: () => settings.focusEnforce,
    onDistraction: (d) => sendToGoose('distraction', d),
    onPermissionNeeded: () => {
      const wa = workArea();
      spawnNote(
        'I tried to close your youtube but the computer says I need permission. System Settings → Privacy → Automation. fix it.',
        wa.x + wa.width / 2,
        wa.y + wa.height / 2
      );
    },
  });
  warden.start();
});

ipcMain.on('r:goose-pos', (_e, { x }) => repositionForGoose(x));

ipcMain.on('r:click-through', (_e, { enable }) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(enable, { forward: true });
});

ipcMain.on('r:spawn-note', (_e, { text, x, y }) => {
  const notes = loadNotes();
  const chosen = text || notes[Math.floor(Math.random() * notes.length)];
  spawnNote(chosen, x, y);
});

ipcMain.on('r:distraction-close', async (_e, { id }) => {
  if (!warden) return;
  const label = await warden.close(id);
  if (label && Math.random() < 0.6) {
    const wa = workArea();
    spawnNote(`closed your ${label}. you're welcome.`, wa.x + wa.width / 2, wa.y + wa.height * 0.4);
  }
});

ipcMain.handle('r:get-state', () => {
  const grudge = settings.grudgePending;
  if (grudge) {
    settings.grudgePending = false;
    saveSettings(settings);
  }
  return {
    workArea: workArea(),
    windowBounds: win ? win.getBounds() : null,
    settings,
    grudgePending: grudge,
  };
});

app.on('window-all-closed', () => {
  if (quitting) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  closeAllNotes();
});
