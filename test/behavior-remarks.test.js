import test from 'node:test';
import assert from 'node:assert/strict';
import { Behavior } from '../renderer/goose/behavior.js';

const makeBehavior = () => new Behavior({
  animator: {},
  workArea: { x: 0, y: 0, width: 1440, height: 900 },
  events: {},
  phrases: ['honk.', 'bread?'],
});

test('nextPhrase never crashes on a quiet system (only the pool eligible)', () => {
  const b = makeBehavior();
  // Quiet state: no battery, no dwell, no kills, weekday afternoon, tier 0 —
  // every conditional candidate is gated off. Repeated draws used to empty
  // the candidate list via recentRemarks and throw on the second call.
  b.env = { hour: 15, minute: 0, weekday: 3, idleSeconds: 0, batteryPct: null, charging: false, uptimeMinutes: 60 };
  for (let i = 0; i < 50; i++) {
    const p = b.nextPhrase();
    assert.equal(typeof p, 'string');
    assert.ok(p.length > 0);
  }
});

test('nextPhrase keeps rotating state remarks without starving the pool', () => {
  const b = makeBehavior();
  b.env = { hour: 15, minute: 0, weekday: 3, idleSeconds: 0, batteryPct: 20, charging: false, uptimeMinutes: 60 };
  b.stats.tabsClosed = 3;
  for (let i = 0; i < 50; i++) assert.equal(typeof b.nextPhrase(), 'string');
});

test('renderPhrase substitutes every occurrence of every token', () => {
  const b = makeBehavior();
  b.env = { hour: 15, minute: 30, weekday: 3, idleSeconds: 0, uptimeMinutes: 120 };
  b.stats.tabsClosed = 2;
  const p = b.renderPhrase('at {time} and again at {time}; {tabsClosed} and {tabsClosed} tabs.');
  assert.ok(!p.includes('{time}'), p);
  assert.ok(!p.includes('{tabsClosed}'), p);
  assert.ok(/\d{1,2}:\d{2}(am|pm)/.test(p), p);
});
