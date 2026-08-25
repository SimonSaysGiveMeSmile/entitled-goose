// The goose, drawn as flat vector paths per docs/DESIGN.md §2.
// Local space: origin at the ground under the body center, +x = forward
// (authored facing right; the caller flips via ctx.scale for left), y+ down.
// Units: standing height = 1.0. No outlines anywhere; separation by value only.

export const PALETTE = {
  body: '#ECECEC',
  bodyShade: 'rgba(90, 90, 95, 0.07)',
  orange: '#F58731',
  orangeFar: '#DF7A2B',
  mouth: '#FF8829',
  eye: '#272725',
  honkLine: '#FFFFFF',
  shadow: 'rgba(20, 20, 25, 0.10)',
};

export const GEO = {
  neckRoot: { x: 0.15, y: -0.41 },
  neckSegments: 5,
  neckLength: 0.52,
  headRx: 0.075,
  headRy: 0.062,
  hipNear: { x: 0.015, y: -0.175 },
  hipFar: { x: -0.035, y: -0.185 },
  legUpper: 0.105,
  legLower: 0.105,
  restHead: { x: 0.22, y: -0.88 },
};

// Authored neck rest pose (gentle S-curve), root to head base.
export function neckRestPose(bodyDY = 0) {
  const r = GEO.neckRoot;
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + 0.045, y: r.y - 0.10 },
    { x: r.x + 0.055, y: r.y - 0.21 },
    { x: r.x + 0.040, y: r.y - 0.315 },
    { x: r.x + 0.048, y: r.y - 0.415 },
    { x: r.x + 0.070, y: r.y - 0.47 },
  ];
  for (const p of pts) p.y += bodyDY;
  return pts;
}

function bodyPath(ctx, dy, tailWag) {
  // Fat teardrop: deep chest front-bottom sweeping up to a pointed tail spike.
  const ty = -0.545 + dy + tailWag;
  ctx.beginPath();
  ctx.moveTo(0.155, -0.425 + dy); // neck root shoulder
  ctx.bezierCurveTo(0.245, -0.415 + dy, 0.300, -0.340 + dy, 0.290, -0.255 + dy); // chest
  ctx.bezierCurveTo(0.280, -0.155 + dy, 0.185, -0.105 + dy, 0.050, -0.105 + dy); // belly front
  ctx.bezierCurveTo(-0.075, -0.105 + dy, -0.185, -0.135 + dy, -0.240, -0.205 + dy); // belly rear
  ctx.bezierCurveTo(-0.300, -0.285 + dy, -0.345, -0.435 + dy, -0.375, ty); // under-tail to spike
  ctx.bezierCurveTo(-0.290, -0.500 + dy, -0.175, -0.470 + dy, -0.045, -0.465 + dy); // back
  ctx.bezierCurveTo(0.035, -0.462 + dy, 0.105, -0.448 + dy, 0.155, -0.425 + dy); // to shoulder
  ctx.closePath();
}

function drawLeg(ctx, hip, knee, ankle, color, width = 0.036) {
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

// Smooth ribbon through neck chain points with a tapered width profile.
function drawNeck(ctx, pts, color) {
  const samples = sampleCatmullRom(pts, 18);
  const n = samples.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const u = i / (n - 1);
    const hw = (0.078 - 0.020 * u) * 0.5; // taper base → head
    left.push({ x: p.x - ty * hw, y: p.y + tx * hw });
    right.push({ x: p.x + ty * hw, y: p.y - tx * hw });
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();
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

  const beakLen = 0.115 * (1 - 0.55 * faceCamera);
  const bx = 0.045; // beak root x relative to head center

  // Open-mouth interior (visible only when beak opens).
  if (beakOpen > 0.05) {
    ctx.fillStyle = PALETTE.mouth;
    ctx.beginPath();
    ctx.moveTo(bx, -0.006);
    ctx.lineTo(bx + beakLen * 0.92, -0.004 - beakOpen * 0.052);
    ctx.lineTo(bx + beakLen * 0.86, 0.010 + beakOpen * 0.062);
    ctx.closePath();
    ctx.fill();
  }

  // Upper beak: rounded wedge, tip slightly downturned.
  ctx.fillStyle = PALETTE.orange;
  ctx.save();
  ctx.translate(bx, -0.004);
  ctx.rotate(-beakOpen * 0.42);
  ctx.beginPath();
  ctx.moveTo(-0.012, -0.026);
  ctx.quadraticCurveTo(beakLen * 0.72, -0.030, beakLen, 0.004);
  ctx.quadraticCurveTo(beakLen * 0.7, 0.013, -0.012, 0.012);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Lower beak.
  ctx.save();
  ctx.translate(bx, 0.008);
  ctx.rotate(beakOpen * 0.55);
  ctx.beginPath();
  ctx.moveTo(-0.010, -0.002);
  ctx.quadraticCurveTo(beakLen * 0.66, -0.002, beakLen * 0.86, 0.006);
  ctx.quadraticCurveTo(beakLen * 0.6, 0.022, -0.010, 0.018);
  ctx.closePath();
  ctx.fill();

  // Head: slightly egg-shaped, long axis horizontal.
  ctx.restore();
  ctx.fillStyle = PALETTE.body;
  ctx.beginPath();
  ctx.ellipse(-0.012, -0.006, 0.078 * (1 + 0.06 * faceCamera), 0.062, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye(s): tiny dot, high and forward, no highlight.
  const eyeY = -0.020;
  const drawEye = (ex) => {
    ctx.fillStyle = PALETTE.eye;
    if (eyelid > 0.6) {
      ctx.fillRect(ex - 0.010, eyeY - 0.001, 0.020, 0.003); // flat closed-eye line
    } else {
      ctx.beginPath();
      ctx.arc(ex, eyeY, 0.0115, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawEye(0.012 - 0.020 * faceCamera);
  if (faceCamera > 0.35) drawEye(-0.052);
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
  // Contact shadow.
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(-0.02, -0.012, state.shadowW ?? 0.30, 0.032, 0, 0, Math.PI * 2);
  ctx.fill();

  // Far leg + foot (darker orange).
  if (state.legs) {
    const f = state.legs.far;
    drawLeg(ctx, f.hip, f.knee, f.ankle, PALETTE.orangeFar);
    drawFoot(ctx, f.ankle, f.droop, PALETTE.orangeFar);
  }

  // Body with weight-shift roll.
  ctx.save();
  ctx.rotate(state.roll * 0.5);
  bodyPath(ctx, state.bodyDY, state.tailWag);
  ctx.fillStyle = PALETTE.body;
  ctx.fill();
  // One soft shade pass, clipped to the body: darker toward belly/rear.
  ctx.save();
  bodyPath(ctx, state.bodyDY, state.tailWag);
  ctx.clip();
  const g = ctx.createLinearGradient(0.1, -0.5 + state.bodyDY, -0.15, -0.1 + state.bodyDY);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, PALETTE.bodyShade);
  ctx.fillStyle = g;
  ctx.fillRect(-0.5, -0.7, 1.0, 0.7);
  ctx.restore();
  ctx.restore();

  // Neck (same fill as body so the join is seamless), then head.
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
