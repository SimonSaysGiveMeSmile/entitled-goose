// The goose, drawn as flat vector paths per docs/DESIGN.md §2.
// Local space: origin at the ground under the body center, +x = forward
// (authored facing right; the caller flips via ctx.scale for left), y+ down.
// Units: standing height = 1.0. No outlines anywhere; separation by value only.

export const PALETTE = {
  body: '#FBFBF9', // site body white
  bodyShade: 'rgba(226, 225, 219, 0.6)', // site #e2e1db @ .6 belly patch
  orange: '#F58731',
  orangeFar: '#DF7A2B',
  eye: '#272725',
  honkLine: '#FFFFFF',
  shadow: 'rgba(39, 39, 37, 0.10)', // site shadow ink
};

// The landing-page goose SVG (220x185 viewBox), converted 1:1 into local
// units: divide site coords by 149.5 (feet y=177 minus head top y=27.5),
// x-centered on site x=96. Standing height = 1.0 exactly.
export const GEO = {
  neckRoot: { x: 0.281, y: -0.408 }, // site shoulder (138,116)
  headRx: 0.104, // MUST match the drawHead ellipse (site rx 15.5)
  headRy: 0.084, // site ry 12.5
  hipNear: { x: 0.045, y: -0.167 },
  hipFar: { x: -0.005, y: -0.172 },
  legUpper: 0.10,
  legLower: 0.10,
  restHead: { x: 0.355, y: -0.916 }, // site rest head (149,40)
};

// Neck rest pose: even samples of the site's authored rest quadratic
// (M138,116 Q146,78 148,44) — tall, nearly upright, gently forward.
export function neckRestPose(bodyDY = 0) {
  const r = GEO.neckRoot;
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + 0.020, y: r.y - 0.101 },
    { x: r.x + 0.036, y: r.y - 0.199 },
    { x: r.x + 0.050, y: r.y - 0.296 },
    { x: r.x + 0.060, y: r.y - 0.390 },
    { x: r.x + 0.067, y: r.y - 0.482 },
  ];
  for (const p of pts) p.y += bodyDY;
  return pts;
}

function bodyPath(ctx, dy, tailWag) {
  // The site body, converted 1:1: chest high at right, swooping belly, long
  // rising sweep to the raised tail point at back-left.
  const ty = -0.689 + dy + tailWag; // tail spike tip (site 22,74)
  ctx.beginPath();
  ctx.moveTo(0.401, -0.381 + dy); // chest top (site 156,120)
  ctx.bezierCurveTo(0.401, -0.234 + dy, 0.241, -0.140 + dy, 0.054, -0.140 + dy); // chest → belly
  ctx.bezierCurveTo(-0.134, -0.140 + dy, -0.294, -0.194 + dy, -0.348, -0.301 + dy); // belly rear
  ctx.bezierCurveTo(-0.401, -0.408 + dy, -0.441, -0.542 + dy, -0.495, ty); // under-tail → spike
  ctx.bezierCurveTo(-0.348, -0.595 + dy, -0.187, -0.595 + dy, 0.000, -0.582 + dy); // back
  ctx.bezierCurveTo(0.214, -0.569 + dy, 0.401, -0.528 + dy, 0.401, -0.381 + dy); // to chest top
  ctx.closePath();
}

function drawLeg(ctx, hip, knee, ankle, color, width = 0.047) { // site stroke 7
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();
}

