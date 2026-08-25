// Critically damped spring (exact integration), parameterized by halflife.
// Returns [newValue, newVelocity]. Halflife = seconds to close ~half the gap.
export function springDamp(x, v, target, halflife, dt) {
  const lambda = (2 * Math.LN2) / Math.max(halflife, 1e-4);
  const j0 = x - target;
  const j1 = v + j0 * lambda;
  const e = Math.exp(-lambda * dt);
  const nx = target + (j0 + j1 * dt) * e;
  const nv = (j1 - lambda * (j0 + j1 * dt)) * e;
  return [nx, nv];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}
