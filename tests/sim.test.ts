import { describe, expect, it } from 'vitest';
import { LEVELS, clonePlan } from '../src/levels/levels';
import { POCKET_LENGTH, Simulation, buildGeometry, validatePlan } from '../src/sim';

describe('simulation', () => {
  it('is deterministic for the same seed', () => {
    const level = LEVELS[2];
    const a = new Simulation(level, level.defaultPlan, 12345).run();
    const b = new Simulation(level, level.defaultPlan, 12345).run();
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const level = LEVELS[0];
    const a = new Simulation(level, level.defaultPlan, 1).run();
    const b = new Simulation(level, level.defaultPlan, 2).run();
    expect(a.throughput !== b.throughput || a.rage !== b.rage).toBe(true);
  });

  it('moves traffic and finishes in bounded time on every level', () => {
    for (const level of LEVELS) {
      const sim = new Simulation(level, level.defaultPlan, 7);
      const stats = sim.run();
      expect(sim.t).toBeLessThanOrEqual(level.duration + 46);
      expect(stats.throughput).toBeGreaterThan(20);
      expect(Number.isFinite(stats.score)).toBe(true);
      expect(stats.worstWait).toBeLessThan(1000);
    }
  });

  it('rewards giving green to the busy road on First Light', () => {
    const level = LEVELS[0];
    const even = clonePlan(level.defaultPlan);
    even.greens = [20, 20];
    const skewed = clonePlan(level.defaultPlan);
    skewed.greens = [40, 8];
    const seeds = [1, 2, 3, 4];
    const mean = (p: typeof even) =>
      seeds.reduce((acc, s) => acc + new Simulation(level, p, s).run().score, 0) / seeds.length;
    expect(mean(skewed)).toBeGreaterThan(mean(even));
  });

  it('flags lanes that cannot serve demanded turns', () => {
    const level = LEVELS[3];
    const plan = clonePlan(level.defaultPlan);
    plan.lanes.N = ['T', 'T'];
    const errors = validatePlan(level, plan);
    expect(errors.some((e) => e.includes('North') && e.includes('left'))).toBe(true);
  });
});

describe('geometry', () => {
  it('finds crossing conflicts but not merges or opposing lefts', () => {
    const g = buildGeometry(1, 1, { N: ['LTR'], E: ['LTR'], S: ['LTR'], W: ['LTR'] });
    const find = (a: string, t: string) => g.paths.find((p) => p.approach === a && p.turn === t)!;
    const nT = find('N', 'T');
    const eT = find('E', 'T');
    const nL = find('N', 'L');
    const sL = find('S', 'L');
    const sT = find('S', 'T');
    expect(nT.conflicts.some((c) => c.other === eT)).toBe(true);
    expect(nL.conflicts.some((c) => c.other === sT)).toBe(true);
    expect(nL.conflicts.some((c) => c.other === sL)).toBe(false);
    // Opposing throughs run parallel and never conflict.
    expect(nT.conflicts.some((c) => c.other === sT)).toBe(false);
  });
});

describe('pocket lanes', () => {
  it('queues pocket-bound vehicles in the feeder lane until they reach the entrance', () => {
    const level = LEVELS[3]; // Pocket: two lanes N/S
    const plan = clonePlan(level.defaultPlan);
    plan.lanes.N = ['L', 'TR'];
    plan.lanes.S = ['L', 'TR'];
    const sim = new Simulation(level, plan, 11);
    let sawFeeder = false;
    let sawMerged = false;
    while (!sim.done && sim.t < 120) {
      sim.step();
      for (const v of sim.vehicles) {
        if (v.approach !== 'N' || v.turn !== 'L' || v.segment !== 'approach') continue;
        if (v.feeder) sawFeeder = true;
        if (!v.feeder && v.lane?.pocket) {
          sawMerged = true;
          // Nobody drives in the unusable part of the pocket.
          expect(v.s).toBeGreaterThan(v.path!.sStop - POCKET_LENGTH - 9);
        }
      }
    }
    expect(sawFeeder).toBe(true);
    expect(sawMerged).toBe(true);
  });
});
