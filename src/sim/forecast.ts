import { YELLOW } from './constants';
import { PATTERNS, cycleLength } from './signal';
import type { Approach, LevelDef, Plan, Turn } from './types';
import { APPROACHES, TURNS, assignmentAllows, movementKey } from './types';

/**
 * A back-of-the-envelope forecast of a plan, shown while the player is still
 * planning. It is deliberately simple capacity arithmetic, not a simulation:
 * how much green each lane gets versus how much traffic it has to move, and
 * how long each approach sits at red. Calibrated against the sim's measured
 * discharge rate so "backs up" means the queue really will grow.
 */

/** Vehicles one lane clears per hour of green once the queue is rolling (2.3 s headway, measured in the sim). */
export const LANE_SATURATION = 1560;
/** Extra usable seconds per green: the yellow carries one more car, which cancels the start-up delay. */
export const GREEN_BONUS = 1;
/** The rush ramps in and out, so the hour averages this fraction of the peak rate. */
export const RUSH_AVERAGE = 0.8;
/** A yielding (permissive) left clears this fraction of what a protected one would. */
export const PERMISSIVE_FACTOR = 0.55;

export type FlowStatus = 'flows' | 'tight' | 'backs-up';

export interface ApproachForecast {
  approach: Approach;
  /** Vehicles per hour at the peak. */
  demand: number;
  /** Worst lane's volume-to-capacity ratio (1.0 = exactly saturated). */
  vc: number;
  status: FlowStatus;
  /** Share of the cycle the worst lane would need to keep up, 0..1+. */
  neededShare: number;
  /** Share of the cycle the worst lane actually gets. */
  greenShare: number;
  /** Longest continuous red the main movement faces, seconds. */
  longestRed: number;
}

export interface Forecast {
  cycle: number;
  approaches: Record<Approach, ApproachForecast>;
  /** The approach in the most trouble, or null when nothing has demand. */
  worst: Approach | null;
  longestRed: number;
  longestRedApproaches: Approach[];
  /** One plain sentence for the panel. */
  verdict: string;
  /** 'ok' | 'warn' | 'bad' for colouring the verdict. */
  tone: 'ok' | 'warn' | 'bad';
}

export const APPROACH_LABEL: Record<Approach, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };

export function statusOf(vc: number): FlowStatus {
  if (vc >= 1.0) return 'backs-up';
  if (vc >= 0.8) return 'tight';
  return 'flows';
}

