import test from 'node:test';
import assert from 'node:assert/strict';
import { twoBoneIK } from '../shared/legik.js';

test('reachable foot: bone lengths are exact', () => {
  const hip = { x: 0, y: -0.18 };
  const foot = { x: 0.05, y: 0 };
  const knee = twoBoneIK(hip, foot, 0.105, 0.105, -1);
  assert.ok(Math.abs(Math.hypot(knee.x - hip.x, knee.y - hip.y) - 0.105) < 1e-9);
  assert.ok(Math.abs(Math.hypot(knee.x - foot.x, knee.y - foot.y) - 0.105) < 1e-9);
});

test('knee bends to the requested side', () => {
  const hip = { x: 0, y: -0.18 };
  const foot = { x: 0, y: 0 };
  const back = twoBoneIK(hip, foot, 0.105, 0.105, -1);
  const front = twoBoneIK(hip, foot, 0.105, 0.105, 1);
  // Hip→foot line is vertical (+y); the two bend signs land on opposite sides.
  assert.ok(back.x < 0, 'bird knee should bend backward (-x)');
  assert.ok(front.x > 0);
});

test('overextended target clamps without NaN', () => {
  const hip = { x: 0, y: -0.18 };
  const knee = twoBoneIK(hip, { x: 2, y: 2 }, 0.105, 0.105, -1);
  assert.ok(Number.isFinite(knee.x) && Number.isFinite(knee.y));
});
