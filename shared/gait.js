// Waddle gait generator. Works in world-x along a flat ground line (y up = negative
// lift). Feet are pinned in world space while planted (zero foot-slide); swing feet
// travel a sine arc to a plant point ahead of the body. Body roll happens at step
// frequency (weight shift), bob at 2x. All distances are in goose-local units
// (standing height = 1); the caller scales to pixels.

const SWING_FRAC = 0.42; // fraction of a foot's cycle spent in the air

export class Gait {
  constructor({ stepLength = 0.34, liftHeight = 0.055, rollAmp = 0.10, bobAmp = 0.012 } = {}) {
    this.stepLength = stepLength;
    this.liftHeight = liftHeight;
    this.rollAmp = rollAmp;
    this.bobAmp = bobAmp;
    this.phase = 0; // full cycle 0..1; foot 0 offset 0, foot 1 offset 0.5
    this.feet = [
      { x: 0, lift: 0, planted: true, swingFrom: 0, swingTo: 0 },
      { x: 0, lift: 0, planted: true, swingFrom: 0, swingTo: 0 },
    ];
    this.roll = 0;
    this.bob = 0;
    this.moving = false;
  }

  reset(bodyX, dir) {
    this.phase = 0;
    this.feet[0].x = bodyX + dir * this.stepLength * 0.22;
    this.feet[1].x = bodyX - dir * this.stepLength * 0.22;
    for (const f of this.feet) { f.lift = 0; f.planted = true; }
  }

  // bodyX: current body world x. speed: total gait cadence speed (local units/s).
  // dir: ±1. plantSpeed: horizontal component of speed — when the goose moves
  // mostly vertically, feet step in place under the body instead of marching
  // ahead of it. Returns plant events (world x per newly planted foot).
  update(dt, bodyX, speed, dir, plantSpeed = speed) {
    const plantEvents = [];
    const wasMoving = this.moving;
    this.moving = speed > 0.01;

    if (!this.moving) {
      // Ease feet down and settle roll/bob.
      for (const f of this.feet) {
        if (!f.planted) {
          f.lift = Math.max(0, f.lift - dt * 0.6);
          if (f.lift === 0) { f.planted = true; plantEvents.push(f.x); }
        }
      }
      this.roll *= Math.max(0, 1 - dt * 8);
      this.bob *= Math.max(0, 1 - dt * 8);
      return plantEvents;
    }

    if (!wasMoving) this.resyncPhase();

    // Step frequency follows speed so stride length stays near stepLength.
    const freq = Math.min(3.4, Math.max(1.4, speed / this.stepLength));
    this.phase = (this.phase + dt * freq) % 1;

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const p = (this.phase + i * 0.5) % 1;
      if (p < SWING_FRAC) {
        const t = p / SWING_FRAC;
        if (f.planted) {
          f.planted = false;
          f.swingFrom = f.x;
          // Plant ahead of where the body will be when the foot lands.
          const landTime = SWING_FRAC / freq;
          const plantFactor = Math.min(1, Math.max(0, plantSpeed / Math.max(speed, 1e-6)));
          f.swingTo = bodyX + dir * (this.stepLength * 0.5 * plantFactor)
            + dir * plantSpeed * landTime * 0.5;
        }
        const ease = t * t * (3 - 2 * t);
        f.x = f.swingFrom + (f.swingTo - f.swingFrom) * ease;
        f.lift = Math.sin(Math.PI * t) * this.liftHeight * Math.min(1, speed * 2.5);
      } else if (!f.planted) {
        f.planted = true;
        f.x = f.swingTo;
        f.lift = 0;
        plantEvents.push(f.x);
      }
    }

    const speedGain = Math.min(1, speed * 1.8);
    this.roll = Math.sin(this.phase * Math.PI * 2) * this.rollAmp * speedGain;
    this.bob = Math.abs(Math.sin(this.phase * Math.PI * 2)) * this.bobAmp * speedGain;
    return plantEvents;
  }

  // When starting to move, sync phase so the trailing foot swings first.
  resyncPhase() {
    this.phase = 0;
    for (const f of this.feet) f.planted = true;
  }
}
