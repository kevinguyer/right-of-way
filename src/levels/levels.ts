import type { Approach, DemandSpec, LaneAssignment, LevelDef, Plan } from '../sim/types';

const T_ONLY = { L: 0, T: 1, R: 0 };

function d(peak: number, turns = T_ONLY): DemandSpec {
  return { peak, turns };
}

function lanes(
  n: LaneAssignment[],
  e: LaneAssignment[],
  s: LaneAssignment[],
  w: LaneAssignment[],
): Record<Approach, LaneAssignment[]> {
  return { N: n, E: e, S: s, W: w };
}

function plan(l: Record<Approach, LaneAssignment[]>, pattern: Plan['pattern'], greens: number[]): Plan {
  return { lanes: l, pattern, greens };
}

export const LEVELS: LevelDef[] = [
  {
    id: 'c1-first-light',
    chapter: 1,
    index: 1,
    title: 'First Light',
    blurb:
      'A quiet crossroads with one busy road. Drag the ring to give the main street more green. Watch what happens to the side street.',
    lanesNS: 1,
    lanesEW: 1,
    lanesEditable: false,
    patterns: ['two-phase'],
    demand: { N: d(1000), S: d(860), E: d(230), W: d(210) },
    duration: 300,
    clockStart: 17,
    clockSpan: 60,
    stars: [95, 125, 150],
    defaultPlan: plan(lanes(['T'], ['T'], ['T'], ['T']), 'two-phase', [20, 20]),
  },
  {
    id: 'c1-cross-town',
    chapter: 1,
    index: 2,
    title: 'Cross Town',
    blurb:
      'Four even streams, until the eastbound office crowd lets out halfway through. Fixed timing means you plan for the whole hour, not the moment.',
    lanesNS: 1,
    lanesEW: 1,
    lanesEditable: false,
    patterns: ['two-phase'],
    demand: { N: d(700), S: d(680), E: d(660), W: d(700) },
    surges: [{ approach: 'E', start: 0.4, end: 0.75, mult: 2.0 }],
    duration: 300,
    clockStart: 17,
    clockSpan: 60,
    stars: [140, 165, 178],
    challenge: 'No rage events',
    defaultPlan: plan(lanes(['T'], ['T'], ['T'], ['T']), 'two-phase', [30, 30]),
  },
  {
    id: 'c2-left-behind',
    chapter: 2,
    index: 3,
    title: 'Left Behind',
    blurb:
      'Left turns arrive, and they yield to oncoming traffic. One car waiting for a gap holds the whole lane. Short cycles mean more stop-and-go; long ones mean longer reds.',
    lanesNS: 1,
    lanesEW: 1,
    lanesEditable: false,
    patterns: ['two-phase'],
    demand: {
      N: d(560, { L: 0.2, T: 0.68, R: 0.12 }),
      S: d(520, { L: 0.18, T: 0.7, R: 0.12 }),
      E: d(330, { L: 0.1, T: 0.75, R: 0.15 }),
      W: d(330, { L: 0.1, T: 0.75, R: 0.15 }),
    },
    duration: 300,
    clockStart: 17,
    clockSpan: 60,
    stars: [84, 94, 99],
    defaultPlan: plan(lanes(['LTR'], ['LTR'], ['LTR'], ['LTR']), 'two-phase', [12, 12]),
  },
  {
    id: 'c2-pocket',
    chapter: 2,
    index: 4,
    title: 'Pocket',
    blurb:
      'The main road is two lanes wide. Tap a lane to repaint it. A left pocket keeps turners out of the way, but it only holds so many cars.',
    lanesNS: 2,
    lanesEW: 1,
    lanesEditable: true,
    patterns: ['two-phase'],
    demand: {
      N: d(980, { L: 0.26, T: 0.62, R: 0.12 }),
      S: d(900, { L: 0.24, T: 0.64, R: 0.12 }),
      E: d(340, { L: 0.1, T: 0.75, R: 0.15 }),
      W: d(360, { L: 0.1, T: 0.75, R: 0.15 }),
    },
    duration: 300,
    clockStart: 17,
    clockSpan: 60,
    stars: [95, 115, 124],
    defaultPlan: plan(lanes(['LT', 'TR'], ['LTR'], ['LT', 'TR'], ['LTR']), 'two-phase', [20, 20]),
  },
  {
    id: 'c2-protected',
    chapter: 2,
    index: 5,
    title: 'Protected',
    blurb:
      'A third of the main road turns left. A protected arrow moves them for certain but eats cycle time. Yielding is quicker when gaps appear. Try both.',
    lanesNS: 2,
    lanesEW: 2,
    lanesEditable: true,
    patterns: ['two-phase', 'protected-lefts'],
    demand: {
      N: d(720, { L: 0.32, T: 0.58, R: 0.1 }),
      S: d(660, { L: 0.3, T: 0.6, R: 0.1 }),
      E: d(380, { L: 0.15, T: 0.7, R: 0.15 }),
      W: d(360, { L: 0.15, T: 0.7, R: 0.15 }),
    },
    duration: 300,
    clockStart: 17,
    clockSpan: 60,
    stars: [88, 99, 106],
    challenge: 'Score 120+ using protected lefts',
    defaultPlan: plan(lanes(['LT', 'TR'], ['LT', 'TR'], ['LT', 'TR'], ['LT', 'TR']), 'two-phase', [30, 30]),
  },
  {
    id: 'c3-rush',
    chapter: 3,
    index: 6,
    title: 'Rush',
    blurb:
      'Everything at once. The peak is steep and short. Long cycles move more cars; short cycles keep tempers down. Pick your poison.',
    lanesNS: 2,
    lanesEW: 2,
    lanesEditable: true,
    patterns: ['two-phase', 'protected-lefts'],
    demand: {
      N: d(820, { L: 0.2, T: 0.65, R: 0.15 }),
      S: d(700, { L: 0.2, T: 0.65, R: 0.15 }),
      E: d(620, { L: 0.2, T: 0.65, R: 0.15 }),
      W: d(760, { L: 0.2, T: 0.65, R: 0.15 }),
    },
    surges: [
      { approach: 'N', start: 0.45, end: 0.65, mult: 1.4 },
      { approach: 'W', start: 0.45, end: 0.65, mult: 1.4 },
    ],
    duration: 330,
    clockStart: 17,
    clockSpan: 60,
    stars: [150, 175, 185],
    challenge: 'No gridlock, no rage events',
    defaultPlan: plan(lanes(['LT', 'TR'], ['LT', 'TR'], ['LT', 'TR'], ['LT', 'TR']), 'two-phase', [30, 30]),
  },
];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** Deep-copy a plan so edits never touch the level definition. */
export function clonePlan(p: Plan): Plan {
  return {
    lanes: { N: [...p.lanes.N], E: [...p.lanes.E], S: [...p.lanes.S], W: [...p.lanes.W] },
    pattern: p.pattern,
    greens: [...p.greens],
  };
}
