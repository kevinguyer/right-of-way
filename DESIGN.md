# Right of Way — Design Document (v0.1)

*A casual, mobile-first traffic-signal simulation. Set the lights, lay out the lanes, then watch rush hour play out. Score is throughput minus road rage.*

---

## 1. The pitch in one breath

You are the traffic engineer. Before each rush hour you get a quiet minute to tune the intersection: how long each light stays green, which lanes turn and which go straight, whether lefts are protected. Then you hit **Go** and the city floods in. Cars queue, creep, clear, and (if you got it wrong) start to glow red with rage, honk, run yellows, and eventually lock the whole box. When the hour ends you get a score and a replay of your worst moment. Tweak. Run again. Beat it.

The hook is **anticipation with consequence**: planning is calm and tactile, watching is tense because you can't touch it, and the result teaches you something concrete every time.

---

## 2. Core loop

```
 ┌──────────┐     ┌──────────┐     ┌──────────┐
 │  PLAN    │ ──▶ │  WATCH   │ ──▶ │  SCORE   │ ──┐
 │ 20–60 s  │     │ 45–90 s  │     │ 10 s     │   │
 └──────────┘     └──────────┘     └──────────┘   │
       ▲                                          │
       └──────────── "Tweak & rerun" ─────────────┘
```

1. **Plan** – Drag the phase dial, tap lanes to reassign them, pick a signal pattern. A live preview strip shows the cycle you've built.
2. **Watch** – Deterministic simulation of a rush hour (compressed to roughly a minute). Speed control 1x / 2x / 4x. No intervention in early levels; limited "override tokens" unlock later (see 6.3).
3. **Score** – Throughput − Rage, stars, and a 5-second highlight of the worst queue. One-tap **Rerun same traffic** (same seed) or **New traffic**.

Runs must be short. Nobody watches a 4-minute sim on a phone. Target: a full plan-watch-score loop in under two minutes.

---

## 3. The score

```
SCORE = THROUGHPUT − RAGE  (+ bonuses, − penalties)
```

### 3.1 Throughput
- +1 per vehicle that clears the intersection.
- Weighted vehicles later: bus = riders aboard (8–40), ambulance = 25, bike = 1.
- A platoon bonus: 5+ cars clearing in a single green without stopping gets +2 ("smooth flow"). This rewards good cycle lengths, not just long greens.

### 3.2 Road rage
Every driver has a hidden **patience** (roughly 15–60 seconds, drawn per car). Rage accrues once they've waited longer than their patience, and it accrues faster the longer they wait:

```
over = max(0, waitTime − patience)
rage += over² / K   per tick        (K tuned so a 90 s wait ≈ 10 rage points)
```

Extras that add rage:
- **Stop-and-go**: each additional stop after the first (creeping forward one car length at a time is infuriating).
- **Contagion**: a honking car raises rage of its two nearest neighbours slightly. Rage spreads up a queue visually like a fuse.
- **Watching the empty cross street get green**: a small spite tax when a car is waiting and the conflicting green has no cars in it. Players feel this one instantly and it teaches sensor/demand logic.

Rage is **not just a number**. It changes behaviour, which is what makes watching tense:

| Rage level | Visual | Behaviour |
|---|---|---|
| Calm | normal colour | normal |
| Irritated | tinted yellow, small "..." | shorter following gap |
| Angry | orange, honk puffs | runs the yellow, accepts dangerous left gaps |
| Furious | red, steam, "!!" | enters on red-ish, blocks the box, triggers contagion |
| Blown | car shakes, big honk burst | counts as a **Rage Event** (−10), then one of several fates (see 3.3) |

Blocking the box is the key feedback: furious drivers who enter when they can't clear cause **spillback**, which stalls the cross street, which raises *their* rage. Gridlock is a run-ending fail state: the sim freezes, a honk cacophony swells, and you get "GRIDLOCK at 6:48 PM."

### 3.3 Blown drivers: a little entropy
When a driver blows, the game rolls a seeded die. The outcomes are deliberately mixed so the same mistake does not always have the same cost, and so the player can never fully bank on a blown car disappearing:

