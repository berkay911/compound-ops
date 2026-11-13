import { OntologyStore } from "../src/ontology/store";
import { Simulator } from "../src/sim/simulator";
import { loadScenario } from "../src/sim/scenario";
import { ACTIONS } from "../src/ontology/actions";
import { PHASE, carrierOf, dist, phaseByOrder, region } from "../src/ontology/queries";
import { formatClock } from "../src/ui/format";
import { insidePolygon } from "../src/sim/routing";
import { MIN_FRIENDLY_M } from "../src/sim/fires";
import type { Point } from "../src/ontology/schema";

let store!: OntologyStore;
let sim!: Simulator;
const operatorLog: { timeMs: number; action: string; phase: number | undefined }[] = [];
const lastPos = new Map<string, Point>();
let movementChecks = 0;
let impactsSeen = 0;
let minStrikeClearance = Infinity;
const shepherdHostile = { seen: false };

function fresh(): void {
  store = new OntologyStore();
  loadScenario(store);
  sim = new Simulator(store);
  operatorLog.length = 0;
  lastPos.clear();
  impactsSeen = 0;
}

function fail(msg: string): never {
  for (const e of store.events.slice(-20)) console.error(`${formatClock(e.timeMs)} [${e.lane}] ${e.text}`);
  throw new Error(msg);
}

function run(id: string, target: string, params: Record<string, string> = {}): void {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) fail(`no action ${id}`);
  const obj = store.get(target)!;
  const reason = a.check(store, obj, params);
  if (reason) fail(`${id} on ${target} refused: ${reason}`);
  const active = store.list("Phase").find((p) => p.props.status === "Active")?.props.order;
  operatorLog.push({ timeMs: store.clockMs, action: `${id} ${target}`, phase: active });
  a.apply(store, obj, params);
}

function friendlyPoints(): { name: string; pos: Point }[] {
  const out: { name: string; pos: Point }[] = [];
  for (const u of store.list("Unit")) {
    if (u.props.status !== "Extracted" && !carrierOf(store, u)) out.push({ name: u.props.callsign, pos: u.props.pos });
  }
  for (const p of store.list("Platform")) {
    if (p.props.kind === "Helicopter") out.push({ name: p.props.callsign, pos: p.props.pos });
  }
  return out;
}

function checkMovement(): void {
  const compound = store.list("Compound")[0];
  const rects = store.list("Structure").map((s) => ({ name: s.props.name, r: s.props.rect }));
  const movers: { id: string; pos: Point }[] = [];
  for (const u of store.list("Unit")) {
    if (u.props.status === "Extracted" || carrierOf(store, u)) lastPos.delete(u.id);
    else movers.push({ id: u.id, pos: u.props.pos });
  }
  for (const t of sim.targets) if (t.active) movers.push({ id: t.id, pos: t.pos });
  for (const m of movers) {
    for (const { name, r } of rects) {
      if (m.pos.x > r.x && m.pos.x < r.x + r.w && m.pos.y > r.y && m.pos.y < r.y + r.h) {
        fail(`${m.id} is inside ${name} at ${formatClock(store.clockMs)}`);
      }
    }
    const prev = lastPos.get(m.id);
    if (prev && insidePolygon(prev, compound.props.wall) !== insidePolygon(m.pos, compound.props.wall)) {
      const viaGate = compound.props.gates.some((g) => dist(g.pos, m.pos) < 8 || dist(g.pos, prev) < 8);
      if (!viaGate) fail(`${m.id} crossed the compound wall away from a gate at ${formatClock(store.clockMs)}`);
    }
    lastPos.set(m.id, { ...m.pos });
    movementChecks++;
  }
}

function checkFires(): void {
  for (const imp of sim.fires.impacts.slice(impactsSeen)) {
    if (imp.truthId === "shepherd") fail(`${imp.engagementId} struck the shepherd`);
    for (const f of friendlyPoints()) {
      const d = dist(f.pos, imp.pos);
      minStrikeClearance = Math.min(minStrikeClearance, d);
      if (d < MIN_FRIENDLY_M) fail(`${imp.engagementId} impact ${d.toFixed(1)} m from ${f.name}`);
    }
    const e = store.getAs("Engagement", imp.engagementId);
    if (!e.props.rationale || !e.props.checks || !e.props.outcome) fail(`${e.props.label} has no recorded rationale`);
    const label = e.props.targetLabel;
    if (store.list("Track").some((t) => t.props.label === label)) fail(`${label} still tracked after ${e.props.label} hit`);
  }
  impactsSeen = sim.fires.impacts.length;
  for (const e of store.list("Engagement")) {
    if (!e.props.rationale || !e.props.checks || !e.props.outcome) fail(`${e.props.label} has no recorded rationale`);
  }
  for (const t of store.list("Track")) {
    if (t.props.affiliation === "Hostile" && sim.tracker.truthOf(t.id) === "shepherd") shepherdHostile.seen = true;
    if (t.props.classifiedBy === "System" && !t.props.assessment) fail(`${t.props.label} classified without a recorded reason`);
  }
  if (shepherdHostile.seen) fail("shepherd track was assessed hostile");
}

