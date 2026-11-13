# Compound Ops

A small, fully fictional operations console built to learn the core idea behind
Palantir-style platforms: an **ontology** of real-world objects, the links
between them, and the actions operators take on them.

The scenario is invented: a special-operations raid on a compound (OBJ FALCON)
in a fictional area (AO GRANITE), on an abstract 1000 x 700 grid.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run smoke   # headless end-to-end run of the whole mission (plus an abort run)
```

## How it is built

| Layer | Where | What |
|---|---|---|
| Ontology schema | `src/ontology/schema.ts` | Object types (Region, Compound, Structure, LandingZone, Unit, Platform, Observation, Phase), their properties, and link types |
| Ontology store | `src/ontology/store.ts` | In-memory objects, typed links, event log, change notifications |
| Actions | `src/ontology/actions.ts` | The only way operators change the world; each action validates itself and may cascade across links |
| Simulator | `src/sim/simulator.ts` | Moves platforms and units, produces UAV observations, advances phases; derives every goal from the ontology each tick |
| UI | `src/ui/` | [Blueprint](https://blueprintjs.com) (Palantir's open-source UI toolkit), dark theme; the tree and detail panel are rendered from the schema |

### Ontology at a glance

```
Region ──contains──▶ Compound ──contains──▶ Structure
Region ──has──▶ LandingZone, Phase
Platform(helicopter) ──carries──▶ Unit ──objective──▶ Structure
Platform ──assigned LZ──▶ LandingZone
Unit ──lift──▶ Platform
Observation ──source──▶ Platform(UAV)
Observation ──concerns──▶ Structure | LandingZone
```

### Cascades worth trying

- **Mark an LZ risky** while the helicopters are inbound: every platform linked
  to it is re-linked to the nearest suitable LZ, and because the simulator reads
  links every tick, the flight paths change immediately.
- **Confirm an observation**: the threat level of the structure it concerns is
  raised, and clearing that structure takes longer.
- **Reassign a unit** mid-assault: the structure it left falls back to
  Uncleared if nobody else is on it.
- **Abort**: open phases are aborted and everyone exfils to their lift's LZ.

## Mission flow

1. **P1 Infil**: helicopters fly from the FOB to their LZ and offload.
2. **P2 Approach**: assault teams move to their breach points, overwatch to the ridge.
3. **P3 Assault**: teams breach and clear; each clear report must be confirmed by
   the operator, and idle teams need a new objective.
4. **P4 Exfil**: helicopters return for pickup and fly everyone back to the FOB.
