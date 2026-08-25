// Turns behavior intents into rig parameters each frame:
// locomotion + gait, thrust-and-hold head stabilization, saccadic looking,
// FABRIK neck with rest-pose stiffness, keyframed actions (honk, shoo),
// additive breath/blink/tail layers.

import { Gait } from '../../shared/gait.js';
import { solveFabrik, blendToRest, limitBends, chainLengths } from '../../shared/fabrik.js';
import { twoBoneIK } from '../../shared/legik.js';
import { springDamp, clamp, lerp } from '../../shared/spring.js';
import { evalTimeline, timelineDuration } from '../../shared/kf.js';
import { GEO, neckRestPose } from './draw.js';

const SPEEDS = { walk: 85, run: 210, charge: 330 }; // px/s
const ACCEL = 700;

const TIMELINES = {
  honk: {
    squash: [[0, 0], [0.09, 1], [0.17, 0]],
    extend: [[0.10, 0], [0.18, 1], [0.42, 1], [0.60, 0]],
    beak: [[0.13, 0], [0.18, 1], [0.40, 1], [0.52, 0]],
  },
};
const HONK_SOUND_T = 0.18;

export class GooseAnimator {
  constructor({ scale, groundY, workArea, events }) {
    this.S = scale;
    this.workArea = workArea;
    this.events = events; // { honk(volume), honkVfx(beakWorld, dir), footPlant(worldX, worldY, dir) }

    this.bodyX = workArea.x + workArea.width / 2;
    this.bodyY = groundY; // the goose's foot line — it roams the whole screen
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.arrived = true;

    this.gait = new Gait();
    this.gait.reset(this.bodyX / this.S, 1);

    // Neck chain state (local units, authored facing +x).
    this.neckPts = neckRestPose().map((p) => ({ ...p }));
    this.neckLengths = chainLengths(this.neckPts);

    // Head target in world px, with snap spring.
    this.headWX = this.bodyX + GEO.restHead.x * this.S;
    this.headWY = this.bodyY + GEO.restHead.y * this.S;
    this.headVX = 0;
    this.headVY = 0;
    this.headTX = this.headWX;
    this.headTY = this.headWY;
    this.headAnchorX = this.headWX; // thrust-and-hold anchor while walking
    this.headSnap = 0.20; // spring halflife; small = snap

    this.beakOpen = 0;
    this.beakV = 0;
    this.eyelid = 0;
    this.blinkT = 3;
    this.faceCamera = 0;
    this.faceCameraV = 0;
    this.tailWag = 0;
    this.tailV = 0;
    this.breathT = 0;
    this.sleepAmt = 0;

    this.saccadeT = 1.5;
    this.saccade = { x: 0, y: 0 };
    this.lastLookTarget = null;

    this.action = null; // { name, t, timeline, fired:{}, target:{x,y} }
    this.honkVolume = 0.7;

    this.dragging = false;
    this.dragAmt = 0; // eased 0..1 for pose blending
    this.falling = false;
    this.fallV = 0;
    this.landed = null; // callback fired once on touchdown
  }

  startDrag() {
    this.dragging = true;
    this.falling = false;
    this.action = null;
  }

  endDrag(onLand) {
    this.dragging = false;
    if (this.bodyY < this.minBodyY()) {
      this.falling = true;
      this.fallV = Math.max(0, this.vy);
      this.landed = onLand || null;
    } else if (onLand) {
      onLand();
    }
    this.gait.reset(this.bodyX / this.S, this.facing);
  }

  startAction(name, opts = {}) {
    this.action = {
      name,
      t: 0,
      timeline: TIMELINES[name] || TIMELINES.honk,
      duration: timelineDuration(TIMELINES[name] || TIMELINES.honk),
      fired: {},
      target: opts.target || null,
    };
    if (opts.volume != null) this.honkVolume = opts.volume;
  }

  poke() {
    // Flinch back, then an indignant honk right back at the offender.
    this.vx = -this.facing * 190;
    this.startAction('honk', { volume: Math.min(1, this.honkVolume + 0.2) });
  }

  get busy() {
    return this.action !== null;
  }

  headWorld() {
    return { x: this.headWX, y: this.headWY };
  }

