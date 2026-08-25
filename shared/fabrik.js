// FABRIK IK chain solver for the neck, with rest-pose blending.
// Points are {x, y}. The root stays fixed; the tip chases the target.
// After solving, the pose is blended toward an authored rest pose by
// `stiffness` (0..1) and segment lengths are re-normalized — this is what
// keeps the neck reading as a goose neck instead of a floppy hose.

export function chainLengths(points) {
  const lengths = [];
  for (let i = 1; i < points.length; i++) {
    lengths.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return lengths;
}

export function totalLength(lengths) {
  return lengths.reduce((a, b) => a + b, 0);
}

export function solveFabrik(points, lengths, target, { iterations = 8, tolerance = 1e-4 } = {}) {
  const n = points.length;
  const root = { x: points[0].x, y: points[0].y };
  const reach = totalLength(lengths);
  const rootToTarget = Math.hypot(target.x - root.x, target.y - root.y);

  if (rootToTarget >= reach) {
    // Target out of reach: straighten toward it.
    const dx = (target.x - root.x) / (rootToTarget || 1);
    const dy = (target.y - root.y) / (rootToTarget || 1);
    let ax = root.x, ay = root.y;
    for (let i = 1; i < n; i++) {
      ax += dx * lengths[i - 1];
      ay += dy * lengths[i - 1];
      points[i].x = ax;
      points[i].y = ay;
    }
    return points;
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Backward: tip to target, walk to root.
    points[n - 1].x = target.x;
    points[n - 1].y = target.y;
    for (let i = n - 2; i >= 0; i--) {
      const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y) || 1;
      const r = lengths[i] / d;
      points[i].x = points[i + 1].x + (points[i].x - points[i + 1].x) * r;
      points[i].y = points[i + 1].y + (points[i].y - points[i + 1].y) * r;
    }
    // Forward: root back to anchor, walk to tip.
    points[0].x = root.x;
    points[0].y = root.y;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) || 1;
      const r = lengths[i - 1] / d;
      points[i].x = points[i - 1].x + (points[i].x - points[i - 1].x) * r;
      points[i].y = points[i - 1].y + (points[i].y - points[i - 1].y) * r;
    }
    const err = Math.hypot(points[n - 1].x - target.x, points[n - 1].y - target.y);
    if (err < tolerance) break;
  }
  return points;
}

// Clamp the bend between consecutive segments to maxBend radians (and the
// first segment to maxRootBend away from refDir). Prevents kinks and the
// "disconnected neck" look at extreme reach angles. Lengths are preserved.
export function limitBends(points, lengths, { maxBend = 0.62, maxRootBend = 0.95, refDir = { x: 0, y: -1 } } = {}) {
  const n = points.length;
  let prevAngle = Math.atan2(refDir.y, refDir.x);
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    let angle = Math.atan2(dy, dx);
    const limit = i === 1 ? maxRootBend : maxBend;
    let delta = angle - prevAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (delta > limit) angle = prevAngle + limit;
    else if (delta < -limit) angle = prevAngle - limit;
    points[i].x = points[i - 1].x + Math.cos(angle) * lengths[i - 1];
    points[i].y = points[i - 1].y + Math.sin(angle) * lengths[i - 1];
    prevAngle = angle;
  }
  return points;
}

// Blend solved pose toward rest pose, then restore segment lengths from the root.
export function blendToRest(points, rest, lengths, stiffness) {
  if (stiffness <= 0) return points;
  const n = points.length;
  for (let i = 1; i < n; i++) {
    points[i].x += (rest[i].x - points[i].x) * stiffness;
    points[i].y += (rest[i].y - points[i].y) * stiffness;
  }
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const d = Math.hypot(dx, dy) || 1;
    const r = lengths[i - 1] / d;
    points[i].x = points[i - 1].x + dx * r;
    points[i].y = points[i - 1].y + dy * r;
  }
  return points;
}
