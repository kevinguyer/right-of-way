import type { Camera } from './renderer';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'puff' | 'ring' | 'text';
  text?: string;
}

/** Lightweight world-space particle system: honk puffs, steam, score dings. */
export class Particles {
  private items: Particle[] = [];

  honk(x: number, y: number, strong: boolean): void {
    const n = strong ? 3 : 2;
    for (let i = 0; i < n; i++) {
      this.items.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0.55 + i * 0.12,
        size: strong ? 2.2 : 1.6,
        color: strong ? 'rgba(255,77,77,' : 'rgba(255,204,51,',
        kind: 'ring',
      });
    }
  }

  skid(x: number, y: number): void {
    this.items.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.5,
      size: 1.4,
      color: 'rgba(230,237,243,',
      kind: 'ring',
    });
  }

  steam(x: number, y: number): void {
    this.items.push({
      x: x + (Math.random() - 0.5) * 0.8,
      y,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -1.2,
      life: 0,
      maxLife: 1.1,
      size: 0.7,
      color: 'rgba(230,237,243,',
      kind: 'puff',
    });
  }

  burst(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * 4,
        vy: Math.sin(a) * 4,
        life: 0,
        maxLife: 0.6,
        size: 0.5,
        color: 'rgba(255,77,77,',
        kind: 'puff',
      });
    }
  }

  ding(x: number, y: number, text: string, color = 'rgba(61,220,132,'): void {
    this.items.push({ x, y, vx: 0, vy: -2.5, life: 0, maxLife: 0.8, size: 1, color, kind: 'text', text });
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.items = this.items.filter((p) => p.life < p.maxLife);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const p of this.items) {
      const u = p.life / p.maxLife;
      const alpha = 1 - u;
      const px = cam.cx + p.x * cam.scale;
      const py = cam.cy + p.y * cam.scale;
      if (p.kind === 'ring') {
        ctx.strokeStyle = `${p.color}${(alpha * 0.9).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, (0.6 + u * p.size * 2.2) * cam.scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'puff') {
        ctx.fillStyle = `${p.color}${(alpha * 0.7).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, (p.size + u * 0.8) * cam.scale * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `${p.color}${alpha.toFixed(3)})`;
        ctx.font = `bold ${Math.max(10, cam.scale * 1.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text ?? '', px, py);
      }
    }
  }

  clear(): void {
    this.items = [];
  }
}
