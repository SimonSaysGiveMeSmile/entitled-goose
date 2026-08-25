import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  muted: false,
  polite: false,
  grudgePending: false,
  focusEnforce: true, // the goose closes entertainment windows to keep you working
  scale: 170, // goose standing height in px
};

const DEFAULT_NOTES = [
  'as per my last honk…',
  'friendly reminder that I live here now.',
  "you've moved the mouse 400 times today. not once toward me.",
  'this desktop is under new management.',
  're: bread. still waiting.',
  'your wallpaper is fine, I guess.',
  'I forgive you. (for what you did.)',
  'honk was sent at 9:04. it is now much later.',
];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function notesPath() {
  return path.join(app.getPath('userData'), 'notes.json');
}

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('settings save failed', err);
  }
}

export function loadNotes() {
  try {
    const notes = JSON.parse(fs.readFileSync(notesPath(), 'utf8'));
    if (Array.isArray(notes) && notes.length) return notes;
  } catch {
    // fall through: seed the user-editable file with defaults
  }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(notesPath(), JSON.stringify(DEFAULT_NOTES, null, 2));
  } catch (err) {
    console.error('notes seed failed', err);
  }
  return DEFAULT_NOTES;
}
