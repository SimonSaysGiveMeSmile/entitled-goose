# Entitled Goose

A macOS desktop pet: a goose — faithful in style to *that* goose — that lives on your
desktop as a transparent overlay and acts like it owns the place. It waddles along the
bottom of your screen, honks at you, judges you silently, leaves passive-aggressive
notes, and **closes your entertainment windows** (YouTube, Instagram, Netflix, …) to
keep you focused.

> **Legal note:** This project uses **original art and audio only** — the goose is
> drawn entirely in code (flat-vector canvas paths) and the honk is synthesized with
> Web Audio. No game assets are extracted or redistributed. Not affiliated with
> House House, Panic, or samperson's Desktop Goose.

## Run

```bash
npm install
npm start        # the goose appears at the bottom of your primary display
npm test         # rig math unit tests (gait, IK, keyframes)
```

The app has no dock icon — everything is controlled from the **🪿 menu-bar tray**:
apologize to the goose, mute honks, polite (work-safe) mode, focus enforcement
toggle, edit its note collection, or quit (the goose will remember this).

## What it does

- **Waddles** with a procedural gait — feet pin to the ground (zero foot-slide),
  weight-shift roll, and thrust-and-hold head stabilization like a real goose.
- **Honks** — directed at your cursor, with white honk-lines and an original
  formant-synthesized honk. Volume and frequency escalate with its mood.
- **The Entitlement Meter** (Content → Miffed → Indignant → Wrath) rises while you
  ignore it and falls when you acknowledge it. A wrathful goose runs, demands
  attention next to your cursor, honks in triplets, and tracks muddy footprints.
- **Judgmental stare** — walks over, faces the camera, and holds… with a "…" bubble.
- **Passive-aggressive notes** — sticky-note windows delivered by beak
  ("as per my last honk…"). Edit the collection via the tray → *Edit notes…*
- **Focus enforcement** — polls the frontmost app/tab; when it spots a blocklisted
  distraction the goose sprints over, honks the window down, and *then* the tab/app
  closes. A note may follow: "closed your youtube. you're welcome."
  Blocklist is user-editable (`~/Library/Application Support/entitled-goose/blocklist.json`).
- **Interactions** — click the goose to poke it (it will not take that well);
  press-and-hold ~1 second to pet it (appeasement). The cursor passes through
  everything except the goose itself.
- **Grudge memory** — quit via the tray and the next launch opens with
  "I noticed you tried to evict me. bold."

## Permissions

- Cursor tracking, overlay, honks: **no permissions needed**.
- Focus enforcement uses AppleScript, so macOS will prompt for **Automation**
  permission (System Events + your browser) on first detection. If denied, the
  goose delivers a note telling you to fix it.

## Architecture

- **Electron** transparent, frameless, always-on-top (`screen-saver` level),
  click-through overlay. A small fixed-size window follows the goose in coarse
  ≤30 Hz steps (never per-frame moves) — the macOS-safe overlay strategy.
- **Original vector puppet**: ~12 code-drawn canvas paths skinned onto a procedural
  rig — FABRIK neck (6 joints, rest-pose stiffness blending, tapered ribbon
  extrusion), analytic 2-bone bird-knee leg IK, gait generator, keyframed honk
  timeline, additive breath/blink/tail-spring layers.
- **Behavior**: weighted shuffle-deck task picker modulated by the Entitlement
  Meter; distraction enforcement preempts everything.
- See `docs/DESIGN.md` for the full research-derived design brief.

## Project layout

```
main/       Electron main process: overlay window, tray, notes, FocusWarden
renderer/   canvas goose: draw (vector paths), animator (rig), behavior, audio, vfx
shared/     pure rig math (gait, FABRIK, leg IK, keyframes) — unit-tested
test/       node --test suites for the rig math
docs/       DESIGN.md — synthesized research brief
```
