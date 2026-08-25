// The goose's mind: a weighted shuffle-deck task picker modulated by the
// Entitlement Meter (Content → Miffed → Indignant → Wrath). The meter rises
// while the goose is ignored and falls when it is acknowledged; it scales honk
// volume/frequency and unlocks the pushier tasks. The goose roams the whole
// screen (2D move targets) and talks via a speech bubble that follows it.

import { clamp } from '../../shared/spring.js';

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

    this.cursor = { x: workArea.x + workArea.width / 2, y: workArea.y + workArea.height / 2 };
    this.cursorSpeed = 0;

    this.intent = { move: null, speedTier: 'walk', lookAt: null, faceCamera: false, showBubble: false, sleep: false };
  }

  get tier() {
    return this.meter < 0.25 ? 0 : this.meter < 0.5 ? 1 : this.meter < 0.75 ? 2 : 3;
  }

  get tierName() {
    return TIERS[this.tier];
  }

  nextPhrase() {
    if (this.phraseDeck.length === 0) {
      this.phraseDeck = [...this.phrasePool];
      for (let i = this.phraseDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.phraseDeck[i], this.phraseDeck[j]] = [this.phraseDeck[j], this.phraseDeck[i]];
      }
    }
    return this.phraseDeck.pop();
  }

  gooseDistToCursor() {
    const b = this.anim;
    return Math.hypot(this.cursor.x - b.bodyX, this.cursor.y - (b.bodyY - b.S * 0.5));
  }

  onCursor(p, dt) {
    const d = Math.hypot(p.x - this.cursor.x, p.y - this.cursor.y);
    this.cursorSpeed = this.cursorSpeed * 0.8 + (d / Math.max(dt, 0.016)) * 0.2;
    if (d > 0.5) this.userIdleT = 0;
    this.cursor = p;
  }

  onPoke() {
    this.meter = clamp(this.meter + 0.08, 0, 1);
    this.anim.poke();
    this.task = null;
    this.gapT = 1.0;
    if (this.tier >= 2) this.events.speak('excuse me??');
  }

  onPet() {
    this.meter = clamp(this.meter - 0.28, 0, 1);
    this.task = null;
    this.gapT = 2.5; // stands there, appeased
    if (Math.random() < 0.4) this.events.speak('hm. acceptable.');
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
    if (Math.random() < 0.45) this.events.speak('we do NOT do that.');
    this.gapT = 1.8;
  }

  // Space switch: stage the illusion that the goose sprinted after you onto
  // the new desktop — snap it back toward the nearer screen edge, then charge
  // home. Throttled so rapid swipes don't stack sprints.
  onSpaceChange() {
    if (this.anim.dragging) return;
    const now = performance.now() / 1000;
    if (this._lastSpaceT && now - this._lastSpaceT < 3) return;
    this._lastSpaceT = now;

    const A = this.anim;
    const wa = this.workArea;
    const homeX = A.bodyX;
    const homeY = A.bodyY;
    const dir = homeX < wa.x + wa.width / 2 ? -1 : 1; // lag toward nearer edge
    A.bodyX = clamp(homeX + dir * 420, wa.x + 0.45 * A.S, wa.x + wa.width - 0.45 * A.S);
    A.vx = 0;
    A.vy = 0;
    A.facing = Math.sign(homeX - A.bodyX) || A.facing;
    A.gait.reset(A.bodyX / A.S, A.facing);
    this.task = this.makeTask('catchup', { x: homeX, y: homeY });
    this.gapT = 0;
  }

  onApologize() {
    this.meter = 0;
    setTimeout(() => this.events.speak('I forgive you. (for what you did.)'), 2500);
  }

  deliverGrudge() {
    this.events.speak('I noticed you tried to evict me. bold.');
    this.meter = clamp(this.meter + 0.2, 0, 1);
  }

  // A distraction was spotted: sprint over, honk it down, then main closes it.
  enforce({ id, label, x }) {
    this.task = this.makeTask('enforce', { id, label, x });
    this.gapT = 0;
  }

  update(dt) {
    this.speakCooldown -= dt;
    this.visitCooldown -= dt;
    this.userIdleT += dt;

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
        this.gapT = 0.6 + Math.random() * 1.6;
        this.resetIntent();
      }
    } else {
      this.gapT -= dt;
      this.resetIntent();
      // Between tasks the goose idly watches the cursor if it is nearby.
      this.intent.lookAt = gooseDist < 330 ? this.cursor : null;
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
    const entries = Object.entries(WEIGHTS)
      .map(([name, w]) => [name, name === this.lastTaskName ? w[t] * 0.25 : w[t]])
      .filter(([name, w]) => w > 0 && !(this.polite && name === 'demand'))
      .filter(([name]) => name !== 'speak' || this.speakCooldown <= 0);
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
            B.intent.lookAt = B.gooseDistToCursor() < 330 ? B.cursor : null;
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
            // Woken rudely → offended honk.
            if (B.gooseDistToCursor() < 130) {
              B.meter = clamp(B.meter + 0.06, 0, 1);
              B.intent.sleep = false;
              A.startAction('honk', { volume: B.honkVolume(), target: B.cursor });
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
              if (Math.random() < 0.25) B.events.speak('nice try.');
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
                  B.meter = clamp(B.meter - 0.08, 0, 1); // enforcement is satisfying
                  B.events.speak(`closed your ${opts.label || 'distraction'}. you're welcome.`);
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