function drawFoot(ctx, ankle, droop, color) {
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(droop);
  ctx.fillStyle = color;
  ctx.beginPath();
  // Webbed triangle with three blunt toes on the leading edge.
  ctx.moveTo(-0.030, 0.004);
  ctx.quadraticCurveTo(-0.028, -0.016, -0.006, -0.018);
  ctx.lineTo(0.012, -0.014);
  ctx.quadraticCurveTo(0.062, -0.030, 0.108, -0.024);
  ctx.quadraticCurveTo(0.100, -0.015, 0.106, -0.010); // toe notch 1
  ctx.quadraticCurveTo(0.098, -0.002, 0.104, 0.002); // toe notch 2
  ctx.quadraticCurveTo(0.060, 0.006, 0.010, 0.005);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Neck as a stroked path with round caps — the landing page's exact
// construction (stroke-width 16, linecap round). The chain is extended one
// phantom point INTO the body so the base cap stays buried.
function drawNeck(ctx, pts, color) {
  const first = pts[0];
  // The phantom root anchors INTO the body interior (down-back of the neck
  // root) rather than opposite the first segment: on a downward look the
  // segment-opposite phantom pointed UP and poked a stub past the shoulder
  // silhouette. A fixed interior anchor stays buried at every reach angle
  // and gives the base a consistent anatomical emergence direction.
  const rooted = [
    { x: first.x - 0.07, y: first.y + 0.05 },
    ...pts,
  ];
  // A ribbon polygon's flat end edge can poke past the rotated head at
  // extreme angles (lowest head position). A round line cap is a semicircle
  // centered on the stroke end, and the end is TRIMMED 0.014 short of the
  // chain tip so cap radius (0.0535) + head-center offset always stays
  // inside the drawn head ellipse (0.104x0.084) at any rotation.
  const samples = sampleCatmullRom(rooted, 20);
  const n = samples.length;
  const end = samples[n - 1];
  const prev2 = samples[n - 2];
  const el = Math.hypot(end.x - prev2.x, end.y - prev2.y) || 1;
  end.x -= ((end.x - prev2.x) / el) * 0.014;
  end.y -= ((end.y - prev2.y) / el) * 0.014;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.107; // site stroke-width 16
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(samples[i].x, samples[i].y);
  ctx.stroke();
}

function sampleCatmullRom(pts, per) {
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const steps = Math.max(2, Math.round(per / (pts.length - 1)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(crPoint(P[i - 1], P[i], P[i + 1], P[i + 2], t));
    }
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

function crPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function drawHead(ctx, head, opts) {
  const { angle, beakOpen, eyelid, faceCamera } = opts;
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(angle);

  // The site head, converted 1:1: one beak shape hinged UNDER the skull
  // (site g-beak, translate(13,-2), rotate(-open*15deg)), then the skull
  // ellipse over it, then a single eye. faceCamera foreshortens the beak.
  const fc = 1 - 0.40 * faceCamera;
  ctx.save();
  ctx.translate(0.087 * fc, -0.013);
  ctx.rotate(-beakOpen * 0.26);
  ctx.fillStyle = PALETTE.orange;
  ctx.beginPath();
  ctx.moveTo(0, -0.040);
  ctx.quadraticCurveTo(0.134 * fc, -0.033, 0.174 * fc, 0.007);
  ctx.quadraticCurveTo(0.127 * fc, 0.047, 0, 0.040);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Skull (site ellipse rx 15.5 ry 12.5).
  ctx.fillStyle = PALETTE.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.104 * (1 + 0.06 * faceCamera), 0.084, 0, 0, Math.PI * 2);
  ctx.fill();

  // Single eye always — a two-eyed frontal goose is lowkey creepy. The ¾
  // turn reads through the foreshortened beak instead. (site: r 2.6 @ 4,-4)
  const eyeY = -0.027;
  const ex = 0.027 - 0.030 * faceCamera;
  ctx.fillStyle = PALETTE.eye;
  if (eyelid > 0.6) {
    ctx.fillRect(ex - 0.014, eyeY - 0.002, 0.028, 0.005); // flat closed-eye line
  } else {
    ctx.beginPath();
    ctx.arc(ex, eyeY, 0.0174, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEllipsisBubble(ctx, head) {
  const x = head.x + 0.10;
  const y = head.y - 0.16;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.roundRect(x - 0.075, y - 0.048, 0.15, 0.095, 0.045);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 0.04, y + 0.044);
  ctx.lineTo(x - 0.065, y + 0.085);
  ctx.lineTo(x - 0.005, y + 0.046);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8A8A8A';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(x + i * 0.035, y, 0.0125, 0, Math.PI * 2);
    ctx.fill();
  }
}

// state: { bodyDY, roll, tailWag, neckPts, head:{x,y}, headAngle, beakOpen,
//          eyelid, faceCamera, showBubble, legs:{near:{hip,knee,ankle,droop},
//          far:{...}}, shadowW }
export function drawGoose(ctx, state) {
  // Contact shadow (site ellipse cx100 cy176 rx72 ry5).
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(0.027, -0.006, state.shadowW ?? 0.48, 0.033, 0, 0, Math.PI * 2);
  ctx.fill();

  // Far leg + foot (darker orange).
  if (state.legs) {
    const f = state.legs.far;
    drawLeg(ctx, f.hip, f.knee, f.ankle, PALETTE.orangeFar);
    drawFoot(ctx, f.ankle, f.droop, PALETTE.orangeFar);
  }

  // Body with weight-shift roll — FLAT site fill plus the site's single
  // belly shade patch (no gradient: flat fill is what makes the neck-over-
  // body join invisible, exactly like the SVG).
  ctx.save();
  ctx.rotate(state.roll * 0.5);
  bodyPath(ctx, state.bodyDY, state.tailWag);
  ctx.fillStyle = PALETTE.body;
  ctx.fill();
  // Site shade patch: M60,144 C80,154 110,156 128,150 C110,156 76,156 60,144
  ctx.fillStyle = PALETTE.bodyShade;
  ctx.beginPath();
  ctx.moveTo(-0.241, -0.221 + state.bodyDY);
  ctx.bezierCurveTo(-0.107, -0.154 + state.bodyDY, 0.094, -0.140 + state.bodyDY, 0.214, -0.181 + state.bodyDY);
  ctx.bezierCurveTo(0.094, -0.140 + state.bodyDY, -0.134, -0.140 + state.bodyDY, -0.241, -0.221 + state.bodyDY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Neck OVER the body, head over the neck — the site's z-order. Flat same-
  // color fills make every overlap seamless.
  drawNeck(ctx, state.neckPts, PALETTE.body);
  drawHead(ctx, state.head, state);

  if (state.showBubble) drawEllipsisBubble(ctx, state.head);

  // Near leg + foot.
  if (state.legs) {
    const nleg = state.legs.near;
    drawLeg(ctx, nleg.hip, nleg.knee, nleg.ankle, PALETTE.orange);
    drawFoot(ctx, nleg.ankle, nleg.droop, PALETTE.orange);
  }
}
