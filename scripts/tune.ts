/**
 * Headless tuning harness. Runs every level with its default plan and a set of
 * candidate plans across several seeds and prints score distributions, so star
 * thresholds and rage constants can be set from data rather than vibes.
 *
 *   npm run tune            # all levels
 *   npm run tune -- c2-pocket   # one level
 *   npm run tune -- c2-pocket --grid   # coarse grid search over greens
 */
import { LEVELS, clonePlan } from '../src/levels/levels';
import { PATTERNS, Simulation, hashString } from '../src/sim';
import type { LaneAssignment, LevelDef, Plan, RunStats } from '../src/sim';

const args = process.argv.slice(2);
const onlyId = args.find((a) => !a.startsWith('--'));
const grid = args.includes('--grid');
const SEEDS = 5;

function seedsFor(level: LevelDef): number[] {
  const out: number[] = [];
  for (let i = 0; i < SEEDS; i++) out.push(hashString(level.id + ':' + i));
  return out;
}

function runPlan(level: LevelDef, plan: Plan, seeds: number[]): RunStats[] {
  return seeds.map((s) => new Simulation(level, plan, s).run());
}

function summarize(label: string, stats: RunStats[]): void {
  const scores = stats.map((s) => s.score).sort((a, b) => a - b);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const med = scores[Math.floor(scores.length / 2)];
  const grid = stats.filter((s) => s.gridlocked).length;
  console.log(
    `  ${label.padEnd(44)} score med ${String(med).padStart(5)}  min ${String(scores[0]).padStart(5)}  max ${String(
      scores[scores.length - 1],
    ).padStart(5)}  thru ${mean(stats.map((s) => s.throughput)).toFixed(0).padStart(4)}  rage ${mean(
      stats.map((s) => s.rage),
    )
      .toFixed(0)
      .padStart(4)}  events ${mean(stats.map((s) => s.rageEvents)).toFixed(1).padStart(4)}  worst ${mean(
      stats.map((s) => s.worstWait),
    )
      .toFixed(0)
      .padStart(3)}s  gridlock ${grid}/${stats.length}`,
  );
}

/** Hand-picked lane layouts worth trying per lane count. */
function laneOptions(level: LevelDef): Record<string, Plan['lanes']>[] {
  const base = level.defaultPlan.lanes;
  const opts: Record<string, Plan['lanes']>[] = [{ default: base }];
  if (!level.lanesEditable) return opts;
  const two = (a: LaneAssignment, b: LaneAssignment): LaneAssignment[] => [a, b];
  const ns = level.lanesNS === 2 ? [two('L', 'TR'), two('LT', 'TR')] : [base.N];
  const ew = level.lanesEW === 2 ? [two('L', 'TR'), two('LT', 'TR')] : [base.E];
  const names = ['L|TR', 'LT|TR'];
  for (let i = 0; i < ns.length; i++) {
    for (let j = 0; j < ew.length; j++) {
      if (level.lanesEW === 2 && i !== j && !(i === 0 && j === 1)) continue;
      const key = `NS ${names[i]} / EW ${level.lanesEW === 2 ? names[j] : 'LTR'}`;
      opts.push({ [key]: { N: ns[i], S: ns[i], E: ew[j], W: ew[j] } });
    }
  }
  return opts;
}

function greensOptions(pattern: Plan['pattern']): number[][] {
  const n = PATTERNS[pattern].phases.length;
  const values = grid ? [8, 15, 25, 35, 50] : [10, 20, 35];
  const out: number[][] = [];
  const rec = (acc: number[]) => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (const v of values) rec([...acc, v]);
  };
  rec([]);
  return out;
}

for (const level of LEVELS) {
  if (onlyId && level.id !== onlyId) continue;
  const seeds = seedsFor(level);
  console.log(`\n== ${level.title} (${level.id}) duration ${level.duration}s`);
  summarize('default plan', runPlan(level, level.defaultPlan, seeds));

  let best: { label: string; med: number } | null = null;
  for (const pattern of level.patterns) {
    for (const laneOpt of laneOptions(level)) {
      const [laneName, lanes] = Object.entries(laneOpt)[0];
      const results: { label: string; stats: RunStats[]; med: number }[] = [];
      for (const greens of greensOptions(pattern)) {
        const plan = clonePlan(level.defaultPlan);
        plan.pattern = pattern;
        plan.lanes = lanes;
        plan.greens = greens;
        const stats = runPlan(level, plan, seeds);
        const scores = stats.map((s) => s.score).sort((a, b) => a - b);
        const med = scores[Math.floor(scores.length / 2)];
        results.push({ label: `${pattern} ${laneName} [${greens.join(',')}]`, stats, med });
      }
      results.sort((a, b) => b.med - a.med);
      for (const r of results.slice(0, 3)) summarize(r.label, r.stats);
      if (!best || results[0].med > best.med) best = { label: results[0].label, med: results[0].med };
    }
  }
  if (best) console.log(`  BEST: ${best.label} -> median ${best.med}`);
}
