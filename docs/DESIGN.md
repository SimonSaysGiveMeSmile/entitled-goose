# ENTITLED GOOSE — Design Brief (Synthesis)

## 1) Asset Verdict: AUTHOR ORIGINAL ART

**Decision: author original flat-vector art. Do not use any existing pack.** All five researchers converge here; the asset survey is decisive:

- The entire free/open goose ecosystem is 16–32 px pixel art (Duckhive "Cobra-Chicken" CC0 16×16, Lowich CC-BY 16×16, OGA CC0 cartoon duck). None matches the flat-shaded, no-outline UGG look, none survives Retina desktop scale (~100–200 px), and **no pack anywhere includes a honk animation** — the app's single most important action.
- The character's identity lives in an *elastic cursor-tracking neck* and a *head-stabilized waddle* — behaviors that are impossible with fixed sprite frames regardless of pack quality. The art problem and the animation problem have the same answer: a small set of original vector parts driven procedurally (Desktop Goose proved ~300 lines of vector drawing beats sprite sheets for this exact character).
- Legal: original art in a "minimal flat white goose" style is safe (it's a generic Embden goose); it also mitigates trade-dress risk vs. House House and differentiates from samperson's proprietary Desktop Goose. Never reuse press-kit imagery, Sketchfab rips, or the decompiled Desktop Goose code/assets (no license — inspiration only). Ship a "not affiliated with House House, Panic, or samperson" disclaimer; don't use "Untitled Goose" in the name.

**Permitted supporting uses:** Duckhive CC0 goose as a dev placeholder sprite only; Plewr's CC0 rigged 3D goose as a Blender pose/timing reference only; girlypixels' 16-state animation list as a behavioral vocabulary (states, not pixels). Budget: ~12 SVG body parts + 8–14 authored poses/parameter keyframe sets at ~256 px source scale.

## 2) Goose Visual Spec

Measured from official press material (reference only — draw from scratch). Normalize standing height = 1.0:

**Proportions**
- Head: small near-sphere, ~0.12 of height; slightly egg-shaped, long axis horizontal. Small head = "real goose, not mascot." No baby-schema.
- Beak: rounded triangular wedge, ~0.6–0.7 of head length, tip slightly downturned; head+beak ≈ 2× head diameter.
- Neck: smooth constant-width tube, width ≈ 1/6 max body width; length 0.30–0.35 at rest (S-curve), **elastic up to ~1.5×** when honking/reaching/running.
- Body: fat teardrop, ~0.47 tall × ~0.5 long; deep chest front-bottom sweeping up to a **pointed raised tail spike** (the #2 silhouette identifier after the neck). Wings invisible at rest — absorbed into the body until flapping.
- Legs: stubby, only ~0.08 exposed; feet = wide orange webbed triangles, 3 blunt toes, foot length ≈ head diameter.

**Palette (hex)**
| Element | Color |
|---|---|
| Body white (lit) | `#EBEBEB` |
| Body highlight | `#F2F2F2` |
| Body shade (5–10% darker only) | `#DADADA` |
| Beak + feet orange | `#F58731` (shaded `#EF8330`) |
| Open-mouth interior | `#FF8829` |
| Eye dot | `#272725` (never pure black) |
| Honk lines VFX | `#FFFFFF` tapered strokes |

**Style rules**
1. **No outlines anywhere** — separation by value/hue only.
2. Flat fills; at most one large soft gradient on the body shade side + a soft contact-shadow ellipse under the feet.
3. Zero texture, zero feather detail, zero speculars. Clean vector-smooth silhouettes with a few deliberate straightish segments (tail spike, beak wedge).
4. Eye: tiny dot ~7% of head diameter, high and forward, no highlight, never blinks expressively. **All expressiveness is pose/silhouette, none is face.**
5. Head glides level (deadpan horizontal beak line); never tilt the head "puppy style."

## 3) Animation States (priority order)

| P | State | Method |
|---|---|---|
| 1 | `walk` (waddle, ~2–3 steps/s) | **Procedural**: gait generator, pinned stance feet (zero foot-slide), body roll ±4–7° at 1× step freq, bob at 2×, Bézier swing arcs |
| 1 | `head_stabilize` (runs inside walk) | **Procedural**: thrust-and-hold — head held fixed in world space ~65% of step cycle, snapped forward in the rest; neck IK absorbs the difference. *The single highest-value realism feature.* |
| 1 | `idle_stand` + saccadic look-around | Procedural + additive breath layer; head **snaps** between orientations (birds saccade, never smooth-track) |
| 1 | `honk` (directed AT a target) | **Keyframed rig-parameter curves**: anticipation squash → neck extend toward target → beak snaps wide → 3–4 white honk-lines for 2–4 frames → recoil. Sound + VFX |
| 2 | `run` | Procedural gait variant: neck drops horizontal, head speared forward, body pitched — the "I have your stuff" pose |
| 2 | `grab_reach` / `carry` / `drag_pull` | Procedural: FABRIK neck aims at cursor/item; item snaps to a beak anchor socket; drag = lean-back tug-of-war keyframe pose over procedural feet |
| 2 | `peck` (cursor jab) | Short keyframed curve |
| 3 | `wing_flap_threat` / `victory_flap` | Attachment swap (wings pop out as flat paddles) + keyframed 2–4 rapid flaps, body rearing |
| 3 | `stare_at_user` (freeze, face screen) | Keyframed hold pose + ¾-view head attachment swap; comedy is the hold duration |
| 3 | `sneak` | Procedural crouch gait: body low, tail highest point, neck a lowered periscope, slow placed steps |
| 4 | `track_mud` (footprint decals) | Procedural: foot-plant events stamp fading footprint sprites (ring buffer ~64) |
| 4 | `idle_preen`, `sit_loaf`, `sleep`, `one_leg` | Keyframed settle poses, neck-tuck; frame-skip to ~12 fps here |
| 4 | `shoo_react` (poked → flinch + defiant honk-back) | Keyframed interrupt |
| 5 | `turn_in_place`, `drop_item`, `honk_double` | Keyframed variants |

Timing law (all states): **pantomime, not Looney Tunes** — long holds, fast 2–4-frame transitions, hold again. No ease-in on decisions; a goose does not hesitate. All state transitions crossfade the rig-parameter vector over 150–300 ms; blink/breath run as additive layers.

## 4) Rig / Rendering Architecture

**Hybrid vector puppet: authored SVG parts skinned onto a procedural rig, drawn on one Canvas 2D context.** *Conflict resolved by me:* the tech researcher recommended pixi.js spritesheets; the animation-tech and prior-art researchers recommended a vector/procedural puppet. I side with the puppet — spritesheets cannot do continuous neck aiming (the core mechanic), and the workload (~15–25 filled paths/frame) doesn't need Pixi. Skip Pixi in v1.

- **Parts (~12 SVGs, back→front slot order):** farFoot, farLeg, tail, body(+folded wing), nearWing, neckRibbon, head, beakLower, beakUpper, eye, nearLeg, nearFoot. Build step converts SVG → Path2D data + pivot JSON. Facing flip via `ctx.scale(-1,1)`; add a ¾-rear head/tail attachment for the stare state.
- **Rig = ~25 floats:** body pos/pitch/roll/bob/chestPuff/facing; gait phase/speed/stepLength + per-leg plantedPos/swingT; neck headTarget/stiffness; beakOpen; eyelid; tailAngle spring.
- **Neck:** FABRIK chain of ~6 joints with per-joint bend limits (25–35°), **blended toward an authored S-curve rest pose by a per-state stiffness weight** (kills the "floppy hose" look), then a Catmull-Rom→Bézier fit extruded as a tapered ribbon — the neck is always one clean shape, never visible segments. Neck IK runs on top of *every* state (weight 1.0 in reach, ~0.3 in sleep).
- **Legs:** analytic 2-bone IK (law of cosines, backward-bending bird knee), fed by the gait state machine.
- **Secondary motion:** 1-spring tail wag + chest jiggle (Rain World-style: physics rig underneath, authored art on top).
- **Perf:** cache the static body layer as a DPR-resolution offscreen bitmap; stroke only dynamic paths per frame; `canvas.width = cssW × devicePixelRatio` (re-run on display change); hardware acceleration ON; 60 fps only during action states, ~12 fps idle/sleep; OffscreenCanvas-in-worker is a phase-2 upgrade for rAF-throttle immunity.

## 5) Behavior Design

**Architecture:** flat task state machine (proven by Desktop Goose) — weighted shuffle-deck task picker (no immediate repeats), per-task stage sub-enums, honk on task transition, reactive interrupts (poke → retaliate). **Differentiator: a global Entitlement Meter** (Content → Miffed → Indignant → Wrath) that rises with time-since-last-interaction and modulates deck weights, honk volume/frequency, and escalation — this directly fixes the #1 Desktop Goose critique ("it only does ~4 things and never reacts to being ignored").

**Core states:** `Wander` (default), `NabCursor`, `DeliverWindow` (notes/gifts as beak-pinned frameless BrowserWindows we own), `TrackMud`, `DemandAttention`, `Sleep/Loaf`. Speed tiers: walk ~80, run ~200, charge ~400 px/s with steering physics.

**Entitled behaviors, ranked by comedy ÷ effort:**
1. **Escalating honks at "camera"** when ignored — trivial (meter + honk state), lands the core personality. 
2. **Passive-aggressive notes** dragged in by beak: "as per my last honk…", "friendly reminder that I live here now", "you've moved the mouse 400 times today. not once toward me." — our own BrowserWindows, zero OS hackery, user-extensible text.
3. **Judgmental stare** — walks near screen center, faces user, holds with "…" bubble. Nearly free; pure timing comedy.
4. **Cursor ransom** — steals cursor (CGWarp drag), returns it only after petting (hold-click 2 s) or clicking an "I'm sorry. You are a very important goose." dialog whose button dodges once or twice. High effort (native module), highest payoff — the signature feature.
5. **One-sided forgiveness** — after IT attacks YOU, delivers a note: "I forgive you."
6. **Grudge memory (persisted)** — next launch after a quit attempt: "I noticed you tried to evict me. bold."
7. **Deed of Ownership / Yelp-for-Humans review windows** ("slow to provide snacks. would honk again").
8. **Tribute (bread bowl)** — drag a crumb into its bowl window or get mud tracked.
9. **Work-aware insistence inversion** — quiet while you type fast, DEMANDS attention the instant you pause (typing-cadence heuristic; defer if it needs input-hook permissions).
10. **Territory line** — mud-footprint border; cursor trespass → warning honk → theft. (Cut-list candidate.)

**Retention lessons from prior art (mandatory):** politeness/work-safe mode, aggression slider, per-sound-category mutes (footstep taps were Desktop Goose's #1 annoyance), Esc-hold-to-evict escape hatch, first-run scripted sequence (TrackMud → first note gift) before random selection.

## 6) Tech Stack + macOS Gotchas

**Stack (versions verified 2026-08-25):** Electron **43.4.1** (adopt 44 at 44.1+) · electron-vite 5.0.0 · electron-builder 26.15.3 (`mac.extendInfo.LSUIElement: true`, hardened runtime, notarization) · Canvas 2D renderer (no Pixi, per §4) · Web Audio API with preloaded honk buffers + ±5% playbackRate jitter · electron-store 11.0.2 · node-mac-permissions 2.5.0 · custom ~50-line N-API addon (node-addon-api) wrapping `CGWarpMouseCursorPosition` + `CGAssociateMouseAndMouseCursorPosition` — **zero-permission cursor stealing**; @jitsi/robotjs 0.6.24 as gated fallback. Not Tauri (no `forward:true` equivalent — the app's core mechanic is exactly its API hole); not nut.js (now closed/paid).

**Window architecture** — *conflict resolved by me:* tech researcher said one static full-workArea window per display (never move it); animation-tech and prior-art researchers said small goose-following window (full-screen transparent overlays are a documented macOS perf trap: electron#28439, Tahoe WindowServer lag reports; Desktop Goose's fullscreen form caused its CPU and multi-monitor bugs). **I choose the small window: fixed-size (~goose bounds + neck-reach radius), never resized, repositioned by the main process at ≤30 Hz in coarse steps while fine motion happens in canvas coordinates inside it.** Electron 43's flicker fixes (PR #46392) make throttled moves safe; the "never move the window" rule targeted per-frame animation moves, which we avoid. Fall back to per-display static windows only if flicker appears in testing.

```js
new BrowserWindow({ transparent:true, frame:false, hasShadow:false, resizable:false,
  roundedCorners:false, skipTaskbar:true, show:false,
  webPreferences:{ backgroundThrottling:false } })
win.setAlwaysOnTop(true, 'screen-saver')  // 'floating' as polite setting
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true, skipTransformProcessType:true })
win.setIgnoreMouseEvents(true, { forward:true })  // default; flip off via IPC over goose pixels
```

**Gotchas checklist**
1. Re-apply `setIgnoreMouseEvents(...,{forward:true})` after every renderer reload (#15376).
2. `skipTransformProcessType:true` or the dock flashes on every workspace call.
3. Re-assert `setAlwaysOnTop(true,'screen-saver')` after `show()` and Space changes (#36364 — order matters).
4. `backgroundThrottling:false` or the goose freezes under a focused fullscreen app; rAF may still throttle when occluded (#9567) → setInterval fallback clock, OffscreenCanvas later.
5. Don't rely on alpha=0 native click-through — Electron disables it on macOS; explicit toggle only. Fallback hit-test: poll `screen.getCursorScreenPoint()` at 30 Hz in main (permission-free).
6. Tray icon (template PNG @1x/@2x, black+alpha, globally retained) is the **only** quit/settings surface once LSUIElement hides the dock; `app.dock.hide()` in dev.
7. `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')` or honks are blocked.
8. Size roam bounds to `display.workArea` (not `bounds`); handle `display-added/removed/metrics-changed`; one goose window handoff per display (separate Spaces = no spanning); clamp paths away from the notch band if walking the menu bar.
9. `focusable:false` preferred; if drags feel dead, `focusable:true` + never call `focus()`.
10. Notarize with hardened runtime; the CGWarp addon needs no special entitlement. First run must work with **zero permission prompts** (cursor-warp path guarantees this).
11. Battery: frame-skip idle states; keep GPU acceleration on.

## 7) Open Risks

1. **Trade dress** — even original art, if pixel-faithful to House House's goose, carries residual risk. Mitigate: deliberate design deltas (our measured spec is a starting point, not a clone target), original honk sounds, disclaimer, no "Untitled Goose" naming. *Unresolved: get a quick legal sanity check before launch.*
2. **Art execution risk** — no artist asset exists yet; the whole visual bar rests on ~12 SVGs + rig tuning. Mitigate: Plewr CC0 3D goose for pose reference; ship the procedural rig with placeholder shapes first (Desktop Goose proves crude shapes + great motion already reads as "the goose").
3. **Small-window strategy is my judgment call** — if throttled window moves still flicker or tear on some macOS versions, we eat a rework to per-display static windows. Prototype this in week 1.
4. **macOS AppKit churn** — Sonoma click-through regression and Tahoe transparent-overlay lag show Apple keeps breaking this niche; pin Electron versions and test each macOS beta.
5. **CGWarp behavior under future TCC changes** — the no-permission cursor warp is documented today (2026) but is exactly the kind of hole Apple closes; keep the @jitsi/robotjs + Accessibility-prompt path and the pure-Electron fake-cursor gag as graceful degradations.
6. **Annoyance churn** — the failure mode of this genre is uninstall-after-a-day. The Entitlement Meter must have a well-tuned ceiling, work-safe mode must be discoverable, and cursor theft must never fire during rapid typing.
7. **Electron footprint (~150–250 MB RAM)** — accepted for v1; Tauri migration only if complaints materialize (its click-through gap may close by then).
8. **Multi-goose / modding demand** — Desktop Goose's community immediately wanted mods; our windows-as-props + JSON note-text files should be user-editable from day 1 to capture that cheaply.