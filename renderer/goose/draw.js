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
  neckRoot: { x: 0.165, y: -0.40 },
  neckSegments: 5,
  neckLength: 0.52,
  headRx: 0.075,
  headRy: 0.062,
  hipNear: { x: 0.015, y: -0.175 },
  hipFar: { x: -0.035, y: -0.185 },
  legUpper: 0.105,
  legLower: 0.105,
  restHead: { x: 0.13, y: -0.78 },
};

// Authored neck rest pose: an upright S that settles slightly BACKWARD over
// the body (how a relaxed goose actually carries it), head barely leading.
export function neckRestPose(bodyDY = 0) {
  const r = GEO.neckRoot;
  // Segment lengths taper toward the head: long and mobile at the base,
  // short and stiff at the skull.
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + 0.014, y: r.y - 0.092 },
    { x: r.x + 0.002, y: r.y - 0.180 },
    { x: r.x - 0.010, y: r.y - 0.260 },
    { x: r.x + 0.003, y: r.y - 0.328 },
    { x: r.x + 0.018, y: r.y - 0.364 },
  ];
  for (const p of pts) p.y += bodyDY;
  return pts;
}

function bodyPath(ctx, dy, tailWag) {
  // Long, low teardrop: deep chest front-bottom, near-horizontal back sweeping
  // up to a sharp raised tail spike — the #2 silhouette identifier.
  const ty = -0.575 + dy + tailWag;
  ctx.beginPath();
  ctx.moveTo(0.175, -0.415 + dy); // neck root shoulder
  ctx.bezierCurveTo(0.280, -0.405 + dy, 0.330, -0.330 + dy, 0.318, -0.240 + dy); // chest
  ctx.bezierCurveTo(0.305, -0.145 + dy, 0.195, -0.100 + dy, 0.045, -0.100 + dy); // belly front
  ctx.bezierCurveTo(-0.095, -0.100 + dy, -0.225, -0.130 + dy, -0.285, -0.200 + dy); // belly rear
  ctx.bezierCurveTo(-0.345, -0.270 + dy, -0.400, -0.470 + dy, -0.430, ty); // under-tail to spike tip
  ctx.bezierCurveTo(-0.330, -0.508 + dy, -0.205, -0.462 + dy, -0.060, -0.450 + dy); // back (near-flat)
  ctx.bezierCurveTo(0.040, -0.443 + dy, 0.120, -0.432 + dy, 0.175, -0.415 + dy); // to shoulder
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
// The chain is extended one phantom point INTO the body so the base never
// shows a raw edge, and the tip gets a round cap that buries itself in the
// head — no visible seams at any reach angle.
function drawNeck(ctx, pts, color) {
  const first = pts[0];
  const second = pts[1];
  const dl = Math.hypot(second.x - first.x, second.y - first.y) || 1;
  const rooted = [
    { x: first.x - ((second.x - first.x) / dl) * 0.09, y: first.y - ((second.y - first.y) / dl) * 0.09 },
    ...pts,
  ];
  const samples = sampleCatmullRom(rooted, 20);
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
    const hw = (0.072 - 0.018 * u) * 0.5; // taper base → head
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

  // Round cap at the tip, bridging into the head.
  const tip = samples[n - 1];
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 0.030, 0, Math.PI * 2);
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

  const beakLen = 0.125 * (1 - 0.40 * faceCamera);
  const bx = 0.040; // beak hinge x relative to head center (shared pivot)
  const upperRot = -beakOpen * 0.30;
  const lowerRot = beakOpen * 0.40;

  // Mouth interior: strictly between the two mandible lines, shorter than
  // the beaks so it can never poke past them.
  if (beakOpen > 0.12) {
    ctx.fillStyle = PALETTE.mouth;
    ctx.beginPath();
    ctx.moveTo(bx + 0.004, 0.004);
    ctx.lineTo(bx + Math.cos(upperRot) * beakLen * 0.78, 0.004 + Math.sin(upperRot) * beakLen * 0.78);
    ctx.lineTo(bx + Math.cos(lowerRot) * beakLen * 0.70, 0.004 + Math.sin(lowerRot) * beakLen * 0.70);
    ctx.closePath();
    ctx.fill();
  }

  // Both mandibles hinge on the SAME pivot so they never cross or overlap
  // awkwardly. Closed, the lower nests fully under the upper.
  ctx.fillStyle = PALETTE.orange;

  // Lower mandible: thin, shorter, tucked under.
  ctx.save();
  ctx.translate(bx, 0.004);
  ctx.rotate(lowerRot);
  ctx.beginPath();
  ctx.moveTo(-0.008, 0.000);
  ctx.quadraticCurveTo(beakLen * 0.62, 0.000, beakLen * 0.82, 0.005);
  ctx.quadraticCurveTo(beakLen * 0.55, 0.016, -0.008, 0.013);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Upper bill: flat top line, blunt tip, slight downturn.
  ctx.save();
  ctx.translate(bx, 0.004);
  ctx.rotate(upperRot);
  ctx.beginPath();
  ctx.moveTo(-0.012, -0.026);
  ctx.quadraticCurveTo(beakLen * 0.70, -0.028, beakLen * 0.96, -0.012);
  ctx.quadraticCurveTo(beakLen * 1.04, -0.002, beakLen * 0.92, 0.004);
  ctx.quadraticCurveTo(beakLen * 0.6, 0.008, -0.012, 0.006);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Head: slightly egg-shaped, long axis horizontal.
  ctx.fillStyle = PALETTE.body;
  ctx.beginPath();
  // Smaller egg-shaped head, long axis horizontal ("real goose, not mascot").
  ctx.ellipse(-0.014, -0.006, 0.072 * (1 + 0.06 * faceCamera), 0.056, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye(s): tiny dot, high and forward, no highlight — all expressiveness
  // lives in the pose, none in the face.
  const eyeY = -0.022;
  const drawEye = (ex) => {
    ctx.fillStyle = PALETTE.eye;
    if (eyelid > 0.6) {
      ctx.fillRect(ex - 0.008, eyeY - 0.001, 0.016, 0.003); // flat closed-eye line
    } else {
      ctx.beginPath();
      ctx.arc(ex, eyeY, 0.0085, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // Single eye always — a two-eyed frontal goose is lowkey creepy. The ¾ turn
  // reads through the foreshortened beak instead.
  drawEye(0.014 - 0.020 * faceCamera);
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

  // Neck UNDER the body: the breast occludes the base, so the join is
  // seamless at every roll and reach angle — a neck drawn on top shows as a
  // flat band across the body's shade gradient and a loose seam at the root.
  drawNeck(ctx, state.neckPts, PALETTE.body);

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

  drawHead(ctx, state.head, state);

  if (state.showBubble) drawEllipsisBubble(ctx, state.head);

  // Near leg + foot.
  if (state.legs) {
    const nleg = state.legs.near;
    drawLeg(ctx, nleg.hip, nleg.knee, nleg.ankle, PALETTE.orange);
    drawFoot(ctx, nleg.ankle, nleg.droop, PALETTE.orange);
  }
}
