import type { Approach, LevelDef } from './types';

/**
 * Rush-hour shape: traffic ramps in, plateaus, then tails off.
 * u is the fraction of the run elapsed, in [0, 1].
 */
export function rushShape(u: number): number {
  if (u < 0.15) return 0.45 + (u / 0.15) * 0.3;
  if (u < 0.35) return 0.75 + ((u - 0.15) / 0.2) * 0.25;
  if (u < 0.7) return 1.0;
  return 1.0 - ((u - 0.7) / 0.3) * 0.65;
}

/** Vehicles per second arriving on an approach at simulated time t. */
export function arrivalRate(level: LevelDef, approach: Approach, t: number): number {
  const u = Math.max(0, Math.min(1, t / level.duration));
  let mult = rushShape(u);
  for (const s of level.surges ?? []) {
    if (s.approach === approach && u >= s.start && u < s.end) mult *= s.mult;
  }
  return (level.demand[approach].peak * mult) / 3600;
}