function until(label: string, done: () => boolean, onTick: () => void = () => {}, maxSimSec = 600): void {
  const limit = store.clockMs + maxSimSec * 1000;
  while (!done()) {
    if (store.clockMs > limit) {
      for (const o of [...store.list("Unit"), ...store.list("Structure")]) console.error(o.id, JSON.stringify(o.props));
      fail(`Stalled: ${label}`);
    }
    onTick();
    sim.tick(100);
    checkMovement();
    checkFires();
  }
  console.log(`[ok] ${label} at ${formatClock(store.clockMs)}`);
}

const phaseDone = (order: number) => () => phaseByOrder(store, order)!.props.status === "Complete";
const hostileTruth = () => sim.targets.filter((t) => t.id !== "shepherd");

if (ACTIONS.some((a) => a.id === "assignObjective" || a.id === "markCleared")) {
  throw new Error("manual objective assignment or clear confirmation still exists");
}

console.log("run 1: hands-off raid, operator presses only the four phase buttons");
fresh();
run("startPhase", "phase-1");
until("P1 Infil", phaseDone(PHASE.INFIL));
run("startPhase", "phase-2");
until("P2 Approach", phaseDone(PHASE.APPROACH));
run("startPhase", "phase-3");
until("P3 Assault", phaseDone(PHASE.ASSAULT));
const duringAssault = operatorLog.filter((o) => o.phase === PHASE.ASSAULT);
if (duringAssault.length > 0) fail(`operator acted during assault: ${duringAssault.map((o) => o.action).join(", ")}`);
const notCleared = store.list("Structure").filter((s) => s.props.status !== "Cleared");
if (notCleared.length > 0) fail(`not cleared: ${notCleared.map((s) => s.props.name).join(", ")}`);
console.log(
  `     assault finished with zero operator actions; cleared by ${store
    .list("Structure")
    .map((s) => `${s.props.name.split(" ")[0]}:${s.props.clearedBy}`)
    .join(" ")}`,
);
const holdAt = new Map(store.list("Unit").map((u) => [u.id, { ...u.props.pos }]));
const holdUntil = store.clockMs + 30_000;
until("teams hold in place for 30 s with no Exfil order", () => store.clockMs >= holdUntil);
for (const u of store.list("Unit")) {
  const moved = dist(holdAt.get(u.id)!, u.props.pos);
  if (moved > 0.01) fail(`${u.props.callsign} moved ${moved.toFixed(1)} m after the assault without an order`);
}
run("startPhase", "phase-4");
until("P4 Exfil", () => region(store).props.missionStatus === "Complete");

const alive = hostileTruth().filter((t) => t.active);
if (alive.length > 0) fail(`hostiles still active: ${alive.map((t) => t.id).join(", ")}`);
if (!sim.targets.find((t) => t.id === "shepherd")!.active) fail("shepherd is not alive");
const byDrone = sim.neutralized.filter((n) => n.by.startsWith("ENG-"));
console.log(
  `     all ${hostileTruth().length} hostile elements neutralized (${byDrone.length} by FPV, ${
    sim.neutralized.length - byDrone.length
  } by assault teams); shepherd alive and never assessed hostile`,
);
const shepherdTrack = store.list("Track").find((t) => sim.tracker.truthOf(t.id) === "shepherd");
console.log(`     shepherd track: ${shepherdTrack ? `${shepherdTrack.props.label} ${shepherdTrack.props.affiliation}` : "not held"}`);
console.log(`     ${sim.fires.impacts.length} strikes, closest friendly at impact ${minStrikeClearance.toFixed(0)} m (rule: ≥ ${MIN_FRIENDLY_M} m)`);
for (const e of store.list("Engagement")) {
  console.log(`       ${e.props.label} ${e.props.effector} → ${e.props.targetLabel}: ${e.props.status}. ${e.props.rationale}`);
}
if (sim.tracker.ghostTracks > 0) fail(`${sim.tracker.ghostTracks} confirmed tracks on friendly forces`);
console.log("     no confirmed tracks on friendly forces");
const rms = (k: "radar" | "eo" | "track") => {
  const st = sim.tracker.stats[k];
  return Math.sqrt(st.sumSq / Math.max(st.n, 1));
};
console.log(
  `     position RMS: radar plots ${rms("radar").toFixed(1)} m, EO plots ${rms("eo").toFixed(1)} m, fused tracks ${rms("track").toFixed(1)} m`,
);
if (!(rms("track") < rms("radar"))) fail("fused tracks are not better than raw radar plots");
console.log(`     no unit or person passed through a building or wall (${movementChecks} position checks)`);

