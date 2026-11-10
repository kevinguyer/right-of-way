import * as C from './constants';
import type { ApproachLane, Path } from './geometry';
import type { Rng } from './rng';
import type { Approach, Fate, RageTier, Segment, Turn, VehicleKind } from './types';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  length: number;
  width: number;
  accel: number;
  brake: number;
  /** Render colour slot 0..5 (rage tint overrides). */
  paint: number;

  approach: Approach;
  turn: Turn;
  lane: ApproachLane | null;
  path: Path | null;
  /** While set, the vehicle is queuing in this lane waiting to enter its pocket lane. */
  feeder: ApproachLane | null;
  /** The feeder lane this vehicle came from (kept after merging, for the render slide). */
  feederLane: ApproachLane | null;
  /** 1 → 0 after merging into the pocket, for the lateral slide animation. */
  mergeAnim: number;

  segment: Segment;
  /** Front-bumper distance along the path. */
  s: number;
  v: number;
  /** Acceleration computed this step (for render + smoothing). */
  a: number;

  // Temperament
  patience: number;
  /** Multiplier on the gap a driver demands; <1 is aggressive. */
  aggression: number;

  // Rage bookkeeping
  waitTime: number;
  stops: number;
  wasMoving: boolean;
  rage: number;
  tier: RageTier;
  blown: boolean;
  fate: Fate | null;
  /** Seconds remaining in the current fate behaviour (stall / bail). */
  fateTimer: number;
  stalled: boolean;
  /** Set once a shove or furious red-run is committed. */
  ignoreSignal: boolean;
  ignoreYield: boolean;
  contagionMult: number;

  spawnTime: number;
  boxEntryTime: number;
  /** Latched yellow/red decision for the current signal interval. */
  yellowGo: boolean | null;
  /** Did this vehicle stop at the line because it refused to block the box? */
  courtesyHold: boolean;
  /** Set while waiting for a conflict in the box (render hint). */
  yielding: boolean;
  counted: boolean;
  honkTimer: number;
  shake: number;
  brakeCooldown: number;
}

let nextId = 1;

export function resetVehicleIds(): void {
  nextId = 1;
}

export function makeVehicle(
  rng: Rng,
  approach: Approach,
  turn: Turn,
  t: number,
): Vehicle {
  const kind = rng.weighted<VehicleKind>(
    ['car', 'suv', 'truck'],
    [C.VEHICLES.car.weight, C.VEHICLES.suv.weight, C.VEHICLES.truck.weight],
  );
  const spec = C.VEHICLES[kind];
  return {
    id: nextId++,
    kind,
    length: spec.length,
    width: spec.width,
    accel: spec.accel,
    brake: spec.brake,
    paint: rng.int(6),
    approach,
    turn,
    lane: null,
    path: null,
    feeder: null,
    feederLane: null,
    mergeAnim: 0,
    segment: 'backlog',
    s: 0,
    v: 0,
    a: 0,
    patience: rng.tri(C.PATIENCE_MIN, C.PATIENCE_MODE, C.PATIENCE_MAX),
    aggression: rng.range(0.75, 1.25),
    waitTime: 0,
    stops: 0,
    wasMoving: true,
    rage: 0,
    tier: 'calm',
    blown: false,
    fate: null,
    fateTimer: 0,
    stalled: false,
    ignoreSignal: false,
    ignoreYield: false,
    contagionMult: 1,
    spawnTime: t,
    boxEntryTime: Infinity,
    yellowGo: null,
    courtesyHold: false,
    yielding: false,
    counted: false,
    honkTimer: 0,
    shake: 0,
    brakeCooldown: 0,
  };
}

export function tierOf(rage: number): RageTier {
  if (rage >= C.TIER_BLOWN) return 'blown';
  if (rage >= C.TIER_FURIOUS) return 'furious';
  if (rage >= C.TIER_ANGRY) return 'angry';
  if (rage >= C.TIER_IRRITATED) return 'irritated';
  return 'calm';
}

export const TIER_RANK: Record<RageTier, number> = {
  calm: 0,
  irritated: 1,
  angry: 2,
  furious: 3,
  blown: 4,
};

/** Desired time headway shrinks as tempers rise. */
export function headwayFor(v: Vehicle): number {
  switch (v.tier) {
    case 'calm':
      return C.IDM_T;
    case 'irritated':
      return C.IDM_T * 0.85;
    default:
      return C.IDM_T * 0.7;
  }
}

/** Seconds of oncoming gap this driver insists on before turning across traffic. */
export function gapAcceptFor(v: Vehicle): number {
  let g = C.GAP_ACCEPT * v.aggression;
  if (v.tier === 'angry') g *= 0.7;
  else if (v.tier === 'furious' || v.tier === 'blown') g *= 0.45;
  return g;
}

/**
 * Intelligent Driver Model acceleration given a gap to an obstacle moving at
 * leaderV. Pass gap = Infinity for free road.
 */
export function idm(v: Vehicle, v0: number, gap: number, leaderV: number): number {
  const free = v.accel * (1 - Math.pow(Math.max(0, v.v) / v0, C.IDM_DELTA));
  if (!isFinite(gap)) return free;
  const g = Math.max(gap, 0.1);
  const dv = v.v - leaderV;
  const sStar =
    C.IDM_S0 +
    Math.max(0, v.v * headwayFor(v) + (v.v * dv) / (2 * Math.sqrt(v.accel * v.brake)));
  const inter = -v.accel * (sStar / g) * (sStar / g);
  return free + inter;
}
