import { LEVELS, clonePlan } from '../levels/levels';
import { Renderer } from '../render/renderer';
import { Audio } from '../audio';
import { loadSave, recordResult, writeSave, type SaveData } from '../save';
import {
  APPROACHES,
  DT,
  FORWARD,
  LANE_WIDTH,
  PATTERNS,
  Simulation,
  TIER_RANK,
  allowedAssignments,
  buildGeometry,
  cycleLength,
  hashString,
  pointAt,
  rightOf,
  validatePlan,
  type Approach,
  type Geometry,
  type LevelDef,
  type Movement,
  type Plan,
  type Turn,
} from '../sim';
import { PhaseDial } from './dial';

type Mode = 'plan' | 'watch' | 'score';

const SPEEDS = [1, 3, 6];

const APPROACH_NAME: Record<Approach, string> = {
  N: 'the North',
  E: 'the East',
  S: 'the South',
  W: 'the West',
};
const TURN_NAME: Record<Turn, string> = {
  L: 'turning left',
  T: 'going straight',
  R: 'turning right',
};

export class App {
  private root: HTMLElement;
  private save: SaveData;
  private audio = new Audio();

  // Game state
  private level: LevelDef = LEVELS[0];
  private plan: Plan = clonePlan(LEVELS[0].defaultPlan);
  private geometry: Geometry = buildGeometry(1, 1, this.plan.lanes);
  private sim: Simulation | null = null;
  private mode: Mode = 'plan';
  private seed = 1;
  private speed = 3;
  private highlightLane: { approach: Approach; index: number } | null = null;
  private highlightTimer = 0;

  // DOM
  private stage!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private renderer!: Renderer;
  private dial!: PhaseDial;
  private panel!: HTMLDivElement;
  private hud!: HTMLDivElement;
  private clockEl!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private resizeObs: ResizeObserver | null = null;

