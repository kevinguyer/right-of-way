/**
 * Every tunable number in the simulation lives here so the headless tuning
 * harness (scripts/tune.ts) and the game agree.
 */
export const DT = 0.05; // simulation step, seconds (20 Hz)

export const LANE_WIDTH = 3.4; // metres
export const APPROACH_LENGTH = 150; // metres of modelled queue before the stop line
export const EXIT_LENGTH = 70; // metres after the box before vehicles vanish
export const SPAWN_GAP = 9; // metres of free lane needed to spawn a vehicle
export const POCKET_LENGTH = 90; // metres of storage in a turn-only pocket lane (roads with 2+ lanes)

export const YELLOW = 3.0; // seconds
export const ALL_RED = 1.0; // seconds
export const MIN_GREEN = 5;
export const MAX_GREEN = 90;

// Car-following (Intelligent Driver Model)
export const V_APPROACH = 13.0; // m/s desired speed on approach (~47 km/h)
export const V_BOX_THROUGH = 11.0;
export const V_BOX_TURN = 6.5;
export const V_EXIT = 13.0;
export const IDM_T = 1.3; // desired time headway, seconds
export const IDM_S0 = 2.0; // standstill gap, metres
export const IDM_DELTA = 4;
export const STOP_LINE_GAP = 0.8; // how far behind the line a stopped vehicle sits

export const VEHICLES = {
  car: { length: 4.5, width: 1.9, accel: 2.2, brake: 2.8, weight: 0.68 },
  suv: { length: 5.1, width: 2.0, accel: 1.9, brake: 2.8, weight: 0.24 },
  truck: { length: 8.0, width: 2.3, accel: 1.1, brake: 2.4, weight: 0.08 },
} as const;

// Conflicts inside the box
export const CONFLICT_DISTANCE = 2.0; // paths closer than this (metres) conflict
export const CONFLICT_MARGIN = 2.6; // how far before a conflict point a yielding vehicle stops
export const CONFLICT_LOOKAHEAD = 40; // metres
export const GAP_ACCEPT = 4.6; // seconds of oncoming gap a calm driver needs
export const BOX_COURTESY_DISTANCE = 10; // calm drivers won't enter the box if blocked within this

// Rage
export const PATIENCE_MIN = 20;
export const PATIENCE_MODE = 40;
export const PATIENCE_MAX = 75;
export const RAGE_K = 600; // rage += over / K per second: 35 s past patience ≈ 1 point, 110 s past ≈ 10 (blown)
export const RAGE_STOP_GO = 0.3; // extra rage per additional stop
export const RAGE_CONTAGION = 0.035; // rage/s pushed onto neighbours by a honking car
export const RAGE_CONTAGION_RADIUS = 9; // metres
export const RAGE_SPITE = 0.012; // rage/s while waiting at red facing an empty green
export const HARD_BRAKE = 4.0; // m/s^2: braking harder than this is a near miss
export const RAGE_HARD_BRAKE = 0.9; // rage for being cut off
export const RAGE_CAP = 10; // a single driver can contribute at most this (then they blow)
export const RAGE_EVENT_PENALTY = 10;

export const TIER_IRRITATED = 1.0;
export const TIER_ANGRY = 3.0;
export const TIER_FURIOUS = 6.0;
export const TIER_BLOWN = 10.0;

export const WAIT_SPEED = 0.6; // m/s; below this you are "waiting"
export const FURIOUS_RED_GRACE = 2.0; // furious drivers treat the first N s of red as yellow

// Fates when a driver blows
export const FATE_WEIGHTS = { bail: 40, stall: 25, seethe: 25, shove: 10 } as const;
export const STALL_MIN = 20;
export const STALL_MAX = 40;
export const TOW_HOOKUP = 10;
export const BAIL_SPLASH = 0.5; // rage splashed onto neighbours by a bailing car
export const BAIL_RADIUS = 12;

// Gridlock detection
export const GRIDLOCK_STOPPED_IN_BOX = 3;
export const GRIDLOCK_SECONDS = 14;

// Scoring
export const PLATOON_SIZE = 5;
export const PLATOON_BONUS = 2;
