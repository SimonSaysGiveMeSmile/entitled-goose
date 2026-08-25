// Analytic 2-bone leg IK. Bird legs: the visible joint (ankle, reads as a
// backward "knee") bends toward -x in goose-local space (bendSign = -1 when
// the goose faces +x).
export function twoBoneIK(hip, foot, l1, l2, bendSign = -1) {
  let dx = foot.x - hip.x;
  let dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  const minD = Math.abs(l1 - l2) + 1e-5;
  const maxD = l1 + l2 - 1e-5;
  if (d < 1e-6) { dx = 0; dy = 1; d = 1e-6; }
  const cd = Math.min(Math.max(d, minD), maxD);
  const ux = dx / d;
  const uy = dy / d;
  // Angle at the hip between hip→foot and hip→knee.
  const cosA = (cd * cd + l1 * l1 - l2 * l2) / (2 * cd * l1);
  const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const s = -Math.sin(a) * bendSign; // y+ is down, so flip to make -1 read as "backward"
  const c = Math.cos(a);
  return {
    x: hip.x + (ux * c - uy * s) * l1,
    y: hip.y + (ux * s + uy * c) * l1,
  };
}