  beakWorld() {
    return {
      x: this.headWX + this.facing * (GEO.headRx + 0.09) * this.S,
      y: this.headWY,
    };
  }

  bounds() {
    const S = this.S;
    return {
      x: this.bodyX - 0.42 * S,
      y: this.bodyY - 1.02 * S,
      w: 0.84 * S,
      h: 1.04 * S,
    };
  }

  minBodyY() {
    return this.workArea.y + 1.08 * this.S;
  }

  maxBodyY() {
    return this.workArea.y + this.workArea.height - 4;
  }

  // intent: { move: {x, y|null}|null, speedTier, lookAt: {x,y}|null, faceCamera, showBubble, sleep }
  update(dt, intent, cursor) {
    const S = this.S;

    // ---- Dragging: the goose hangs from the cursor grab point ----
    this.dragAmt += clamp((this.dragging ? 1 : 0) - this.dragAmt, -dt * 4, dt * 4);
    if (this.dragging && cursor) {
      const grabX = cursor.x;
      const grabY = cursor.y + 0.38 * S; // body center hangs below the grab
      const oldX = this.bodyX;
      const oldY = this.bodyY;
      [this.bodyX, this.vx] = springDamp(this.bodyX, this.vx, grabX, 0.07, dt);
      [this.bodyY, this.vy] = springDamp(this.bodyY, this.vy, grabY, 0.07, dt);
      const wa = this.workArea;
      this.bodyX = clamp(this.bodyX, wa.x + 0.3 * S, wa.x + wa.width - 0.3 * S);
      this.bodyY = clamp(this.bodyY, wa.y + 0.55 * S, this.maxBodyY());
      if (Math.abs(this.bodyX - oldX) > 1) this.facing = Math.sign(this.bodyX - oldX) || this.facing;
      this.gait.update(dt, this.bodyX / S, 0, this.facing); // settle feet math
      return this.composeDragState(dt, oldX, oldY);
    }

    // ---- Falling after being dropped from a height ----
    if (this.falling) {
      this.fallV += 2400 * dt;
      this.bodyY += this.fallV * dt;
      if (this.bodyY >= this.minBodyY()) {
        this.bodyY = this.minBodyY();
        this.falling = false;
        this.gait.reset(this.bodyX / S, this.facing);
        if (this.landed) { this.landed(); this.landed = null; }
      } else {
        return this.composeDragState(dt, this.bodyX, this.bodyY - this.fallV * dt);
      }
    }

    // ---- Locomotion (free 2D roaming) ----
    let speed = 0;
    let hSpeed = 0;
    const mv = intent.move;
    const dx = mv != null ? mv.x - this.bodyX : 0;
    const dy = mv != null && mv.y != null ? mv.y - this.bodyY : 0;
    const dist = Math.hypot(dx, dy);
    if (mv != null && dist > 6) {
      this.arrived = false;
      const maxSpeed = SPEEDS[intent.speedTier || 'walk'];
      // Arrive: slow down inside the stopping radius.
      const target = Math.min(maxSpeed, dist * 3.2);
      const tvx = (dx / dist) * target;
      const tvy = (dy / dist) * target;
      this.vx += clamp(tvx - this.vx, -ACCEL * dt, ACCEL * dt);
      this.vy += clamp(tvy - this.vy, -ACCEL * dt, ACCEL * dt);
      if (Math.abs(this.vx) > 20) this.facing = Math.sign(this.vx);
    } else {
      this.arrived = true;
      this.vx += clamp(0 - this.vx, -ACCEL * dt, ACCEL * dt);
      this.vy += clamp(0 - this.vy, -ACCEL * dt, ACCEL * dt);
    }
    this.bodyX += this.vx * dt;
    this.bodyY += this.vy * dt;
    const margin = 0.45 * S;
    this.bodyX = clamp(this.bodyX, this.workArea.x + margin, this.workArea.x + this.workArea.width - margin);
    this.bodyY = clamp(this.bodyY, this.minBodyY(), this.maxBodyY());
    speed = Math.hypot(this.vx, this.vy);
    hSpeed = Math.abs(this.vx);

    // Face the point of interest when standing still.
    if (this.arrived && !intent.faceCamera) {
      const poi = intent.lookAt || cursor;
      if (poi && Math.abs(poi.x - this.bodyX) > 30) {
        this.facing = Math.sign(poi.x - this.bodyX);
      }
    }

    // ---- Gait (local units) ----
    // Cadence follows total speed; plant distance follows horizontal speed, so
    // a vertically-walking goose steps in place under its body.
    const plants = this.gait.update(dt, this.bodyX / S, speed / S, this.facing, hSpeed / S);
    for (const px of plants) this.events.footPlant(px * S, this.bodyY, this.facing);

    // ---- Sleep settle ----
    const sleepTarget = intent.sleep ? 1 : 0;
    this.sleepAmt += clamp(sleepTarget - this.sleepAmt, -dt * 1.5, dt * 1.5);

    // ---- Action timeline ----
    let squash = 0;
    let extend = 0;
    let beakTarget = 0;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const v = evalTimeline(a.timeline, a.t);
      squash = v.squash || 0;
      extend = v.extend || 0;
      beakTarget = v.beak || 0;
      if (a.name === 'honk' && !a.fired.sound && a.t >= HONK_SOUND_T) {
        a.fired.sound = true;
        this.events.honk(this.honkVolume);
        this.events.honkVfx(this.beakWorld(), this.facing);
      }
      if (a.t >= a.duration) this.action = null;
    }

