// World-space VFX: white honk lines bursting from the beak, and fading
// footprints stamped on foot-plant events (ring buffer, short fade so the
// trail expires before it hits the follow-window edge).

export class Vfx {
  constructor() {
    this.honkLines = [];
    this.footprints = [];
  }

  spawnHonk(beak, dir) {
    this.honkLines.push({ x: beak.x, y: beak.y, dir, t: 0 });
  }

  stampFoot(worldX, groundY, dir) {
    this.footprints.push({ x: worldX, y: groundY, dir, t: 0 });
    if (this.footprints.length > 64) this.footprints.shift();
  }

  update(dt) {
    for (const h of this.honkLines) h.t += dt;
    this.honkLines = this.honkLines.filter((h) => h.t < 0.16);
    for (const f of this.footprints) f.t += dt;
    this.footprints = this.footprints.filter((f) => f.t < 3.2);
  }

  // ctx is in raw screen space translated by -windowOrigin (1 unit = 1 px).
  drawFootprints(ctx) {
    for (const f of this.footprints) {
      const alpha = 0.16 * (1 - f.t / 3.2);
      ctx.fillStyle = `rgba(200, 110, 40, ${alpha.toFixed(3)})`;
      ctx.save();
      ctx.translate(f.x, f.y - 1);
      ctx.scale(f.dir, 1);
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(12, -3);
      ctx.lineTo(13, 0);
      ctx.lineTo(12, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawHonkLines(ctx) {
    for (const h of this.honkLines) {
      const u = h.t / 0.16;
      const alpha = 0.9 * (1 - u);
      const start = 6 + u * 14;
      const len = 10 + u * 22;
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineCap = 'round';
      for (const spread of [-0.30, 0, 0.30]) {
        ctx.lineWidth = 3.4 * (1 - u * 0.5) * (spread === 0 ? 1.15 : 0.9);
        ctx.beginPath();
        ctx.moveTo(h.x + h.dir * Math.cos(spread) * start, h.y + Math.sin(spread) * start);
        ctx.lineTo(h.x + h.dir * Math.cos(spread) * (start + len), h.y + Math.sin(spread) * (start + len));
        ctx.stroke();
      }
    }
  }
}
