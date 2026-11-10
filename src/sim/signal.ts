import { ALL_RED, MAX_GREEN, MIN_GREEN, YELLOW } from './constants';
import type { Movement, PatternDef, PatternId, SignalColor, SignalState } from './types';
import { movementKey } from './types';

const NS_ALL: Movement[] = [
  { approach: 'N', turn: 'T' },
  { approach: 'N', turn: 'R' },
  { approach: 'S', turn: 'T' },
  { approach: 'S', turn: 'R' },
];
const EW_ALL: Movement[] = [
  { approach: 'E', turn: 'T' },
  { approach: 'E', turn: 'R' },
  { approach: 'W', turn: 'T' },
  { approach: 'W', turn: 'R' },
];
const NS_LEFTS: Movement[] = [
  { approach: 'N', turn: 'L' },
  { approach: 'S', turn: 'L' },
];
const EW_LEFTS: Movement[] = [
  { approach: 'E', turn: 'L' },
  { approach: 'W', turn: 'L' },
];

export const PATTERNS: Record<PatternId, PatternDef> = {
  'two-phase': {
    id: 'two-phase',
    name: '2-phase',
    phases: [
      { label: 'N/S', movements: [...NS_ALL, ...NS_LEFTS], permissive: NS_LEFTS },
      { label: 'E/W', movements: [...EW_ALL, ...EW_LEFTS], permissive: EW_LEFTS },
    ],
    defaultGreens: [30, 30],
  },
  'protected-lefts': {
    id: 'protected-lefts',
    name: 'Protected lefts',
    phases: [
      { label: 'N/S ←', movements: NS_LEFTS, permissive: [] },
      { label: 'N/S', movements: NS_ALL, permissive: [] },
      { label: 'E/W ←', movements: EW_LEFTS, permissive: [] },
      { label: 'E/W', movements: EW_ALL, permissive: [] },
    ],
    defaultGreens: [10, 25, 10, 25],
  },
};

export function clampGreen(g: number): number {
  return Math.max(MIN_GREEN, Math.min(MAX_GREEN, Math.round(g)));
}

export function phaseLength(green: number): number {
  return green + YELLOW + ALL_RED;
}

export function cycleLength(greens: number[]): number {
  return greens.reduce((a, g) => a + phaseLength(g), 0);
}

/** Fixed-time signal controller. Pure: state is a function of time. */
export class SignalController {
  readonly pattern: PatternDef;
  readonly greens: number[];
  readonly cycle: number;
  private readonly phaseStarts: number[];
  /** movementKey -> phase index where it is green (first match). */
  private readonly phaseOf = new Map<string, number[]>();
  private readonly permissiveKeys = new Set<string>();

  constructor(pattern: PatternDef, greens: number[]) {
    this.pattern = pattern;
    this.greens = greens.map(clampGreen);
    this.cycle = cycleLength(this.greens);
    this.phaseStarts = [];
    let t = 0;
    for (const g of this.greens) {
      this.phaseStarts.push(t);
      t += phaseLength(g);
    }
    pattern.phases.forEach((ph, i) => {
      for (const m of ph.movements) {
        const k = movementKey(m);
        const arr = this.phaseOf.get(k) ?? [];
        arr.push(i);
        this.phaseOf.set(k, arr);
      }
      for (const m of ph.permissive) this.permissiveKeys.add(`${i}:${movementKey(m)}`);
    });
  }

  state(t: number): SignalState {
    const ct = ((t % this.cycle) + this.cycle) % this.cycle;
    let i = this.phaseStarts.length - 1;
    while (i > 0 && this.phaseStarts[i] > ct) i--;
    const pt = ct - this.phaseStarts[i];
    const g = this.greens[i];
    const color: SignalColor = pt < g ? 'green' : pt < g + YELLOW ? 'yellow' : 'red';
    return { phaseIndex: i, phaseTime: pt, cycleTime: ct, cycleLength: this.cycle, color };
  }

  /** Signal colour facing a movement at time t, plus seconds since it turned red. */
  forMovement(m: Movement, t: number): { color: SignalColor; redFor: number; permissive: boolean } {
    const st = this.state(t);
    const phases = this.phaseOf.get(movementKey(m));
    if (!phases || phases.length === 0) return { color: 'red', redFor: 1e9, permissive: false };
    if (phases.includes(st.phaseIndex) && st.color !== 'red') {
      return {
        color: st.color,
        redFor: 0,
        permissive: this.permissiveKeys.has(`${st.phaseIndex}:${movementKey(m)}`),
      };
    }
    // Red. How long ago did our most recent green phase end its yellow?
    let redFor = Infinity;
    for (const pi of phases) {
      const end = this.phaseStarts[pi] + this.greens[pi] + YELLOW; // start of all-red
      let d = st.cycleTime - end;
      if (d < 0) d += this.cycle;
      redFor = Math.min(redFor, d);
    }
    return { color: 'red', redFor, permissive: false };
  }

  /** Is any movement in the current phase served? Used for the spite tax. */
  movementsInPhase(i: number): Movement[] {
    return this.pattern.phases[i].movements;
  }
}
