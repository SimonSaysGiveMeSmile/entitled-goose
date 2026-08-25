import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  muted: false,
  polite: false,
  grudgePending: false,
  focusEnforce: true, // the goose closes entertainment windows to keep you working
  footsteps: false, // quiet webbed taps on foot plants (off: they get old fast)
  fps: 120, // max frame rate cap (actual rate limited by the display)
  energy: 50, // 0-100: high = fast and restless, low = slow and sleepy
  shushUntil: 0, // epoch ms; goose stays quiet until then
  scale: 170, // goose standing height in px
  awareness: {
    battery: true, // battery warnings
    time: true, // time-of-day greetings, absence counting, late-night judgment
    reports: true, // unsolicited status reports
    calendar: false, // event reminders (prompts for Calendar automation permission)
    phone: true, // 'you're on your phone, aren't you' suspicion honks
  },
};

const DEFAULT_NOTES = [
  'as per my last honk…',
  'friendly reminder that I live here now.',
  "you've moved the mouse 400 times today. not once toward me.",
  'this desktop is under new management.',
  're: bread. still waiting.',
  'your wallpaper is fine, I guess.',
  'honk was sent at 9:04. it is now much later.',
  'per the terms of our arrangement (I honk, you listen):',
  'I have reviewed your open tabs. we need to talk.',
  'a lesser goose would let this slide.',
  'circling back on the bread situation.',
  'you seem busy. anyway—',
  'I counted your unread emails. shameful. also, bread?',
  'the cursor and I are no longer on speaking terms.',
  'this is my desk now. you may continue using it. for now.',
  'noted. and by noted I mean honk.',
  'do you hear yourself typing? I do. constantly.',
  'my lawyer (also a goose) will be in touch.',
  'I was promised a pond.',
  'consider this your final warning. (warning #47)',
];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function notesPath() {
  return path.join(app.getPath('userData'), 'notes.json');
}

export function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return {
      ...DEFAULTS,
      ...stored,
      awareness: { ...DEFAULTS.awareness, ...(stored.awareness || {}) },
    };
  } catch {
    return { ...DEFAULTS, awareness: { ...DEFAULTS.awareness } };
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

export function saveNotes(phrases) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(notesPath(), JSON.stringify(phrases, null, 2));
  } catch (err) {
    console.error('notes save failed', err);
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
