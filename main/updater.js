// Auto-update via electron-updater against GitHub Releases. Checks on launch
// and every 6 hours; downloads silently; installs when the user clicks
// "Restart & update" in the control panel (or on next quit). The goose
// announces a downloaded update itself, naturally.

import electronUpdater from 'electron-updater';
import { app } from 'electron';

const { autoUpdater } = electronUpdater;

export class Updater {
  constructor({ onStatus, onSpeak }) {
    this.onStatus = onStatus;
    this.onSpeak = onSpeak;
    this.state = { status: app.isPackaged ? 'idle' : 'dev', version: app.getVersion(), available: null };
  }

  start() {
    if (!app.isPackaged) return; // electron-updater has no update config in dev

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', available: info.version }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'up-to-date', available: null }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', available: info.version });
      // Re-checks re-emit this event for the cached download — announce once.
      if (this.announcedVersion !== info.version) {
        this.announcedVersion = info.version;
        this.onSpeak(`a newer, better me exists (v${info.version}). restart me when you're ready to be honked at more efficiently.`);
      }
    });
    autoUpdater.on('error', (err) => {
      this.set({ status: 'error', message: String(err?.message || err).slice(0, 140) });
    });

    this.check();
    setInterval(() => this.check(), 6 * 3600_000);
  }

  check() {
    if (!app.isPackaged) return;
    autoUpdater.checkForUpdates().catch(() => { /* reported via 'error' */ });
  }

  install() {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall();
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onStatus(this.state);
  }
}
