import { OntologyStore } from "../src/ontology/store";
import { Simulator } from "../src/sim/simulator";
import { loadScenario } from "../src/sim/scenario";
import { ACTIONS } from "../src/ontology/actions";
import { PHASE, dist, objectiveOf, phaseByOrder, region } from "../src/ontology/queries";
import { formatClock } from "../src/ui/format";
import { insidePolygon } from "../src/sim/routing";
import type { Point } from "../src/ontology/schema";

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

const lastPos = new Map<string, Point>();
let movementChecks = 0;

function groundMovers(): { id: string; pos: Point }[] {
  const out: { id: string; pos: Point }[] = [];
  for (const u of store.list("Unit")) {
    if (u.props.status === "Extracted" || store.linkedOne(u.id, "platformCarries", "reverse")) {
      lastPos.delete(u.id);
      continue;
    }
    out.push({ id: u.id, pos: u.props.pos });
  }
  for (const t of sim.targets) if (t.active) out.push({ id: t.id, pos: t.pos });
  return out;
}

function checkMovement(): void {
  const compound = store.list("Compound")[0];
  const rects = store.list("Structure").map((s) => ({ name: s.props.name, r: s.props.rect }));
  for (const m of groundMovers()) {
    for (const { name, r } of rects) {
      if (m.pos.x > r.x && m.pos.x < r.x + r.w && m.pos.y > r.y && m.pos.y < r.y + r.h) {
        throw new Error(`${m.id} is inside ${name} at ${formatClock(store.clockMs)}`);
      }
    }
    const prev = lastPos.get(m.id);
    if (prev && insidePolygon(prev, compound.props.wall) !== insidePolygon(m.pos, compound.props.wall)) {
      const viaGate = compound.props.gates.some((g) => dist(g.pos, m.pos) < 8 || dist(g.pos, prev) < 8);
      if (!viaGate) throw new Error(`${m.id} crossed the compound wall away from a gate at ${formatClock(store.clockMs)}`);
    }
    lastPos.set(m.id, { ...m.pos });
    movementChecks++;
  }
}

function until(label: string, done: () => boolean, onTick: () => void = () => {}, maxSimSec = 600): void {
  const limit = store.clockMs + maxSimSec * 1000;
  let seen = store.events.length;
  while (!done()) {
    for (const e of store.events.slice(seen)) {
      const trackId = e.refs.find((r) => store.get(r)?.type === "Track");
      if (e.kind === "warning" && / m from HLZ /.test(e.text) && trackId) {
        alertTruth.set(trackId, nearestTruth(trackId));
      }
    }
    seen = store.events.length;
    if (store.clockMs > limit) {
      for (const o of [...store.list("Unit"), ...store.list("Structure"), ...store.list("Platform")]) {
        console.error(o.id, JSON.stringify(o.props));
      }
      for (const e of store.events.slice(-15)) console.error(`${formatClock(e.timeMs)} [${e.kind}] ${e.text}`);
      throw new Error(`Stalled: ${label}`);
    }
    onTick();
    sim.tick(100);
    checkMovement();
  }
  console.log(`[ok] ${label} at ${formatClock(store.clockMs)}`);
}

function nearestTruth(trackId: string): string {
  const t = store.getAs("Track", trackId);
  const best = sim.targets
    .filter((g) => g.active)
    .sort((a, b) => dist(a.pos, t.props.pos) - dist(b.pos, t.props.pos))[0];
  return best ? best.id : "none";
}

const alertTruth = new Map<string, string>();
function nearestTruthAt(trackId: string | undefined): string {
  return (trackId && alertTruth.get(trackId)) ?? "unknown";
}

const phaseDone = (order: number) => () => phaseByOrder(store, order)!.props.status === "Complete";

run("startPhase", "phase-1");
let diverted = false;
until("P1 Infil", phaseDone(PHASE.INFIL), () => {
  if (diverted) return;
  const alert = store.events.find((e) => e.kind === "warning" && e.text.includes("from HLZ RAVEN"));
  const threat = alert && store.get(alert.refs[0]);
  if (threat) {
    run("classifyHostile", threat.id);
    run("markLzRisky", "hlz-raven");
    diverted = true;
    console.log(`     ${alert.text}; truth: ${nearestTruth(threat.id)}`);
  }
});
for (const id of ["dusty-1", "dusty-2"]) {
  const lz = store.linkedOne(id, "platformLz");
  if (!diverted) throw new Error("No LZ threat alert during infil");
  if (lz?.id !== "hlz-crow") throw new Error(`${id} was not diverted to CROW`);
}

run("startPhase", "phase-2");
until("P2 Approach", phaseDone(PHASE.APPROACH));
for (const id of ["alpha", "bravo"]) {
  const gate = store.getAs("Unit", id).props.entryGate;
  if (gate !== "North gate") throw new Error(`${id} picked ${gate} after landing at CROW`);
}
console.log("     assault teams staged at North gate");

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
const spurious = store.events.filter(
  (e) =>
    e.kind === "warning" &&
    / m from HLZ /.test(e.text) &&
    nearestTruthAt(e.refs.find((r) => alertTruth.has(r))) !== "technical",
);
if (spurious.length > 0) throw new Error(`Spurious LZ alerts: ${spurious.map((e) => e.text).join("; ")}`);
console.log("     every LZ alert came from the technical vehicle");
if (sim.tracker.ghostTracks > 0) throw new Error(`${sim.tracker.ghostTracks} confirmed tracks on friendly forces`);
console.log("     no confirmed tracks on friendly forces");
const rms = (k: "radar" | "eo" | "track") => {
  const st = sim.tracker.stats[k];
  return Math.sqrt(st.sumSq / Math.max(st.n, 1));
};
const radarRms = rms("radar");
const eoRms = rms("eo");
const trackRms = rms("track");
console.log(
  `     position RMS: radar plots ${radarRms.toFixed(1)} m, EO plots ${eoRms.toFixed(1)} m, fused tracks ${trackRms.toFixed(1)} m`,
);
if (!(trackRms < radarRms)) throw new Error("Fused tracks are not better than raw radar plots");

console.log(`     no unit or person passed through a building or wall (${movementChecks} position checks)`);

store = new OntologyStore();
loadScenario(store);
sim = new Simulator(store);
lastPos.clear();
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
