/**
 * Quick plan comparison for one level: a few named plans across a few seeds.
 *
 *   npx tsx scripts/quick.ts c2-pocket
 *   npx tsx scripts/quick.ts c2-pocket "two-phase|LT,TR|LTR|35,20" "protected-lefts|L,TR|L,TR|10,25,10,25"
 *
 * Plan spec: pattern | N and S lanes | E and W lanes | greens
 */
import { LEVELS, clonePlan } from '../src/levels/levels';
import { Simulation, hashString } from '../src/sim';
import type { LaneAssignment, Plan } from '../src/sim';

const [id, ...specs] = process.argv.slice(2);
const level = LEVELS.find((l) => l.id === id);
if (!level) {
  console.error('unknown level', id, 'known:', LEVELS.map((l) => l.id).join(', '));
  process.exit(1);
}
const seeds = [0, 1, 2, 3, 4].map((i) => hashString(level.id + ':' + i));

function parse(spec: string): Plan {
  const [pattern, ns, ew, greens] = spec.split('|');
  const p = clonePlan(level!.defaultPlan);
  p.pattern = pattern as Plan['pattern'];
  const nsL = ns.split(',') as LaneAssignment[];
  const ewL = ew.split(',') as LaneAssignment[];
  p.lanes = { N: nsL, S: [...nsL], E: ewL, W: [...ewL] };
  p.greens = greens.split(',').map(Number);
  return p;
}

const plans: [string, Plan][] = [['default', level.defaultPlan], ...specs.map((s) => [s, parse(s)] as [string, Plan])];
for (const [name, plan] of plans) {
  const runs = seeds.map((s) => new Simulation(level, plan, s).run());
  const scores = runs.map((r) => r.score).sort((a, b) => a - b);
  const med = scores[Math.floor(scores.length / 2)];
  const f = (k: 'throughput' | 'rage' | 'rageEvents' | 'worstWait') =>
    (runs.reduce((a, r) => a + r[k], 0) / runs.length).toFixed(0);
  console.log(
    `${name.padEnd(42)} med ${String(med).padStart(5)} [${scores.join(', ')}]  thru ${f('throughput')} rage ${f('rage')} ev ${f('rageEvents')} worst ${f('worstWait')}s grid ${runs.filter((r) => r.gridlocked).length}`,
  );
}
