# Compound Ops

A fictional special-operations raid console built around a small Palantir-style **ontology**: typed objects, links between them, and actions that cascade across those links. UI built with [Blueprint](https://blueprintjs.com).

![Assault phase](docs/assault.jpg)

## Ontology

- **Objects:** Region, Compound, Structure, Landing zone, Unit, Platform, Observation, Phase
- **Links:** compound → structures, helicopter → carried units, unit → objective, observation → source and subject
- **Actions:** start phase, assign objective, confirm cleared, mark LZ risky, confirm or dismiss an observation, abort

The simulator reads links on every tick. Marking an LZ risky re-links its helicopters to the alternate LZ, and they change course right away:

![LZ divert](docs/divert.jpg)

## Run

```bash
npm install
npm run dev
npm run smoke
```

`smoke` plays the whole mission headless, plus an abort run.

All names, places and coordinates are invented.
