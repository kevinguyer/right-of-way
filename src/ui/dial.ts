import { ALL_RED, MIN_GREEN, YELLOW, clampGreen, cycleLength, phaseLength, type PatternDef } from '../sim';

const NS = 'http://www.w3.org/2000/svg';

/**
 * The phase dial: a ring around the intersection, one arc per signal phase.
 * In plan mode the boundaries between phases are draggable and shift green time
 * from one phase to its neighbour. In watch mode a sweep hand shows where the
 * cycle is right now.
 */
export class PhaseDial {
  readonly el: SVGSVGElement;
  private pattern: PatternDef;
  private greens: number[];
  private mode: 'plan' | 'watch' = 'plan';
  private radius = 100;
  private stroke = 12;
  private progress = 0; // seconds into cycle
  private activePhase = -1;
  private dragging: number | null = null;
  onChange: ((greens: number[]) => void) | null = null;

  constructor(pattern: PatternDef, greens: number[]) {
    this.pattern = pattern;
    this.greens = [...greens];
    this.el = document.createElementNS(NS, 'svg');
    this.el.classList.add('dial');
    this.el.setAttribute('aria-label', 'Signal phase dial');
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.render();
  }

  setPlan(pattern: PatternDef, greens: number[]): void {
    this.pattern = pattern;
    this.greens = [...greens];
    this.render();
  }

  setMode(mode: 'plan' | 'watch'): void {
    this.mode = mode;
    this.el.classList.toggle('dial--watch', mode === 'watch');
    this.render();
  }

  /** Place the ring on screen (CSS pixels, relative to the parent). */
  setGeometry(cx: number, cy: number, radius: number): void {
    this.radius = radius;
    this.stroke = Math.max(10, Math.min(16, radius * 0.11));
    const size = (radius + 40) * 2;
    this.el.setAttribute('width', `${size}`);
    this.el.setAttribute('height', `${size}`);
    this.el.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    this.el.style.left = `${cx - size / 2}px`;
    this.el.style.top = `${cy - size / 2}px`;
    this.render();
  }

  /** Watch mode: seconds into the cycle and the active phase. */
  setProgress(cycleTime: number, phaseIndex: number): void {
    this.progress = cycleTime;
    if (phaseIndex !== this.activePhase) {
      this.activePhase = phaseIndex;
      this.render();
    } else {
      this.updateHand();
    }
  }

  get cycle(): number {
    return cycleLength(this.greens);
  }

  // ---------------------------------------------------------------------------

  private angleAt(t: number): number {
    return (t / this.cycle) * Math.PI * 2 - Math.PI / 2;
  }

  private arcPath(t0: number, t1: number, r: number): string {
    const a0 = this.angleAt(t0);
    const a1 = this.angleAt(t1);
    const x0 = Math.cos(a0) * r,
      y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r,
      y1 = Math.sin(a1) * r;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  }

