import type { OntObject, Point } from "../ontology/schema";
import type { OntologyStore } from "../ontology/store";
import {
  PHASE,
  activePhase,
  carrierOf,
  dist,
  liftOf,
  lzOf,
  objectiveOf,
  phaseByOrder,
  phases,
  region,
} from "../ontology/queries";

const HELO_SPEED = 18;
const UNIT_SPEED = 11;
const ARRIVE = 3;
const OFFLOAD_MS = 4000;
const CLEAR_MS_PER_FLOOR = 9000;
const ORBIT = { center: { x: 632, y: 336 }, radius: 175, rate: 0.12 };

const OBSERVATION_POOL = [
  "2 PAX on roof",
  "Movement behind window",
  "Thermal signature, 1 PAX",
  "Door opened, PAX re-entered",
  "Interior light switched off",
  "PAX carrying long object",
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moveToward(pos: Point, target: Point, step: number): boolean {
  const d = dist(pos, target);
  if (d <= Math.max(step, ARRIVE)) {
    pos.x = target.x;
    pos.y = target.y;
    return true;
  }
  pos.x += ((target.x - pos.x) / d) * step;
  pos.y += ((target.y - pos.y) / d) * step;
  return false;
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export class Simulator {
  private rng = mulberry32(1337);
  private orbitAngle = -Math.PI / 2;
  private nextObservationAt = 6000;
  private lzThreatInjected = false;

  constructor(private store: OntologyStore) {}

  tick(dtMs: number): void {
    const store = this.store;
    store.clockMs += dtMs;
    const dt = dtMs / 1000;

    this.updateHelicopters(dt);
    this.updateUnits(dt);
    this.updateStructures();
    this.updateUav(dt);
    this.produceObservations();
    this.checkPhases();
    store.touch();
  }

  private landingSpot(platform: OntObject<"Platform">, lz: OntObject<"LandingZone">): Point {
    const helos = this.store.list("Platform").filter((p) => p.props.kind === "Helicopter");
    const i = helos.findIndex((p) => p.id === platform.id);
    return { x: lz.props.pos.x + (i === 0 ? -14 : 14), y: lz.props.pos.y };
  }

  private liftUnitsAboard(platform: OntObject<"Platform">): boolean {
    const store = this.store;
    return store
      .linked<"Unit">(platform.id, "unitLift", "reverse")
      .every((u) => carrierOf(store, u)?.id === platform.id || u.props.status === "Extracted");
  }

  private updateHelicopters(dt: number): void {
    const store = this.store;
    const phase = activePhase(store);
    const exfil = phase?.props.order === PHASE.EXFIL;
    const r = region(store);

    for (const helo of store.list("Platform")) {
      if (helo.props.kind !== "Helicopter") continue;
      const p = helo.props;
      const lz = lzOf(store, helo);
      const carrying = store.linked<"Unit">(helo.id, "platformCarries");

      switch (p.status) {
        case "Staged":
          if (exfil && this.liftUnitsAboard(helo)) {
            store.update(helo, { status: "RTB complete" });
          } else if (phase?.props.order === PHASE.INFIL && carrying.length > 0) {
            store.update(helo, { status: "Inbound" });
            store.log("sim", `${p.callsign} wheels up, inbound ${lz?.props.name ?? "?"}`, [helo.id]);
          }
          break;

        case "Inbound": {
          if (exfil && carrying.length > 0 && this.liftUnitsAboard(helo)) {
            store.update(helo, { status: "Egress" });
            break;
          }
          if (!lz) break;
          const spot = this.landingSpot(helo, lz);
          store.update(helo, { waypoint: spot, altitudeFt: 400 });
          if (moveToward(p.pos, spot, HELO_SPEED * dt)) {
            store.update(helo, { status: "Landed", landedAt: store.clockMs, altitudeFt: 0, waypoint: null });
            store.log("sim", `${p.callsign} landed at ${lz.props.name}`, [helo.id, lz.id]);
            if (!exfil) this.offload(helo, lz);
          }
          break;
        }

        case "Landed":
          if (exfil) {
            if (this.liftUnitsAboard(helo)) {
              store.update(helo, { status: "Egress" });
              store.log("sim", `${p.callsign} lifting off with ${carrying.map((u) => u.props.callsign).join(", ")}`, [helo.id]);
            }
          } else if (carrying.length === 0 && store.clockMs - (p.landedAt ?? 0) > OFFLOAD_MS) {
            store.update(helo, { status: "Holding", waypoint: r.props.holdingArea });
            store.log("sim", `${p.callsign} departing to holding area`, [helo.id]);
          }
          break;

        case "Holding":
          if (exfil) {
            store.update(helo, { status: "Inbound" });
            store.log("sim", `${p.callsign} inbound ${lz?.props.name ?? "?"} for pickup`, [helo.id]);
            break;
          }
          if (p.waypoint === null) break;
          store.update(helo, { waypoint: r.props.holdingArea, altitudeFt: 500 });
          if (moveToward(p.pos, r.props.holdingArea, HELO_SPEED * dt)) {
            store.update(helo, { waypoint: null, altitudeFt: 0 });
          }
          break;

        case "Egress": {
          const home = { x: r.props.fob.x + (helo.id === "dusty-1" ? 0 : 14), y: r.props.fob.y };
          store.update(helo, { waypoint: home, altitudeFt: 400 });
          if (moveToward(p.pos, home, HELO_SPEED * dt)) {
            store.update(helo, { status: "RTB complete", waypoint: null, altitudeFt: 0 });
            store.log("sim", `${p.callsign} back at FOB`, [helo.id]);
            for (const u of carrying) store.update(u, { status: "Extracted" });
          }
          break;
        }

        default:
          break;
      }

      if (p.altitudeFt > 0) store.update(helo, { fuel: Math.max(0, p.fuel - 0.12 * dt) });
    }
  }

  private offload(helo: OntObject<"Platform">, lz: OntObject<"LandingZone">): void {
    const store = this.store;
    const units = store.linked<"Unit">(helo.id, "platformCarries");
    units.forEach((u, i) => {
      store.unlink("platformCarries", helo.id, u.id);
      store.update(u, {
        status: "On ground",
        pos: { x: helo.props.pos.x + (i - (units.length - 1) / 2) * 10, y: helo.props.pos.y - 14 },
      });
      store.log("sim", `${u.props.callsign} on the ground at ${lz.props.name}`, [u.id, lz.id]);
    });
  }

  private unitGoal(unit: OntObject<"Unit">): { goal: Point | null; arrivedStatus: OntObject<"Unit">["props"]["status"] } {
    const store = this.store;
    const order = activePhase(store)?.props.order;
    const objective = objectiveOf(store, unit);

    if (order === PHASE.APPROACH) {
      if (unit.props.role === "Overwatch") return { goal: unit.props.overwatchPos, arrivedStatus: "In position" };
      if (objective) return { goal: objective.props.breachPoint, arrivedStatus: "In position" };
      return { goal: null, arrivedStatus: "Holding" };
    }

    if (order === PHASE.ASSAULT) {
      if (unit.props.role === "Overwatch") return { goal: unit.props.overwatchPos, arrivedStatus: "In position" };
      if (!objective) return { goal: null, arrivedStatus: "Holding" };
      const compound = store.list("Compound")[0];
      const outside = compound && !insidePolygon(unit.props.pos, compound.props.wall);
      const door = objective.props.door;
      const wp = unit.props.waypoint;
      const headingToDoor = wp !== null && wp.x === door.x && wp.y === door.y;
      const atBreach = dist(unit.props.pos, objective.props.breachPoint) <= ARRIVE;
      if (outside && !atBreach && !headingToDoor) return { goal: objective.props.breachPoint, arrivedStatus: "Moving" };
      return { goal: objective.props.door, arrivedStatus: "Assaulting" };
    }

    if (order === PHASE.EXFIL) {
      const lift = liftOf(store, unit);
      const lz = lift && lzOf(store, lift);
      return { goal: lz ? { x: lz.props.pos.x, y: lz.props.pos.y - 16 } : null, arrivedStatus: "Holding" };
    }

    return { goal: null, arrivedStatus: unit.props.status === "On ground" ? "On ground" : "Holding" };
  }

  private updateUnits(dt: number): void {
    const store = this.store;
    const exfil = activePhase(store)?.props.order === PHASE.EXFIL;

    for (const unit of store.list("Unit")) {
      const carrier = carrierOf(store, unit);
      if (carrier) {
        unit.props.pos.x = carrier.props.pos.x;
        unit.props.pos.y = carrier.props.pos.y;
        continue;
      }
      if (unit.props.status === "Extracted") continue;

      const { goal, arrivedStatus } = this.unitGoal(unit);
      if (!goal) {
        if (unit.props.status !== arrivedStatus) store.update(unit, { status: arrivedStatus, waypoint: null });
        continue;
      }
      store.update(unit, { waypoint: { ...goal } });
      const arrived = moveToward(unit.props.pos, goal, UNIT_SPEED * dt);
      const status = arrived ? arrivedStatus : "Moving";
      if (unit.props.status !== status) store.update(unit, { status });

      if (arrived && exfil) this.tryEmbark(unit);
    }
  }

  private tryEmbark(unit: OntObject<"Unit">): void {
    const store = this.store;
    const lift = liftOf(store, unit);
    if (!lift || lift.props.status !== "Landed") return;
    if (dist(lift.props.pos, unit.props.pos) > 40) return;
    store.link("platformCarries", lift.id, unit.id);
    store.update(unit, { status: "Embarked", waypoint: null });
    store.log("sim", `${unit.props.callsign} embarked on ${lift.props.callsign}`, [unit.id, lift.id]);
  }

  private updateStructures(): void {
    const store = this.store;
    if (activePhase(store)?.props.order !== PHASE.ASSAULT) return;

    for (const s of store.list("Structure")) {
      const assaulting = store
        .linked<"Unit">(s.id, "unitObjective", "reverse")
        .filter((u) => u.props.status === "Assaulting");

      if (s.props.status === "Uncleared" && assaulting.length > 0) {
        store.update(s, { status: "Clearing", clearingSince: store.clockMs });
        store.update(store.list("Compound")[0], { status: "Contested" });
        store.log("sim", `${assaulting[0].props.callsign} breaching ${s.props.name}`, [assaulting[0].id, s.id]);
        continue;
      }

      if (s.props.status === "Clearing" && s.props.clearingSince !== null) {
        const factor = s.props.threat === "Confirmed" ? 1.5 : 1;
        if (store.clockMs - s.props.clearingSince >= s.props.floors * CLEAR_MS_PER_FLOOR * factor) {
          store.update(s, { status: "Clear reported" });
          const who = assaulting[0]?.props.callsign ?? "Assault team";
          store.log("warning", `${who} reports ${s.props.name} clear. Confirm.`, [s.id]);
        }
      }
    }
  }

  private updateUav(dt: number): void {
    const store = this.store;
    this.orbitAngle += ORBIT.rate * dt;
    for (const uav of store.list("Platform")) {
      if (uav.props.kind !== "UAV") continue;
      uav.props.pos.x = ORBIT.center.x + ORBIT.radius * Math.cos(this.orbitAngle);
      uav.props.pos.y = ORBIT.center.y + ORBIT.radius * Math.sin(this.orbitAngle);
      uav.props.fuel = Math.max(0, uav.props.fuel - 0.02 * dt);
    }
  }

  private addObservation(
    summary: string,
    confidence: OntObject<"Observation">["props"]["confidence"],
    pos: Point,
    subject: { structure?: string; lz?: string },
  ): void {
    const store = this.store;
    const uav = store.list("Platform").find((p) => p.props.kind === "UAV");
    const id = store.nextId("obs");
    store.add("Observation", id, { summary, confidence, status: "New", timeMs: store.clockMs, pos });
    if (uav) store.link("observationSource", id, uav.id);
    if (subject.structure) store.link("observationStructure", id, subject.structure);
    if (subject.lz) store.link("observationLz", id, subject.lz);
    store.log("sim", `${uav?.props.callsign ?? "UAV"}: ${summary} (${confidence})`, [id]);
  }

  private produceObservations(): void {
    const store = this.store;
    if (region(store).props.missionStatus !== "In progress") return;

    const infil = phaseByOrder(store, PHASE.INFIL);
    const raven = store.get("hlz-raven") as OntObject<"LandingZone"> | undefined;
    if (
      !this.lzThreatInjected &&
      infil?.props.status === "Active" &&
      infil.props.startedAt !== null &&
      store.clockMs - infil.props.startedAt > 3000 &&
      raven
    ) {
      this.lzThreatInjected = true;
      this.addObservation(
        "Vehicle with 3 PAX moving toward HLZ RAVEN",
        "High",
        { x: raven.props.pos.x + 40, y: raven.props.pos.y - 45 },
        { lz: raven.id },
      );
    }

    if (store.clockMs < this.nextObservationAt) return;
    this.nextObservationAt = store.clockMs + 9000 + this.rng() * 6000;

    const candidates = store.list("Structure").filter((s) => s.props.status !== "Cleared");
    if (candidates.length === 0) return;
    const s = candidates[Math.floor(this.rng() * candidates.length)];
    const text = OBSERVATION_POOL[Math.floor(this.rng() * OBSERVATION_POOL.length)];
    const roll = this.rng();
    const confidence = roll > 0.75 ? "High" : roll > 0.35 ? "Medium" : "Low";
    const r = s.props.rect;
    this.addObservation(
      `${text} at ${s.props.name.split(" ")[0]}`,
      confidence,
      { x: r.x + r.w / 2 + (this.rng() - 0.5) * 20, y: r.y + r.h / 2 + (this.rng() - 0.5) * 20 },
      { structure: s.id },
    );
    if (confidence === "High" && s.props.threat === "None") store.update(s, { threat: "Possible" });
  }

  private checkPhases(): void {
    const store = this.store;
    const phase = activePhase(store);
    if (!phase) return;
    const units = store.list("Unit");

    switch (phase.props.order) {
      case PHASE.INFIL:
        if (units.every((u) => !carrierOf(store, u))) {
          store.update(phase, { status: "Complete" });
          store.log("system", "P1 Infil complete. All elements on the ground.", [phase.id]);
        }
        break;

      case PHASE.APPROACH: {
        const tasked = units.filter((u) => u.props.role === "Overwatch" || objectiveOf(store, u));
        if (tasked.length > 0 && tasked.every((u) => u.props.status === "In position")) {
          store.update(phase, { status: "Complete" });
          store.log("system", "P2 Approach complete. All elements set. Ready for Assault.", [phase.id]);
        }
        break;
      }

      case PHASE.EXFIL:
        if (units.every((u) => u.props.status === "Extracted")) {
          store.update(phase, { status: "Complete" });
          const aborted = phases(store).some((p) => p.props.status === "Aborted");
          store.update(region(store), { missionStatus: aborted ? "Aborted" : "Complete" });
          store.log("system", aborted ? "All elements extracted. Mission aborted." : "All elements extracted. Mission complete.", [
            phase.id,
          ]);
        }
        break;

      default:
        break;
    }
  }
}
