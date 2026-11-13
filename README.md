# Compound Ops

A fictional special-operations raid console built around a small Palantir-style **ontology**, a real **multi-sensor tracker**, an **autonomous FPV strike cell** and **edge nodes that keep working under jamming**. UI built with [Blueprint](https://blueprintjs.com), map symbology in the style of MIL-STD-2525.

![Demo](docs/demo.gif)

## Sensor fusion

- **Sensors:** a rotating ground radar (range/bearing noise, false alarms) and a UAV EO/IR camera staring at the objective.
- **Tracker:** two-model **IMM** Kalman filter (constant velocity + maneuver), chi-square gating, global nearest neighbour association, tentative → confirmed → coasting → dropped lifecycle, duplicate-track merging.
- **Blue force suppression:** plots that match a friendly position under the measurement covariance are dropped before tracking.
- **Result** (`npm run smoke`, first mission): position RMS 14.7 m for raw radar plots, 3.7 m for EO plots, **8.1 m for fused tracks**.

## Autonomy

- **Pathing:** A* on a 2 m grid built from the compound wall, gates and building footprints. Teams cross the wall only at gates and enter buildings only at their doors.
- **Assault and Exfil:** after the operator presses Assault, the teams split the buildings between themselves by route length, clear them and hold in place once the compound is secured. Exfil runs the same way.
- **Threat assessment:** every confirmed track is assessed by rule. Inside OBJ FALCON means hostile, closing on an LZ at vehicle speed means hostile, and a slow walker well outside the objective is marked neutral and protected.
- **FPV strike cell:** the nearest ready drone is assigned to each hostile track and flies a lead-pursuit intercept. Each decision becomes an **Engagement** object with its rationale, rule checks and outcome, and a hit drops the track.
- **Rules of engagement:** neutral and unknown tracks are never engaged, and nothing within 50 m of a friendly is struck (a launch needs 60 m, a drone holds off at 56 m, and a final check runs at impact). One click on **WEAPONS HOLD** stops new engagements and recalls every drone in flight.

## Edge operations under jamming

- **Radio links:** every pair of stations (COC, teams, helicopters, UAV) gets a link budget: free-space path loss at 350 MHz, receiver noise, the jammer's power at the receiver and 20 dB of frequency-hopping processing gain. A link is up above 10 dB SINR in both directions, with hysteresis down to 7 dB. Traffic relays across the mesh.
- **Replicated ontology:** COC and each team hold their own replica, and connected replicas gossip once a second. Merges are CRDT joins: last writer wins for positions and orders, a max register for building status so it never regresses, and first writer wins for building claims.
- **Teams act on what they know:** when a hidden jammer comes up during the assault, ALPHA and BRAVO lose COC but still reach each other. They keep splitting and clearing buildings. Orders such as Exfil or Abort reach them only when a path exists, and after 45 s of silence an idle team moves to a rally point to regain comms.
- **COC shows only what it has heard:** cut-off teams are drawn at their last report with a dashed frame and an uncertainty ring that grows with report age. Late reports are backfilled into the log and timeline with their delay.
- **Fires get more careful as the picture ages:** the 50 m rule is measured from the edge of each friendly's uncertainty ring, and no drone launches at a target where its control link would be jammed. A drone that loses its link aborts.

## Ontology

- **Objects:** Region, Phase, Track, Engagement, Sensor, Detection, Compound, Structure, Landing zone, Platform, Unit
- **Links:** track → supporting detections → sensor, track → structure, engagement → target track and effector, helicopter → carried units, unit → objective
- **Actions:** start phase, weapons hold / free, classify track, mark LZ risky, abort

## Smoke test

`npm run smoke` flies three headless missions, one of them aborted while the teams are jammed, and fails if any of these happens:

- a unit or person is inside a building, or crosses the wall away from a gate
- the operator has to act during the assault, or a team moves after it without an order
- replica merges break commutativity, associativity, idempotence or convergence in 200 random trials
- teams fail to keep clearing while cut off, or any replica still differs from COC once contact is back
- an order reaches a team that has no path to COC, or a team report never arrives
- the shepherd is struck or assessed hostile
- an impact lands within 50 m of a friendly's true position, including while COC's picture is stale
- a hostile survives the mission
- WEAPONS HOLD does not recall the drones already in flight

## Run

```bash
npm install
npm run dev
npm run smoke
```

The demo GIF is rendered frame by frame from `?capture` mode with `node scripts/record-demo.mjs frames` (needs Chrome and the dev server on port 5317), then encoded with ffmpeg at full 1600 px width with a single 256-color palette, no downscaling.

All names, places and coordinates are invented.
