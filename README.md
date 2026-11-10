# Right of Way

Set the lights. Lay out the lanes. Watch the rush.

A casual, mobile-first traffic-signal simulation. Before each rush hour you tune
one intersection: how long each phase stays green, which lanes turn and which go
straight, whether lefts get a protected arrow. Then you press **Go** and watch.
Score is **throughput minus road rage**.

Design document: [DESIGN.md](DESIGN.md).

## Run it

```bash
npm install
npm run dev
```

Open the printed URL on your phone (same Wi-Fi) or in a desktop browser with the
device toolbar set to a phone. The app is an installable PWA: `npm run build`
then `npm run preview` serves the production bundle with the service worker.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck and build the PWA into `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm test` | Vitest: determinism, geometry conflicts, plan validation |
| `npm run tune` | Headless harness: runs every level across seeds and candidate plans, prints score distributions. `npm run tune -- <level-id>` for one level, `--grid` for a wider search. |
| `npm run icons` | Regenerate PNG icons from the traffic-light mark |

## Layout

```
src/
  sim/        pure, headless simulation (no DOM): geometry, signals, vehicles, rage, scoring
  levels/     level definitions as data
  render/     canvas renderer and particles
  ui/         app shell, screens, the phase dial
  audio.ts    synthesised honks and dings
  save.ts     localStorage progress
scripts/      tuning harness, icon generator
tests/        vitest suite
```

The simulation runs at a fixed 20 Hz step with a seeded RNG. Same level, plan and
seed always produce the same run, so "Rerun same traffic" is a fair A/B test of a
tweak, and the tuning harness can sweep thousands of runs without a browser.

Every tunable constant lives in `src/sim/constants.ts`.
