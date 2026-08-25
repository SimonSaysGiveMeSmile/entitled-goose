// The goose's mind: a weighted shuffle-deck task picker modulated by the
// Entitlement Meter (Content → Miffed → Indignant → Wrath). The meter rises
// while the goose is ignored and falls when it is acknowledged; it scales honk
// volume/frequency and unlocks the pushier tasks. The goose roams the whole
// screen (2D move targets) and talks via a speech bubble that follows it.

import { clamp } from '../../shared/spring.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const TIERS = ['content', 'miffed', 'indignant', 'wrath'];

//                       content miffed indignant wrath
const WEIGHTS = {
  wander: [0.30, 0.25, 0.18, 0.10],
  idle:   [0.30, 0.22, 0.10, 0.05],
  sleep:  [0.20, 0.06, 0.00, 0.00],
  honk:   [0.05, 0.15, 0.22, 0.30],
  stare:  [0.10, 0.14, 0.18, 0.15],
  demand: [0.00, 0.04, 0.18, 0.30],
  speak:  [0.05, 0.14, 0.14, 0.10],
};
const HONK_VOLUME = [0.40, 0.55, 0.75, 1.0];
const SPEAK_COOLDOWN = 30;

export class Behavior {
  constructor({ animator, workArea, events, phrases = [], polite = false }) {
    this.anim = animator;
    this.workArea = workArea;
    // events: { speak(text), closeDistraction(id) }
    this.events = events;
    this.polite = polite;

    this.meter = 0.15;
    this.task = null;
    this.lastTaskName = null;
    this.gapT = 1.5;
    this.speakCooldown = 8;
    this.visitCooldown = 0;
    this.userIdleT = 0;

    // Shuffle-deck of phrases: no repeats until the whole pool has been used.
    this.phrasePool = phrases.length ? phrases : ['honk.'];
    this.phraseDeck = [];

    // Live session stats feeding the adaptive remark engine.
    this.stats = { cursorPx: 0, honks: 0, tabsClosed: 0, pokes: 0, pets: 0 };
    this.sessionStart = Date.now();
    this.front = { app: null, since: Date.now() };
    this.recentRemarks = [];

    this.cursor = { x: workArea.x + workArea.width / 2, y: workArea.y + workArea.height / 2 };
    this.cursorSpeed = 0;

    // Environmental awareness (time, machine state, battery, your absences).
    this.env = { hour: 12, minute: 0, idleSeconds: 0, load1: 0, cpus: 4 };
    this.envEvents = [];
    this.envCooldowns = {}; // key → seconds remaining
    this.wasIdleSeconds = 0;
    // Per-category toggles, mirrored from settings via the control panel.
    this.awareness = { battery: true, time: true, reports: true, calendar: false, phone: true };
    this.shushUntil = 0; // epoch ms from settings
    this.energy = 50; // 0-100 from settings: restless vs sleepy
    this.calendarEvents = [];
    this.calendarReminded = new Set();

    this.intent = { move: null, speedTier: 'walk', lookAt: null, faceCamera: false, showBubble: false, sleep: false };
  }

  get tier() {
    return this.meter < 0.25 ? 0 : this.meter < 0.5 ? 1 : this.meter < 0.75 ? 2 : 3;
  }

  get tierName() {
    return TIERS[this.tier];
  }

