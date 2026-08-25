import test from 'node:test';
import assert from 'node:assert/strict';
import { Gait } from '../shared/gait.js';

test('planted feet never slide (zero foot-slide invariant)', () => {
  const gait = new Gait();
  let bodyX = 0;
  const speed = 0.5; // local units/s
  gait.reset(bodyX, 1);
  const dt = 1 / 60;
  let prev = gait.feet.map((f) => ({ x: f.x, planted: f.planted }));
  for (let i = 0; i < 600; i++) {
    bodyX += speed * dt;
    gait.update(dt, bodyX, speed, 1);
    for (let j = 0; j < 2; j++) {
      if (prev[j].planted && gait.feet[j].planted) {
        assert.equal(gait.feet[j].x, prev[j].x, `foot ${j} slid at frame ${i}`);
      }
    }
    prev = gait.feet.map((f) => ({ x: f.x, planted: f.planted }));
  }
});

test('feet keep pace with the body while walking', () => {
  const gait = new Gait();
  let bodyX = 0;
  const speed = 0.5;
  gait.reset(bodyX, 1);
  const dt = 1 / 60;
  for (let i = 0; i < 600; i++) {
    bodyX += speed * dt;
    gait.update(dt, bodyX, speed, 1);
  }
  for (const f of gait.feet) {
    assert.ok(Math.abs(f.x - bodyX) < gait.stepLength * 1.5, `foot lagged: ${f.x} vs body ${bodyX}`);
  }
});

test('plant events fire while walking', () => {
  const gait = new Gait();
  let bodyX = 0;
  gait.reset(bodyX, 1);
  const dt = 1 / 60;
  let plants = 0;
  for (let i = 0; i < 600; i++) {
    bodyX += 0.5 * dt;
    plants += gait.update(dt, bodyX, 0.5, 1).length;
  }
  assert.ok(plants >= 8, `expected a stream of foot plants, got ${plants}`);
});

test('stopping settles both feet to the ground', () => {
  const gait = new Gait();
  let bodyX = 0;
  gait.reset(bodyX, 1);
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) {
    bodyX += 0.5 * dt;
    gait.update(dt, bodyX, 0.5, 1);
  }
  for (let i = 0; i < 120; i++) gait.update(dt, bodyX, 0, 1);
  for (const f of gait.feet) {
    assert.equal(f.lift, 0);
    assert.ok(f.planted);
  }
  assert.ok(Math.abs(gait.roll) < 1e-3);
});