| Fate | Odds (initial) | What happens |
|---|---|---|
| **Bails** | 40% | Pulls a U-turn or cuts across to any exit on the next gap. Clears the lane, but the manoeuvre forces nearby cars to brake (small rage splash). |
| **Stalls** | 25% | Engine dies on the spot. A tow truck arrives after 20–40 s, blocks the lane while hooking up (10 s), then both leave. Until then the lane is dead. |
| **Seethes** | 25% | Stays in the queue, honks continuously, contagion radius doubled. Still counts for throughput if they eventually clear. |
| **Shoves through** | 10% | Forces into the intersection regardless of signal. Usually ends up blocking the box; occasionally threads a gap and escapes, which looks lucky because it is. |

Odds shift by level and twist. Snow raises Stalls. A cop on point lowers Shoves. The "Things Break" chapter can weight any of them. The sim stays deterministic per seed, so a rerun reproduces the same fates, but a new seed makes the same plan feel slightly different, which is the chaos we want.

### 3.4 Stars and goals
Each level has three star thresholds plus one optional **challenge goal** (e.g. "No rage events", "Every bus under 30 s wait", "Score 200 with only 2 phases"). Challenge goals are where the depth lives for players who want it.

---

## 4. What the player controls

Everything must work with a thumb, one-handed, portrait.

### 4.1 Phase dial (the signature control)
A ring around the intersection, divided into segments, one per **phase**. Dragging a segment boundary lengthens one phase and shortens its neighbour, or lengthens the whole cycle if you drag the outer edge. Each segment shows which movements are green with little arrows. The current cycle length is printed in the middle.

Why a dial: it makes "cycle length vs. split" physical, it's fast with a thumb, and it animates nicely as a sweep hand during the run so the player can see *why* the queue is building.

### 4.2 Signal pattern
Pick from a short list that grows with progression:
- **2-phase** (N/S then E/W, lefts yield)
- **4-phase protected lefts** (lefts get their own arrow)
- **Split phase** (each approach alone)
- **Lead/lag lefts**
- **Leading pedestrian interval** (walk starts 3 s before cars)
- **Actuated** (later): greens extend while cars are detected, up to a max you set. Introduces min/max green and gap-out time as knobs.

### 4.3 Lane layout
Tap a lane to cycle its assignment: `←` `←↑` `↑` `↑→` `→`. Levels cap the lane count per approach (1–3). Some levels let you add a lane at the cost of a shorter cycle (road width is fixed, so a left-turn pocket shortens the storage of its neighbours — a real trade-off).

### 4.4 Small knobs (unlocked gradually)
- Yellow duration (short = more red-running)
- All-red clearance (safer, costs throughput)
- Right-turn-on-red on/off
- Crosswalk on/off per leg
- Offset to the neighbouring intersection (multi-intersection chapter)

---

## 5. The simulation

### 5.1 Model
Discrete lanes, continuous position along each lane. Simple car-following (a lightweight Intelligent Driver Model: target gap, max acceleration, comfortable braking). Vehicles follow a fixed path: approach lane → intersection polyline → exit lane. Conflicting paths are resolved by gap acceptance at the stop line (and by rage).

Deterministic: fixed 20 Hz step, seeded RNG, no dependence on frame rate. The same settings + seed always give the same run, so "rerun" is a fair A/B test of a tweak.

### 5.2 Demand
Each approach has a demand curve over the run: ramp up, plateau, ramp down (the rush). Turning proportions per approach. Levels vary this, e.g. "all the office traffic goes west at 5 PM."

### 5.3 Vehicle traits (per car, seeded)
- patience (seconds)
- aggressiveness (gap acceptance)
- type: car, SUV, truck (slow start), bus (long, heavy), bike, emergency

### 5.4 Pedestrians
Spawn at corners, cross on Walk. If made to wait past their patience they jaywalk, which forces nearby cars to brake and adds rage. A crosswalk you leave off is faster for cars until the jaywalkers show up.

---

## 6. Progression: chapters and twists

The campaign is a series of short chapters. Each chapter introduces one idea, then throws twists at it.

### Chapter 1 — First Light
Through traffic only. Learn the dial. Twist: one direction suddenly heavier.

