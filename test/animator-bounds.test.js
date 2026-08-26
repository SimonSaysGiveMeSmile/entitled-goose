import test from 'node:test';
import assert from 'node:assert/strict';
import { GooseAnimator } from '../renderer/goose/animator.js';

const wa = { x: 0, y: 0, width: 1440, height: 900 };
const events = { honk() {}, honkVfx() {}, footPlant() {} };

test('pointer hit-zone never follows the cursor-tracking head', () => {
  const a = new GooseAnimator({ scale: 170, groundY: 800, workArea: wa, events });
  const before = a.bounds();
  // Simulate the head chasing a distant cursor — the exact v0.3.4 failure:
  // a head-following hit-zone contains the cursor by construction, so the
  // overlay goes solid under the pointer and eats clicks near the goose.
  a.headWX = a.bodyX + 500;
  a.headWY = a.bodyY - 300;
  a.headDrawWX = a.headWX;
  a.headDrawWY = a.headWY;
  const after = a.bounds();
  assert.deepEqual(after, before);
});

test('hit-zone covers the resting head and beak, and the tail', () => {
  const a = new GooseAnimator({ scale: 170, groundY: 800, workArea: wa, events });
  const b = a.bounds();
  const S = 170;
  // Rest beak tip: restHead.x (0.355) + hinge-to-tip (0.261) = 0.616S forward.
  assert.ok(a.bodyX + 0.616 * S <= b.x + b.w, 'rest beak inside hit-zone');
  // Tail spike reaches 0.495S behind.
  assert.ok(a.bodyX - 0.50 * S >= b.x, 'tail inside hit-zone');
  // Reasonable size: never wider than 1.3S (a giant zone blocks clicks).
  assert.ok(b.w <= 1.3 * S, 'hit-zone stays modest');
});
