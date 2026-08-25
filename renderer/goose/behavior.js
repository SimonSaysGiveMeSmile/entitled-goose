// The goose's mind: a weighted shuffle-deck task picker modulated by the
// Entitlement Meter (Content → Miffed → Indignant → Wrath). The meter rises
// while the goose is ignored and falls when it is acknowledged; it scales honk
// volume/frequency and unlocks the pushier tasks.

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
  note:   [0.05, 0.14, 0.14, 0.10],
};
const HONK_VOLUME = [0.40, 0.55, 0.75, 1.0];
const NOTE_COOLDOWN = 45;

export class Behavior {
  constructor({ animator, workArea, events, polite = false }) {
    this.anim = animator;
    this.workArea = workArea;
    this.events = events; // { spawnNote(text|null), honkSound-> via animator }
    this.polite = polite;

    this.meter = 0.15;
    this.task = null;
    this.lastTaskName = null;
    this.gapT = 1.5;
    this.noteCooldown = 10;
    this.visitCooldown = 0;
    this.userIdleT = 0;

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
  }

  onPet() {
    this.meter = clamp(this.meter - 0.28, 0, 1);
    this.task = null;
    this.gapT = 2.5; // stands there, appeased, eye closed handled by renderer
  }

  onApologize() {
    this.meter = 0;
    setTimeout(() => this.events.spawnNote('I forgive you. (for what you did.)'), 3000);
  }

  deliverGrudgeNote() {
    this.task = this.makeTask('note', { text: 'I noticed you tried to evict me. bold.' });
  }

  // A distraction was spotted (m:distraction). This preempts whatever the
  // goose was doing: sprint to the offending window, honk it down, and only
  // then does the main process actually close it.
  enforce({ id, label, x }) {
    this.task = this.makeTask('enforce', { id, label, x });
    this.gapT = 0;
  }

  update(dt) {
    this.noteCooldown -= dt;
    this.visitCooldown -= dt;
    this.userIdleT += dt;

    // ---- Entitlement meter dynamics ----
    const gooseDist = Math.hypot(this.cursor.x - this.anim.bodyX, this.cursor.y - this.anim.groundY + this.anim.S * 0.5);
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
        this.task.start?.();
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
      .filter(([name]) => name !== 'note' || this.noteCooldown <= 0);
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

  clampX(x, margin = 100) {
    const wa = this.workArea;
    return clamp(x, wa.x + margin, wa.x + wa.width - margin);
  }

  honkVolume() {
    return HONK_VOLUME[this.tier];
  }

  makeTask(name, opts = {}) {
    const B = this;
    const A = this.anim;
    const tasks = {
      wander() {
        // Short purposeful walks; the goose patrols its territory.
        const near = Math.random() < 0.6;
        const target = near
          ? B.clampX(A.bodyX + (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 320))
          : B.randomX();
        let linger = 0.4 + Math.random() * 1.4;
        return {
          name, update(dt) {
            if (Math.abs(A.bodyX - target) > 8) {
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
            const near = Math.hypot(B.cursor.x - A.bodyX, B.cursor.y - A.groundY) < 330;
            B.intent.lookAt = near ? B.cursor : null;
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
            if (Math.hypot(B.cursor.x - A.bodyX, B.cursor.y - A.groundY) < 130) {
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
        const target = B.clampX(B.cursor.x + (Math.random() < 0.5 ? -1 : 1) * 170);
        let hold = 4 + Math.random() * 3.5;
        let staring = false;
        return {
          name, update(dt) {
            if (!staring && Math.abs(A.bodyX - target) > 10) {
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
            const target = B.clampX(B.cursor.x + (B.cursor.x > A.bodyX ? -130 : 130));
            if (phase === 'approach') {
              if (Math.abs(A.bodyX - target) > 20) {
                B.intent.move = target;
                B.intent.speedTier = 'run';
                return false;
              }
              phase = 'demand';
            }
            B.intent.lookAt = B.cursor;
            waitT -= dt;
            const gooseDist = Math.hypot(B.cursor.x - A.bodyX, B.cursor.y - A.groundY + A.S * 0.5);
            if (gooseDist < 150) {
              // Acknowledged. A curt, satisfied honk.
              B.meter = clamp(B.meter - 0.25, 0, 1);
              if (!A.busy) A.startAction('honk', { volume: 0.35, target: B.cursor });
              return true;
            }
            if (!A.busy && waitT <= 0) {
              if (honks >= 3) {
                B.meter = clamp(B.meter + 0.03, 0, 1);
                if (B.noteCooldown <= 0 && Math.random() < 0.5) {
                  B.events.spawnNote(null);
                  B.noteCooldown = NOTE_COOLDOWN;
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
      note(taskOpts = {}) {
        const target = B.clampX(B.cursor.x + (Math.random() < 0.5 ? -1 : 1) * 220);
        let phase = 'walk';
        let t = 0;
        return {
          name, update(dt) {
            if (phase === 'walk') {
              if (Math.abs(A.bodyX - target) > 10) {
                B.intent.move = target;
                return false;
              }
              phase = 'honk';
              A.startAction('honk', { volume: B.honkVolume(), target: B.cursor });
            }
            if (phase === 'honk') {
              if (A.busy) return false;
              const beak = A.beakWorld();
              B.events.spawnNote(taskOpts.text || null, beak);
              B.noteCooldown = NOTE_COOLDOWN;
              phase = 'leave';
            }
            t += dt;
            const away = B.clampX(A.bodyX + (A.facing * -1) * 200);
            B.intent.move = away;
            return t > 2.2;
          },
        };
      },
      enforce(taskOpts = {}) {
        const target = B.clampX(taskOpts.x ?? B.cursor.x, 140);
        let phase = 'charge';
        let honks = 0;
        let cooldown = 0;
        let doneT = 0.8;
        return {
          name, update(dt) {
            if (phase === 'charge') {
              if (Math.abs(A.bodyX - target) > 16) {
                B.intent.move = target;
                B.intent.speedTier = 'charge';
                return false;
              }
              phase = 'honk';
            }
            if (phase === 'honk') {
              cooldown -= dt;
              // Honk upward at the offending window, not at the cursor.
              const windowPoint = { x: target, y: B.workArea.y + B.workArea.height * 0.3 };
              B.intent.lookAt = windowPoint;
              if (!A.busy && cooldown <= 0) {
                if (honks >= 2) {
                  B.events.closeDistraction(taskOpts.id);
                  B.meter = clamp(B.meter - 0.08, 0, 1); // enforcement is satisfying
                  phase = 'gloat';
                  return false;
                }
                A.startAction('honk', { volume: Math.min(1, B.honkVolume() + 0.25), target: windowPoint });
                honks++;
                cooldown = 0.4;
              }
              return false;
            }
            // gloat: a brief victorious stare at the scene of the crime.
            doneT -= dt;
            B.intent.faceCamera = doneT < 0.5;
            return doneT <= 0;
          },
        };
      },
    };
    const factory = tasks[name] || tasks.idle;
    return factory(opts);
  }
}