  private render(): void {
    const el = this.el;
    while (el.firstChild) el.removeChild(el.firstChild);
    const r = this.radius;
    const sw = this.stroke;
    const cycle = this.cycle;
    if (cycle <= 0) return;

    // Track
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('r', `${r}`);
    track.setAttribute('class', 'dial__track');
    track.setAttribute('stroke-width', `${sw + 4}`);
    el.appendChild(track);

    let t = 0;
    this.pattern.phases.forEach((ph, i) => {
      const g = this.greens[i];
      const gEnd = t + g;
      const yEnd = gEnd + YELLOW;
      const pEnd = yEnd + ALL_RED;
      const active = this.mode === 'watch' && this.activePhase === i;

      const green = document.createElementNS(NS, 'path');
      green.setAttribute('d', this.arcPath(t, gEnd, r));
      green.setAttribute('class', `dial__green${active ? ' is-active' : ''}`);
      green.setAttribute('stroke-width', `${sw}`);
      el.appendChild(green);

      const yellow = document.createElementNS(NS, 'path');
      yellow.setAttribute('d', this.arcPath(gEnd, yEnd, r));
      yellow.setAttribute('class', 'dial__yellow');
      yellow.setAttribute('stroke-width', `${sw}`);
      el.appendChild(yellow);

      const red = document.createElementNS(NS, 'path');
      red.setAttribute('d', this.arcPath(yEnd, pEnd, r));
      red.setAttribute('class', 'dial__red');
      red.setAttribute('stroke-width', `${sw}`);
      el.appendChild(red);

      // Label outside the ring at the middle of the green.
      const mid = this.angleAt(t + g / 2);
      const lr = r + sw / 2 + 14;
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', `${Math.cos(mid) * lr}`);
      label.setAttribute('y', `${Math.sin(mid) * lr}`);
      label.setAttribute('class', 'dial__label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = ph.label;
      el.appendChild(label);

      const secs = document.createElementNS(NS, 'text');
      const ir = r - sw / 2 - 11;
      secs.setAttribute('x', `${Math.cos(mid) * ir}`);
      secs.setAttribute('y', `${Math.sin(mid) * ir}`);
      secs.setAttribute('class', 'dial__secs');
      secs.setAttribute('text-anchor', 'middle');
      secs.setAttribute('dominant-baseline', 'middle');
      secs.textContent = `${g}s`;
      el.appendChild(secs);

      t = pEnd;
    });

    // Handles at boundaries (not the one at the top: the cycle start is fixed).
    if (this.mode === 'plan') {
      let tb = 0;
      for (let i = 0; i < this.pattern.phases.length - 1; i++) {
        tb += phaseLength(this.greens[i]);
        const a = this.angleAt(tb);
        const hx = Math.cos(a) * r,
          hy = Math.sin(a) * r;
        const hit = document.createElementNS(NS, 'circle');
        hit.setAttribute('cx', `${hx}`);
        hit.setAttribute('cy', `${hy}`);
        hit.setAttribute('r', '24');
        hit.setAttribute('class', 'dial__hit');
        hit.dataset.boundary = `${i}`;
        el.appendChild(hit);
        const knob = document.createElementNS(NS, 'circle');
        knob.setAttribute('cx', `${hx}`);
        knob.setAttribute('cy', `${hy}`);
        knob.setAttribute('r', `${sw * 0.75}`);
        knob.setAttribute('class', `dial__knob${this.dragging === i ? ' is-dragging' : ''}`);
        el.appendChild(knob);
        const grip = document.createElementNS(NS, 'path');
        const ga = a + Math.PI / 2;
        const gx = Math.cos(ga) * 4,
          gy = Math.sin(ga) * 4;
        grip.setAttribute(
          'd',
          `M ${hx - gx} ${hy - gy} L ${hx + gx} ${hy + gy}`,
        );
        grip.setAttribute('class', 'dial__grip');
        el.appendChild(grip);
      }
    } else {
      const hand = document.createElementNS(NS, 'path');
      hand.setAttribute('class', 'dial__hand');
      hand.dataset.role = 'hand';
      el.appendChild(hand);
      this.updateHand();
    }
  }

  private updateHand(): void {
    const hand = this.el.querySelector<SVGPathElement>('[data-role="hand"]');
    if (!hand) return;
    const a = this.angleAt(this.progress);
    const r0 = this.radius - this.stroke / 2 - 6;
    const r1 = this.radius + this.stroke / 2 + 6;
    hand.setAttribute(
      'd',
      `M ${Math.cos(a) * r0} ${Math.sin(a) * r0} L ${Math.cos(a) * r1} ${Math.sin(a) * r1}`,
    );
  }

  // --- Dragging ---------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (this.mode !== 'plan') return;
    const target = e.target as HTMLElement;
    const b = target.dataset?.boundary;
    if (b === undefined) return;
    this.dragging = parseInt(b, 10);
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('is-dragging');
    e.preventDefault();
    this.render();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging === null) return;
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    let ang = Math.atan2(y, x) + Math.PI / 2; // 0 at top, clockwise
    if (ang < 0) ang += Math.PI * 2;
    const tAtPointer = (ang / (Math.PI * 2)) * this.cycle;
    this.moveBoundary(this.dragging, tAtPointer);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.dragging === null) return;
    this.dragging = null;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.el.classList.remove('is-dragging');
    this.render();
    this.onChange?.([...this.greens]);
  };

  /** Move the boundary after phase k so it sits at cycle time T, keeping the cycle length. */
  private moveBoundary(k: number, T: number): void {
    let start = 0;
    for (let i = 0; i < k; i++) start += phaseLength(this.greens[i]);
    const pool = this.greens[k] + this.greens[k + 1];
    let gk = Math.round(T - start - YELLOW - ALL_RED);
    gk = Math.max(MIN_GREEN, Math.min(pool - MIN_GREEN, gk));
    if (gk === this.greens[k]) return;
    this.greens[k] = gk;
    this.greens[k + 1] = pool - gk;
    this.render();
    this.onChange?.([...this.greens]);
  }

  /** Change the cycle length by delta seconds, spread proportionally. */
  adjustCycle(delta: number): number[] {
    const total = this.greens.reduce((a, b) => a + b, 0);
    const target = Math.max(MIN_GREEN * this.greens.length, total + delta);
    let next = this.greens.map((g) => clampGreen((g / total) * target));
    // Fix rounding drift so the sum moves by at least |delta| when possible.
    let diff = target - next.reduce((a, b) => a + b, 0);
    let i = 0;
    while (diff !== 0 && i < 50) {
      const idx = i % next.length;
      const step = diff > 0 ? 1 : -1;
      const candidate = next[idx] + step;
      if (candidate >= MIN_GREEN && candidate <= 90) {
        next[idx] = candidate;
        diff -= step;
      }
      i++;
    }
    this.greens = next;
    this.render();
    this.onChange?.([...this.greens]);
    return [...this.greens];
  }
}
