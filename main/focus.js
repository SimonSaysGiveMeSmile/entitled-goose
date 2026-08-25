// FocusWarden: the goose's productivity-enforcement instincts.
// Polls the frontmost app/tab via AppleScript; when it spots a blocklisted
// distraction (YouTube, Instagram, Netflix, …) it tells the renderer, the
// goose runs over and honks, and only then do we actually close the tab/app —
// the goose gets the credit. Needs macOS Automation permission for System
// Events + the target browser (the OS prompts on first use).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const CHROME_LIKE = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Vivaldi', 'Opera'];
const POLL_MS = 4000;
const COOLDOWN_MS = 15_000;

const DEFAULT_BLOCKLIST = {
  // Matched against the active tab's URL hostname.
  domains: [
    'youtube.com', 'instagram.com', 'tiktok.com', 'netflix.com', 'twitch.tv',
    'reddit.com', 'x.com', 'twitter.com', 'facebook.com', '9gag.com',
    'hulu.com', 'disneyplus.com', 'primevideo.com', 'snal.com',
  ],
  // Matched against window titles when no URL is available (e.g. Firefox).
  titleKeywords: ['youtube', 'instagram', 'netflix', 'twitch', 'tiktok', 'snal'],
  // Whole apps the goose will quit on sight.
  apps: ['TV', 'Netflix', 'Steam'],
};

function osascript(script, timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function blocklistPath() {
  return path.join(app.getPath('userData'), 'blocklist.json');
}

export function loadBlocklist() {
  try {
    const data = JSON.parse(fs.readFileSync(blocklistPath(), 'utf8'));
    return { ...DEFAULT_BLOCKLIST, ...data };
  } catch {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(blocklistPath(), JSON.stringify(DEFAULT_BLOCKLIST, null, 2));
    } catch { /* non-fatal: run with defaults */ }
    return { ...DEFAULT_BLOCKLIST };
  }
}

function hostMatches(url, domains) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export class FocusWarden {
  constructor({ isEnabled, onDistraction, onPermissionNeeded }) {
    this.isEnabled = isEnabled;
    this.onDistraction = onDistraction;
    this.onPermissionNeeded = onPermissionNeeded;
    this.blocklist = loadBlocklist();
    this.pending = new Map(); // id → { closer, label }
    this.cooldowns = new Map(); // key → timestamp
    this.permissionWarned = false;
    this.nextId = 1;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => {
      this.poll().catch((err) => this.handleError(err));
    }, POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  handleError(err) {
    const msg = String(err?.message || err);
    // -1743: not authorized to send Apple events.
    if ((msg.includes('-1743') || msg.includes('Not authorized')) && !this.permissionWarned) {
      this.permissionWarned = true;
      this.onPermissionNeeded();
    }
  }

  onCooldown(key) {
    const t = this.cooldowns.get(key);
    return t && Date.now() - t < COOLDOWN_MS;
  }

  async poll() {
    if (!this.isEnabled() || this.pending.size > 0) return;

    const front = await osascript(
      'tell application "System Events" to get name of first application process whose frontmost is true'
    );
    if (!front || front === 'Electron' || front === 'Entitled Goose') return;

    if (this.blocklist.apps.includes(front)) {
      if (this.onCooldown('app:' + front)) return;
      this.emit(front, front, () => osascript(`tell application "${front.replace(/"/g, '')}" to quit`), 'app:' + front);
      return;
    }

    if (CHROME_LIKE.includes(front) || front === 'Safari') {
      const isSafari = front === 'Safari';
      const tabRef = isSafari ? 'current tab of front window' : 'active tab of front window';
      const titleProp = isSafari ? 'name' : 'title';
      let url = '';
      let title = '';
      try {
        url = await osascript(`tell application "${front}" to get URL of ${tabRef}`);
        title = await osascript(`tell application "${front}" to get ${titleProp} of ${tabRef}`);
      } catch (err) {
        this.handleError(err);
        return;
      }
      if (hostMatches(url, this.blocklist.domains)) {
        const key = 'url:' + (safeHost(url) || title);
        if (this.onCooldown(key)) return;
        const label = safeHost(url) || 'that tab';
        this.emit(label, front, () => osascript(`tell application "${front}" to close ${tabRef}`), key);
      }
      return;
    }

    // Non-scriptable browsers (e.g. Firefox): fall back to window-title keywords.
    if (front === 'Firefox' || front === 'Firefox Developer Edition' || front === 'Zen Browser') {
      let title = '';
      try {
        title = await osascript(
          `tell application "System Events" to tell process "${front}" to get name of front window`
        );
      } catch (err) {
        this.handleError(err);
        return;
      }
      const lower = title.toLowerCase();
      if (this.blocklist.titleKeywords.some((k) => lower.includes(k))) {
        const key = 'title:' + lower.slice(0, 40);
        if (this.onCooldown(key)) return;
        this.emit('that tab', front, () =>
          osascript(`tell application "System Events" to tell process "${front}" to keystroke "w" using command down`), key);
      }
    }
  }

  async emit(label, appName, closer, cooldownKey) {
    // Where should the goose run? Toward the offending window if we can ask.
    let targetX = null;
    try {
      const pos = await osascript(
        `tell application "System Events" to tell process "${appName}" to get position of front window`
      );
      const size = await osascript(
        `tell application "System Events" to tell process "${appName}" to get size of front window`
      );
      const [px] = pos.split(',').map((n) => parseInt(n, 10));
      const [sw] = size.split(',').map((n) => parseInt(n, 10));
      if (Number.isFinite(px) && Number.isFinite(sw)) targetX = px + sw / 2;
    } catch { /* fine: the goose will improvise */ }

    const id = this.nextId++;
    this.pending.set(id, { closer, label });
    this.cooldowns.set(cooldownKey, Date.now());
    this.onDistraction({ id, label, x: targetX });

    // If the renderer never follows through, drop the pending entry.
    setTimeout(() => this.pending.delete(id), 20_000);
  }

  async close(id) {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    if (!entry) return null;
    try {
      await entry.closer();
      return entry.label;
    } catch (err) {
      this.handleError(err);
      return null;
    }
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
