// Calendar awareness (macOS): polls upcoming events via AppleScript so the
// goose can remind you — "your 3pm thing is in 10 minutes. go be a person."
// Requires Calendar automation permission (macOS prompts on first poll), so
// this only runs when the user enables it in the control panel.

import { execFile } from 'node:child_process';

const POLL_MS = 5 * 60_000;
const LOOKAHEAD_SECONDS = 60 * 60;

const SCRIPT = `
set out to ""
set nowD to current date
set endD to nowD + ${LOOKAHEAD_SECONDS}
tell application "Calendar"
  repeat with c in calendars
    try
      repeat with e in (events of c whose start date is greater than or equal to nowD and start date is less than or equal to endD)
        set out to out & (summary of e) & "|" & ((start date of e) - nowD) & linefeed
      end repeat
    end try
  end repeat
end tell
return out
`.trim();

export class CalendarWatcher {
  constructor({ isEnabled, onEvents, onPermissionNeeded }) {
    this.isEnabled = isEnabled;
    this.onEvents = onEvents;
    this.onPermissionNeeded = onPermissionNeeded;
    this.permissionWarned = false;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.poll(), POLL_MS);
    setTimeout(() => this.poll(), 8000);
  }

  poll() {
    if (!this.isEnabled()) return;
    // Calendar AppleScript can be slow on big calendars: generous timeout.
    execFile('osascript', ['-e', SCRIPT], { timeout: 30_000 }, (err, stdout) => {
      if (err) {
        const msg = String(err.message || err);
        if ((msg.includes('-1743') || msg.includes('Not authorized')) && !this.permissionWarned) {
          this.permissionWarned = true;
          this.onPermissionNeeded();
        }
        return;
      }
      const events = [];
      for (const line of stdout.split('\n')) {
        const idx = line.lastIndexOf('|');
        if (idx <= 0) continue;
        const title = line.slice(0, idx).trim();
        const seconds = parseInt(line.slice(idx + 1), 10);
        if (title && Number.isFinite(seconds)) {
          events.push({ title, minutesUntil: Math.round(seconds / 60) });
        }
      }
      this.onEvents(events);
    });
  }
}