export function forecast(level: LevelDef, plan: Plan): Forecast {
  const pattern = PATTERNS[plan.pattern];
  const cycle = cycleLength(plan.greens);

  // Green seconds per movement and whether that green is permissive.
  const green = new Map<string, number>();
  const permissive = new Set<string>();
  pattern.phases.forEach((ph, i) => {
    for (const m of ph.movements) {
      const k = movementKey(m);
      green.set(k, (green.get(k) ?? 0) + plan.greens[i]);
    }
    for (const m of ph.permissive) permissive.add(movementKey(m));
  });

  const approaches = {} as Record<Approach, ApproachForecast>;
  let worst: Approach | null = null;
  let longestRed = 0;
  const longestRedApproaches: Approach[] = [];

  for (const a of APPROACHES) {
    const d = level.demand[a];
    const turnTotal = d.turns.L + d.turns.T + d.turns.R || 1;
    const lanes = plan.lanes[a];
    const lanesServing = (t: Turn) => lanes.filter((l) => assignmentAllows(l, t)).length;

    let worstVc = 0;
    let worstNeeded = 0;
    let worstShare = 0;
    for (const lane of lanes) {
      // Time-sharing: a shared lane's load is the sum of each movement's share of its capacity.
      let vc = 0;
      let neededSeconds = 0;
      let laneGreen = 0;
      for (const t of TURNS) {
        if (!assignmentAllows(lane, t)) continue;
        const n = lanesServing(t);
        const demandHere = n > 0 ? (d.peak * RUSH_AVERAGE * (d.turns[t] / turnTotal)) / n : 0;
        const k = a + t;
        const g = green.get(k) ?? 0;
        laneGreen = Math.max(laneGreen, g);
        const factor = permissive.has(k) && t === 'L' ? PERMISSIVE_FACTOR : 1;
        const effective = g > 0 ? g + GREEN_BONUS : 0;
        const capacity = (LANE_SATURATION * factor * effective) / cycle;
        if (demandHere <= 0) continue;
        vc += capacity > 0 ? demandHere / capacity : 99;
        neededSeconds += (demandHere * cycle) / (LANE_SATURATION * factor);
      }
      if (vc > worstVc) {
        worstVc = vc;
        worstNeeded = Math.min(1.5, Math.max(0, neededSeconds - GREEN_BONUS) / cycle);
        worstShare = laneGreen / cycle;
      }
    }

    // Longest red for the approach's main movement (through, else the busiest turn).
    let main: Turn = 'T';
    if (d.turns.T <= 0) main = d.turns.L >= d.turns.R ? 'L' : 'R';
    let servedTime = 0;
    pattern.phases.forEach((ph, i) => {
      if (ph.movements.some((m) => m.approach === a && m.turn === main)) servedTime += plan.greens[i] + YELLOW;
    });
    const red = Math.max(0, Math.round(cycle - servedTime));

    const f: ApproachForecast = {
      approach: a,
      demand: d.peak,
      vc: worstVc,
      status: statusOf(worstVc),
      neededShare: worstNeeded,
      greenShare: worstShare,
      longestRed: red,
    };
    approaches[a] = f;
    if (d.peak > 0) {
      if (!worst || worstVc > approaches[worst].vc) worst = a;
      if (red > longestRed) {
        longestRed = red;
        longestRedApproaches.length = 0;
        longestRedApproaches.push(a);
      } else if (red === longestRed) longestRedApproaches.push(a);
    }
  }

  const { verdict, tone } = describe(approaches, worst, longestRed, longestRedApproaches);
  return { cycle, approaches, worst, longestRed, longestRedApproaches, verdict, tone };
}

function names(list: Approach[]): string {
  const n = list.map((a) => APPROACH_LABEL[a]);
  if (n.length <= 1) return n[0] ?? '';
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function describe(
  approaches: Record<Approach, ApproachForecast>,
  worst: Approach | null,
  longestRed: number,
  redApproaches: Approach[],
): { verdict: string; tone: Forecast['tone'] } {
  if (!worst) return { verdict: 'No traffic expected.', tone: 'ok' };
  const w = approaches[worst];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (w.vc >= 1.0) {
    const others = APPROACHES.filter((a) => a !== worst && approaches[a].vc >= 1.0 && approaches[a].demand > 0);
    const who = others.length ? names([worst, ...others]) : APPROACH_LABEL[worst];
    const verb = others.length ? 'will back up' : 'will back up';
    return {
      verdict: `${who} ${verb}: ${others.length ? 'the worst lane' : 'its busiest lane'} needs ${pct(w.neededShare)} of the cycle and gets ${pct(w.greenShare)}.`,
      tone: 'bad',
    };
  }
  if (longestRed >= 90) {
    return {
      verdict: `Everything should clear, but ${names(redApproaches)} sit through ${longestRed} s reds. Tempers will go.`,
      tone: 'bad',
    };
  }
  if (w.vc >= 0.8) {
    return {
      verdict: `Tight on ${APPROACH_LABEL[worst]} at ${pct(w.vc)} of capacity. Longest red ${longestRed} s for ${names(redApproaches)}.`,
      tone: 'warn',
    };
  }
  if (longestRed >= 60) {
    return {
      verdict: `Flows, but ${names(redApproaches)} wait up to ${longestRed} s at a red. A shorter cycle would help tempers.`,
      tone: 'warn',
    };
  }
  return { verdict: `Flows with room to spare. Longest red ${longestRed} s.`, tone: 'ok' };
}
