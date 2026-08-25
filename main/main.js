import { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, dialog, systemPreferences } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, loadNotes, saveNotes, notesPath } from './settings.js';
import { closeAllNotes } from './notes.js';
import { FocusWarden, loadBlocklist, saveBlocklist } from './focus.js';
import { openPanel } from './panel.js';
import { EnvMonitor } from './env.js';
import { CalendarWatcher } from './calendar.js';
import { Updater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Honks must be able to play without a user gesture inside the window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
let tray = null;
let settings = loadSettings();
let quitting = false;
let warden = null;
let envMonitor = null;
let updater = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

// The work area of the display the overlay currently lives on (it follows
// the cursor across displays) — primary only before the window exists.
function currentWorkArea() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds()).workArea;
  return workArea();
}

function applyOverlayFlags() {
  if (!win || win.isDestroyed()) return;
  // Order matters on macOS: fullScreenable(false) BEFORE the workspace call
  // (or fullscreen apps hide the overlay), and always-on-top LAST (#36364).
  win.setFullScreenable(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setAlwaysOnTop(true, settings.polite ? 'floating' : 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  if (!win.isVisible()) win.showInactive();
}

function sendToGoose(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send('m:' + channel, data);
}

// Static full-workArea overlay: the window NEVER moves, so the goose's motion
// is pure canvas animation — no compositor mismatch, no jitter. Cheapness is
// preserved by dirty-rect redraws in the renderer (only the region around the
// goose repaints each frame).
function createWindow() {
  const wa = workArea();
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    // NSPanel: macOS can pin a regular borderless screen-sized window to one
    // Space; panels reliably join every Space (incl. fullscreen) instead.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
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
    sendToGoose('work-area', currentWorkArea());
    sendToGoose('window-moved', win.getBounds());
    sendToGoose('settings', settings);
    // Renderer boot races the first env timer: send a snapshot on every load.
    if (envMonitor) sendToGoose('env', envMonitor.snapshot());
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    applyOverlayFlags(); // re-assert on-top level after show (order matters on macOS)
  });
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
        label: 'Shush for an hour',
        click: () => {
          settings.shushUntil = Date.now() + 3600_000;
          saveSettings(settings);
          sendToGoose('settings', settings);
        },
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
  // Also: multi-display follow — if the cursor dwells on another display for
  // ~4s, the overlay moves there and the goose sprints in after you.
  let otherDisplayPolls = 0;
  setInterval(() => {
    const p = screen.getCursorScreenPoint();
    sendToGoose('cursor', p);
    if (!win || win.isDestroyed()) return;
    const cursorDisplay = screen.getDisplayNearestPoint(p);
    const windowDisplay = screen.getDisplayMatching(win.getBounds());
    if (cursorDisplay.id !== windowDisplay.id) {
      otherDisplayPolls++;
      if (otherDisplayPolls >= 120) { // ~4s at 33ms
        otherDisplayPolls = 0;
        win.setBounds(cursorDisplay.workArea);
        applyOverlayFlags();
        sendToGoose('work-area', cursorDisplay.workArea);
        sendToGoose('window-moved', win.getBounds());
        sendToGoose('space-changed', {}); // cue the catch-up sprint
      }
    } else {
      otherDisplayPolls = 0;
    }
  }, 33);

  const onDisplayChange = () => {
    if (!win || win.isDestroyed()) return;
    // Stay on the display we're on if it still exists; else fall back to primary.
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds(wa);
    applyOverlayFlags();
    sendToGoose('work-area', wa);
    sendToGoose('window-moved', win.getBounds());
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
      // App/window switches can drop the overlay's on-top level — re-assert.
      systemPreferences.subscribeWorkspaceNotification(
        'NSWorkspaceDidActivateApplicationNotification',
        () => applyOverlayFlags()
      );
    } catch (err) {
      console.error('workspace subscription failed', err);
    }
  }
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  // The goose's productivity-enforcement instincts.
  warden = new FocusWarden({
    isEnabled: () => settings.focusEnforce,
    onFrontmost: (app) => sendToGoose('frontmost', { app }),
    onDistraction: (d) => sendToGoose('distraction', d),
    onPermissionNeeded: () => sendToGoose('speak', {
      text: 'I tried to close your youtube but the computer says I need permission. System Settings → Privacy → Automation. fix it.',
    }),
  });
  warden.start();

  // The goose keeps an eye on the clock and the machine.
  envMonitor = new EnvMonitor((env) => sendToGoose('env', env));
  envMonitor.start();

  // Auto-update from GitHub releases; the goose announces downloads itself.
  updater = new Updater({
    onStatus: () => {}, // panel pulls state via panel:get
    onSpeak: (text) => sendToGoose('speak', { text }),
  });
  updater.start();

  // …and, when allowed, your calendar.
  if (process.platform === 'darwin') {
    new CalendarWatcher({
      isEnabled: () => settings.awareness.calendar,
      onEvents: (events) => sendToGoose('calendar', { events }),
      onPermissionNeeded: () => sendToGoose('speak', {
        text: 'I tried to read your calendar (for reminders, not gossip) but need permission. System Settings → Privacy → Automation.',
      }),
    }).start();
  }
});

