import * as C from './constants';
import { arrivalRate } from './demand';
import { buildGeometry, type ApproachLane, type Geometry, type Path } from './geometry';
import { Rng } from './rng';
import { PATTERNS, SignalController } from './signal';
import type {
  Approach,
  Fate,
  LevelDef,
  Movement,
  Plan,
  RunStats,
  Turn,
} from './types';
import { APPROACHES, TURNS, assignmentAllows } from './types';
import {
  TIER_RANK,
  gapAcceptFor,
  idm,
  makeVehicle,
  resetVehicleIds,
  tierOf,
  type Vehicle,
} from './vehicle';

export type SimEvent =
  | { type: 'honk'; vehicle: Vehicle }
  | { type: 'blow'; vehicle: Vehicle; fate: Fate }
  | { type: 'cleared'; vehicle: Vehicle }
  | { type: 'tow'; vehicle: Vehicle }
  | { type: 'brake'; vehicle: Vehicle }
  | { type: 'gridlock' };

interface Obstacle {
  /** Distance from my front bumper to the obstacle. */
  gap: number;
  speed: number;
}

/**
 * The whole simulation. Pure: no DOM, no timers. Call step() at a fixed DT.
 * Same level + plan + seed always produces the same run.
 */
export class Simulation {
  readonly level: LevelDef;
  readonly plan: Plan;
  readonly seed: number;
  readonly geometry: Geometry;
  readonly signal: SignalController;
  readonly rng: Rng;
  readonly vehicles: Vehicle[] = [];
  readonly backlog: Record<Approach, Vehicle[]> = { N: [], E: [], S: [], W: [] };
  /** Events emitted during the most recent step. */
  events: SimEvent[] = [];

  t = 0;
  done = false;
  stats: RunStats;

  private nextArrival: Record<Approach, number> = { N: 0, E: 0, S: 0, W: 0 };
  private lastBoxExit = 0;
  private gridTimer = 0;
  private waitSum = 0;
  private waitCount = 0;
  private platoon: Record<string, { count: number; last: number }> = {};

  constructor(level: LevelDef, plan: Plan, seed: number) {
    this.level = level;
    this.plan = plan;
    this.seed = seed;
    this.rng = new Rng(seed);
    resetVehicleIds();
    this.geometry = buildGeometry(level.lanesNS, level.lanesEW, plan.lanes);
    this.signal = new SignalController(PATTERNS[plan.pattern], plan.greens);
    for (const a of APPROACHES) this.nextArrival[a] = this.rng.range(0.2, 1.2) / Math.max(1e-6, arrivalRate(level, a, 0));
    this.stats = {
      throughput: 0,
      rage: 0,
      rageEvents: 0,
      score: 0,
      worstWait: 0,
      worstWaitMovement: null,
      gridlocked: false,
      gridlockTime: 0,
      stalls: 0,
      bails: 0,
      shoves: 0,
      seethes: 0,
      spawned: 0,
      avgWait: 0,
      hardBrakes: 0,
    };
  }

  /** Run to completion headlessly. */
  run(): RunStats {
    while (!this.done) this.step();
    return this.stats;
  }