    // ---- Head target selection ----
    const restX = this.bodyX + this.facing * GEO.restHead.x * S;
    const restY = this.bodyY + GEO.restHead.y * S;
    let snapHalflife = 0.22;

    if (this.sleepAmt > 0.5) {
      // Tucked along the back.
      this.headTX = this.bodyX - this.facing * 0.06 * S;
      this.headTY = this.bodyY - 0.46 * S;
      snapHalflife = 0.35;
    } else if (this.action && extend > 0) {
      // Honk: anticipation pull-back, then extend toward the target.
      const tgt = this.action.target || { x: restX + this.facing * 220, y: restY - 140 };
      const dx = tgt.x - restX;
      const dy = tgt.y - restY;
      const d = Math.hypot(dx, dy) || 1;
      const reach = 0.24 * S;
      this.headTX = restX - this.facing * 0.07 * S * squash + (dx / d) * reach * extend;
      this.headTY = restY + (dy / d) * reach * extend * 0.7;
      snapHalflife = 0.035;
    } else if (this.action && squash > 0) {
      this.headTX = restX - this.facing * 0.07 * S * squash;
      this.headTY = restY + 0.03 * S * squash;
      snapHalflife = 0.04;
    } else if (!this.arrived && speed > 20) {
      // Thrust-and-hold head stabilization: hold in world space, snap forward.
      const lead = this.facing * GEO.restHead.x * S;
      const desired = this.bodyX + lead;
      if ((desired - this.headAnchorX) * this.facing > 0.13 * S) {
        this.headAnchorX = desired + this.facing * 0.05 * S; // thrust with overshoot
      }
      // Running drops the neck into the "I have your stuff" spear.
      const runDrop = clamp((speed - SPEEDS.walk) / (SPEEDS.run - SPEEDS.walk), 0, 1);
      this.headTX = this.headAnchorX + this.facing * runDrop * 0.14 * S;
      this.headTY = restY + runDrop * 0.22 * S;
      snapHalflife = 0.045;
    } else if (intent.faceCamera) {
      this.headTX = restX - this.facing * 0.03 * S;
      this.headTY = restY - 0.02 * S;
      snapHalflife = 0.06;
    } else if (intent.lookAt) {
      // Saccadic cursor tracking: retarget only on meaningful movement, then snap.
      const root = { x: this.bodyX + this.facing * GEO.neckRoot.x * S, y: this.bodyY + GEO.neckRoot.y * S };
      let dx = intent.lookAt.x - root.x;
      let dy = intent.lookAt.y - root.y;
      const d = Math.hypot(dx, dy) || 1;
      const r = clamp(d, 0.30 * S, 0.55 * S);
      let tx = root.x + (dx / d) * r;
      let ty = Math.min(root.y + (dy / d) * r, this.bodyY - 0.16 * S);
      if (!this.lastLookTarget || Math.hypot(tx - this.lastLookTarget.x, ty - this.lastLookTarget.y) > 34) {
        this.lastLookTarget = { x: tx, y: ty };
      }
      this.headTX = this.lastLookTarget.x;
      this.headTY = this.lastLookTarget.y;
      snapHalflife = 0.04;
    } else {
      // Idle: rest pose + occasional saccade glances (birds snap, never smooth-track).
      this.saccadeT -= dt;
      if (this.saccadeT <= 0) {
        this.saccadeT = 1.6 + Math.random() * 2.6;
        const looks = [
          { x: 0, y: 0 }, { x: 0.05, y: -0.02 }, { x: -0.05, y: 0.03 },
          { x: 0.03, y: 0.05 }, { x: 0, y: 0 },
        ];
        this.saccade = looks[Math.floor(Math.random() * looks.length)];
      }
      this.headTX = restX + this.facing * this.saccade.x * S;
      this.headTY = restY + this.saccade.y * S;
      snapHalflife = 0.05;
      this.headAnchorX = restX;
    }