  // Loop
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private steamClock = 0;
  private scoreDelay = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.save = loadSave();
    this.speed = SPEEDS.includes(this.save.speed) ? this.save.speed : 3;
    this.audio.muted = this.save.muted;
    this.showLevels();
  }

  // ===========================================================================
  // Level select
  // ===========================================================================

  private showLevels(): void {
    this.stopLoop();
    this.root.innerHTML = '';
    const wrap = el('div', 'levels');
    const header = el('header', 'levels__header');
    header.innerHTML = `
      <div class="brand">
        <div class="brand__mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <h1>Right of Way</h1>
      </div>
      <p class="tag">Set the lights. Lay out the lanes. Watch the rush.</p>`;
    wrap.appendChild(header);

    const list = el('ol', 'level-list');
    let chapter = 0;
    LEVELS.forEach((lvl, i) => {
      if (lvl.chapter !== chapter) {
        chapter = lvl.chapter;
        const h = el('li', 'level-list__chapter');
        h.textContent = `Chapter ${chapter}`;
        list.appendChild(h);
      }
      const prog = this.save.levels[lvl.id];
      const unlocked = i === 0 || (this.save.levels[LEVELS[i - 1].id]?.stars ?? 0) >= 1;
      const li = el('li', `level-card${unlocked ? '' : ' is-locked'}`);
      const stars = prog ? starString(prog.stars) : starString(0);
      li.innerHTML = `
        <div class="level-card__num">${lvl.index}</div>
        <div class="level-card__body">
          <div class="level-card__title">${lvl.title}</div>
          <div class="level-card__meta">${
            unlocked
              ? `<span class="stars">${stars}</span>${prog && isFinite(prog.best) ? ` · Best ${prog.best}` : ' · Not yet played'}`
              : 'Earn a star on the previous level'
          }</div>
        </div>
        <div class="level-card__go">${unlocked ? '›' : '🔒'}</div>`;
      if (unlocked) {
        li.addEventListener('click', () => {
          this.audio.unlock();
          this.openLevel(lvl);
        });
      }
      list.appendChild(li);
    });
    wrap.appendChild(list);

    const foot = el('footer', 'levels__footer');
    foot.innerHTML = `
      <button class="link" data-act="sound">${this.audio.muted ? 'Sound off' : 'Sound on'}</button>
      <span>·</span>
      <button class="link" data-act="reset">Reset progress</button>
      <span>·</span>
      <span class="dim">v0.1</span>`;
    foot.querySelector('[data-act="sound"]')!.addEventListener('click', () => {
      this.audio.muted = !this.audio.muted;
      this.save.muted = this.audio.muted;
      writeSave(this.save);
      this.showLevels();
    });
    foot.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
      if (confirm('Reset all stars and best scores?')) {
        this.save.levels = {};
        writeSave(this.save);
        this.showLevels();
      }
    });
    wrap.appendChild(foot);
    this.root.appendChild(wrap);
  }

  // ===========================================================================
  // Game screen
  // ===========================================================================

  private openLevel(level: LevelDef): void {
    this.level = level;
    this.plan = clonePlan(level.defaultPlan);
    this.seed = hashString(level.id + ':first');
    this.sim = null;
    this.mode = 'plan';
    this.buildGameDom();
    this.rebuildGeometry();
    this.renderPanel();
    this.startLoop();
  }

  private buildGameDom(): void {
    this.root.innerHTML = '';
    const game = el('div', 'game');

    const top = el('header', 'topbar');
    const back = el('button', 'btn-icon');
    back.setAttribute('aria-label', 'Back to levels');
    back.innerHTML = '‹';
    back.addEventListener('click', () => this.showLevels());
    const title = el('div', 'topbar__title');
    title.innerHTML = `<span class="topbar__num">${this.level.index}</span> ${this.level.title}`;
    this.clockEl = el('div', 'topbar__clock');
    this.clockEl.textContent = this.formatClockStart();
    top.append(back, title, this.clockEl);

    this.stage = el('div', 'stage');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage__canvas';
    this.stage.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);

    this.dial = new PhaseDial(PATTERNS[this.plan.pattern], this.plan.greens);
    this.dial.onChange = (greens) => {
      this.plan.greens = greens;
      this.renderPanel();
    };
    this.stage.appendChild(this.dial.el);

    this.hud = el('div', 'hud');
    this.hud.hidden = true;
    this.stage.appendChild(this.hud);

    this.canvas.addEventListener('pointerdown', (e) => this.onStageTap(e));

    this.panel = el('div', 'panel');
    this.overlay = el('div', 'overlay');
    this.overlay.hidden = true;

    game.append(top, this.stage, this.panel, this.overlay);
    this.root.appendChild(game);

    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(this.stage);
    this.onResize();
  }

  private onResize(): void {
    const rect = this.stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.renderer.resize(rect.width, rect.height, this.geometry);
    const [cx, cy] = this.renderer.toScreen(0, 0);
    this.dial.setGeometry(cx, cy, this.renderer.dialRadius(this.geometry));
  }

  private rebuildGeometry(): void {
    this.geometry = buildGeometry(this.level.lanesNS, this.level.lanesEW, this.plan.lanes);
    this.onResize();
  }

  private formatClockStart(): string {
    const h = this.level.clockStart;
    return `${((h + 11) % 12) + 1}:00 ${h >= 12 ? 'PM' : 'AM'}`;
  }

  // --- Plan panel -------------------------------------------------------------

  private renderPanel(): void {
    const p = this.panel;
    p.innerHTML = '';
    if (this.mode === 'plan') {
      this.dial.setMode('plan');
      this.dial.setPlan(PATTERNS[this.plan.pattern], this.plan.greens);
      this.hud.hidden = true;
      this.clockEl.textContent = this.formatClockStart();

      if (this.level.patterns.length > 1) {
        const row = el('div', 'chips');
        for (const id of this.level.patterns) {
          const b = el('button', `chip${this.plan.pattern === id ? ' is-on' : ''}`);
          b.textContent = PATTERNS[id].name;
          b.addEventListener('click', () => {
            if (this.plan.pattern === id) return;
            this.plan.pattern = id;
            this.plan.greens = [...PATTERNS[id].defaultGreens];
            this.renderPanel();
          });
          row.appendChild(b);
        }
        p.appendChild(row);
      }

      const cyc = el('div', 'cycle');
      const minus = el('button', 'btn-round');
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Shorter cycle');
      const plus = el('button', 'btn-round');
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Longer cycle');
      const label = el('div', 'cycle__label');
      label.innerHTML = `<span class="cycle__num">${cycleLength(this.plan.greens)}</span><span class="cycle__unit">s cycle</span>`;
      minus.addEventListener('click', () => {
        this.plan.greens = this.dial.adjustCycle(-5);
        this.renderPanel();
      });
      plus.addEventListener('click', () => {
        this.plan.greens = this.dial.adjustCycle(5);
        this.renderPanel();
      });
      cyc.append(minus, label, plus);
      p.appendChild(cyc);

      const errors = validatePlan(this.level, this.plan);
      const hint = el('p', errors.length ? 'hint hint--error' : 'hint');
      hint.textContent = errors.length
        ? errors[0]
        : this.level.blurb;
      p.appendChild(hint);

      const go = el('button', 'btn-go');
      go.textContent = 'Go';
      go.disabled = errors.length > 0;
      go.addEventListener('click', () => this.startRun());
      p.appendChild(go);
    } else if (this.mode === 'watch') {
      this.dial.setMode('watch');
      this.hud.hidden = false;
      const row = el('div', 'watchrow');
      const speeds = el('div', 'chips chips--tight');
      for (const s of SPEEDS) {
        const b = el('button', `chip${this.speed === s ? ' is-on' : ''}`);
        b.textContent = `${s}×`;
        b.addEventListener('click', () => {
          this.speed = s;
          this.save.speed = s;
          writeSave(this.save);
          this.renderPanel();
        });
        speeds.appendChild(b);
      }
      const stop = el('button', 'btn-secondary');
      stop.textContent = 'Stop & replan';
      stop.addEventListener('click', () => this.backToPlan());
      row.append(speeds, stop);
      p.appendChild(row);
      const legend = el('div', 'legend');
      legend.innerHTML = `
        <span><i class="sw sw--calm"></i>calm</span>
        <span><i class="sw sw--irritated"></i>irritated</span>
        <span><i class="sw sw--angry"></i>angry</span>
        <span><i class="sw sw--furious"></i>furious</span>`;
      p.appendChild(legend);
    }
  }

  private updateHud(): void {
    if (!this.sim) return;
    const s = this.sim.stats;
    this.hud.innerHTML = `
      <div class="hud__item"><div class="hud__num">${s.throughput}</div><div class="hud__lbl">through</div></div>
      <div class="hud__item hud__item--rage"><div class="hud__num">−${Math.round(s.rage)}</div><div class="hud__lbl">rage</div></div>
      <div class="hud__item hud__item--score"><div class="hud__num">${s.score}</div><div class="hud__lbl">score</div></div>`;
  }

  // --- Lane tapping -----------------------------------------------------------

  private onStageTap(e: PointerEvent): void {
    if (this.mode !== 'plan' || !this.level.lanesEditable) return;
    const rect = this.canvas.getBoundingClientRect();
    const [wx, wy] = this.renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    for (const a of APPROACHES) {
      const f = FORWARD[a];
      const r = rightOf(f);
      for (const lane of this.geometry.lanes[a]) {
        const dx = wx - lane.stop.x;
        const dy = wy - lane.stop.y;
        const along = dx * f.x + dy * f.y;
        const across = dx * r.x + dy * r.y;
        if (along <= 0.5 && along >= -24 && Math.abs(across) <= LANE_WIDTH * 0.55) {
          const n = this.geometry.lanes[a].length;
          const allowed = allowedAssignments(lane.index, n);
          const cur = this.plan.lanes[a][lane.index];
          const next = allowed[(allowed.indexOf(cur) + 1) % allowed.length];
          this.plan.lanes[a][lane.index] = next;
          this.highlightLane = { approach: a, index: lane.index };
          this.highlightTimer = 0.6;
          this.audio.unlock();
          this.rebuildGeometry();
          this.renderPanel();
          return;
        }
      }
    }
  }

  // --- Run control ------------------------------------------------------------

  private startRun(): void {
    this.audio.unlock();
    this.sim = new Simulation(this.level, clonePlan(this.plan), this.seed);
    this.mode = 'watch';
    this.acc = 0;
    this.scoreDelay = 0;
    this.renderer.particles.clear();
    this.overlay.hidden = true;
    this.renderPanel();
    this.updateHud();
  }

  private backToPlan(): void {
    this.sim = null;
    this.mode = 'plan';
    this.overlay.hidden = true;
    this.renderer.particles.clear();
    this.renderPanel();
  }

  private finishRun(): void {
    if (!this.sim) return;
    this.mode = 'score';
    const stats = this.sim.stats;
    const stars = this.level.stars.filter((t) => stats.score >= t).length;
    const prog = recordResult(this.save, this.level.id, stats.score, stars);
    const idx = LEVELS.indexOf(this.level);
    const next = LEVELS[idx + 1];

    const caption = this.caption(stats.worstWait, stats.worstWaitMovement, stats.gridlocked, stats.gridlockTime);
    const fates: string[] = [];
    if (stats.rageEvents) fates.push(`${stats.rageEvents} driver${stats.rageEvents > 1 ? 's' : ''} blew up`);
    if (stats.stalls) fates.push(`${stats.stalls} stalled`);
    if (stats.bails) fates.push(`${stats.bails} bailed`);
    if (stats.shoves) fates.push(`${stats.shoves} shoved through`);
    if (stats.hardBrakes) fates.push(`${stats.hardBrakes} slammed the brakes`);

    this.overlay.innerHTML = `
      <div class="card">
        <div class="card__kicker">${stats.gridlocked ? 'GRIDLOCK' : 'Rush hour over'}</div>
        <div class="card__score ${stats.score < 0 ? 'is-neg' : ''}">${stats.score}</div>
        <div class="card__stars">${starString(stars)}</div>
        <div class="card__math">
          <span><b>${stats.throughput}</b> through</span>
          <span class="minus">−</span>
          <span><b>${Math.round(stats.rage)}</b> rage</span>
        </div>
        <p class="card__caption">${caption}</p>
        ${fates.length ? `<p class="card__fates">${fates.join(' · ')}</p>` : ''}
        <p class="card__best">Best ${prog.best} · ${this.level.stars.map((t, i) => `${'★'.repeat(i + 1)} ${t}`).join(' · ')}</p>
        <div class="card__actions">
          <button class="btn-primary" data-act="rerun">Rerun same traffic</button>
          <button class="btn-secondary" data-act="new">New traffic</button>
        </div>
        <div class="card__actions card__actions--row">
          <button class="btn-secondary" data-act="plan">Tweak plan</button>
          ${next && stars >= 1 ? `<button class="btn-secondary" data-act="next">Next level ›</button>` : ''}
          <button class="btn-secondary" data-act="levels">Levels</button>
        </div>
      </div>`;
    this.overlay.hidden = false;
    this.overlay.querySelector('[data-act="rerun"]')!.addEventListener('click', () => this.startRun());
    this.overlay.querySelector('[data-act="new"]')!.addEventListener('click', () => {
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.startRun();
    });
    this.overlay.querySelector('[data-act="plan"]')!.addEventListener('click', () => this.backToPlan());
    this.overlay.querySelector('[data-act="levels"]')!.addEventListener('click', () => this.showLevels());
    this.overlay.querySelector('[data-act="next"]')?.addEventListener('click', () => this.openLevel(next));
    this.renderPanel();
  }

  private caption(worst: number, m: Movement | null, gridlocked: boolean, gridTime: number): string {
    if (gridlocked && this.sim) {
      const u = Math.min(1, gridTime / this.level.duration);
      const minutes = this.level.clockStart * 60 + u * this.level.clockSpan;
      const h24 = Math.floor(minutes / 60) % 24;
      const mm = Math.floor(minutes % 60);
      return `The box locked solid at ${((h24 + 11) % 12) + 1}:${mm.toString().padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}. Nothing moved after that.`;
    }
    if (!m || worst < 20) return 'Nobody waited long enough to notice. Smooth.';
    const who = `Traffic from ${APPROACH_NAME[m.approach]} ${TURN_NAME[m.turn]}`;
    const secs = Math.round(worst);
    if (secs >= 90) return `${who} waited ${secs} seconds. Ouch.`;
    if (secs >= 50) return `${who} waited ${secs} seconds. That is a long red.`;
    return `Longest wait: ${who.toLowerCase()}, ${secs} seconds.`;
  }

  // --- Main loop --------------------------------------------------------------

  private startLoop(): void {
    this.stopLoop();
    this.lastFrame = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dtReal = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(dtReal);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
  }

  private frame(dtReal: number): void {
    if (this.highlightTimer > 0) {
      this.highlightTimer -= dtReal;
      if (this.highlightTimer <= 0) this.highlightLane = null;
    }

    if (this.mode === 'watch' && this.sim) {
      this.acc += dtReal * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 40 && !this.sim.done) {
        this.sim.step();
        this.consumeEvents();
        this.acc -= DT;
        steps++;
      }
      if (steps >= 40) this.acc = 0;
      this.steamClock += dtReal * this.speed;
      if (this.steamClock > 0.3) {
        this.steamClock = 0;
        for (const v of this.sim.vehicles) {
          if (v.segment === 'approach' || v.segment === 'box') {
            if (TIER_RANK[v.tier] >= TIER_RANK.furious && v.v < 0.6 && !v.stalled) {
              const { pos } = pointAt(v.path!, v.s);
              this.renderer.particles.steam(pos.x, pos.y);
            }
          }
        }
      }
      const st = this.sim.signal.state(this.sim.t);
      this.dial.setProgress(st.cycleTime, st.phaseIndex);
      this.clockEl.textContent = this.sim.clock();
      this.updateHud();
      if (this.sim.done) {
        this.scoreDelay += dtReal;
        if (this.scoreDelay > (this.sim.stats.gridlocked ? 1.4 : 0.5)) this.finishRun();
      }
    }

    this.renderer.draw(
      this.sim,
      this.geometry,
      this.level,
      this.plan,
      this.mode,
      dtReal * (this.mode === 'watch' ? this.speed : 1),
      this.highlightLane,
    );
  }

  private consumeEvents(): void {
    const sim = this.sim!;
    for (const ev of sim.events) {
      switch (ev.type) {
        case 'honk': {
          const { pos } = pointAt(ev.vehicle.path!, ev.vehicle.s - ev.vehicle.length / 2);
          const strong = TIER_RANK[ev.vehicle.tier] >= TIER_RANK.furious;
          this.renderer.particles.honk(pos.x, pos.y, strong);
          if (this.speed <= 3) this.audio.honk(strong);
          break;
        }
        case 'blow': {
          const { pos } = pointAt(ev.vehicle.path!, ev.vehicle.s - ev.vehicle.length / 2);
          this.renderer.particles.burst(pos.x, pos.y);
          this.renderer.particles.ding(pos.x, pos.y - 2, '−10', 'rgba(255,77,77,');
          this.audio.honk(true);
          break;
        }
        case 'cleared': {
          const { pos } = pointAt(ev.vehicle.path!, ev.vehicle.s);
          this.renderer.particles.ding(pos.x, pos.y, '+1');
          if (this.speed <= 3) this.audio.ding();
          break;
        }
        case 'gridlock':
          this.audio.gridlock();
          break;
        case 'brake': {
          const { pos } = pointAt(ev.vehicle.path!, ev.vehicle.s);
          this.renderer.particles.skid(pos.x, pos.y);
          break;
        }
        case 'tow':
          break;
      }
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function starString(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}
