import test from 'node:test';
import assert from 'node:assert/strict';
import { solveFabrik, blendToRest, chainLengths, totalLength } from '../shared/fabrik.js';

function makeChain(n = 6, seg = 0.1) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: 0, y: -i * seg });
  return pts;
}

test('reachable target: tip converges, root stays fixed, lengths preserved', () => {
  const pts = makeChain();
  const lengths = chainLengths(pts);
  const target = { x: 0.2, y: -0.35 };
  solveFabrik(pts, lengths, target);
  assert.ok(Math.hypot(pts[5].x - target.x, pts[5].y - target.y) < 1e-3);
  assert.ok(Math.abs(pts[0].x) < 1e-12);
  assert.ok(Math.abs(pts[0].y) < 1e-12);
  const after = chainLengths(pts);
  for (let i = 0; i < lengths.length; i++) {
    assert.ok(Math.abs(after[i] - lengths[i]) < 1e-6, `segment ${i} length drifted`);
  }
});

test('unreachable target: chain straightens toward it at full reach', () => {
  const pts = makeChain();
  const lengths = chainLengths(pts);
  const reach = totalLength(lengths);
  solveFabrik(pts, lengths, { x: 5, y: 5 });
  const tipDist = Math.hypot(pts[5].x, pts[5].y);
  assert.ok(Math.abs(tipDist - reach) < 1e-6);
  // Collinear along the target direction.
  const angle = Math.atan2(pts[5].y, pts[5].x);
  assert.ok(Math.abs(angle - Math.atan2(5, 5)) < 1e-6);
});

test('blendToRest preserves segment lengths', () => {
  const pts = makeChain();
  const lengths = chainLengths(pts);
  solveFabrik(pts, lengths, { x: 0.3, y: -0.2 });
  const rest = makeChain();
  blendToRest(pts, rest, lengths, 0.4);
  const after = chainLengths(pts);
  for (let i = 0; i < lengths.length; i++) {
    assert.ok(Math.abs(after[i] - lengths[i]) < 1e-9, `segment ${i} length drifted`);
  }
});

test('blendToRest at stiffness 1 returns the rest pose', () => {
  const pts = makeChain();
  const lengths = chainLengths(pts);
  solveFabrik(pts, lengths, { x: 0.3, y: -0.2 });
  const rest = makeChain();
  blendToRest(pts, rest, lengths, 1);
  for (let i = 0; i < pts.length; i++) {
    assert.ok(Math.hypot(pts[i].x - rest[i].x, pts[i].y - rest[i].y) < 1e-9);
  }
});
