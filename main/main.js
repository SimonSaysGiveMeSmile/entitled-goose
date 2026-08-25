import { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, dialog, systemPreferences } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, loadNotes, saveNotes, notesPath } from './settings.js';
import { closeAllNotes } from './notes.js';
import { FocusWarden } from './focus.js';
import { openPanel } from './panel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Honks must be able to play without a user gesture inside the window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const WIN_W = 800;
const WIN_H = 640;

let win = null;
let tray = null;
let settings = loadSettings();
let quitting = false;
let warden = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
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
    y: wa.y + wa.height - WIN_H,
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

// The RENDERER owns follow decisions: it updates its drawing origin and orders
// the window move in the same frame, so the goose never draws against a stale
// origin (that mismatch showed up as intermittent flicker, worst on vertical
// walks). Main just executes the move verbatim — clamped for safety, never
// re-quantized, or the two sides would disagree.
function moveWindowTo(x, y) {
  if (!win || win.isDestroyed()) return;
  const wa = workArea();
  const cx = Math.min(Math.max(Math.round(x), wa.x), wa.x + wa.width - WIN_W);
  const cy = Math.min(Math.max(Math.round(y), wa.y), wa.y + wa.height - WIN_H);
  win.setBounds({ x: cx, y: cy, width: WIN_W, height: WIN_H });
}

function buildTray() {
  const iconName = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-win.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', iconName));
  tray = new Tray(icon);
  if (process.platform === 'darwin') tray.setTitle('🪿');
  tray.setToolTip('Entitled Goose');
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Entitled Goose', enabled: false },
      { type: 'separator' },
      { label: 'Control panel…', click: () => openPanel() },
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
      { label: 'Edit goose phrases…', click: () => { loadNotes(); shell.openPath(notesPath()); } },
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
    // Renderer re-follows on its next frame once it has the new bounds.
    sendToGoose('work-area', workArea());
  };

  // Space switches: re-assert overlay flags (macOS can drop the on-top level)
  // and cue the goose's catch-up sprint so it "follows" you to the new desktop.
  if (process.platform === 'darwin') {
    try {
      systemPreferences.subscribeWorkspaceNotification(
        'NSWorkspaceActiveSpaceDidChangeNotification',
        () => {
          applyOverlayFlags();
          sendToGoose('space-changed', {});
        }
      );
    } catch (err) {
      console.error('space-change subscription failed', err);
    }
  }
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  // The goose's productivity-enforcement instincts.
  warden = new FocusWarden({
    isEnabled: () => settings.focusEnforce,
    onDistraction: (d) => sendToGoose('distraction', d),
    onPermissionNeeded: () => sendToGoose('speak', {
      text: 'I tried to close your youtube but the computer says I need permission. System Settings → Privacy → Automation. fix it.',
    }),
  });
  warden.start();
});

ipcMain.on('r:move-window', (_e, { x, y }) => moveWindowTo(x, y));

let gooseState = { meter: 0.15, tier: 'content' };
ipcMain.on('r:goose-state', (_e, s) => { gooseState = s; });

// ---- Control panel ----
ipcMain.handle('panel:get', () => ({
  settings,
  phrases: loadNotes(),
  meter: gooseState.meter,
  tier: gooseState.tier,
}));

ipcMain.on('panel:set', (_e, partial) => {
  const politeBefore = settings.polite;
  Object.assign(settings, partial);
  saveSettings(settings);
  if (settings.polite !== politeBefore) applyOverlayFlags();
  sendToGoose('settings', settings);
  buildTrayMenu();
});

ipcMain.on('panel:set-phrases', (_e, phrases) => {
  if (Array.isArray(phrases) && phrases.every((p) => typeof p === 'string')) {
    saveNotes(phrases.slice(0, 200));
  }
});

ipcMain.on('panel:apologize', () => sendToGoose('apologize', {}));

// Failsafe: solid mode must be continuously renewed by the renderer, so a
// missed IPC or a hung renderer can never leave the overlay blocking real
// computer use — it always falls back to click-through.
let solidFailsafe = null;
ipcMain.on('r:click-through', (_e, { enable }) => {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(enable, { forward: true });
  clearTimeout(solidFailsafe);
  if (!enable) {
    solidFailsafe = setTimeout(() => {
      if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
    }, 2500);
  }
});

ipcMain.on('r:distraction-close', async (_e, { id }) => {
  if (warden) await warden.close(id); // the goose announces the kill via its bubble
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
    phrases: loadNotes(),
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
