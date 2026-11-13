// Headless end-to-end run: plays the whole mission through ontology actions
// and fails if any phase stalls. Run with `npm run smoke`.

import { OntologyStore } from "../src/ontology/store";
import { Simulator } from "../src/sim/simulator";
import { loadScenario } from "../src/sim/scenario";
import { ACTIONS } from "../src/ontology/actions";
import { PHASE, objectiveOf, phaseByOrder, region } from "../src/ontology/queries";
import { formatClock } from "../src/ui/format";

let store = new OntologyStore();
loadScenario(store);
let sim = new Simulator(store);
const action = (id: string) => ACTIONS.find((a) => a.id === id)!;

function run(id: string, target: string, params: Record<string, string> = {}): void {
  const a = action(id);
  const obj = store.get(target)!;
  const reason = a.check(store, obj, params);
  if (reason) throw new Error(`${id} on ${target} refused: ${reason}`);
  a.apply(store, obj, params);
}

function until(label: string, done: () => boolean, onTick: () => void = () => {}, maxSimSec = 600): void {
  const limit = store.clockMs + maxSimSec * 1000;
  while (!done()) {
    if (store.clockMs > limit) {
      for (const o of [...store.list("Unit"), ...store.list("Structure"), ...store.list("Platform")]) {
        console.error(o.id, JSON.stringify(o.props));
      }
      for (const e of store.events.slice(-15)) console.error(`${formatClock(e.timeMs)} [${e.kind}] ${e.text}`);
      throw new Error(`Stalled: ${label}`);
    }
    onTick();
    sim.tick(100);
  }
  console.log(`[ok] ${label} at ${formatClock(store.clockMs)}`);
}

const phaseDone = (order: number) => () => phaseByOrder(store, order)!.props.status === "Complete";

// P1: divert both helicopters when the LZ threat shows up.
run("startPhase", "phase-1");
let diverted = false;
until("P1 Infil", phaseDone(PHASE.INFIL), () => {
  if (diverted) return;
  const threat = store.list("Observation").find((o) => store.linkedOne(o.id, "observationLz"));
  if (threat) {
    run("markLzRisky", "hlz-raven");
    diverted = true;
  }
});
for (const id of ["dusty-1", "dusty-2"]) {
  const lz = store.linkedOne(id, "platformLz");
  if (lz?.id !== "hlz-crow") throw new Error(`${id} was not diverted to CROW`);
}

run("startPhase", "phase-2");
until("P2 Approach", phaseDone(PHASE.APPROACH));

run("startPhase", "phase-3");
until(
  "P3 Assault",
  phaseDone(PHASE.ASSAULT),
  () => {
    for (const s of store.list("Structure")) {
      if (s.props.status === "Clear reported") run("markCleared", s.id);
    }
    for (const u of store.list("Unit")) {
      if (u.props.role !== "Assault" || objectiveOf(store, u)) continue;
      const next = store
        .list("Structure")
        .find((s) => s.props.status === "Uncleared" && store.linked(s.id, "unitObjective", "reverse").length === 0);
      if (next) run("assignObjective", u.id, { structure: next.id });
    }
  },
);

run("startPhase", "phase-4");
until("P4 Exfil", () => region(store).props.missionStatus === "Complete");

const fullRunEvents = store.events.length;

// Second run: abort in the middle of the assault.
store = new OntologyStore();
loadScenario(store);
sim = new Simulator(store);
run("startPhase", "phase-1");
until("abort run: P1", phaseDone(PHASE.INFIL));
run("startPhase", "phase-2");
until("abort run: P2", phaseDone(PHASE.APPROACH));
run("startPhase", "phase-3");
until("abort run: assault under way", () => store.list("Structure").some((s) => s.props.status === "Clearing"));
run("abortMission", "region-granite");
until("abort run: extracted", () => region(store).props.missionStatus === "Aborted");

console.log(`\nfull run: ${fullRunEvents} events; abort run tail:`);
for (const e of store.events.slice(-8)) console.log(`${formatClock(e.timeMs)} [${e.kind}] ${e.text}`);