    [this.headWX, this.headVX] = springDamp(this.headWX, this.headVX, this.headTX, snapHalflife, dt);
    [this.headWY, this.headVY] = springDamp(this.headWY, this.headVY, this.headTY, snapHalflife, dt);

    // ---- Beak / blink / breath / tail / faceCamera ----
    [this.beakOpen, this.beakV] = springDamp(this.beakOpen, this.beakV, beakTarget, 0.03, dt);
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = 3 + Math.random() * 4; this.eyelid = 1; }
    else this.eyelid = Math.max(0, this.eyelid - dt * 12);
    if (this.sleepAmt > 0.5) this.eyelid = 1;
    this.breathT += dt;
    [this.faceCamera, this.faceCameraV] = springDamp(this.faceCamera, this.faceCameraV, intent.faceCamera ? 1 : 0, 0.09, dt);
    const wagTarget = this.gait.roll * 1.6 + (this.action ? 0.05 : 0);
    [this.tailWag, this.tailV] = springDamp(this.tailWag, this.tailV, wagTarget, 0.10, dt);

    // ---- Neck solve (local space) ----
    // Sleep sink stops at the belly touching the ground (belly is at -0.105).
    const bodyDY = this.gait.bob + squash * 0.035 + this.sleepAmt * 0.095 - Math.sin(this.breathT * 3.1) * 0.004;
    const root = { x: GEO.neckRoot.x, y: GEO.neckRoot.y + bodyDY };
    const localTX = ((this.headWX - this.bodyX) / S) * this.facing;
    const localTY = (this.headWY - this.bodyY) / S;
    this.neckPts[0].x = root.x;
    this.neckPts[0].y = root.y;
    solveFabrik(this.neckPts, this.neckLengths, { x: localTX, y: localTY });
    // Bend limits keep the chain kink-free at extreme reach angles so the
    // ribbon never creases or visually detaches from body or head.
    limitBends(this.neckPts, this.neckLengths);
    const stiffness = this.action ? 0.06 : this.sleepAmt > 0.5 ? 0.5 : 0.30;
    blendToRest(this.neckPts, neckRestPose(bodyDY), this.neckLengths, stiffness);

    // ---- Legs (local space) ----
    const legs = this.computeLegs(bodyDY);

    // Head rides the neck's end direction: anchored along the final segment so
    // it stays connected at any angle, tilting partially with the reach.
    const tip = this.neckPts[this.neckPts.length - 1];
    const prev = this.neckPts[this.neckPts.length - 2];
    let ux = tip.x - prev.x;
    let uy = tip.y - prev.y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    const headAngle = clamp((Math.atan2(uy, ux) + Math.PI / 2) * 0.35, -0.55, 0.55);

    return {
      bodyX: this.bodyX,
      bodyY: this.bodyY,
      facing: this.facing,
      bodyDY,
      roll: this.gait.roll,
      tailWag: this.tailWag * 0.05,
      neckPts: this.neckPts,
      head: { x: tip.x + ux * 0.034, y: tip.y + uy * 0.034 },
      headAngle,
      beakOpen: this.beakOpen,
      eyelid: this.eyelid,
      faceCamera: this.faceCamera,
      showBubble: !!intent.showBubble,
      legs,
      shadowW: 0.30 - this.sleepAmt * 0.02,
      sleeping: this.sleepAmt > 0.5,
    };
  }

  // Render state while dangling from the cursor (or falling): body swings like
  // a pendulum, legs hang loose, the head fights to stay upright above it all.
  composeDragState(dt, oldX, oldY) {
    const S = this.S;
    const pitch = clamp(-this.vx * 0.0011, -0.4, 0.4);

    // Head strains upward while the body dangles.
    this.headTX = this.bodyX + this.facing * 0.06 * S;
    this.headTY = this.bodyY - 0.92 * S;
    [this.headWX, this.headVX] = springDamp(this.headWX, this.headVX, this.headTX, 0.10, dt);
    [this.headWY, this.headVY] = springDamp(this.headWY, this.headVY, this.headTY, 0.10, dt);
    [this.beakOpen, this.beakV] = springDamp(this.beakOpen, this.beakV, this.dragAmt * 0.35, 0.06, dt);
    [this.tailWag, this.tailV] = springDamp(this.tailWag, this.tailV, pitch * 2, 0.10, dt);

    const bodyDY = 0;
    const root = { x: GEO.neckRoot.x, y: GEO.neckRoot.y };
    const localTX = ((this.headWX - this.bodyX) / S) * this.facing;
    const localTY = (this.headWY - this.bodyY) / S;
    this.neckPts[0].x = root.x;
    this.neckPts[0].y = root.y;
    solveFabrik(this.neckPts, this.neckLengths, { x: localTX, y: localTY });
    limitBends(this.neckPts, this.neckLengths);
    blendToRest(this.neckPts, neckRestPose(bodyDY), this.neckLengths, 0.2);

    const tip = this.neckPts[this.neckPts.length - 1];
    const prev = this.neckPts[this.neckPts.length - 2];
    let ux = tip.x - prev.x;
    let uy = tip.y - prev.y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;

    // Dangling legs: feet hang below the hips with a velocity sway.
    const sway = clamp(-this.vx * 0.0004, -0.08, 0.08);
    const mkDangle = (hipGeo, phase) => {
      const hip = { x: hipGeo.x, y: hipGeo.y };
      const ankle = { x: hip.x + sway + phase * 0.02, y: hip.y + 0.185 };
      const knee = twoBoneIK(hip, ankle, GEO.legUpper, GEO.legLower, -1);
      return { hip, knee, ankle, droop: 0.9 + phase * 0.15 };
    };

    return {
      bodyX: this.bodyX,
      bodyY: this.bodyY,
      facing: this.facing,
      bodyDY,
      roll: pitch,
      tailWag: this.tailWag * 0.05,
      neckPts: this.neckPts,
      head: { x: tip.x + ux * 0.034, y: tip.y + uy * 0.034 },
      headAngle: clamp((Math.atan2(uy, ux) + Math.PI / 2) * 0.35, -0.55, 0.55),
      beakOpen: this.beakOpen,
      eyelid: 0,
      faceCamera: 0,
      showBubble: false,
      legs: { near: mkDangle(GEO.hipNear, 1), far: mkDangle(GEO.hipFar, -1) },
      shadowW: 0.30 * Math.max(0.25, 1 - (this.minBodyY() - Math.min(this.bodyY, this.minBodyY())) / (0.9 * S) - this.dragAmt * 0.3),
      sleeping: false,
    };
  }

  computeLegs(bodyDY) {
    const S = this.S;
    if (this.sleepAmt > 0.6) return null; // loafing: legs folded under the body
    const mk = (hipGeo, foot, far) => {
      const hip = { x: hipGeo.x, y: hipGeo.y + bodyDY };
      // Convert world foot x to local (accounting for facing flip).
      const fx = ((foot.x * S - this.bodyX) / S) * this.facing;
      const fy = -foot.lift - 0.012;
      const ankle = { x: fx, y: fy };
      const knee = twoBoneIK(hip, ankle, GEO.legUpper, GEO.legLower, -1);
      const droop = foot.planted ? 0 : 0.5 * Math.min(1, foot.lift / 0.05);
      return { hip, knee, ankle, droop, far };
    };
    return {
      near: mk(GEO.hipNear, this.gait.feet[0], false),
      far: mk(GEO.hipFar, this.gait.feet[1], true),
    };
  }
}
