import test from 'node:test';
import assert from 'node:assert/strict';
import { evalTrack, evalTimeline, timelineDuration, smoothstep } from '../shared/kf.js';

test('evalTrack clamps to endpoints', () => {
  const track = [[0.1, 2], [0.5, 8]];
  assert.equal(evalTrack(track, -1), 2);
  assert.equal(evalTrack(track, 0.1), 2);
  assert.equal(evalTrack(track, 0.5), 8);
  assert.equal(evalTrack(track, 9), 8);
});

test('evalTrack midpoint uses smoothstep', () => {
  const track = [[0, 0], [1, 10]];
  assert.equal(evalTrack(track, 0.5), 10 * smoothstep(0.5));
  assert.ok(evalTrack(track, 0.25) < 2.5); // slow-in
  assert.ok(evalTrack(track, 0.75) > 7.5); // slow-out
});

test('evalTimeline evaluates every track', () => {
  const tl = { a: [[0, 0], [1, 1]], b: [[0, 5]] };
  const v = evalTimeline(tl, 0.5);
  assert.ok(v.a > 0 && v.a < 1);
  assert.equal(v.b, 5);
});

test('timelineDuration is the max track end time', () => {
  const tl = { a: [[0, 0], [0.6, 1]], b: [[0, 0], [0.9, 0]] };
  assert.equal(timelineDuration(tl), 0.9);
});