  /** Simulated clock string, e.g. "5:23 PM". */
  clock(): string {
    const u = Math.min(1, this.t / this.level.duration);
    const minutes = this.level.clockStart * 60 + u * this.level.clockSpan;
    const h24 = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    const h12 = ((h24 + 11) % 12) + 1;
    return `${h12}:${m.toString().padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
  }

  step(): void {
    if (this.done) return;
    this.events = [];
    const dt = C.DT;
    const t = this.t;

    if (t < this.level.duration) this.spawn(t, dt);
    this.insertFromBacklog(t);

    // Index vehicles for neighbour queries.
    const byLane = new Map<ApproachLane, Vehicle[]>();
    const byPath = new Map<Path, Vehicle[]>();
    const byExit = new Map<string, Vehicle[]>();
    for (const v of this.vehicles) {
      if (v.segment === 'backlog' || v.segment === 'gone') continue;
      if (v.segment === 'approach' && v.lane) push(byLane, v.feeder ?? v.lane, v);
      if (v.path) push(byPath, v.path, v);
      if (v.path && (v.segment === 'box' || v.segment === 'exit'))
        push(byExit, v.path.exitRoad + v.path.exitLane, v);
    }
    for (const arr of byLane.values()) arr.sort((a, b) => b.s - a.s);
    for (const arr of byExit.values())
      arr.sort((a, b) => b.s - b.path!.sExit - (a.s - a.path!.sExit));

    const emptyGreen = this.isGreenEmpty(t, byPath);

    // Phase 1: decide accelerations from the previous state (synchronous update).
    const accels = new Float64Array(this.vehicles.length);
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.segment === 'backlog' || v.segment === 'gone') continue;
      accels[i] = this.decide(v, t, byLane, byPath, byExit);
    }

    // Phase 2: integrate, segment transitions, rage.
    let stoppedInBox = 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.segment === 'gone') continue;
      if (v.segment === 'backlog') {
        this.updateRage(v, dt, true, emptyGreen, byLane);
        continue;
      }
      const p = v.path!;
      if (v.stalled) {
        v.v = 0;
        v.a = 0;
      } else {
        v.a = accels[i];
        // Being forced into a hard brake is a near miss, and near misses make people angry.
        if (v.brakeCooldown > 0) v.brakeCooldown -= dt;
        if (v.a < -C.HARD_BRAKE && v.v > 4 && v.brakeCooldown <= 0 && !v.blown) {
          v.brakeCooldown = 4;
          v.rage += C.RAGE_HARD_BRAKE;
          this.stats.hardBrakes++;
          this.events.push({ type: 'brake', vehicle: v });
        }
        v.v = Math.max(0, v.v + v.a * dt);
        v.s += v.v * dt;
      }
      if (v.mergeAnim > 0) v.mergeAnim = Math.max(0, v.mergeAnim - dt / 0.7);
      if (v.segment === 'approach' && v.s >= p.sStop) {
        v.segment = 'box';
        v.boxEntryTime = t;
        v.yellowGo = null;
        v.courtesyHold = false;
      }
      if (v.segment === 'box' && v.s - v.length >= p.sExit) {
        v.segment = 'exit';
        this.lastBoxExit = t;
        if (!v.counted) {
          v.counted = true;
          this.stats.throughput += 1;
          this.platoonBonus(v, t);
          this.events.push({ type: 'cleared', vehicle: v });
        }
      }
      if (v.segment === 'exit' && v.s - v.length >= p.sEnd) {
        this.retire(v);
        continue;
      }
      if (v.segment === 'box' && v.v < 0.3) stoppedInBox++;

      const waiting = v.segment !== 'exit' && v.v < C.WAIT_SPEED;
      this.updateRage(v, dt, waiting, emptyGreen, byLane);
      this.updateFate(v, dt);
      if (v.honkTimer > 0) v.honkTimer -= dt;
      if (v.shake > 0) v.shake = Math.max(0, v.shake - dt);
    }

    // Gridlock: the box is clogged and nothing has left it for a while.
    if (stoppedInBox >= C.GRIDLOCK_STOPPED_IN_BOX && t - this.lastBoxExit > C.GRIDLOCK_SECONDS) {
      this.gridTimer += dt;
    } else {
      this.gridTimer = 0;
    }
    if (this.gridTimer >= 1.0 && !this.stats.gridlocked) {
      this.stats.gridlocked = true;
      this.stats.gridlockTime = t;
      this.events.push({ type: 'gridlock' });
      this.finish();
      return;
    }

    this.t = t + dt;
    this.updateScore();

    // The run ends when time is up and the last vehicles have drained, or after a grace period.
    if (this.t >= this.level.duration) {
      const live = this.vehicles.filter((v) => v.segment !== 'gone' && v.segment !== 'exit').length;
      if (live === 0 || this.t >= this.level.duration + 45) this.finish();
    }
  }

  // ---------------------------------------------------------------------------

  private finish(): void {
    this.done = true;
    this.updateScore();
    this.stats.avgWait = this.waitCount ? this.waitSum / this.waitCount : 0;
  }

  private updateScore(): void {
    let rage = 0;
    for (const v of this.vehicles) rage += Math.min(v.rage, C.RAGE_CAP);
    rage += this.stats.rageEvents * C.RAGE_EVENT_PENALTY;
    this.stats.rage = rage;
    this.stats.score = Math.round(this.stats.throughput - rage);
  }

  private retire(v: Vehicle): void {
    v.segment = 'gone';
    this.waitSum += v.waitTime;
    this.waitCount++;
  }

  private platoonBonus(v: Vehicle, t: number): void {
    const key = v.approach + v.turn;
    const p = this.platoon[key] ?? { count: 0, last: -100 };
    if (t - p.last < 3.0 && v.stops === 0) p.count++;
    else p.count = v.stops === 0 ? 1 : 0;
    p.last = t;
    this.platoon[key] = p;
    if (p.count === C.PLATOON_SIZE) this.stats.throughput += C.PLATOON_BONUS;
  }

  // --- Spawning ---------------------------------------------------------------

  private spawn(t: number, dt: number): void {
    for (const a of APPROACHES) {
      this.nextArrival[a] -= dt;
      while (this.nextArrival[a] <= 0) {
        const rate = arrivalRate(this.level, a, t);
        // Jittered rather than Poisson arrivals: random, but without the extreme
        // bunching that made the same plan swing 100+ points between seeds.
        this.nextArrival[a] += rate > 0 ? (this.rng.range(0.35, 1.65) / rate) : 1e9;
        const turn = this.pickTurn(a);
        if (!turn) continue;
        const v = makeVehicle(this.rng, a, turn, t);
        this.vehicles.push(v);
        this.backlog[a].push(v);
        this.stats.spawned++;
      }
    }
  }

  private pickTurn(a: Approach): Turn | null {
    const d = this.level.demand[a].turns;
    const lanes = this.geometry.lanes[a];
    const turns: Turn[] = [];
    const weights: number[] = [];
    for (const tn of TURNS) {
      const w = d[tn];
      if (w <= 0) continue;
      if (!lanes.some((l) => assignmentAllows(l.assignment, tn))) continue;
      turns.push(tn);
      weights.push(w);
    }
    if (turns.length === 0) return null;
    return this.rng.weighted(turns, weights);
  }

  private insertFromBacklog(t: number): void {
    for (const a of APPROACHES) {
      const q = this.backlog[a];
      while (q.length > 0) {
        const v = q[0];
        if (v.segment === 'gone') {
          q.shift();
          continue;
        }
        const lane = this.chooseLane(v);
        if (!lane) break;
        const path = lane.paths.find((p) => p.turn === v.turn)!;
        v.lane = lane;
        v.path = path;
        // Pocket lanes are entered from the neighbouring lane further up.
        v.feeder = lane.pocket ? this.geometry.lanes[a][lane.feederIndex] : null;
        v.feederLane = v.feeder;
        v.segment = 'approach';
        v.s = v.length;
        // Match the speed of the lane's tail, or roll in at speed on an empty lane.
        const queueLane = v.feeder ?? lane;
        let tailV = C.V_APPROACH;
        for (const o of this.vehicles) {
          if ((o.feeder ?? o.lane) === queueLane && o.segment === 'approach' && o !== v)
            tailV = Math.min(tailV, o.v + 2);
        }
        v.v = tailV;
        v.wasMoving = true;
        void t;
        q.shift();
      }
    }
  }

  private chooseLane(v: Vehicle): ApproachLane | null {
    const lanes = this.geometry.lanes[v.approach].filter((l) =>
      assignmentAllows(l.assignment, v.turn),
    );
    let best: ApproachLane | null = null;
    let bestCount = Infinity;
    for (const l of lanes) {
      // Vehicles bound for a pocket queue in its feeder lane until the pocket entrance.
      const queueLane = l.pocket ? this.geometry.lanes[v.approach][l.feederIndex] : l;
      let count = 0;
      let tailRear = Infinity;
      for (const o of this.vehicles) {
        if (o.segment !== 'approach') continue;
        if ((o.feeder ?? o.lane) === queueLane) {
          count++;
          tailRear = Math.min(tailRear, o.s - o.length);
        } else if (l.pocket && o.lane === l) {
          count++;
        }
      }
      if (tailRear < v.length + C.SPAWN_GAP) continue; // no room
      // Prefer fewer cars; turning drivers prefer the lane dedicated to their turn.
      const dedicated = l.assignment === v.turn ? -0.5 : 0;
      if (count + dedicated < bestCount) {
        bestCount = count + dedicated;
        best = l;
      }
    }
    return best;
  }

  // --- Driving decisions ------------------------------------------------------

  private decide(
    v: Vehicle,
    t: number,
    byLane: Map<ApproachLane, Vehicle[]>,
    byPath: Map<Path, Vehicle[]>,
    byExit: Map<string, Vehicle[]>,
  ): number {
    const p = v.path!;
    const obstacles: Obstacle[] = [];
    v.yielding = false;

    // Desired speed by segment (slow early for turns).
    let v0: number;
    if (v.segment === 'approach') {
      v0 = C.V_APPROACH;
      if (v.turn !== 'T' && p.sStop - v.s < 18) v0 = C.V_BOX_TURN;
    } else if (v.segment === 'box') {
      v0 = v.turn === 'T' ? C.V_BOX_THROUGH : C.V_BOX_TURN;
    } else v0 = C.V_EXIT;

    // Leader in my approach lane (or the lane feeding my pocket).
    if (v.segment === 'approach' && v.lane) {
      const arr = byLane.get(v.feeder ?? v.lane) ?? [];
      const idx = arr.indexOf(v);
      if (idx > 0) {
        const lead = arr[idx - 1];
        obstacles.push({ gap: lead.s - lead.length - v.s, speed: lead.v });
      }
      // Waiting in the feeder lane for room in the pocket.
      if (v.feeder) {
        const entrance = p.sStop - C.POCKET_LENGTH;
        let tailRear = Infinity; // rear bumper of the last vehicle already in the pocket
        for (const o of byLane.get(v.lane) ?? []) {
          if (!o.feeder) tailRear = Math.min(tailRear, o.s - o.length);
        }
        const room = tailRear - v.s;
        if (v.s >= entrance - 8 && room >= C.IDM_S0 + 0.5) {
          v.feeder = null; // slide into the pocket
          v.mergeAnim = 1;
        } else if (room < C.IDM_S0 + 0.5) {
          // Pocket is full: hold at the entrance (and behind the pocket's tail), blocking the feeder lane.
          const holdAt = Math.min(entrance - 1.0, tailRear - C.IDM_S0);
          obstacles.push({ gap: holdAt - v.s, speed: 0 });
        }
      }
    }
    // Leader heading for my exit lane (in the box or already on the exit).
    if (v.segment !== 'exit' || true) {
      const arr = byExit.get(p.exitRoad + p.exitLane) ?? [];
      const myEp = v.s - p.sExit;
      for (const o of arr) {
        if (o === v) continue;
        const oEp = o.s - o.path!.sExit;
        if (oEp <= myEp) continue;
        // Only the nearest one ahead matters; arr is sorted descending so take the last that is ahead.
        obstacles.push({ gap: oEp - o.length - myEp, speed: o.v });
      }
    }

    // Signal at the stop line.
    let mustStopAtLine = false;
    if (v.segment === 'approach') {
      const dist = p.sStop - v.s;
      const sig = this.signal.forMovement({ approach: v.approach, turn: v.turn }, t);
      if (v.ignoreSignal) {
        // shove: go regardless
      } else if (sig.color === 'green') {
        v.yellowGo = null;
      } else if (sig.color === 'yellow') {
        if (v.yellowGo === null) {
          const stopDist = (v.v * v.v) / (2 * v.brake * 0.9) + 1.0;
          const canStop = dist > stopDist;
          v.yellowGo = !canStop || (TIER_RANK[v.tier] >= TIER_RANK.angry && dist < 35);
        }
        if (!v.yellowGo) mustStopAtLine = true;
      } else {
        // red
        if (v.yellowGo === true && dist < 6) {
          // committed on yellow, already at the line
        } else if (
          v.tier === 'furious' &&
          sig.redFor < C.FURIOUS_RED_GRACE &&
          dist < 15 &&
          v.v > 1.5
        ) {
          v.yellowGo = true;
        } else {
          mustStopAtLine = true;
          v.yellowGo = null;
        }
      }
    }

    // Conflicts inside the box.
    if (v.segment !== 'exit') {
      const myGap = gapAcceptFor(v);
      const sigMine = this.signal.forMovement({ approach: v.approach, turn: v.turn }, t);
      for (const c of p.conflicts) {
        if (c.s <= v.s) continue; // already committed through this point
        const dMe = c.s - v.s;
        if (dMe > C.CONFLICT_LOOKAHEAD) break;
        const stopAt = c.s - C.CONFLICT_MARGIN;
        if (stopAt <= v.s) continue; // too late to stop before it
        const others = byPath.get(c.other) ?? [];
        let yieldHere = false;
        let blockedByStopped = false;
        for (const o of others) {
          if (o.segment === 'exit' || o.segment === 'gone' || o.segment === 'backlog') continue;
          const oRear = o.s - o.length;
          // Occupancy: their body is sitting on the conflict point.
          if (o.s >= c.sOther - 0.6 && oRear <= c.sOther + 0.6) {
            yieldHere = true;
            if (o.v < 0.5) blockedByStopped = true;
            continue;
          }
          if (o.s > c.sOther) continue; // they are past it
          const dO = c.sOther - o.s;
          if (o.segment === 'box') {
            if (v.ignoreYield) continue;
            const oMoving = o.v >= 1.0;
            if (!oMoving && dO > 5) continue; // stopped well short of the point: stuck elsewhere
            const ttaO = dO / Math.max(o.v, 2.5);
            const ttaMe = dMe / Math.max(v.v, 2.5);
            if (oMoving) {
              // A moving vehicle that will get there first has the point.
              if (ttaO < ttaMe + 1.0) yieldHere = true;
              continue;
            }
            // They are stopped just short of the point. Yield only if they outrank us,
            // otherwise we would both sit there waiting for each other.
            const sigO = this.signal.forMovement({ approach: o.approach, turn: o.turn }, t);
            if (sigO.permissive && !sigMine.permissive) continue; // they must yield to us
            if (!sigO.permissive && sigMine.permissive) {
              yieldHere = true;
              continue;
            }
            if (o.boxEntryTime < v.boxEntryTime || (o.boxEntryTime === v.boxEntryTime && o.id < v.id))
              yieldHere = true;
          } else if (o.segment === 'approach') {
            if (v.ignoreYield) continue;
            // Only vehicles that are allowed to go matter, and permissive movements
            // yield to protected ones, not the other way round.
            const sigO = this.signal.forMovement({ approach: o.approach, turn: o.turn }, t);
            if (sigO.color === 'red' && !o.ignoreSignal) continue;
            if (sigO.permissive && !sigMine.permissive) continue;
            if (!sigMine.permissive && !sigO.permissive && sigO.color !== 'red') {
              // Both protected and both green should not conflict; treat as arrival order.
              const ttaO = dO / Math.max(o.v, 3);
              const ttaMe = dMe / Math.max(v.v, 3);
              if (ttaO < ttaMe || (ttaO === ttaMe && o.id < v.id)) yieldHere = true;
              continue;
            }
            const ttaO = dO / Math.max(o.v, 3.0);
            if (ttaO < myGap) yieldHere = true;
          }
        }
        if (yieldHere) {
          v.yielding = true;
          obstacles.push({ gap: stopAt - v.s, speed: 0 });
          // Courteous drivers won't enter the box only to stop inside it.
          if (
            v.segment === 'approach' &&
            blockedByStopped &&
            TIER_RANK[v.tier] <= TIER_RANK.irritated &&
            stopAt - p.sStop < C.BOX_COURTESY_DISTANCE
          ) {
            mustStopAtLine = true;
            v.courtesyHold = true;
          }
          break; // nearest unresolved conflict is what matters
        }
      }
    }

    if (mustStopAtLine) {
      obstacles.push({ gap: p.sStop - C.STOP_LINE_GAP - v.s, speed: 0 });
    }

    // Most restrictive obstacle wins.
    let a = idm(v, v0, Infinity, 0);
    for (const o of obstacles) {
      const ao = idm(v, v0, o.gap, o.speed);
      if (ao < a) a = ao;
    }
    // Hard floor so we never reverse or explode.
    if (a < -3 * v.brake) a = -3 * v.brake;
    // Snap to a stop when crawling into a standstill gap.
    for (const o of obstacles) {
      if (o.speed < 0.2 && o.gap < C.IDM_S0 * 0.6 && v.v < 0.6) return -v.v / C.DT;
    }
    return a;
  }

  /** True when the active phase has nobody to serve (fuel for spite). */
  private isGreenEmpty(t: number, byPath: Map<Path, Vehicle[]>): boolean {
    const st = this.signal.state(t);
    if (st.color !== 'green') return false;
    const served = this.signal.movementsInPhase(st.phaseIndex);
    for (const m of served) {
      for (const lane of this.geometry.lanes[m.approach]) {
        for (const p of lane.paths) {
          if (p.turn !== m.turn) continue;
          for (const o of byPath.get(p) ?? []) {
            if (o.segment === 'box') return false;
            if (o.segment === 'approach' && p.sStop - o.s < 45) return false;
          }
        }
      }
    }
    return true;
  }

  // --- Rage -------------------------------------------------------------------

  private updateRage(
    v: Vehicle,
    dt: number,
    waiting: boolean,
    emptyGreen: boolean,
    byLane: Map<ApproachLane, Vehicle[]>,
  ): void {
    if (waiting) {
      v.waitTime += dt;
      if (v.waitTime > this.stats.worstWait) {
        this.stats.worstWait = v.waitTime;
        this.stats.worstWaitMovement = { approach: v.approach, turn: v.turn };
      }
      if (v.wasMoving) {
        v.stops++;
        v.wasMoving = false;
        if (v.stops > 1 && !v.blown) v.rage += C.RAGE_STOP_GO;
      }
      if (!v.blown) {
        const over = v.waitTime - v.patience;
        if (over > 0) v.rage += (over / C.RAGE_K) * dt;
        if (emptyGreen && v.segment === 'approach') v.rage += C.RAGE_SPITE * dt;
      }
    } else if (v.v > 1.5) {
      v.wasMoving = true;
    }

    // Contagion: honking neighbours in my lane wear me down.
    if (!v.blown && v.lane && v.segment === 'approach') {
      const arr = byLane.get(v.lane);
      if (arr) {
        const idx = arr.indexOf(v);
        for (const j of [idx - 1, idx + 1]) {
          const o = arr[j];
          if (!o || TIER_RANK[o.tier] < TIER_RANK.angry) continue;
          const radius = C.RAGE_CONTAGION_RADIUS * o.contagionMult;
          if (Math.abs(o.s - v.s) < radius + o.length) v.rage += C.RAGE_CONTAGION * o.contagionMult * dt;
        }
      }
    }

    const newTier = tierOf(v.rage);
    if (newTier !== v.tier) {
      v.tier = newTier;
      if (TIER_RANK[newTier] >= TIER_RANK.angry) this.honk(v);
    }
    if (TIER_RANK[v.tier] >= TIER_RANK.angry && waiting && v.honkTimer <= 0 && !v.stalled) {
      // Periodic honking while stuck.
      this.honk(v);
    }
    if (v.tier === 'blown' && !v.blown) this.blow(v);
  }

  private honk(v: Vehicle): void {
    const period = v.tier === 'angry' ? 4.5 : v.tier === 'furious' ? 2.5 : 1.5;
    v.honkTimer = period * (0.8 + 0.4 * this.rng.next());
    this.events.push({ type: 'honk', vehicle: v });
  }

  private blow(v: Vehicle): void {
    v.blown = true;
    v.rage = C.RAGE_CAP;
    this.stats.rageEvents++;
    v.shake = 1.2;
    const fate = this.rng.weighted<Fate>(
      ['bail', 'stall', 'seethe', 'shove'],
      [C.FATE_WEIGHTS.bail, C.FATE_WEIGHTS.stall, C.FATE_WEIGHTS.seethe, C.FATE_WEIGHTS.shove],
    );
    v.fate = v.segment === 'backlog' ? 'bail' : fate;
    switch (v.fate) {
      case 'bail':
        this.stats.bails++;
        v.fateTimer = 1.5;
        break;
      case 'stall':
        this.stats.stalls++;
        v.stalled = true;
        v.fateTimer = this.rng.range(C.STALL_MIN, C.STALL_MAX) + C.TOW_HOOKUP;
        break;
      case 'seethe':
        this.stats.seethes++;
        v.contagionMult = 2;
        break;
      case 'shove':
        this.stats.shoves++;
        v.ignoreSignal = true;
        v.ignoreYield = true;
        break;
    }
    this.events.push({ type: 'blow', vehicle: v, fate: v.fate });
  }

  private updateFate(v: Vehicle, dt: number): void {
    if (!v.fate) return;
    if (v.fate === 'bail') {
      v.fateTimer -= dt;
      if (v.fateTimer <= 0) {
        // Splash some rage on the neighbours as they swing out of the queue.
        for (const o of this.vehicles) {
          if (o === v || o.lane !== v.lane || o.segment !== 'approach' || o.blown) continue;
          if (Math.abs(o.s - v.s) < C.BAIL_RADIUS) o.rage += C.BAIL_SPLASH;
        }
        this.retire(v);
      }
    } else if (v.fate === 'stall') {
      v.fateTimer -= dt;
      if (v.fateTimer <= C.TOW_HOOKUP && v.fateTimer + dt > C.TOW_HOOKUP) {
        this.events.push({ type: 'tow', vehicle: v });
      }
      if (v.fateTimer <= 0) this.retire(v);
    }
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** Problems with a plan that would make the run meaningless. */
export function validatePlan(level: LevelDef, plan: Plan): string[] {
  const errors: string[] = [];
  const names: Record<Approach, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };
  const turnNames: Record<Turn, string> = { L: 'left turns', T: 'through traffic', R: 'right turns' };
  for (const a of APPROACHES) {
    const d = level.demand[a];
    for (const tn of TURNS) {
      if (d.turns[tn] <= 0 || d.peak <= 0) continue;
      if (!plan.lanes[a].some((l) => assignmentAllows(l, tn)))
        errors.push(`No lane from ${names[a]} serves ${turnNames[tn]}.`);
    }
  }
  return errors;
}

/** Movements that actually carry demand in a level. */
export function demandedMovements(level: LevelDef): Movement[] {
  const out: Movement[] = [];
  for (const a of APPROACHES) {
    for (const tn of TURNS) {
      if (level.demand[a].peak > 0 && level.demand[a].turns[tn] > 0) out.push({ approach: a, turn: tn });
    }
  }
  return out;
}
