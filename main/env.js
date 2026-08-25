// Environmental awareness: the goose knows the time, the machine's state, and
// when you leave or come back — and has opinions about all of it. Snapshots
// push every 30s; power/lock/theme changes push immediately with an event tag.

import { powerMonitor, nativeTheme } from 'electron';
import os from 'node:os';

export class EnvMonitor {
  constructor(send) {
    this.send = send;
    this.timer = null;
  }

  start() {
    const push = (event) => this.send({ ...this.snapshot(), event });
    this.timer = setInterval(() => this.send(this.snapshot()), 30_000);
    powerMonitor.on('resume', () => push('resume'));
    powerMonitor.on('unlock-screen', () => push('unlock'));
    powerMonitor.on('on-battery', () => push('on-battery'));
    powerMonitor.on('on-ac', () => push('on-ac'));
    // 'updated' fires for accent/contrast changes too — only announce when
    // dark/light actually flips.
    this.lastDark = nativeTheme.shouldUseDarkColors;
    nativeTheme.on('updated', () => {
      if (nativeTheme.shouldUseDarkColors !== this.lastDark) {
        this.lastDark = nativeTheme.shouldUseDarkColors;
        push('theme');
      }
    });
  }

  snapshot() {
    const now = new Date();
    let memFreePct = null;
    try {
      const mem = process.getSystemMemoryInfo();
      memFreePct = Math.round((mem.free / mem.total) * 100);
    } catch { /* not critical */ }
    return {
      now: now.getTime(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      weekday: now.getDay(),
      idleSeconds: powerMonitor.getSystemIdleTime(),
      load1: process.platform === 'win32' ? null : os.loadavg()[0], // always 0 on Windows

      cpus: os.cpus().length || 1,
      memFreePct,
      dark: nativeTheme.shouldUseDarkColors,
      uptimeMinutes: Math.round(os.uptime() / 60),
    };
  }
}
