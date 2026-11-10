import {
  APPROACH_LENGTH,
  CONFLICT_DISTANCE,
  EXIT_LENGTH,
  LANE_WIDTH,
} from './constants';
import type { Approach, LaneAssignment, Turn, Vec } from './types';
import { APPROACHES, TURNS, assignmentAllows } from './types';

/**
 * World frame: x east, y south (matches canvas). Intersection centre at origin.
 * Right-hand traffic. Each approach has a forward vector f (direction of travel
 * towards the centre) and a right vector r. Inbound lanes sit on the right of
 * the centreline, lane 0 being the leftmost (nearest the centreline).
 */

export const FORWARD: Record<Approach, Vec> = {
  N: { x: 0, y: 1 },
  S: { x: 0, y: -1 },
  E: { x: -1, y: 0 },
  W: { x: 1, y: 0 },
};

/** Right-hand vector for a heading, in screen coords (y down). */
export function rightOf(f: Vec): Vec {
  return { x: -f.y, y: f.x };
}

/** Opposite approach. */
export const OPPOSITE: Record<Approach, Approach> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** The road a vehicle exits onto for a given approach and turn. */
export function exitRoad(approach: Approach, turn: Turn): Approach {
  const f = FORWARD[approach];
  let g: Vec;
  if (turn === 'T') g = f;
  else if (turn === 'L') g = { x: f.y, y: -f.x }; // rotate towards driver's left
  else g = { x: -f.y, y: f.x }; // driver's right
  // Exit road is the approach whose inbound direction is opposite to g.
  for (const a of APPROACHES) {
    const fa = FORWARD[a];
    if (fa.x === -g.x && fa.y === -g.y) return a;
  }
  throw new Error('no exit road');
}

export function isNS(a: Approach): boolean {
  return a === 'N' || a === 'S';
}

export interface Path {
  id: number;
  approach: Approach;
  laneIndex: number;
  turn: Turn;
  exitRoad: Approach;
  exitLane: number;
  /** Sampled polyline through approach, box and exit. */
  points: Vec[];
  /** Cumulative length at each point. */
  cum: number[];
  /** s coordinate of the stop line (end of approach). */
  sStop: number;
  /** s coordinate where the box ends and the exit lane begins. */
  sExit: number;
  /** Total length; vehicles vanish beyond it. */
  sEnd: number;
  /** Conflicts with other paths, sorted by s on this path. */
  conflicts: Conflict[];
}

export interface Conflict {
  /** Position along this path. */
  s: number;
  /** The other path. */
  other: Path;
  /** Position along the other path. */
  sOther: number;
}

export interface ApproachLane {
  approach: Approach;
  index: number;
  assignment: LaneAssignment;
  /** Turn-only lane on a multi-lane road: a short pocket fed from the neighbouring lane. */
  pocket: boolean;
  /** Index of the lane that feeds this pocket, or -1. */
  feederIndex: number;
  /** World position of the lane centre at the stop line. */
  stop: Vec;
  /** World position of the lane centre at the far end of the modelled approach. */
  start: Vec;
  paths: Path[];
}

export interface Geometry {
  lanesNS: number;
  lanesEW: number;
  /** Half extent of the box along x (east-west) and y (north-south). */
  hx: number;
  hy: number;
  lanes: Record<Approach, ApproachLane[]>;
  paths: Path[];
}

/** Half extent of the box along an approach's forward axis. */
function halfExtentAlong(a: Approach, lanesNS: number, lanesEW: number): number {
  // Travelling N/S you cross the E/W road, whose half width is lanesEW * w.
  return (isNS(a) ? lanesEW : lanesNS) * LANE_WIDTH;
}

function laneCount(a: Approach, lanesNS: number, lanesEW: number): number {
  return isNS(a) ? lanesNS : lanesEW;
}

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k };
}
function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Lane centre at the stop line for inbound lane i of an approach. */
export function stopPoint(a: Approach, i: number, lanesNS: number, lanesEW: number): Vec {
  const f = FORWARD[a];
  const r = rightOf(f);
  const h = halfExtentAlong(a, lanesNS, lanesEW);
  return add(scale(f, -h), scale(r, (i + 0.5) * LANE_WIDTH));
}

