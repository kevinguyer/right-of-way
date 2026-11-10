import {
  APPROACHES,
  APPROACH_LENGTH,
  FORWARD,
  LANE_WIDTH,
  POCKET_LENGTH,
  TIER_RANK,
  pointAt,
  rightOf,
  type Approach,
  type ApproachLane,
  type Geometry,
  type LaneAssignment,
  type LevelDef,
  type Plan,
  type Simulation,
  type Vehicle,
} from '../sim';
import { Particles } from './particles';

export interface Camera {
  /** Pixels per metre. */
  scale: number;
  /** Screen position of the world origin. */
  cx: number;
  cy: number;
}

export const PALETTE = {
  bg: '#0f1418',
  asphalt: '#232a30',
  asphaltEdge: '#1a2025',
  kerb: '#3a444c',
  grass: '#151b1f',
  line: '#5a6670',
  lineBright: '#8a98a3',
  stop: '#c9d3db',
  text: '#e6edf3',
  textDim: '#8a98a3',
  green: '#3ddc84',
  yellow: '#ffcc33',
  red: '#ff4d4d',
  accent: '#4fd1ff',
  paints: ['#9fb3c8', '#6f8aa6', '#c6cfd8', '#7f9bb5', '#55667a', '#b0bec9'],
  rage: {
    irritated: '#e7c15a',
    angry: '#f08a3c',
    furious: '#ff4d4d',
    blown: '#ff1f1f',
  },
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly particles = new Particles();
  camera: Camera = { scale: 8, cx: 0, cy: 0 };
  dpr = 1;
  width = 0;
  height = 0;
  /** Visible metres horizontally; set by resize. */
  private viewMetres = 56;
  time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number, geometry: Geometry | null): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const roadHalf = geometry ? Math.max(geometry.hx, geometry.hy) : 7;
    // Show the box plus a comfortable amount of approach on the narrow axis.
    this.viewMetres = Math.max(40, roadHalf * 2 + 34);
    const scaleW = width / this.viewMetres;
    const scaleH = height / (this.viewMetres * 1.25);
    this.camera.scale = Math.min(scaleW, scaleH);
    this.camera.cx = width / 2;
    this.camera.cy = height / 2;
  }

  toScreen(x: number, y: number): [number, number] {
    return [this.camera.cx + x * this.camera.scale, this.camera.cy + y * this.camera.scale];
  }

  toWorld(px: number, py: number): [number, number] {
    return [(px - this.camera.cx) / this.camera.scale, (py - this.camera.cy) / this.camera.scale];
  }

  /** Radius in screen px for the phase dial ring. */
  dialRadius(geometry: Geometry): number {
    const r = Math.hypot(geometry.hx, geometry.hy) + 3.2;
    return Math.max(88, r * this.camera.scale);
  }

  draw(
    sim: Simulation | null,
    geometry: Geometry,
    level: LevelDef,
    plan: Plan,
    mode: 'plan' | 'watch' | 'score',
    dt: number,
    highlightLane: { approach: Approach; index: number } | null,
  ): void {
    const ctx = this.ctx;
    this.time += dt;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawRoads(geometry, plan, mode, highlightLane, level);
    if (sim) {
      this.drawSignals(sim, geometry);
      this.drawVehicles(sim);
      this.particles.update(dt);
      this.particles.draw(ctx, this.camera);
      this.drawBacklogBadges(sim, geometry);
    } else {
      this.drawDemandLabels(level, geometry);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------

  private drawRoads(
    g: Geometry,
    plan: Plan,
    mode: 'plan' | 'watch' | 'score',
    highlight: { approach: Approach; index: number } | null,
    level: LevelDef,
  ): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const [ox, oy] = this.toScreen(0, 0);
    const far = Math.max(this.width, this.height) * 2;

    // Road bodies
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(ox - g.hx * s, oy - far, g.hx * 2 * s, far * 2);
    ctx.fillRect(ox - far, oy - g.hy * s, far * 2, g.hy * 2 * s);

    // Kerbs
    ctx.strokeStyle = PALETTE.kerb;
    ctx.lineWidth = 2;
    for (const sign of [-1, 1]) {
      // vertical road edges, stopping at the box
      ctx.beginPath();
      ctx.moveTo(ox + sign * g.hx * s, oy - far);
      ctx.lineTo(ox + sign * g.hx * s, oy - g.hy * s);
      ctx.moveTo(ox + sign * g.hx * s, oy + g.hy * s);
      ctx.lineTo(ox + sign * g.hx * s, oy + far);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox - far, oy + sign * g.hy * s);
      ctx.lineTo(ox - g.hx * s, oy + sign * g.hy * s);
      ctx.moveTo(ox + g.hx * s, oy + sign * g.hy * s);
      ctx.lineTo(ox + far, oy + sign * g.hy * s);
      ctx.stroke();
    }

    // Centre lines (double yellow-ish, muted)
    ctx.strokeStyle = '#7a6a3a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ox, oy - far);
    ctx.lineTo(ox, oy - g.hy * s);
    ctx.moveTo(ox, oy + g.hy * s);
    ctx.lineTo(ox, oy + far);
    ctx.moveTo(ox - far, oy);
    ctx.lineTo(ox - g.hx * s, oy);
    ctx.moveTo(ox + g.hx * s, oy);
    ctx.lineTo(ox + far, oy);
    ctx.stroke();

    // Lane lines (dashed) for roads with >1 lane each way
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3 * s, 3 * s]);
    for (let i = 1; i < g.lanesNS; i++) {
      for (const sign of [-1, 1]) {
        const x = ox + sign * i * LANE_WIDTH * s;
        ctx.beginPath();
        ctx.moveTo(x, oy - far);
        ctx.lineTo(x, oy - g.hy * s);
        ctx.moveTo(x, oy + g.hy * s);
        ctx.lineTo(x, oy + far);
        ctx.stroke();
      }
    }
    for (let i = 1; i < g.lanesEW; i++) {
      for (const sign of [-1, 1]) {
        const y = oy + sign * i * LANE_WIDTH * s;
        ctx.beginPath();
        ctx.moveTo(ox - far, y);
        ctx.lineTo(ox - g.hx * s, y);
        ctx.moveTo(ox + g.hx * s, y);
        ctx.lineTo(ox + far, y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Stop lines and lane arrows per approach
    for (const a of APPROACHES) {
      const f = FORWARD[a];
      const r = rightOf(f);
      const lanesHere = g.lanes[a];
      const n = lanesHere.length;
      // Stop line spans the inbound half of the road.
      const p0 = lanesHere[0].stop;
      const start = { x: p0.x - r.x * LANE_WIDTH * 0.5, y: p0.y - r.y * LANE_WIDTH * 0.5 };
      const end = { x: start.x + r.x * LANE_WIDTH * n, y: start.y + r.y * LANE_WIDTH * n };
      const [sx, sy] = this.toScreen(start.x - f.x * 0.4, start.y - f.y * 0.4);
      const [ex, ey] = this.toScreen(end.x - f.x * 0.4, end.y - f.y * 0.4);
      ctx.strokeStyle = PALETTE.stop;
      ctx.lineWidth = Math.max(2, 0.5 * s);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      for (const lane of lanesHere) {
        if (lane.pocket) this.drawPocketHatch(lane, f, r);
      }
      for (const lane of lanesHere) {
        const assignment = plan.lanes[a][lane.index] ?? lane.assignment;
        const isHl = highlight && highlight.approach === a && highlight.index === lane.index;
        const editable = mode === 'plan' && level.lanesEditable;
        // Arrow marking a few metres back from the line.
        const cx = lane.stop.x - f.x * 6.5;
        const cy = lane.stop.y - f.y * 6.5;
        if (editable) {
          // Tap target plate
          const [px, py] = this.toScreen(lane.stop.x - f.x * 9, lane.stop.y - f.y * 9);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.atan2(f.y, f.x));
          ctx.fillStyle = isHl ? 'rgba(79,209,255,0.28)' : 'rgba(79,209,255,0.10)';
          ctx.strokeStyle = isHl ? PALETTE.accent : 'rgba(79,209,255,0.45)';
          ctx.lineWidth = 1.5;
          roundRect(ctx, -7 * s, -LANE_WIDTH * 0.42 * s, 14 * s, LANE_WIDTH * 0.84 * s, 3);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        this.drawLaneArrows(cx, cy, f, assignment, editable ? PALETTE.text : PALETTE.lineBright);
      }
    }
  }

  /** The unusable part of a pocket lane: hatched, with a taper into the pocket. */
  private drawPocketHatch(lane: ApproachLane, f: { x: number; y: number }, r: { x: number; y: number }): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const entrance = { x: lane.stop.x - f.x * POCKET_LENGTH, y: lane.stop.y - f.y * POCKET_LENGTH };
    const taper = 10;
    const [ex, ey] = this.toScreen(entrance.x - f.x * taper, entrance.y - f.y * taper);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(f.y, f.x));
    const half = (LANE_WIDTH / 2) * s * 0.92;
    const len = (APPROACH_LENGTH - POCKET_LENGTH - taper) * s;
    // Hatched block behind the taper
    ctx.fillStyle = 'rgba(15,20,24,0.55)';
    ctx.fillRect(-len, -half, len, half * 2);
    ctx.strokeStyle = 'rgba(138,152,163,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = -len; x < 0; x += 2.2 * s) {
      ctx.moveTo(x, -half);
      ctx.lineTo(x + half * 2, half);
    }
    ctx.stroke();
    // Taper
    ctx.fillStyle = 'rgba(15,20,24,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    const sideSign = lane.assignment === 'L' ? 1 : -1; // taper opens towards the feeder lane
    ctx.lineTo(taper * s, sideSign * half);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PALETTE.lineBright;
    ctx.beginPath();
    ctx.moveTo(0, -sideSign * half);
    ctx.lineTo(taper * s, sideSign * half);
    ctx.stroke();
    ctx.restore();
    void r;
  }

  private drawLaneArrows(
    wx: number,
    wy: number,
    f: { x: number; y: number },
    assignment: LaneAssignment,
    color: string,
  ): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const [px, py] = this.toScreen(wx, wy);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(f.y, f.x) - Math.PI / 2); // arrows point "up" = forward
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, 0.28 * s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const L = 2.6 * s;
    const head = 0.7 * s;
    const turns = assignment.split('') as ('L' | 'T' | 'R')[];
    // Shared stem
    ctx.beginPath();
    ctx.moveTo(0, L * 0.6);
    ctx.lineTo(0, 0);
    ctx.stroke();
    for (const t of turns) {
      ctx.beginPath();
      if (t === 'T') {
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -L * 0.75);
        ctx.stroke();
        arrowHead(ctx, 0, -L * 0.75, -Math.PI / 2, head);
      } else {
        const dir = t === 'L' ? -1 : 1;
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(0, -L * 0.35, dir * L * 0.45, -L * 0.35);
        ctx.stroke();
        arrowHead(ctx, dir * L * 0.45, -L * 0.35, dir > 0 ? 0 : Math.PI, head);
      }
    }
    ctx.restore();
  }

  private drawSignals(sim: Simulation, g: Geometry): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    for (const a of APPROACHES) {
      const f = FORWARD[a];
      const r = rightOf(f);
      for (const lane of g.lanes[a]) {
        // One lamp per movement served by the lane, lined up just past the stop line on the right kerb side.
        const paths = lane.paths;
        paths.forEach((p, i) => {
          const sig = sim.signal.forMovement({ approach: a, turn: p.turn }, sim.t);
          const color =
            sig.color === 'green' ? PALETTE.green : sig.color === 'yellow' ? PALETTE.yellow : PALETTE.red;
          const off = (i - (paths.length - 1) / 2) * 1.0;
          const wx = lane.stop.x + f.x * 1.4 + r.x * off;
          const wy = lane.stop.y + f.y * 1.4 + r.y * off;
          const [px, py] = this.toScreen(wx, wy);
          ctx.fillStyle = '#0b0e11';
          ctx.beginPath();
          ctx.arc(px, py, Math.max(2.5, 0.42 * s), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.6, 0.26 * s), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          if (p.turn !== 'T') {
            // small turn glyph in the lamp for clarity
            ctx.strokeStyle = '#0b0e11';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(0.8, 0.12 * s), 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }
    }
  }

  private drawVehicles(sim: Simulation): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    // Draw exit/box vehicles first so queued approach vehicles layer on top at the line.
    const order = sim.vehicles.filter((v) => v.segment !== 'backlog' && v.segment !== 'gone');
    for (const v of order) {
      const p = v.path!;
      // Centre of the body is half a length behind the front bumper.
      let { pos, heading } = pointAt(p, v.s - v.length / 2);
      if (v.feederLane && (v.feeder || v.mergeAnim > 0) && v.segment === 'approach') {
        // Queuing in (or sliding out of) the lane that feeds the pocket.
        const fp = pointAt(v.feederLane.paths[0], v.s - v.length / 2).pos;
        const k = v.feeder ? 1 : easeOut(v.mergeAnim);
        pos = { x: pos.x + (fp.x - pos.x) * k, y: pos.y + (fp.y - pos.y) * k };
      }
      const [px, py] = this.toScreen(pos.x, pos.y);
      ctx.save();
      let jx = 0,
        jy = 0;
      if (v.shake > 0) {
        jx = Math.sin(this.time * 70) * 1.5 * v.shake;
        jy = Math.cos(this.time * 90) * 1.0 * v.shake;
      }
      ctx.translate(px + jx, py + jy);
      ctx.rotate(heading);
      const L = v.length * s;
      const W = v.width * s;
      const fill = this.vehicleColor(v);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, -L / 2 + 1, -W / 2 + 1.5, L, W, 2.5);
      ctx.fill();
      ctx.fillStyle = fill;
      roundRect(ctx, -L / 2, -W / 2, L, W, 2.5);
      ctx.fill();
      // windshield stripe near the front
      ctx.fillStyle = 'rgba(10,14,18,0.55)';
      roundRect(ctx, L * 0.12, -W * 0.36, L * 0.16, W * 0.72, 1);
      ctx.fill();
      if (v.kind === 'truck') {
        // cab line
        ctx.fillStyle = 'rgba(10,14,18,0.35)';
        ctx.fillRect(L * 0.05, -W / 2, 1.5, W);
      }
      if (v.stalled) {
        // hazard flashers
        const on = Math.floor(this.time * 2) % 2 === 0;
        ctx.fillStyle = on ? PALETTE.yellow : 'rgba(255,204,51,0.25)';
        ctx.fillRect(-L / 2, -W / 2, 2, 2);
        ctx.fillRect(-L / 2, W / 2 - 2, 2, 2);
        ctx.fillRect(L / 2 - 2, -W / 2, 2, 2);
        ctx.fillRect(L / 2 - 2, W / 2 - 2, 2, 2);
      }
      ctx.restore();

      // Tow truck on its way for stalled cars
      if (v.stalled && v.fateTimer <= 10) {
        ctx.fillStyle = PALETTE.yellow;
        ctx.font = `bold ${Math.max(8, 1.1 * s)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('TOW', px, py - W / 2 - 3);
      }
      // Rage mark above furious cars
      if (TIER_RANK[v.tier] >= TIER_RANK.furious && !v.stalled) {
        ctx.fillStyle = PALETTE.red;
        ctx.font = `bold ${Math.max(9, 1.4 * s)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(v.tier === 'blown' ? '!!' : '!', px, py - W / 2 - 3);
      }
    }
  }

  vehicleColor(v: Vehicle): string {
    switch (v.tier) {
      case 'calm':
        return PALETTE.paints[v.paint];
      case 'irritated':
        return mix(PALETTE.paints[v.paint], PALETTE.rage.irritated, 0.65);
      case 'angry':
        return PALETTE.rage.angry;
      case 'furious':
        return PALETTE.rage.furious;
      case 'blown':
        return PALETTE.rage.blown;
    }
  }

  /** Little counters at the screen edge for queue that extends off screen. */
  private drawBacklogBadges(sim: Simulation, g: Geometry): void {
    const ctx = this.ctx;
    for (const a of APPROACHES) {
      const f = FORWARD[a];
      // Count vehicles not visible: backlog plus approach vehicles beyond the view.
      let hidden = sim.backlog[a].filter((v) => v.segment === 'backlog').length;
      let waitingHidden = 0;
      for (const v of sim.vehicles) {
        if (v.segment !== 'approach' || v.approach !== a) continue;
        const { pos } = pointAt(v.path!, v.s);
        const [px, py] = this.toScreen(pos.x, pos.y);
        if (px < -10 || px > this.width + 10 || py < -10 || py > this.height + 10) {
          hidden++;
          if (v.v < 0.6) waitingHidden++;
        }
      }
      if (hidden === 0) continue;
      const lane0 = g.lanes[a][0];
      const n = g.lanes[a].length;
      const r = rightOf(f);
      const mid = {
        x: lane0.stop.x + r.x * LANE_WIDTH * (n - 1) * 0.5,
        y: lane0.stop.y + r.y * LANE_WIDTH * (n - 1) * 0.5,
      };
      // Place along the approach direction at the screen edge.
      const far = { x: mid.x - f.x * APPROACH_LENGTH, y: mid.y - f.y * APPROACH_LENGTH };
      let [px, py] = this.toScreen(far.x, far.y);
      const pad = 22;
      px = Math.max(pad, Math.min(this.width - pad, px));
      py = Math.max(pad + 4, Math.min(this.height - pad, py));
      const arrow: Record<Approach, string> = { N: '↓', S: '↑', E: '←', W: '→' };
      ctx.fillStyle = waitingHidden > 3 ? 'rgba(255,77,77,0.85)' : 'rgba(20,26,31,0.85)';
      ctx.strokeStyle = PALETTE.lineBright;
      ctx.lineWidth = 1;
      roundRect(ctx, px - 22, py - 11, 44, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.text;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${hidden} ${arrow[a]}`, px, py + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** In plan mode: expected traffic per approach, drawn at the screen edge. */
  private drawDemandLabels(level: LevelDef, g: Geometry): void {
    const ctx = this.ctx;
    const names: Record<Approach, string> = { N: 'from North', E: 'from East', S: 'from South', W: 'from West' };
    for (const a of APPROACHES) {
      const d = level.demand[a];
      if (d.peak <= 0) continue;
      const f = FORWARD[a];
      const r = rightOf(f);
      const n = g.lanes[a].length;
      const lane0 = g.lanes[a][0];
      const mid = {
        x: lane0.stop.x + r.x * LANE_WIDTH * (n - 1) * 0.5,
        y: lane0.stop.y + r.y * LANE_WIDTH * (n - 1) * 0.5,
      };
      // Sit beside the inbound lanes, off the pavement, well back from the box.
      const side = (n * LANE_WIDTH) / 2 + 7.5;
      const far = { x: mid.x - f.x * 34 + r.x * side, y: mid.y - f.y * 34 + r.y * side };
      let [px, py] = this.toScreen(far.x, far.y);
      px = Math.max(50, Math.min(this.width - 50, px));
      py = Math.max(28, Math.min(this.height - 28, py));
      const parts: string[] = [];
      const tot = d.turns.L + d.turns.T + d.turns.R;
      if (d.turns.L > 0) parts.push(`↰${Math.round((100 * d.turns.L) / tot)}%`);
      if (d.turns.R > 0) parts.push(`↱${Math.round((100 * d.turns.R) / tot)}%`);
      ctx.fillStyle = 'rgba(20,26,31,0.82)';
      ctx.strokeStyle = 'rgba(138,152,163,0.5)';
      ctx.lineWidth = 1;
      const w = 92;
      roundRect(ctx, px - w / 2, py - 17, w, 34, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.text;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${d.peak}/h`, px, py - 3);
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(parts.length ? `${names[a]} ${parts.join(' ')}` : names[a], px, py + 10);
    }
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.6);
  ctx.lineTo(-size, size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function easeOut(t: number): number {
  return t * t;
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a),
    pb = hex(b);
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hex(h: string): number[] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