### Chapter 2 — Turn Signals
Left turns appear. Yielding lefts stall the lane; protected lefts eat cycle time. Twist: a dedicated left-turn pocket you must choose to add.

### Chapter 3 — Rush
Steep demand peaks. Long cycles help throughput, short cycles help rage. Twist: a **school zone** halves speed limits for 90 seconds mid-run.

### Chapter 4 — On Foot
Crosswalks, Walk phases, jaywalkers. Twist: a parade closes one leg; everything reroutes.

### Chapter 5 — Mass Transit
Buses worth 30 riders each. Bus priority (hold green briefly when a bus approaches). Twist: a bus stop right at the corner blocks a lane while loading.

### Chapter 6 — Sirens
Emergency vehicle preemption. Cars must pull aside; a bad layout leaves no gap. Twist: the ambulance arrives during your longest red.

### Chapter 7 — Things Break
- **Power outage**: lights go to flashing red (4-way stop). Watch the awkward dance.
- **Stuck sensor**: one detector reads "always on."
- **Stalled car** blocks a lane for a minute.
- **Snow**: slower acceleration, longer braking, more spacing.
- **Officer on point**: a cop takes over for 30 seconds with their own crude logic.

### Chapter 8 — Green Wave
Two intersections 200 m apart. You set an **offset** so platoons from one arrive at the other's green. Then three. Then a mis-timed train crossing in between.

### Chapter 9 — The Bad Ideas
The five-leg intersection. A roundabout you can convert to. A diverging diamond. Fun, weird geometries that show off the engine.

### 6.1 Daily Rush
One fixed seed per day on a procedurally generated intersection. Everyone gets the same traffic. Leaderboard is just score and a share card.

### 6.2 Sandbox
All knobs, any geometry, unlimited reruns. Heatmap overlay of average wait per lane.

### 6.3 Override tokens (keeps "watch" from feeling passive)
From Chapter 3, each run gives you 2–3 **override tokens**. During the run you can spend one to hold the current green for 10 s or skip to the next phase. They are powerful and scarce, so the player watches with a thumb hovering. Challenge goals often forbid them.

---

## 7. Look, feel, sound

- **Top-down, flat, chunky, and not cute.** Cars are rounded rectangles with a windshield stripe. No faces, no eyes, no mascots. Big enough to read on a phone. Four to six muted car colours, with rage tint overriding colour as it climbs. Rage is communicated through tint, shake, honk puffs and steam, never through expressions. Think transit-map and wayfinding aesthetics: clean geometry, restrained palette, confident typography.
- **Road is the UI.** The dial wraps the intersection; lanes are tapped directly. No menus during planning.
- **Juice that carries information**: honk puffs, exhaust when idling long, a satisfying whoosh when a platoon clears, a rising rumble as the box fills, a "ding" per throughput point in bursts.
- **Replay highlight**: after the run, a 5-second clip of the worst queue with a caption ("Northbound left waited 94 s. Ouch.").
- **Audio**: mutable ambience plus honks that layer into a chorus. The gridlock cacophony should be funny, not punishing.
- **Dark mode by default** (phones, evening play) with a day palette option.

---

## 8. Platform and tech (recommendation)

**Progressive web app first.** Install-to-home-screen, offline capable, no store review cycle while we iterate. Wrap in Capacitor later if we want the stores.

- TypeScript + Vite
- Rendering: Canvas 2D (plenty for ~200 cars) or Pixi.js if we want effects cheaply. Start with Canvas 2D.
- Fixed-step deterministic sim in a Web Worker so the UI never stutters; render interpolates.
- Seeded RNG (e.g. mulberry32).
- Save: localStorage for progress and best scores; export/import as JSON.
- No backend for v1. Daily Rush seeds derive from the date; sharing is a generated image card.

### Suggested layout
```
src/
  sim/        vehicles, lanes, signals, demand, rage   (pure, no DOM)
  levels/     level definitions as data (JSON/TS)
  render/     canvas drawing, camera, particles
  ui/         plan screen, dial, lane picker, score screen
  worker.ts   sim loop
  main.ts
```

The sim being pure and headless matters: we can run thousands of seeds in a test to tune rage constants and star thresholds without opening a browser.

