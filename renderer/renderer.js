import { GooseAnimator } from './goose/animator.js';
import { Behavior } from './goose/behavior.js';
import { HonkSynth } from './goose/audio.js';
import { Vfx } from './goose/vfx.js';
import { SpeechBubble } from './goose/bubble.js';
import { drawGoose } from './goose/draw.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let origin = { x: 0, y: 0 };
let workArea = null;
let settings = { muted: false, polite: false, scale: 170 };
let cursor = { x: 0, y: 0 };
let clickable = false;

const synth = new HonkSynth();
const vfx = new Vfx();
let animator = null;
let behavior = null;
let bubble = null;

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
}

async function boot() {
  const state = await window.goose.getState();
  workArea = state.workArea;
  settings = { ...settings, ...state.settings };
  if (state.windowBounds) origin = { x: state.windowBounds.x, y: state.windowBounds.y };
  synth.muted = settings.muted;

  const events = {
    honk: (volume) => synth.honk(volume),
    honkVfx: (beak, dir) => vfx.spawnHonk(beak, dir),
    footPlant: (worldX, worldY, dir) => {
      // Angry geese track mud. Content geese are tidy.
      if (behavior && behavior.tier >= 3) vfx.stampFoot(worldX, worldY, dir);
      if (settings.footsteps) synth.step();
    },
  };
  animator = new GooseAnimator({
    scale: settings.scale,
    groundY: workArea.y + workArea.height - 4,
    workArea,
    events,
  });
  bubble = new SpeechBubble(() => {
    const head = animator.headWorld();
    return { x: head.x, y: head.y, facing: animator.facing };
  });
  behavior = new Behavior({
    animator,
    workArea,
    polite: settings.polite,
    phrases: state.phrases || [],
    events: {
      speak: (text) => bubble.say(text),
      closeDistraction: (id) => {
        synth.peck();
        window.goose.send('distraction-close', { id });
      },
    },
  });

  if (pendingEnv) {
    behavior.onEnv(pendingEnv);
    pendingEnv = null;
  }

  if (state.grudgePending) {
    setTimeout(() => behavior && behavior.deliverGrudge(), 8000);
  }

  requestAnimationFrame(frame);
}

// ---- Input wiring ----

window.goose.on('window-moved', (b) => {
  origin = { x: b.x, y: b.y };
  pendingMoveAt = 0;
});

window.goose.on('work-area', (wa) => {
  workArea = wa;
  if (animator) {
    animator.workArea = wa;
    behavior.workArea = wa;
  }
});

window.goose.on('settings', (s) => {
  settings = { ...settings, ...s };
  synth.muted = settings.muted;
  if (behavior) behavior.polite = settings.polite;
  if (animator && settings.scale) animator.S = settings.scale;
});

window.goose.on('apologize', () => behavior && behavior.onApologize());

window.goose.on('distraction', (d) => behavior && behavior.enforce(d));

window.goose.on('speak', ({ text }) => bubble && bubble.say(text));

window.goose.on('space-changed', () => behavior && behavior.onSpaceChange());

let pendingEnv = null;
window.goose.on('env', (env) => {
  if (behavior) behavior.onEnv(env);
  else pendingEnv = env; // arrives before boot() finishes; applied there
});

// Battery lives in the renderer's web API; poll it into the behavior.
if (navigator.getBattery) {
  navigator.getBattery().then((battery) => {
    const report = () => behavior && behavior.onBattery(Math.round(battery.level * 100), battery.charging);
    battery.addEventListener('levelchange', report);
    battery.addEventListener('chargingchange', report);
    const wait = setInterval(() => { if (behavior) { report(); clearInterval(wait); } }, 1000);
  }).catch(() => {});
}

let lastCursor = null;
let lastCursorTime = 0;
window.goose.on('cursor', (p) => {
  cursor = p;
  const now = performance.now() / 1000;
  if (behavior && lastCursor) behavior.onCursor(p, now - lastCursorTime);
  lastCursor = p;
  lastCursorTime = now;

  // Held down and moved: the user is picking the goose up.
  if (downAt !== null && !dragging && downCursor
      && Math.hypot(p.x - downCursor.x, p.y - downCursor.y) > 14) {
    beginDrag();
    downAt = null;
  }
  // While dragging, stay solid even if the cursor outruns the goose bounds.
  if (dragging) {
    window.goose.send('click-through', { enable: false });
    return;
  }

  // Click-through toggling: the goose is solid, everything else passes
  // through. Solid mode is re-sent every second as a keepalive — main's
  // failsafe re-enables click-through if the renewals stop.
  if (animator) {
    const b = animator.bounds();
    const over = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const nowMs = performance.now();
    if (over !== clickable || (over && nowMs - lastSolidSent > 1000)) {
      clickable = over;
      if (over) lastSolidSent = nowMs;
      window.goose.send('click-through', { enable: !over });
    }
  }
});
let lastSolidSent = 0;

