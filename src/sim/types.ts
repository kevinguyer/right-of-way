/** Compass approach a vehicle arrives FROM. A vehicle from N travels south. */
export type Approach = 'N' | 'E' | 'S' | 'W';
export const APPROACHES: readonly Approach[] = ['N', 'E', 'S', 'W'];

export type Turn = 'L' | 'T' | 'R';
export const TURNS: readonly Turn[] = ['L', 'T', 'R'];

/** What a single approach lane is painted for. */
export type LaneAssignment = 'L' | 'LT' | 'T' | 'TR' | 'R' | 'LTR';

export function assignmentAllows(a: LaneAssignment, t: Turn): boolean {
  return a.includes(t);
}

export interface Vec {
  x: number;
  y: number;
}

/** A movement is an approach plus a turn: "left from North". */
export interface Movement {
  approach: Approach;
  turn: Turn;
}

export function movementKey(m: Movement): string {
  return m.approach + m.turn;
}

/** The player's plan for one run. */
export interface Plan {
  /** Lane assignments per approach, leftmost lane first (driver's view). */
  lanes: Record<Approach, LaneAssignment[]>;
  /** Which signal pattern is in use. */
  pattern: PatternId;
  /** Green seconds per phase, in pattern phase order. */
  greens: number[];
}

export type PatternId = 'two-phase' | 'protected-lefts';

export interface PhaseDef {
  /** Short label for the dial, e.g. "N/S". */
  label: string;
  /** Movements that are green during this phase. */
  movements: Movement[];
  /** Movements that are green but must yield (permissive lefts). */
  permissive: Movement[];
}

export interface PatternDef {
  id: PatternId;
  name: string;
  phases: PhaseDef[];
  defaultGreens: number[];
}

export type SignalColor = 'green' | 'yellow' | 'red';

export interface SignalState {
  phaseIndex: number;
  /** Seconds into the current phase (green + yellow + all-red). */
  phaseTime: number;
  /** Seconds into the current cycle. */
  cycleTime: number;
  cycleLength: number;
  /** 'green' | 'yellow' | 'red' for the active phase's movements. */
  color: SignalColor;
}

export type VehicleKind = 'car' | 'suv' | 'truck';

export type RageTier = 'calm' | 'irritated' | 'angry' | 'furious' | 'blown';

export type Fate = 'bail' | 'stall' | 'seethe' | 'shove';

export type Segment = 'backlog' | 'approach' | 'box' | 'exit' | 'gone';

export interface DemandSpec {
  /** Peak vehicles per hour on this approach. */
  peak: number;
  /** Turning fractions, need not sum to 1. */
  turns: { L: number; T: number; R: number };
}

export interface Surge {
  approach: Approach;
  /** Fraction of the run [0,1] when the surge starts / ends. */
  start: number;
  end: number;
  /** Multiplier applied to that approach's demand. */
  mult: number;
}

export interface LevelDef {
  id: string;
  chapter: number;
  index: number;
  title: string;
  blurb: string;
  /** Lanes per direction on the N/S road and the E/W road. */
  lanesNS: number;
  lanesEW: number;
  /** Can the player repaint lanes? */
  lanesEditable: boolean;
  patterns: PatternId[];
  demand: Record<Approach, DemandSpec>;
  surges?: Surge[];
  /** Run length in simulated seconds. */
  duration: number;
  /** Clock shown to the player: start hour (24h) and minutes represented by the run. */
  clockStart: number;
  clockSpan: number;
  /** Score needed for 1, 2, 3 stars. */
  stars: [number, number, number];
  /** Optional challenge goal text (not enforced in MVP). */
  challenge?: string;
  /** Starting plan. */
  defaultPlan: Plan;
}

export interface RunStats {
  throughput: number;
  rage: number;
  rageEvents: number;
  score: number;
  worstWait: number;
  worstWaitMovement: Movement | null;
  gridlocked: boolean;
  gridlockTime: number;
  stalls: number;
  bails: number;
  shoves: number;
  seethes: number;
  spawned: number;
  avgWait: number;
  hardBrakes: number;
}