---

## 9. MVP scope (what we build first)

**Goal: one intersection that is already fun to tweak.**

In:
- 4-leg intersection, 1–2 lanes per approach, lane assignment tap
- 2-phase and 4-phase protected-left patterns
- Phase dial with live cycle readout
- Cars only, with patience, rage tiers, honks, red-running, box-blocking, gridlock fail
- Score, 3-star thresholds, rerun same seed, speed control
- Six hand-tuned levels (Chapters 1–2 plus a taste of 3)
- Mobile portrait layout, installable PWA

Out (for now): pedestrians, buses, emergency, actuated signals, multi-intersection, daily, audio beyond honks.

Done looks like: a friend can pick up the phone cold, understand the dial in 20 seconds, fail a level, change one thing, and pass it.

---

## 10. Decisions and open questions

### Decided (2026-11-10)
1. **Override tokens** are a Chapter 3 unlock, disabled by challenge goals. Revisit after playtesting; if they undermine the "fair test of your plan" feeling, cut them.
2. **Blown drivers** get a mixed fate (bail / stall / seethe / shove), see 3.3. Some chaos is a feature.
3. **Art** is flat minimalist, not cute. No faces.
4. **Name** is **Right of Way**. "Full Stop" was the spitball title and still names the project folder (`full-stop`); the package is `right-of-way`. Rename the folder whenever convenient, with no session open in it.

### Implementation notes from the MVP build (2026-11-10)
- The sim runs on the main thread with a fixed-step accumulator, not in a Web Worker. At 6x speed it is ~120 steps/s over ~150 vehicles, which is cheap. Move it to a worker only if profiling says so.
- In-box conflicts are resolved by: physical occupancy first, then moving vehicles that arrive first, then rank (protected over permissive, then earlier box entry). Two stopped vehicles can never wait on each other; that symmetric rule caused near-universal gridlock in the first tuning pass.
- Rage constant: a wait of ~95 s past patience blows a driver (`RAGE_K = 26000`). The first value (90 s total wait ≈ 10 points) made any four-phase cycle unplayable, because every left turner who missed their arrow blew up.
- Turn pockets are real: a turn-only lane on a multi-lane road holds `POCKET_LENGTH` (60 m, about ten cars). Turners queue in the neighbouring lane until the pocket has room, so an overflowing pocket blocks through traffic. Without this a pocket was a free extra lane and levels 4 and 5 had no trade-off.
- Rage accrues at a rate proportional to time past patience (`RAGE_K = 600`): ~35 s past patience is one point, ~110 s past blows the driver. Patience is 20 to 75 s. The original quadratic rate blew up every driver who missed one arrow in a 100 s cycle.
- Finding: with at most two lanes per approach, a permissive left beats protected arrows on raw throughput at every demand level the harness tried. Real intersections get arrows for safety, so the game now has a safety currency in its own terms: a driver forced to brake harder than 4 m/s² (a near miss, usually caused by a left turner forcing a gap) gains rage. With that, protected lefts edge out two-phase on level 5, but only slightly. Level 5 is framed as "try both" with a protected-lefts challenge goal. Three-lane approaches (chapter 3+) would make the arrow decisive.
- Arrivals are jittered-uniform rather than Poisson. Poisson bunching made the same plan swing 100+ points between seeds, which drowned out the plan's effect.
- Star thresholds come from `npm run tune`: 1★ ≈ a plan a first-timer stumbles into, 2★ ≈ clearly tuned, 3★ ≈ near the best the harness found.

### Open
1. **Score scale.** Throughput ~150–400 per run, rage ~0–300. Stars need to feel earnable. Tune by running the headless sim across seeds.

---

## 11. Why this can be compelling

- **Every run teaches.** The replay says exactly which movement failed and why.
- **Rage is a feedback loop, not a penalty.** Bad timing creates behaviour that creates worse timing. That's drama.
- **Tiny input, big output.** Nudging a green by 4 seconds can flip a level. That's the Opus Magnum / Mini Motorways feeling.
- **Twists are stories.** "The ambulance arrived during my longest red" is something people tell each other.
- **It's about something real.** People have strong opinions about their worst intersection. The game lets them be right.
