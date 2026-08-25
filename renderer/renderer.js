import { GooseAnimator } from './goose/animator.js';
import { Behavior } from './goose/behavior.js';
import { HonkSynth } from './goose/audio.js';
import { Vfx } from './goose/vfx.js';
import { drawGoose } from './goose/draw.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let origin = { x: 0, y: 0 };
let workArea = null;
let settings = { muted: false, polite: false, scale: 170 };
let cursor = { x: 0, y: 0 };
let clickable = false;
let lastCursorAt = performance.now();

const synth = new HonkSynth();
const vfx = new Vfx();
let animator = null;
let behavior = null;

function groundY() {
  return workArea.y + workArea.height - 4;
}

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
    footPlant: (worldX, dir) => {
      // Angry geese track mud. Content geese are tidy.
      if (behavior && behavior.tier >= 3) vfx.stampFoot(worldX, groundY(), dir);
    },
  };
  animator = new GooseAnimator({ scale: settings.scale, groundY: groundY(), workArea, events });
  behavior = new Behavior({
    animator,
    workArea,
    polite: settings.polite,
    events: {
      spawnNote: (text, beak) => {
        const b = beak || animator.beakWorld();
        window.goose.send('spawn-note', { text, x: b.x, y: b.y });
      },
      closeDistraction: (id) => window.goose.send('distraction-close', { id }),
    },
  });

  if (state.grudgePending) {
    setTimeout(() => behavior && behavior.deliverGrudgeNote(), 8000);
  }

  requestAnimationFrame(frame);
}

// ---- Input wiring ----

window.goose.on('window-moved', (b) => { origin = { x: b.x, y: b.y }; });

window.goose.on('work-area', (wa) => {
  workArea = wa;
  if (animator) {
    animator.workArea = wa;
    animator.groundY = groundY();
    behavior.workArea = wa;
  }
});

window.goose.on('settings', (s) => {
  settings = { ...settings, ...s };
  synth.muted = settings.muted;
  if (behavior) behavior.polite = settings.polite;
});

window.goose.on('apologize', () => behavior && behavior.onApologize());

window.goose.on('distraction', (d) => behavior && behavior.enforce(d));

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

// ---- Main loop with a watchdog for rAF throttling ----

let lastFrame = performance.now();

function step(dt) {
  const intent = behavior.update(dt);
  const state = animator.update(dt, intent, cursor);
  vfx.update(dt);
  window.goose.send('goose-pos', { x: animator.bodyX });
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

  // Goose local space: origin at ground under body, height 1.0, faces +x.
  ctx.save();
  ctx.translate(state.bodyX, groundY());
  ctx.scale(settings.scale * state.facing, settings.scale);
  drawGoose(ctx, state);
  ctx.restore();

  vfx.drawHonkLines(ctx);
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