// Poke, pet, or drag: a quick click offends; holding ≥1.1s appeases; moving
// while holding picks the goose up (it does not care for this either).
let downAt = null;
let downCursor = null;
let petTimer = null;
let dragging = false;

function beginDrag() {
  clearTimeout(petTimer);
  dragging = true;
  animator.startDrag();
  behavior.onDragStart();
  synth.flutter(0.4);
}

function endDrag() {
  dragging = false;
  animator.endDrag(() => behavior.onDragEnd());
}

window.addEventListener('pointerdown', () => {
  if (!clickable) return;
  downAt = performance.now();
  downCursor = { ...cursor };
  petTimer = setTimeout(() => {
    if (animator) animator.eyelid = 1;
    behavior.onPet();
    synth.hmph();
    downAt = null;
  }, 1100);
});
window.addEventListener('pointerup', () => {
  clearTimeout(petTimer);
  if (dragging) {
    endDrag();
  } else if (downAt !== null && performance.now() - downAt < 1100) {
    behavior.onPoke();
    synth.flutter();
  }
  downAt = null;
  downCursor = null;
});
window.addEventListener('blur', () => { if (dragging) endDrag(); });

// ---- Window follow (renderer-owned to avoid stale-origin flicker) ----
// The drawing origin updates in the SAME frame the move is ordered, so the
// goose never draws against a window position it doesn't have yet. Coarse
// quantized steps keep moves infrequent.
// Window follow: GLIDE, don't jump. Once the goose leaves the comfort zone the
// window slides after it in small capped steps (≤18px per move, ≤30Hz), with
// hysteresis so it settles once the goose is comfortably framed again. One
// move in flight at a time: the drawing origin only swaps when main confirms
// the native move, so any mismatch is a single ≤18px frame — imperceptible —
// instead of the old one-shot ~200px recenter flash.
const MAX_STEP = 18;
const START_SLACK_X = 190;
const START_SLACK_Y = 100;
const STOP_SLACK = 40;
let pendingMoveAt = 0;
let gliding = false;
let lastMoveSent = 0;

function followWindow() {
  const now = performance.now();
  if (pendingMoveAt && now - pendingMoveAt < 400) return;
  pendingMoveAt = 0;
  if (now - lastMoveSent < 33) return;

  const WIN_W = window.innerWidth;
  const WIN_H = window.innerHeight;
  const idealX = animator.bodyX - WIN_W / 2;
  const idealY = animator.bodyY - WIN_H * 0.72;
  const dx = idealX - origin.x;
  const dy = idealY - origin.y;

  if (!gliding) {
    if (Math.abs(dx) <= START_SLACK_X && Math.abs(dy) <= START_SLACK_Y) return;
    gliding = true;
  } else if (Math.abs(dx) <= STOP_SLACK && Math.abs(dy) <= STOP_SLACK) {
    gliding = false;
    return;
  }

  const sx = Math.max(-MAX_STEP, Math.min(MAX_STEP, dx));
  const sy = Math.max(-MAX_STEP, Math.min(MAX_STEP, dy));
  let tx = Math.round(origin.x + sx);
  let ty = Math.round(origin.y + sy);
  tx = Math.min(Math.max(tx, workArea.x), workArea.x + workArea.width - WIN_W);
  ty = Math.min(Math.max(ty, workArea.y), workArea.y + workArea.height - WIN_H);
  if (tx !== origin.x || ty !== origin.y) {
    pendingMoveAt = now;
    lastMoveSent = now;
    window.goose.send('move-window', { x: tx, y: ty });
  } else {
    gliding = false; // pinned against a screen edge
  }
}

// ---- Main loop with a watchdog for rAF throttling ----

let lastFrame = performance.now();
let stateReportT = 0;

function step(dt) {
  // The goose's mind pauses while it is being carried; it has other concerns.
  const intent = dragging ? behavior.intent : behavior.update(dt);
  const state = animator.update(dt, intent, cursor);
  vfx.update(dt);
  bubble.update(dt, ctx);
  followWindow();
  stateReportT -= dt;
  if (stateReportT <= 0) {
    stateReportT = 0.5;
    window.goose.send('goose-state', { meter: behavior.meter, tier: behavior.tierName });
  }
  return state;
}

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const state = step(dt);

  fitCanvas();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  // World space (screen px), shifted by the follow-window origin.
  ctx.save();
  ctx.translate(-origin.x, -origin.y);
  vfx.drawFootprints(ctx);

  // Goose local space: origin at the foot line under the body, height 1.0, faces +x.
  ctx.save();
  ctx.translate(state.bodyX, state.bodyY);
  ctx.scale(settings.scale * state.facing, settings.scale);
  drawGoose(ctx, state);
  ctx.restore();

  vfx.drawHonkLines(ctx);
  bubble.draw(ctx);
  ctx.restore();

  requestAnimationFrame(frame);
}

// Keep behavior alive if rAF is throttled while occluded.
setInterval(() => {
  const now = performance.now();
  if (now - lastFrame > 250 && behavior) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    step(dt);
  }
}, 250);

boot();