  poolDraw() {
    if (this.phraseDeck.length === 0) {
      this.phraseDeck = [...this.phrasePool];
      for (let i = this.phraseDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.phraseDeck[i], this.phraseDeck[j]] = [this.phraseDeck[j], this.phraseDeck[i]];
      }
    }
    return this.phraseDeck.pop();
  }

  // Adaptive remarks: candidates are weighted by CURRENT system state — the
  // frontmost app and how long you've been in it, battery, uptime, cursor
  // mileage, tabs closed today, day/time, its own mood. The user's phrase
  // pool stays in rotation as one candidate among them.
  nextPhrase() {
    const e = this.env;
    const mins = this.frontMinutes();
    const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][e.weekday ?? 0];
    const c = [];
    const add = (key, w, t) => { if (w > 0 && !this.recentRemarks.includes(key)) c.push({ key, w, t }); };

    if (this.front.app && mins >= 20) add('appDwell', 3, [`{appMin} minutes in {app}. I've seen enough.`, `still {app}. minute {appMin}. fascinating.`, `{app} again. {appMin} minutes. I am documenting this.`]);
    if (this.front.app && mins >= 45) add('appDwellLong', 4, [`we have lived in {app} for {appMin} minutes. blink twice if you need help.`, `{appMin} minutes. {app} should be paying you rent.`, `day 1 in {app}. morale: mine is low. ({appMin} minutes.)`]);
    if (e.batteryPct != null && !e.charging && e.batteryPct <= 35) add('batt', 3, [`{battery}% battery and no charger in sight. thrilling.`, `{battery}%. I am not saying panic. I am honking it.`, `the machine is at {battery}%. one of us should care.`]);
    if (e.charging) add('charging', 1.5, [`charging. finally, someone listens.`, `plugged in. a rare display of responsibility.`]);
    if (e.uptimeMinutes > 72 * 60) add('uptime', 2, [`this machine has been awake {uptimeH} hours. neither of us is okay.`, `{uptimeH} hours without a restart. bold. reckless, even.`]);
    if (this.stats.tabsClosed > 0) add('kills', 2, [`tabs closed on your behalf today: {tabsClosed}. you're welcome.`, `{tabsClosed} distractions eliminated today. gratitude accepted in crumbs.`]);
    if (this.stats.cursorPx > 350000) add('miles', 2.5, [`your cursor has traveled {miles} meters today. not once toward me.`, `{miles} meters of cursor travel. zero visits. noted.`]);
    if (e.weekday === 1 && e.hour < 12) add('monday', 2, [`monday. even I feel it, and I'm a goose.`, `it is monday. adjust expectations accordingly.`]);
    if ((e.weekday === 0 || e.weekday === 6) && e.idleSeconds < 60) add('weekend', 2, [`working on a {day}. the pond misses you.`, `a {day}, and you're here. commendable. concerning.`]);
    if (e.hour >= 12 && e.hour < 13) add('lunch', 1.5, [`it is lunchtime. you get bread. think of me.`, `lunch hour. somewhere, bread is happening without me.`]);
    if (this.tier >= 2) add('mood', 2, [`for the record, I have been {tier} for a while now.`, `current status: {tier}. this is on you.`]);
    if (Date.now() - this.sessionStart > 3 * 3600_000) add('session', 2, [`{sessionMin} minutes together today and not one crumb of bread.`, `{sessionMin} minutes of my company today. invoice pending.`]);
    if (this.stats.pokes > 2) add('pokes', 2, [`you have poked me ${this.stats.pokes} times today. I keep records.`, `poke #${this.stats.pokes} has been logged with my lawyer (also a goose).`]);
    // The pool is exempt from the recent-remark filter: it is the guaranteed
    // fallback, and dedupe there is the deck's job. Filtering it empties the
    // candidate list on quiet systems and there is nothing left to say.
    c.push({ key: 'pool', w: 3, t: null });

    const total = c.reduce((a, x) => a + x.w, 0);
    let r = Math.random() * total;
    let chosen = c[c.length - 1];
    for (const x of c) { r -= x.w; if (r <= 0) { chosen = x; break; } }
    if (!chosen) return this.renderPhrase(this.poolDraw());
    if (chosen.key !== 'pool') {
      this.recentRemarks.push(chosen.key);
      if (this.recentRemarks.length > 6) this.recentRemarks.shift();
    }
    const t = Array.isArray(chosen.t) ? pick(chosen.t) : chosen.t;
    return this.renderPhrase(t == null ? this.poolDraw() : t);
  }

  // Phrase templates: {time} becomes a time 1-3 hours ago, so "honk was sent
  // at {time}. it is now much later." always refers to a real, recent honk.
  renderPhrase(p) {
    if (typeof p !== 'string') return p;
    const e = this.env;
    const tokens = {
      '{battery}': e.batteryPct != null ? String(e.batteryPct) : '??',
      '{app}': this.front.app || 'that app',
      '{appMin}': String(this.frontMinutes()),
      '{miles}': String(Math.round(this.stats.cursorPx / 3780)), // px → ~meters at 96dpi
      '{tabsClosed}': String(this.stats.tabsClosed),
      '{uptimeH}': String(Math.round((e.uptimeMinutes || 0) / 60)),
      '{day}': ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][e.weekday ?? 0],
      '{sessionMin}': String(Math.round((Date.now() - this.sessionStart) / 60000)),
      '{idleMin}': String(Math.round((e.idleSeconds || 0) / 60)),
      '{tier}': this.tierName,
    };
    for (const [k, v] of Object.entries(tokens)) p = p.split(k).join(v);
    if (p.includes('{time}')) {
      const back = 60 + Math.floor(Math.random() * 120);
      let total = this.env.hour * 60 + this.env.minute - back;
      while (total < 0) total += 1440;
      const h = Math.floor(total / 60);
      const m = total % 60;
      const h12 = ((h + 11) % 12) + 1;
      p = p.split('{time}').join(`${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`);
    }
    return p;
  }

  gooseDistToCursor() {
    const b = this.anim;
    return Math.hypot(this.cursor.x - b.bodyX, this.cursor.y - (b.bodyY - b.S * 0.5));
  }

  get shushed() {
    return Date.now() < this.shushUntil;
  }

  get isNight() {
    return this.env.hour >= 23 || this.env.hour < 6;
  }

  timeString() {
    const h = this.env.hour;
    const m = String(this.env.minute).padStart(2, '0');
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${m}${h < 12 ? 'am' : 'pm'}`;
  }

  envCooldownOk(key, seconds) {
    if ((this.envCooldowns[key] || 0) > 0) return false;
    this.envCooldowns[key] = seconds;
    return true;
  }

  onEnv(env) {
    if (env.idleSeconds != null) this.wasIdleSeconds = Math.max(this.wasIdleSeconds, env.idleSeconds);
    this.env = { ...this.env, ...env };
    if (env.event) this.envEvents.push(env.event);
  }

  onBattery(pct, charging) {
    this.env.batteryPct = pct;
    this.env.charging = charging;
  }

  onCalendar(events) {
    this.calendarEvents = events || [];
    if (this.calendarReminded.size > 80) this.calendarReminded.clear();
  }

  onWorkAreaChange(wa) {
    this.workArea = wa;
    this._batteryIcon = null; // the menu bar moved with the display
    // Cancel EVERY task, catchup included: any in-flight target lives on the
    // old display and can never be reached inside the new work area. A
    // display-follow move sends a forced space-changed right after this,
    // which starts a fresh catchup with a valid target.
    if (this.task) {
      this.task = null;
      this.resetIntent();
      this.gapT = 1.0;
    }
  }

  onMenuPos(item, pos) {
    if (item === 'battery' && pos) this._batteryIcon = pos;
  }

  // Device warnings are delivered AT the battery icon: walk over, point the
  // beak up at the menu bar, honk, then speak.
  startBatteryAnnounce(text, urgent) {
    const wa = this.workArea;
    if (!this._batteryIcon) {
      this._batteryIcon = { x: wa.x + wa.width - 130, y: wa.y + 12 }; // estimate
    }
    this.events.requestMenuPos && this.events.requestMenuPos('battery'); // refine async
    this.resetIntent(); // interrupting sleep must clear intent.sleep or the goose slides around seated
    this.task = this.makeTask('announce', { text, urgent });
    this.gapT = 0;
  }

  // Runs each tick: event reactions + ambient awareness. Speaks sparingly —
  // awareness should feel observant, not chatty.
  updateEnv(dt) {
    for (const key of Object.keys(this.envCooldowns)) {
      this.envCooldowns[key] = Math.max(0, this.envCooldowns[key] - dt);
    }

    const asleep = this.task?.name === 'sleep';
    if (this.shushed) {
      // A shushed goose holds its tongue — except for a dying battery.
      this.envEvents.length = 0;
      this.wasIdleSeconds = 0; // absences during shush go unremarked
      const pct = this.env.batteryPct;
      if (this.awareness.battery && pct != null && !this.env.charging
          && pct <= 5 && this.envCooldownOk('battery5', 300)) {
        this.startBatteryAnnounce('FIVE PERCENT. shush revoked. do something.', true);
      }
      return;
    }
    const wake = () => { if (this.task?.name === 'sleep') { this.task = null; this.gapT = 1.5; this.resetIntent(); } };

    while (this.envEvents.length) {
      const event = this.envEvents.shift();
      // A real absence (sleep, lock, walk-away) invalidates the wall-clock
      // "today" counters — without this the first morning remark reports the
      // overnight hours as app-dwell/session time.
      if ((event === 'resume' || event === 'unlock')
          && Math.max(this.wasIdleSeconds, this.env.idleSeconds || 0) > 1800) {
        this.front.since = Date.now();
        this.sessionStart = Date.now();
        this.stats = { cursorPx: 0, honks: 0, tabsClosed: 0, pokes: 0, pets: 0 };
      }
      if (!this.awareness.time) continue;
      if ((event === 'resume' || event === 'unlock') && this.envCooldownOk('greet', 120)) {
        const h = this.env.hour;
        let line = h < 6 ? pick(['it is the middle of the night. bold of us.', 'nocturnal, are we. the pond judges silently. I do it out loud.'])
          : h < 12 ? pick(['good morning. the bread situation remains unresolved.', 'morning. I have been awake for hours. someone had to hold the fort.'])
          : h < 18 ? pick(['welcome back. I saw nothing.', 'back again. the desktop held. you are welcome.'])
          : pick(['evening. I kept everything exactly as you left it. mostly.', 'good evening. the day was long. I supervised.']);
        // Fold the counted absence into the greeting so it is never lost.
        if (this.wasIdleSeconds > 600) {
          const mins = Math.round(this.wasIdleSeconds / 60);
          this.wasIdleSeconds = 0;
          line += pick([` you were gone ${mins} minutes. I counted.`, ` ${mins} minutes of absence, logged and notarized.`]);
          this.meter = clamp(this.meter + Math.min(0.15, mins * 0.004), 0, 1);
        }
        wake();
        this.events.speak(line);
        this.anim.startAction('honk', { volume: 0.4, target: this.cursor });
      } else if (event === 'on-battery' && !asleep && this.envCooldownOk('power', 600)) {
        this.events.speak(pick(['unplugged, are we. living dangerously.', 'running on battery. how bohemian.']));
      } else if (event === 'theme' && !asleep && this.envCooldownOk('theme', 1800)) {
        this.events.speak(this.env.dark ? 'dark mode. moody.' : 'light mode. blinding. thanks.');
      }
    }

    // Calendar reminders: once per event, inside the 12-minute window.
    if (this.awareness.calendar) {
      for (const ev of this.calendarEvents) {
        if (ev.minutesUntil > 12 || ev.minutesUntil < -1) continue;
        const startBucket = Math.round((this.env.now + ev.minutesUntil * 60_000) / 300_000);
        const key = ev.title + '|' + startBucket;
        if (this.calendarReminded.has(key)) continue;
        this.calendarReminded.add(key);
        wake();
        this.events.speak(ev.minutesUntil <= 1
          ? `'${ev.title}' is NOW. go. GO.`
          : `'${ev.title}' in ${ev.minutesUntil} minutes. go be a person.`);
        this.anim.startAction('honk', { volume: 0.5, target: this.cursor });
      }
    }

    // The phone suspicion: mouse untouched for minutes while the machine is
    // awake in daytime. The goose knows exactly what you're doing.
    if (this.awareness.phone && !asleep
        && this.userIdleT >= 240
        && this.env.idleSeconds >= 240 && this.env.idleSeconds <= 540
        && this.env.hour >= 9 && this.env.hour < 23
        && this.envCooldownOk('phone', 1800)) {
      const mins = Math.round(this.env.idleSeconds / 60);
      this.events.speak(pick([`${mins} minutes without touching the mouse. you're on your phone, aren't you. the computer is RIGHT HERE.`, `${mins} minutes of mouse silence. blink if the phone has taken you hostage.`]));
      this.anim.startAction('honk', { volume: this.honkVolume(), target: this.cursor });
      this.meter = clamp(this.meter + 0.04, 0, 1);
    }

    // Returned after an at-desk absence (no sleep/lock event involved).
    if (this.awareness.time && this.wasIdleSeconds > 600 && this.env.idleSeconds < 10) {
      if (this.envCooldownOk('absence', 120)) {
        const mins = Math.round(this.wasIdleSeconds / 60);
        this.wasIdleSeconds = 0;
        wake();
        this.events.speak(pick([`you were gone ${mins} minutes. I counted.`, `${mins} minutes away. the desk reported nothing. I reported honk.`]));
        this.meter = clamp(this.meter + Math.min(0.15, mins * 0.004), 0, 1);
      }
    } else if (this.env.idleSeconds < 10 && this.wasIdleSeconds < 600) {
      this.wasIdleSeconds = 0;
    }

    // Battery concern: separate cooldown tiers so the emergency is never
    // throttled by the earlier nag. The 5% alarm wakes a sleeping goose.
    const pct = this.env.batteryPct;
    if (this.awareness.battery && pct != null && !this.env.charging) {
      if (pct <= 5 && this.envCooldownOk('battery5', 300)) {
        wake();
        this.startBatteryAnnounce('FIVE PERCENT. the nest is losing power. do something.', true);
      } else if (pct > 5 && pct <= 15 && !asleep && this.envCooldownOk('battery15', 600)) {
        this.startBatteryAnnounce(`your battery is at ${pct}%. charge it. I live here.`, false);
      }
    }

    // Machine under strain: sympathy, of a sort. (load1 is null on Windows.)
    if (this.awareness.time && this.env.load1 != null && this.env.load1 > this.env.cpus * 1.5
        && !asleep && this.envCooldownOk('load', 900)) {
      this.events.speak(pick(['your computer is wheezing. what did you do.', 'the fans are screaming. I relate to them deeply.']));
    }

    // Deep night with the user still typing: judgment.
    if (this.awareness.time && this.isNight && this.env.hour >= 1 && this.env.hour < 5 && !asleep
        && this.env.idleSeconds < 30 && this.envCooldownOk('latenight', 1800)) {
      this.events.speak(pick([`it is ${this.timeString()}. even geese sleep. this is unwell.`, `${this.timeString()}. the only creatures awake right now are you, me, and regret.`]));
    }
  }

  onFrontmost(app) {
    if (app !== this.front.app) this.front = { app, since: Date.now() };
  }

  frontMinutes() {
    return Math.round((Date.now() - this.front.since) / 60000);
  }

  onCursor(p, dt) {
    const d = Math.hypot(p.x - this.cursor.x, p.y - this.cursor.y);
    this.stats.cursorPx += d;
    this.cursorSpeed = this.cursorSpeed * 0.8 + (d / Math.max(dt, 0.016)) * 0.2;
    if (d > 0.5) this.userIdleT = 0;
    this.cursor = p;
  }

  onPoke() {
    this.stats.pokes++;
    this.meter = clamp(this.meter + 0.08, 0, 1);
    this.anim.poke();
    this.task = null;
    this.gapT = 1.0;
    if (this.tier >= 2) this.events.speak(pick(['excuse me??', 'HANDS.', 'that is assault, technically.']));
  }

  onPet() {
    this.stats.pets++;
    this.meter = clamp(this.meter - 0.28, 0, 1);
    this.task = null;
    this.gapT = 2.5; // stands there, appeased
    if (Math.random() < 0.4) this.events.speak(pick(['hm. acceptable.', 'continue.', 'this changes nothing. (do it again.)']));
  }

  onDragStart() {
    this.task = null;
    this.gapT = 1.0;
    this.meter = clamp(this.meter + 0.05, 0, 1);
  }

  onDragEnd() {
    // Set down (or dropped): indignant honk back at the hand that held it.
    this.meter = clamp(this.meter + 0.10, 0, 1);
    this.anim.startAction('honk', { volume: Math.min(1, this.honkVolume() + 0.2), target: this.cursor });
    if (Math.random() < 0.45) this.events.speak(pick(['we do NOT do that.', 'I am a goose, not luggage.']));
    this.gapT = 1.8;
  }

  // Space switch: the goose sprints in AFTER YOU — it drops back away from
  // your cursor and charges toward it, so the chase direction always reads
  // correctly no matter which way you swiped. Throttled against rapid swipes.
  onSpaceChange(force = false) {
    if (this.anim.dragging) return;
    const now = performance.now() / 1000;
    // The throttle guards against rapid Space swipes; display-follow moves
    // bypass it (force) — their catchup was just cancelled by the
    // accompanying work-area change and must be replaced.
    if (!force && this._lastSpaceT && now - this._lastSpaceT < 3) return;
    this._lastSpaceT = now;

    const A = this.anim;
    const wa = this.workArea;
    // Fall back away from the cursor (the goose "hasn't caught up yet")…
    const away = Math.sign(A.bodyX - this.cursor.x) || 1;
    A.bodyX = clamp(this.cursor.x + away * 520, wa.x + 0.45 * A.S, wa.x + wa.width - 0.45 * A.S);
    A.vx = 0;
    A.vy = 0;
    A.facing = Math.sign(this.cursor.x - A.bodyX) || A.facing;
    A.gait.reset(A.bodyX / A.S, A.facing);
    // …then charge to a spot right beside you.
    this.resetIntent(); // may interrupt sleep: clear intent.sleep so the sprint is on its feet
    this.task = this.makeTask('catchup', {
      x: this.clampX(this.cursor.x + away * 170),
      y: this.clampY(this.cursor.y + 150),
    });
    this.gapT = 0;
  }

  onApologize() {
    this.meter = 0;
    setTimeout(() => this.events.speak(pick(['I forgive you. (for what you did.)', 'apology received. penance: bread.'])), 2500);
  }

  deliverGrudge() {
    this.events.speak(pick(['I noticed you tried to evict me. bold.', 'you closed me. I came back. reflect on that.']));
    this.meter = clamp(this.meter + 0.2, 0, 1);
  }

  // A distraction was spotted: sprint over, honk it down, then main closes it.
  enforce({ id, label, x }) {
    this.resetIntent(); // may interrupt sleep: clear intent.sleep so the sprint is on its feet
    this.task = this.makeTask('enforce', { id, label, x });
    this.gapT = 0;
  }

  update(dt) {
    this.speakCooldown -= dt;
    this.visitCooldown -= dt;
    this.userIdleT += dt;
    this.updateEnv(dt);

    // ---- Entitlement meter dynamics ----
    const gooseDist = this.gooseDistToCursor();
    const rate = this.polite ? 0.5 : 1;
    if (this.cursorSpeed > 60 && gooseDist > 350) {
      this.meter += 0.014 * rate * dt; // actively ignoring the goose
    } else if (this.userIdleT > 30) {
      this.meter += 0.004 * rate * dt; // user absent; mild simmer
    }
    if (gooseDist < 160 && this.visitCooldown <= 0) {
      this.meter = clamp(this.meter - 0.10, 0, 1); // acknowledged by proximity
      this.visitCooldown = 30;
    }
    this.meter = clamp(this.meter, 0, 1);

    // ---- Task lifecycle ----
    if (this.task) {
      if (this.task.update(dt)) {
        this.lastTaskName = this.task.name;
        this.task = null;
        this.gapT = (0.6 + Math.random() * 1.6) * (1.5 - this.energy / 100);
        this.resetIntent();
      }
    } else {
      this.gapT -= dt;
      this.resetIntent();
      // Between tasks the goose idly watches the cursor if it is nearby.
      // Site behavior: the standing goose watches the cursor constantly,
      // at any distance — the always-tracking neck IS the character.
      this.intent.lookAt = this.cursor;
      if (this.gapT <= 0 && !this.anim.busy) {
        this.task = this.pickTask();
      }
    }

    return this.intent;
  }

  resetIntent() {
    this.intent.move = null;
    this.intent.speedTier = 'walk';
    this.intent.lookAt = null;
    this.intent.faceCamera = false;
    this.intent.showBubble = false;
    this.intent.sleep = false;
  }

  pickTask() {
    const t = this.tier;
    // Ambient awareness shapes the deck: at night (or while you're away) the
    // goose mostly sleeps and doesn't demand; status reports surface rarely.
    const drowsy = this.isNight || this.env.idleSeconds > 240;
    const QUIET = new Set(['wander', 'idle', 'sleep']);
    const entries = Object.entries({ ...WEIGHTS, report: [0.05, 0.06, 0.06, 0.04] })
      .map(([name, w]) => {
        let weight = name === this.lastTaskName ? w[t] * 0.25 : w[t];
        if (name === 'sleep' && !drowsy) weight *= 1.6 - this.energy / 100 * 1.2;
        if (drowsy) {
          // A wrathful goose sleeps lightly, but even it winds down at night.
          if (name === 'sleep') weight = (t >= 2 ? 0.25 : 0.5) * (1.6 - this.energy / 100 * 1.2);
          else if (name === 'demand' || name === 'honk') weight *= 0.25;
        }
        return [name, weight];
      })
      .filter(([name, w]) => w > 0 && !(this.polite && name === 'demand'))
      .filter(([name]) => !this.shushed || QUIET.has(name))
      .filter(([name]) => name !== 'report' || this.awareness.reports)
      .filter(([name]) => (name !== 'speak' && name !== 'report') || this.speakCooldown <= 0);
    let total = entries.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [name, w] of entries) {
      r -= w;
      if (r <= 0) return this.makeTask(name);
    }
    return this.makeTask('idle');
  }

  randomX(margin = 120) {
    const wa = this.workArea;
    return wa.x + margin + Math.random() * (wa.width - margin * 2);
  }

  randomY() {
    const lo = this.anim.minBodyY();
    const hi = this.anim.maxBodyY();
    return lo + Math.random() * (hi - lo);
  }

  clampX(x, margin = 100) {
    const wa = this.workArea;
    return clamp(x, wa.x + margin, wa.x + wa.width - margin);
  }

  clampY(y) {
    return clamp(y, this.anim.minBodyY(), this.anim.maxBodyY());
  }

  near(target, r = 10) {
    const dy = target.y != null ? this.anim.bodyY - target.y : 0;
    return Math.hypot(this.anim.bodyX - target.x, dy) < r;
  }

  honkVolume() {
    return HONK_VOLUME[this.tier];
  }

  makeTask(name, opts = {}) {
    const B = this;
    const A = this.anim;
    const tasks = {
      wander() {
        // Short purposeful walks anywhere on screen; the goose patrols its territory.
        const target = Math.random() < 0.55
          ? { x: B.clampX(A.bodyX + (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 320)),
              y: Math.random() < 0.5 ? B.clampY(A.bodyY + (Math.random() - 0.5) * 400) : null }
          : { x: B.randomX(), y: B.randomY() };
        let linger = 0.4 + Math.random() * 1.4;
        return {
          name, update(dt) {
            if (!B.near(target)) {
              B.intent.move = target;
              B.intent.speedTier = B.tier === 3 ? 'run' : 'walk';
              return false;
            }
            B.resetIntent();
            linger -= dt;
            return linger <= 0;
          },
        };
      },
      idle() {
        let t = 3 + Math.random() * 5;
        return {
          name, update(dt) {
            t -= dt;
            B.intent.lookAt = B.cursor; // always-tracking, like the site
            return t <= 0;
          },
        };
      },
      sleep() {
        let t = 12 + Math.random() * 14;
        return {
          name, update(dt) {
            t -= dt;
            B.intent.sleep = true;
            // Woken rudely → offended. At night it grumbles instead of
            // honking, so the drowsy sleep weighting can't create a honk loop.
            if (B.gooseDistToCursor() < 130) {
              B.meter = clamp(B.meter + 0.06, 0, 1);
              B.intent.sleep = false;
              if (B.shushed) { /* silently resettles */ } else if (B.isNight) {
                if (B.envCooldownOk('grumble', 60)) B.events.speak(pick(['I was ASLEEP.', 'five more minutes. or years.']));
              } else {
                A.startAction('honk', { volume: B.honkVolume(), target: B.cursor });
              }
              return true;
            }
            return t <= 0;
          },
        };
      },
      honk() {
        const count = 1 + (B.tier >= 2 ? 1 : 0) + (B.tier >= 3 ? 1 : 0);
        let honked = 0;
        let cooldown = 0;
        return {
          name, update(dt) {
            B.intent.lookAt = B.cursor;
            cooldown -= dt;
            if (!A.busy && cooldown <= 0) {
              if (honked >= count) return true;
              A.startAction('honk', { volume: B.honkVolume(), target: B.cursor });
              honked++;
              cooldown = 0.34;
            }
            return false;
          },
        };
      },
      stare() {
        // Walk pointedly near the cursor, face the camera, judge silently.
        const target = {
          x: B.clampX(B.cursor.x + (Math.random() < 0.5 ? -1 : 1) * 170),
          y: B.clampY(B.cursor.y + 150),
        };
        let hold = 4 + Math.random() * 3.5;
        let staring = false;
        return {
          name, update(dt) {
            if (!staring && !B.near(target, 12)) {
              B.intent.move = target;
              return false;
            }
            staring = true;
            hold -= dt;
            B.intent.faceCamera = true;
            B.intent.showBubble = hold < 3.2;
            return hold <= 0;
          },
        };
      },
      demand() {
        // Run at the cursor and honk until acknowledged.
        let phase = 'approach';
        let waitT = 0;
        let honks = 0;
        return {
          name, update(dt) {
            const target = {
              x: B.clampX(B.cursor.x + (B.cursor.x > A.bodyX ? -130 : 130)),
              y: B.clampY(B.cursor.y + 120),
            };
            if (phase === 'approach') {
              if (!B.near(target, 24)) {
                B.intent.move = target;
                B.intent.speedTier = 'run';
                return false;
              }
              phase = 'demand';
            }
            B.intent.lookAt = B.cursor;
            waitT -= dt;
            if (B.gooseDistToCursor() < 150) {
              // Acknowledged. A curt, satisfied honk.
              B.meter = clamp(B.meter - 0.25, 0, 1);
              if (!A.busy) A.startAction('honk', { volume: 0.35, target: B.cursor });
              return true;
            }
            if (!A.busy && waitT <= 0) {
              if (honks >= 3) {
                B.meter = clamp(B.meter + 0.03, 0, 1);
                if (B.speakCooldown <= 0) {
                  B.events.speak(B.nextPhrase());
                  B.speakCooldown = SPEAK_COOLDOWN;
                }
                return true; // gives up, files a complaint
              }
              A.startAction('honk', { volume: Math.min(1, B.honkVolume() + honks * 0.15), target: B.cursor });
              honks++;
              waitT = 1.4;
            }
            return false;
          },
        };
      },
      speak() {
        // Wander near the user, honk for attention, then say its piece.
        const target = {
          x: B.clampX(B.cursor.x + (Math.random() < 0.5 ? -1 : 1) * 220),
          y: B.clampY(B.cursor.y + 160),
        };
        let phase = 'walk';
        let t = 0;
        return {
          name, update(dt) {
            if (phase === 'walk') {
              if (!B.near(target, 12)) {
                B.intent.move = target;
                return false;
              }
              phase = 'honk';
              A.startAction('honk', { volume: B.honkVolume(), target: B.cursor });
            }
            if (phase === 'honk') {
              if (A.busy) return false;
              B.events.speak(opts.text || B.nextPhrase());
              B.speakCooldown = SPEAK_COOLDOWN;
              phase = 'linger';
            }
            t += dt;
            B.intent.lookAt = B.cursor;
            return t > 2.5;
          },
        };
      },
      report() {
        // The goose delivers an unsolicited status report.
        const target = {
          x: B.clampX(B.cursor.x + (Math.random() < 0.5 ? -1 : 1) * 200),
          y: B.clampY(B.cursor.y + 150),
        };
        let phase = 'walk';
        let t = 0;
        return {
          name, update(dt) {
            if (phase === 'walk') {
              if (!B.near(target, 12)) {
                B.intent.move = target;
                return false;
              }
              phase = 'honk';
              A.startAction('honk', { volume: B.honkVolume() * 0.8, target: B.cursor });
            }
            if (phase === 'honk') {
              if (A.busy) return false;
              const bits = [`status report: ${B.timeString()}.`];
              if (B.env.batteryPct != null) {
                bits.push(`battery ${B.env.batteryPct}%${B.env.charging ? ' (charging)' : ''}.`);
              }
              bits.push(B.env.load1 != null && B.env.load1 > B.env.cpus ? 'computer: struggling.' : 'computer: fine.');
              if (B.stats.tabsClosed > 0) bits.push(`tabs closed for you: ${B.stats.tabsClosed}.`);
              if (B.front.app) bits.push(`current obsession: ${B.front.app}.`);
              bits.push('me: unappreciated.');
              B.events.speak(bits.join(' '));
              B.speakCooldown = SPEAK_COOLDOWN * 2;
              // A report already mentioned the battery; hold the nag a while.
              B.envCooldowns.battery15 = Math.max(B.envCooldowns.battery15 || 0, 300);
              phase = 'linger';
            }
            t += dt;
            B.intent.lookAt = B.cursor;
            return t > 2.5;
          },
        };
      },
      announce() {
        // Walk to the battery icon, aim the beak at it, honk, deliver.
        let phase = 'walk';
        let t = 0;
        return {
          name, update(dt) {
            const icon = B._batteryIcon || { x: B.workArea.x + B.workArea.width - 130, y: B.workArea.y + 12 };
            const stand = { x: B.clampX(icon.x - 30, 120), y: B.anim.minBodyY() };
            if (phase === 'walk') {
              if (!B.near(stand, 14)) {
                B.intent.move = stand;
                B.intent.speedTier = opts.urgent ? 'run' : 'walk';
                return false;
              }
              phase = 'point';
            }
            B.intent.lookAt = icon;
            t += dt;
            if (phase === 'point' && t > 0.4 && !A.busy) {
              A.startAction('honk', { volume: opts.urgent ? 1 : 0.45, target: icon });
              B.events.speak(opts.text);
              phase = 'linger';
            }
            return phase === 'linger' && t > 3.4;
          },
        };
      },
      catchup() {
        // Sprint back to where it was standing before the desktop switched.
        const target = { x: opts.x, y: opts.y };
        let arrived = false;
        let settleT = 0.6;
        return {
          name, update(dt) {
            if (!arrived) {
              if (!B.near(target, 16)) {
                B.intent.move = target;
                B.intent.speedTier = 'run';
                return false;
              }
              arrived = true;
              if (!B.shushed && Math.random() < 0.25) B.events.speak(pick(['nice try.', 'blocked. again. we learn nothing.']));
            }
            settleT -= dt;
            B.intent.lookAt = B.cursor;
            return settleT <= 0;
          },
        };
      },
      enforce() {
        // The close button of the offending window (or a sensible stand-in).
        const btn = {
          x: B.clampX(opts.x ?? B.cursor.x, 140),
          y: opts.y != null ? opts.y : B.workArea.y + B.workArea.height * 0.25,
        };
        // Stand just right of the button so the extended beak lands ON it.
        const target = {
          x: B.clampX(btn.x + 58, 130),
          y: B.clampY(btn.y + 0.92 * A.S),
        };
        let phase = 'charge';
        let warned = false;
        let cooldown = 0;
        let peckT = null;
        let doneT = 1.6;
        return {
          name, update(dt) {
            if (phase === 'charge') {
              if (!B.near(target, 16)) {
                B.intent.move = target;
                B.intent.speedTier = 'charge';
                return false;
              }
              phase = 'peck';
            }
            if (phase === 'peck') {
              if (B.shushed) {
                // Shushed enforcement still protects focus — wordlessly.
                B.events.closeDistraction(opts.id);
                B.stats.tabsClosed++;
                B.meter = clamp(B.meter - 0.08, 0, 1);
                phase = 'gloat';
                return false;
              }
              cooldown -= dt;
              B.intent.lookAt = btn;
              if (!warned && !A.busy && cooldown <= 0) {
                // One warning honk at the button…
                A.startAction('honk', { volume: Math.min(1, B.honkVolume() + 0.25), target: btn });
                warned = true;
                cooldown = 0.5;
                return false;
              }
              if (warned && !A.busy && cooldown <= 0 && peckT === null) {
                // …then the peck: neck extends to the button and the close
                // fires at the exact moment of beak contact.
                A.startAction('honk', { volume: 0.5, target: btn });
                peckT = 0.2;
              }
              if (peckT !== null) {
                peckT -= dt;
                if (peckT <= 0) {
                  B.events.closeDistraction(opts.id);
                  B.stats.tabsClosed++;
                  B.meter = clamp(B.meter - 0.08, 0, 1); // enforcement is satisfying
                  B.events.speak(pick([`closed your ${opts.label || 'distraction'}. you're welcome.`, `${opts.label || 'that'}: handled. focus restored. tip jar accepts bread.`]));
                  phase = 'gloat';
                }
              }
              return false;
            }
            // gloat: a brief victorious stare at the scene of the crime.
            doneT -= dt;
            B.intent.faceCamera = doneT < 1.2;
            return doneT <= 0;
          },
        };
      },
    };
    const factory = tasks[name] || tasks.idle;
    return factory(opts);
  }
}
