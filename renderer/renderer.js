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
      requestMenuPos: (item) => window.goose.send('menu-pos-req', { item }),
      closeDistraction: (id) => {
        synth.peck();
        window.goose.send('distraction-close', { id });
      },
    },
  });

  if (settings.awareness) behavior.awareness = { ...behavior.awareness, ...settings.awareness };
  if (settings.energy != null) { behavior.energy = settings.energy; animator.energy = settings.energy; }
  if (settings.shushUntil != null) behavior.shushUntil = settings.shushUntil;
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

window.goose.on('window-moved', (b) => { origin = { x: b.x, y: b.y }; });

window.goose.on('work-area', (wa) => {
  workArea = wa;
  if (animator) {
    animator.workArea = wa;
    behavior.onWorkAreaChange(wa);
    // Display switch: stale world-space VFX belongs to the old screen.
    vfx.footprints.length = 0;
    vfx.honkLines.length = 0;
  }
});

window.goose.on('settings', (s) => {
  settings = { ...settings, ...s };
  synth.muted = settings.muted;
  if (behavior) {
    behavior.polite = settings.polite;
    if (settings.awareness) behavior.awareness = { ...behavior.awareness, ...settings.awareness };
    if (settings.energy != null) behavior.energy = settings.energy;
    if (settings.shushUntil != null) behavior.shushUntil = settings.shushUntil;
  }
  if (animator) {
    if (settings.scale) animator.S = settings.scale;
    if (settings.energy != null) animator.energy = settings.energy;
  }
});

window.goose.on('calendar', ({ events }) => behavior && behavior.onCalendar(events));

window.goose.on('menu-pos', (d) => behavior && behavior.onMenuPos(d.item, { x: d.x, y: d.y }));

window.goose.on('apologize', () => behavior && behavior.onApologize());

window.goose.on('distraction', (d) => behavior && behavior.enforce(d));

window.goose.on('speak', ({ text }) => {
  // Main-process speech (updater, permission prompts) respects shush too.
  if (bubble && !(behavior && behavior.shushed)) bubble.say(text);
});

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
let lastPokeAt = 0;
window.addEventListener('pointerup', () => {
  clearTimeout(petTimer);
  if (dragging) {
    endDrag();
  } else if (downAt !== null && performance.now() - downAt < 1100) {
    // Double-click the goose → control panel (single click = poke).
    if (performance.now() - lastPokeAt < 380) {
      window.goose.send('open-panel', {});
    } else {
      behavior.onPoke();
      synth.flutter();
    }
    lastPokeAt = performance.now();
  }
  downAt = null;
  downCursor = null;
});
window.addEventListener('blur', () => { if (dragging) endDrag(); });

// ---- Main loop ----
// The window is static (full work area), so ALL motion is canvas animation:
// no compositor mismatch, no jitter. Logic steps on every rAF with real dt;
// drawing is capped at settings.fps (default 120, bounded by the display),
// with a full canvas clear every frame — artifact-proof by construction.

let lastFrame = performance.now();
let lastDraw = 0;
let stateReportT = 0;

function step(dt) {
  // The goose's mind pauses while it is being carried; it has other concerns.
  const intent = dragging ? behavior.intent : behavior.update(dt);
  const state = animator.update(dt, intent, cursor);
  // Defensive: if any numeric blowup ever poisons the pose, reset rather
  // than smear garbage across the desktop.
  if (!Number.isFinite(state.bodyX + state.bodyY)) {
    animator.bodyX = workArea.x + workArea.width / 2;
    animator.bodyY = workArea.y + workArea.height - 4;
    animator.vx = 0; animator.vy = 0;
    animator.gait.reset(animator.bodyX / settings.scale, 1);
  }
  vfx.update(dt);
  bubble.update(dt, ctx);
  stateReportT -= dt;
  if (stateReportT <= 0) {
    stateReportT = 0.5;
    window.goose.send('goose-state', { meter: behavior.meter, tier: behavior.tierName });
  }
  return state;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const state = step(dt);

  const minFrameMs = 1000 / (settings.fps || 120) - 1.5;
  if (now - lastDraw < minFrameMs) return;
  lastDraw = now;

  fitCanvas();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Full clear every frame. (A dirty-rect optimization lived here briefly —
  // its failure mode was smeared residue across the screen: one bad
  // coordinate makes clearRect a silent no-op and nothing erases again.
  // Full clearing is GPU-cheap and cannot leave artifacts.)
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  // World space (screen px), shifted by the static window origin.
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