let gooseState = { meter: 0.15, tier: 'content' };
ipcMain.on('r:goose-state', (_e, s) => { gooseState = s; });

// ---- Control panel ----
ipcMain.handle('panel:get', () => ({
  settings,
  phrases: loadNotes(),
  blocklist: loadBlocklist(),
  meter: gooseState.meter,
  tier: gooseState.tier,
  appVersion: app.getVersion(),
  update: updater ? updater.state : { status: 'dev' },
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

ipcMain.on('panel:set-blocklist', (_e, bl) => {
  // Only lines that already look like a real domain are accepted — half-typed
  // fragments from the autosave debounce must never become live matchers.
  const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  const domains = [...new Set((Array.isArray(bl?.domains) ? bl.domains : [])
    .map((s) => String(s).trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#:]/)[0])
    .filter((d) => DOMAIN_RE.test(d)))].slice(0, 200);
  const apps = [...new Set((Array.isArray(bl?.apps) ? bl.apps : [])
    .map((s) => String(s).trim()).filter(Boolean))].slice(0, 50);
  // Title-fallback keywords (Firefox + Windows close whole windows on these,
  // substring-matched): use the registrable label, and only when it is long
  // enough not to collide with benign titles ("news", "web", "old"...).
  const TLDISH = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu']);
  const titleKeywords = [...new Set(domains.map((d) => {
    const parts = d.split('.');
    let label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (TLDISH.has(label) && parts.length >= 3) label = parts[parts.length - 3];
    return label;
  }).filter((k) => k.length >= 5))];
  const list = { domains, apps, titleKeywords, defaultsVersion: 2 };
  saveBlocklist(list);
  if (warden) warden.setBlocklist(list);
});

ipcMain.on('panel:apologize', () => sendToGoose('apologize', {}));

ipcMain.on('r:open-panel', () => openPanel());

ipcMain.on('panel:check-updates', () => updater && updater.check());
ipcMain.on('panel:install-update', () => updater && updater.install());

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

// Locate a menu-bar status item (e.g. the battery icon) so the goose can
// deliver device warnings AT the icon. AX query via ControlCenter; falls back
// to a top-right estimate if not authorized or not found.
ipcMain.on('r:menu-pos-req', async (_e, { item }) => {
  if (item !== 'battery' || process.platform !== 'darwin') return;
  try {
    const { execFile } = await import('node:child_process');
    execFile('osascript', ['-e',
      `tell application "System Events" to tell process "ControlCenter"
         set mi to first menu bar item of menu bar 1 whose description contains "atter"
         set p to position of mi
         set s to size of mi
         return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text)
       end tell`,
    ], { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      const [x, y, w] = String(stdout).trim().split(',').map((n) => parseInt(n, 10));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        sendToGoose('menu-pos', { item: 'battery', x: x + (Number.isFinite(w) ? w / 2 : 12), y: y + 12 });
      }
    });
  } catch { /* fallback stays in renderer */ }
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
    workArea: currentWorkArea(),
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