console.log("\nrun 2: WEAPONS HOLD, LZ diversion, then hold pressed mid-flight");
fresh();
run("weaponsHold", "region-granite");
run("startPhase", "phase-1");
let diverted = false;
until("P1 Infil under WEAPONS HOLD", phaseDone(PHASE.INFIL), () => {
  if (diverted) return;
  const alert = store.events.find((e) => e.kind === "warning" && e.text.includes("from HLZ RAVEN"));
  if (alert) {
    run("markLzRisky", "hlz-raven");
    diverted = true;
  }
});
if (store.list("Engagement").length > 0) fail("engagement launched under WEAPONS HOLD");
if (!store.list("Track").some((t) => t.props.affiliation === "Hostile")) fail("no hostile assessed during hold");
console.log("     hostiles assessed but no engagement launched while on hold");
for (const id of ["dusty-1", "dusty-2"]) {
  if (store.linkedOne(id, "platformLz")?.id !== "hlz-crow") fail(`${id} was not diverted to CROW`);
}
run("startPhase", "phase-2");
until("P2 Approach", phaseDone(PHASE.APPROACH));
for (const id of ["alpha", "bravo"]) {
  const gate = store.getAs("Unit", id).props.entryGate;
  if (gate !== "North gate") fail(`${id} picked ${gate} after landing at CROW`);
}
console.log("     assault teams staged at North gate after landing at CROW");
run("weaponsFree", "region-granite");
until("an FPV is in flight after WEAPONS FREE", () => store.list("Platform").some((p) => p.props.kind === "FPV" && p.props.status === "Engaging"));
const hitsBefore = sim.fires.impacts.length;
run("weaponsHold", "region-granite");
sim.tick(100);
const stillEngaging = store.list("Platform").filter((p) => p.props.kind === "FPV" && (p.props.status === "Engaging" || p.props.status === "Holding off"));
if (stillEngaging.length > 0) fail(`${stillEngaging.map((d) => d.props.callsign).join(", ")} still engaging after hold`);
const holdEnds = store.clockMs + 20_000;
until("20 s of WEAPONS HOLD with drones returning", () => store.clockMs >= holdEnds);
if (sim.fires.impacts.length !== hitsBefore) fail("impact during WEAPONS HOLD");
console.log("     one click on hold broke off every drone in flight; no impacts during hold");
run("weaponsFree", "region-granite");
run("startPhase", "phase-3");
until("P3 Assault", phaseDone(PHASE.ASSAULT));
run("startPhase", "phase-4");
until("P4 Exfil", () => region(store).props.missionStatus === "Complete");
const alive2 = hostileTruth().filter((t) => t.active);
if (alive2.length > 0) fail(`hostiles still active: ${alive2.map((t) => t.id).join(", ")}`);
if (!sim.targets.find((t) => t.id === "shepherd")!.active) fail("shepherd is not alive");
console.log(`     all hostiles neutralized, shepherd alive (${sim.fires.impacts.length} strikes)`);

console.log("\nrun 3: abort mid-assault");
fresh();
run("startPhase", "phase-1");
until("P1", phaseDone(PHASE.INFIL));
run("startPhase", "phase-2");
until("P2", phaseDone(PHASE.APPROACH));
run("startPhase", "phase-3");
until("assault under way", () => store.list("Structure").some((s) => s.props.status === "Clearing"));
run("abortMission", "region-granite");
until("extracted", () => region(store).props.missionStatus === "Aborted");

console.log(`\nsmoke passed: ${movementChecks} movement checks, closest strike to a friendly ${minStrikeClearance.toFixed(0)} m`);
