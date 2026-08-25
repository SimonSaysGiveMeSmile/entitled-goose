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
      closeDistraction: (id) => window.goose.send('distraction-close', { id }),
    },
  });

  if (state.grudgePending) {
    setTimeout(() => behavior && behavior.deliverGrudge(), 8000);
  }

  requestAnimationFrame(frame);
}

// ---- Input wiring ----

window.goose.on('window-moved', (b) => { origin = { x: b.x, y: b.y }; });

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

let lastCursor = null;
let lastCursorTime = 0;
window.goose.on('cursor', (p) => {
  cursor = p;
  const now = performance.now() / 1000;
  if (behavior && lastCursor) behavior.onCursor(p, now - lastCursorTime);
  lastCursor = p;
  lastCursorTime = now;

  // Click-through toggling: the goose is solid, everything else passes through.
  if (animator) {
    const b = animator.bounds();
    const over = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    if (over !== clickable) {
      clickable = over;
      window.goose.send('click-through', { enable: !over });
    }
  }
});

// Poke vs pet: quick click offends; holding ≥1.1s appeases.
let downAt = null;
let petTimer = null;
window.addEventListener('pointerdown', () => {
  if (!clickable) return;
  downAt = performance.now();
  petTimer = setTimeout(() => {
    if (animator) animator.eyelid = 1;
    behavior.onPet();
    downAt = null;
  }, 1100);
});
window.addEventListener('pointerup', () => {
  clearTimeout(petTimer);
  if (downAt !== null && performance.now() - downAt < 1100) {
    behavior.onPoke();
  }
  downAt = null;
});

// ---- Window follow (renderer-owned to avoid stale-origin flicker) ----
// The drawing origin updates in the SAME frame the move is ordered, so the
// goose never draws against a window position it doesn't have yet. Coarse
// quantized steps keep moves infrequent.
const WIN_W = 660;
const WIN_H = 540;
const FOLLOW_QUANTUM = 64;

function followWindow() {
  const anchorX = origin.x + WIN_W / 2;
  const anchorY = origin.y + WIN_H * 0.72;
  if (Math.abs(animator.bodyX - anchorX) <= 200 && Math.abs(animator.bodyY - anchorY) <= 105) return;
  const q = FOLLOW_QUANTUM;
  let tx = Math.round((animator.bodyX - WIN_W / 2) / q) * q;
  let ty = Math.round((animator.bodyY - WIN_H * 0.72) / q) * q;
  tx = Math.min(Math.max(tx, workArea.x), workArea.x + workArea.width - WIN_W);
  ty = Math.min(Math.max(ty, workArea.y), workArea.y + workArea.height - WIN_H);
  if (tx !== origin.x || ty !== origin.y) {
    origin = { x: tx, y: ty };
    window.goose.send('move-window', { x: tx, y: ty });
  }
}

// ---- Main loop with a watchdog for rAF throttling ----

let lastFrame = performance.now();
let stateReportT = 0;

function step(dt) {
  const intent = behavior.update(dt);
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