/** Lane centre where outbound lane j of a road leaves the box. */
export function exitPoint(road: Approach, j: number, lanesNS: number, lanesEW: number): Vec {
  // Outbound traffic on `road` heads away from the centre: g = -FORWARD[road].
  const g = scale(FORWARD[road], -1);
  const rg = rightOf(g);
  const h = halfExtentAlong(road, lanesNS, lanesEW);
  return add(scale(g, h), scale(rg, (j + 0.5) * LANE_WIDTH));
}

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * u * u * t,
    c = 3 * u * t * t,
    d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function buildPath(
  id: number,
  approach: Approach,
  laneIndex: number,
  turn: Turn,
  lanesNS: number,
  lanesEW: number,
): Path {
  const f = FORWARD[approach];
  const road = exitRoad(approach, turn);
  const nExit = laneCount(road, lanesNS, lanesEW);
  let exitLane: number;
  if (turn === 'T') exitLane = Math.min(laneIndex, nExit - 1);
  else if (turn === 'L') exitLane = 0;
  else exitLane = nExit - 1;

  const stop = stopPoint(approach, laneIndex, lanesNS, lanesEW);
  const start = add(stop, scale(f, -APPROACH_LENGTH));
  const exitStart = exitPoint(road, exitLane, lanesNS, lanesEW);
  const g = scale(FORWARD[road], -1);
  const exitEnd = add(exitStart, scale(g, EXIT_LENGTH));

  const points: Vec[] = [start, stop];
  if (turn === 'T') {
    points.push(exitStart);
  } else {
    const d = dist(stop, exitStart);
    const k = turn === 'L' ? 0.55 * d : 0.5 * d;
    const c1 = add(stop, scale(f, k));
    const c2 = add(exitStart, scale(g, -k));
    const n = 14;
    for (let i = 1; i <= n; i++) points.push(cubic(stop, c1, c2, exitStart, i / n));
  }
  points.push(exitEnd);

  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  const sStop = APPROACH_LENGTH;
  const sExit = cum[cum.length - 2];
  const sEnd = cum[cum.length - 1];
  return {
    id,
    approach,
    laneIndex,
    turn,
    exitRoad: road,
    exitLane,
    points,
    cum,
    sStop,
    sExit,
    sEnd,
    conflicts: [],
  };
}

/** Position and heading along a path at distance s. */
export function pointAt(p: Path, s: number): { pos: Vec; heading: number } {
  const cum = p.cum;
  if (s <= 0) {
    const a = p.points[0],
      b = p.points[1];
    return { pos: add(a, scale(dirOf(a, b), s)), heading: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = p.points[i - 1],
    b = p.points[i];
  const segLen = cum[i] - cum[i - 1];
  const t = segLen > 0 ? (s - cum[i - 1]) / segLen : 0;
  return {
    pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function dirOf(a: Vec, b: Vec): Vec {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** Sample a path between two s values at a fixed step. */
function samples(p: Path, s0: number, s1: number, step: number): { s: number; pos: Vec }[] {
  const out: { s: number; pos: Vec }[] = [];
  for (let s = s0; s <= s1; s += step) out.push({ s, pos: pointAt(p, s).pos });
  return out;
}

function computeConflicts(paths: Path[]): void {
  const step = 0.5;
  const sampled = paths.map((p) => samples(p, p.sStop - 1, p.sExit + 1, step));
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue;
      const p = paths[i],
        q = paths[j];
      if (p.approach === q.approach) continue; // parallel or diverging from the same road
      if (p.exitRoad === q.exitRoad && p.exitLane === q.exitLane) continue; // merge, handled by following
      // Opposing left turns pass each other.
      if (p.turn === 'L' && q.turn === 'L' && OPPOSITE[p.approach] === q.approach) continue;
      let best = Infinity,
        bs = 0,
        bq = 0;
      for (const a of sampled[i]) {
        for (const b of sampled[j]) {
          const d = dist(a.pos, b.pos);
          if (d < best) {
            best = d;
            bs = a.s;
            bq = b.s;
          }
        }
      }
      if (best < CONFLICT_DISTANCE) p.conflicts.push({ s: bs, other: q, sOther: bq });
    }
    paths[i].conflicts.sort((a, b) => a.s - b.s);
  }
}

export function buildGeometry(
  lanesNS: number,
  lanesEW: number,
  assignments: Record<Approach, LaneAssignment[]>,
): Geometry {
  const lanes = {} as Record<Approach, ApproachLane[]>;
  const paths: Path[] = [];
  let id = 0;
  for (const a of APPROACHES) {
    const n = laneCount(a, lanesNS, lanesEW);
    lanes[a] = [];
    for (let i = 0; i < n; i++) {
      const assignment = assignments[a][i] ?? 'T';
      const stop = stopPoint(a, i, lanesNS, lanesEW);
      const start = add(stop, scale(FORWARD[a], -APPROACH_LENGTH));
      const pocket = n > 1 && (assignment === 'L' || assignment === 'R');
      const feederIndex = pocket ? (assignment === 'L' ? i + 1 : i - 1) : -1;
      const lane: ApproachLane = { approach: a, index: i, assignment, pocket, feederIndex, stop, start, paths: [] };
      for (const t of TURNS) {
        if (!assignmentAllows(assignment, t)) continue;
        const p = buildPath(id++, a, i, t, lanesNS, lanesEW);
        lane.paths.push(p);
        paths.push(p);
      }
      lanes[a].push(lane);
    }
  }
  computeConflicts(paths);
  return {
    lanesNS,
    lanesEW,
    hx: lanesNS * LANE_WIDTH,
    hy: lanesEW * LANE_WIDTH,
    lanes,
    paths,
  };
}

/** The assignments a lane at `index` of `count` lanes may legally take. */
export function allowedAssignments(index: number, count: number): LaneAssignment[] {
  if (count === 1) return ['LTR', 'LT', 'TR', 'T'];
  if (index === 0) return ['L', 'LT', 'T'];
  if (index === count - 1) return ['T', 'TR', 'R'];
  return ['T'];
}
