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
    'hulu.com', 'disneyplus.com', 'primevideo.com', 'snal.com', 'amazon.com',
  ],
  // Matched against window titles when no URL is available (e.g. Firefox).
  titleKeywords: ['youtube', 'instagram', 'netflix', 'twitch', 'tiktok', 'snal'],
  // Whole apps the goose will quit on sight.
  apps: ['TV', 'Netflix', 'Steam'],
  defaultsVersion: 2,
};

function osascript(script, timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function powershell(script, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

// Foreground window on Windows: process name, title, and horizontal center.
const PS_FOREGROUND = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$h = [FG]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][FG]::GetWindowText($h, $sb, 512)
$procId = 0
[void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
$r = New-Object FG+RECT
[void][FG]::GetWindowRect($h, [ref]$r)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
"$($p.ProcessName)|$($r.Left)|$($r.Top)|$($r.Right)|$($sb.ToString())"
`.trim();

const PS_CLOSE_FOREGROUND = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
[void][CW]::SendMessage([CW]::GetForegroundWindow(), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
`.trim();

function blocklistPath() {
  return path.join(app.getPath('userData'), 'blocklist.json');
}

export function saveBlocklist(list) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(blocklistPath(), JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('blocklist save failed', err);
  }
}

export function loadBlocklist() {
  try {
    const data = JSON.parse(fs.readFileSync(blocklistPath(), 'utf8'));
    const merged = { ...DEFAULT_BLOCKLIST, ...data };
    // One-time migration: ship newly-added default domains to existing
    // installs (a saved file otherwise fully shadows the defaults).
    if ((data.defaultsVersion || 1) < 2) {
      if (!merged.domains.includes('amazon.com')) merged.domains = [...merged.domains, 'amazon.com'];
      merged.defaultsVersion = 2;
      saveBlocklist(merged);
    }
    return merged;
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

  setBlocklist(list) {
    this.blocklist = list;
    // Abort in-flight enforcement: its target may have just been unblocked.
    this.pending.clear();
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
    if (process.platform === 'win32') return this.pollWindows();
    if (process.platform !== 'darwin') return;

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

  // Windows: title-keyword matching only (no sanctioned way to read tab URLs).
  // The distraction must still be the foreground window when the goose arrives,
  // otherwise the close is skipped — we never close an unrelated window.
  async pollWindows() {
    const BROWSERS = ['chrome', 'msedge', 'brave', 'opera', 'firefox', 'vivaldi', 'arc'];
    const out = await powershell(PS_FOREGROUND);
    const [proc, left, top, right, ...titleParts] = out.split('|');
    const title = titleParts.join('|');
    if (!proc || proc.toLowerCase() === 'electron' || proc === 'Entitled Goose') return;

    const lowerProc = proc.toLowerCase();
    const lowerTitle = (title || '').toLowerCase();
    const isBrowser = BROWSERS.includes(lowerProc);
    const appBlocked = this.blocklist.apps.some((a) => a.toLowerCase() === lowerProc);
    const titleBlocked = isBrowser && this.blocklist.titleKeywords.some((k) => lowerTitle.includes(k));
    if (!appBlocked && !titleBlocked) return;

    const key = (appBlocked ? 'app:' : 'title:') + (appBlocked ? lowerProc : lowerTitle.slice(0, 40));
    if (this.onCooldown(key)) return;

    const closer = async () => {
      // Re-check the foreground before closing: the user may have switched away.
      const now = await powershell(PS_FOREGROUND);
      const [nowProc, , ...nowTitleParts] = now.split('|');
      const nowTitle = nowTitleParts.join('|').toLowerCase();
      if (nowProc?.toLowerCase() !== lowerProc) return;
      if (titleBlocked && !this.blocklist.titleKeywords.some((k) => nowTitle.includes(k))) return;
      await powershell(PS_CLOSE_FOREGROUND);
    };

    // Windows close button lives top-right.
    const x = parseInt(right, 10) - 45;
    const y = parseInt(top, 10) + 22;
    const id = this.nextId++;
    this.pending.set(id, { closer, label: appBlocked ? proc : 'that tab' });
    this.cooldowns.set(key, Date.now());
    this.onDistraction({
      id,
      label: appBlocked ? proc : 'that tab',
      x: Number.isFinite(x) ? x : null,
      y: Number.isFinite(y) ? y : null,
    });
    setTimeout(() => this.pending.delete(id), 20_000);
  }

  async emit(label, appName, closer, cooldownKey) {
    // The goose pecks the ACTUAL close button of what we close: the selected
    // tab's X (left edge of the tab via the AX tree). Fallback: the window's
    // red traffic-light corner.
    let targetX = null;
    let targetY = null;
    try {
      const tab = await osascript(
        `tell application "System Events" to tell process "${appName}"
           set tg to first tab group of front window
           set rb to first radio button of tg whose value is 1
           set p to position of rb
           set s to size of rb
           return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 2 of s as text)
         end tell`
      );
      const [tx, ty, th] = tab.split(',').map((n) => parseInt(n, 10));
      if (Number.isFinite(tx) && Number.isFinite(ty)) {
        targetX = tx + 14; // macOS tab close X sits at the tab's left edge
        targetY = ty + (Number.isFinite(th) ? th / 2 : 14);
      }
    } catch { /* tab bar not exposed; fall through to the traffic lights */ }
    if (targetX == null) {
      try {
        const pos = await osascript(
          `tell application "System Events" to tell process "${appName}" to get position of front window`
        );
        const [px, py] = pos.split(',').map((n) => parseInt(n, 10));
        if (Number.isFinite(px) && Number.isFinite(py)) {
          targetX = px + 27;
          targetY = py + 26;
        }
      } catch { /* fine: the goose will improvise */ }
    }

    const id = this.nextId++;
    this.pending.set(id, { closer, label });
    this.cooldowns.set(cooldownKey, Date.now());
    this.onDistraction({ id, label, x: targetX, y: targetY });

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
