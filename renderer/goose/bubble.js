// Comic speech bubble that follows a character. Reusable: construct with an
// anchor function returning {x, y, facing} in world px (for the goose: the
// head), and it rides along as the character moves. Messages queue; each pops
// in, holds long enough to read, and fades out.

const FONT = '14px -apple-system, "Segoe UI", system-ui, sans-serif';
const MAX_WIDTH = 210;
const PAD = 12;

export class SpeechBubble {
  constructor(anchorFn) {
    this.anchorFn = anchorFn;
    this.queue = [];
    this.current = null; // { lines, w, h, t, duration }
  }

  say(text) {
    if (this.queue.length >= 3) return; // an entitled goose still shouldn't spam
    this.queue.push(String(text));
  }

  get active() {
    return this.current !== null || this.queue.length > 0;
  }

  // World-space rect currently occupied (for dirty-rect clearing), or null.
  bounds() {
    const c = this.current;
    if (!c) return null;
    const a = this.anchorFn();
    const bx = a.x + (a.facing || 1) * 26;
    const by = a.y - 58 - c.h / 2;
    return {
      x0: bx - c.w / 2 - 12,
      y0: by - c.h / 2 - 12,
      x1: bx + c.w / 2 + 12,
      y1: by + c.h / 2 + 48, // tail reaches down toward the anchor
    };
  }

  update(dt, measureCtx) {
    if (!this.current && this.queue.length) {
      const text = this.queue.shift();
      measureCtx.font = FONT;
      const lines = wrap(measureCtx, text, MAX_WIDTH);
      const w = Math.min(
        MAX_WIDTH,
        Math.max(...lines.map((l) => measureCtx.measureText(l).width))
      ) + PAD * 2;
      const h = lines.length * 18 + PAD * 2;
      this.current = { lines, w, h, t: 0, duration: 2.2 + text.length * 0.045 };
    }
    if (this.current) {
      this.current.t += dt;
      if (this.current.t >= this.current.duration) this.current = null;
    }
  }

  // ctx must be in world space (screen px).
  draw(ctx) {
    const c = this.current;
    if (!c) return;
    const a = this.anchorFn();

    // Pop-in / fade-out envelope.
    const inT = Math.min(1, c.t / 0.16);
    const outT = Math.min(1, (c.duration - c.t) / 0.20);
    const pop = 1 - (1 - inT) * (1 - inT); // ease-out
    const alpha = Math.min(inT * 2, outT);

    // Sits well above the head, on the side the character faces.
    const bx = a.x + (a.facing || 1) * 26;
    const by = a.y - 58 - c.h / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bx, by);
    ctx.scale(pop, pop);

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 12);
    ctx.fill();
    ctx.stroke();

    // Tail pointing back toward the anchor (longer to bridge the raised gap).
    const tailX = -(a.facing || 1) * Math.min(c.w * 0.28, 40);
    ctx.beginPath();
    ctx.moveTo(tailX - 8, c.h / 2 - 1);
    ctx.lineTo(tailX + (a.facing || 1) * -10, c.h / 2 + 34);
    ctx.lineTo(tailX + 8, c.h / 2 - 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#3A3A38';
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    c.lines.forEach((line, i) => {
      ctx.fillText(line, 0, -c.h / 2 + PAD + i * 18);
    });
    ctx.restore();
  }
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const probe = line ? line + ' ' + word : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}
