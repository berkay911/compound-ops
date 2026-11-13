import type { OntObject, Point, UnitStatus } from "../ontology/schema";
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
import { mulberry32, poisson } from "./random";
import { createTargets, moveTarget, type TruthTarget } from "./targets";
import {
  EO,
  RADAR,
  angleInSweep,
  eoMeasure,
  eoPlot,
  inEoFootprint,
  radarMeasure,
  radarPlot,
  type RawDetection,
} from "./sensors";
import { Tracker } from "./tracker";
import { entryGate } from "./routing";
import { buildNavGrid, findPath, type NavGrid } from "./nav";

const HELO_SPEED = 18;
const UNIT_SPEED = 11;
const ARRIVE = 3;
const OFFLOAD_MS = 4000;
const CLEAR_MS_PER_FLOOR = 9000;
const ORBIT = { center: { x: 632, y: 336 }, radius: 175, rate: 0.12 };
const LZ_ALERT_RANGE_M = 450;
const LZ_CLOSE_RANGE_M = 120;
const LZ_CLOSING_MPS = 3;
const LANDING_THREAT_RANGE_M = 150;
const TWO_PI = Math.PI * 2;

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

function samePoint(a: Point | null, b: Point): boolean {
  return a !== null && a.x === b.x && a.y === b.y;
}

export class Simulator {
  readonly targets: TruthTarget[] = createTargets();
  readonly tracker: Tracker;
  private rng = mulberry32(1337);
  private orbitAngle = -Math.PI / 2;
  private radarAngle = 0;
  private nextEoScanMs = 0;
  private alerted = new Set<string>();
  readonly nav: NavGrid;

  constructor(private store: OntologyStore) {
    this.tracker = new Tracker(store, { [RADAR.id]: RADAR.name, [EO.id]: EO.name });
    const compound = store.list("Compound")[0];
    this.nav = buildNavGrid({
      wall: compound?.props.wall ?? [],
      gates: compound?.props.gates ?? [],
      buildings: store.list("Structure").map((s) => s.props.rect),
    });
  }

  tick(dtMs: number): void {
    const store = this.store;
    store.clockMs += dtMs;
    const dt = dtMs / 1000;

    this.updateHelicopters(dt);
    this.updateUnits(dt);
    this.updateStructures();
    this.updateUav(dt);
    this.updateTargets(dt);
    this.runRadar(dt);
    this.runEo();
    this.tracker.maintain(store.clockMs, this.truthPos);
    this.trackAlerts();
    this.checkPhases();
    store.touch();
  }

  truthPos = (id: string): Point | undefined => this.targets.find((t) => t.id === id && t.active)?.pos;

  private friendlyPositions(): { id: string; pos: Point }[] {
    const store = this.store;
    const out: { id: string; pos: Point }[] = [];
    for (const u of store.list("Unit")) {
      if (!carrierOf(store, u) && u.props.status !== "Extracted") out.push({ id: `friendly:${u.id}`, pos: u.props.pos });
    }
    for (const p of store.list("Platform")) {
      if (p.props.kind === "Helicopter" && p.props.altitudeFt === 0) out.push({ id: `friendly:${p.id}`, pos: p.props.pos });
    }
    return out;
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
          const spot = this.offsetSpot(helo, lz.props.pos);
          store.update(helo, { waypoint: spot, altitudeFt: 400 });
          if (moveToward(p.pos, spot, HELO_SPEED * dt)) {
            store.update(helo, { status: "Landed", landedAt: store.clockMs, altitudeFt: 0, waypoint: null });
            store.log("sim", `${p.callsign} landed at ${lz.props.name}`, [helo.id, lz.id]);
            this.warnLandingThreat(helo, lz);
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
            store.update(helo, { status: "Holding", waypoint: this.offsetSpot(helo, r.props.holdingArea, "base") });
            store.log("sim", `${p.callsign} departing to holding area`, [helo.id]);
          }
          break;

        case "Holding": {
          if (exfil) {
            store.update(helo, { status: "Inbound" });
            store.log("sim", `${p.callsign} inbound ${lz?.props.name ?? "?"} for pickup`, [helo.id]);
            break;
          }
          if (p.waypoint === null) break;
          const spot = this.offsetSpot(helo, r.props.holdingArea, "base");
          store.update(helo, { waypoint: spot, altitudeFt: 500 });
          if (moveToward(p.pos, spot, HELO_SPEED * dt)) store.update(helo, { waypoint: null, altitudeFt: 0 });
          break;
        }

        case "Egress": {
          const home = this.offsetSpot(helo, r.props.fob, "base");
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

  private offsetSpot(platform: OntObject<"Platform">, at: Point, spread: "pad" | "base" = "pad"): Point {
    const helos = this.store.list("Platform").filter((p) => p.props.kind === "Helicopter");
    const first = helos.findIndex((p) => p.id === platform.id) === 0;
    if (spread === "base") return first ? { x: at.x - 8, y: at.y - 20 } : { x: at.x + 22, y: at.y + 18 };
    return { x: at.x + (first ? -14 : 14), y: at.y };
  }

  private liftUnitsAboard(platform: OntObject<"Platform">): boolean {
    const store = this.store;
    return store
      .linked<"Unit">(platform.id, "unitLift", "reverse")
      .every((u) => carrierOf(store, u)?.id === platform.id || u.props.status === "Extracted");
  }

  private warnLandingThreat(helo: OntObject<"Platform">, lz: OntObject<"LandingZone">): void {
    for (const t of this.store.list("Track")) {
      if (t.props.status === "Tentative" || t.props.affiliation === "Neutral") continue;
      const d = dist(t.props.pos, lz.props.pos);
      if (d < LANDING_THREAT_RANGE_M) {
        this.store.log("warning", `${helo.props.callsign} on the ground with ${t.props.label} ${Math.round(d)} m from ${lz.props.name}`, [
          helo.id,
          t.id,
        ]);
      }
    }
  }

  private offload(helo: OntObject<"Platform">, lz: OntObject<"LandingZone">): void {
    const store = this.store;
    const units = store.linked<"Unit">(helo.id, "platformCarries");
    units.forEach((u, i) => {
      store.unlink("platformCarries", helo.id, u.id);
      store.update(u, {
        status: "On ground",
        pos: { x: helo.props.pos.x + (i - (units.length - 1) / 2) * 12, y: helo.props.pos.y - 14 },
        route: [],
        routeGoal: null,
      });
      store.log("sim", `${u.props.callsign} on the ground at ${lz.props.name}`, [u.id, lz.id]);
    });
  }

  private unitGoal(unit: OntObject<"Unit">): { goal: Point | null; arrivedStatus: UnitStatus } {
    const store = this.store;
    const order = activePhase(store)?.props.order;
    const objective = objectiveOf(store, unit);
    const compound = store.list("Compound")[0];

    if (order === PHASE.APPROACH || order === PHASE.ASSAULT) {
      if (unit.props.role === "Overwatch") return { goal: unit.props.overwatchPos, arrivedStatus: "In position" };
      if (!objective) return { goal: null, arrivedStatus: "Holding" };
      if (order === PHASE.ASSAULT) return { goal: objective.props.door, arrivedStatus: "Assaulting" };
      if (!compound) return { goal: null, arrivedStatus: "Holding" };
      let gate = compound.props.gates.find((g) => g.name === unit.props.entryGate);
      if (!gate) {
        gate = entryGate(this.nav, compound.props.gates, unit.props.pos, objective.props.door);
        store.update(unit, { entryGate: gate.name });
        store.log("sim", `${unit.props.callsign} routing to ${gate.name} for ${objective.props.name}`, [unit.id]);
      }
      return { goal: gate.outer, arrivedStatus: "In position" };
    }

    if (order === PHASE.EXFIL) {
      const lift = liftOf(store, unit);
      const lz = lift && lzOf(store, lift);
      return { goal: lz ? { x: lz.props.pos.x, y: lz.props.pos.y - 16 } : null, arrivedStatus: "Holding" };
    }

    return { goal: null, arrivedStatus: unit.props.status === "On ground" ? "On ground" : "Holding" };
  }

  private moveUnit(unit: OntObject<"Unit">, goal: Point, dt: number): boolean {
    const store = this.store;
    const p = unit.props;
    if (!samePoint(p.routeGoal, goal)) {
      store.update(unit, { route: findPath(this.nav, p.pos, goal), routeGoal: { ...goal } });
    }
    let step = UNIT_SPEED * dt;
    while (step > 0 && p.route.length > 0) {
      const next = p.route[0];
      const d = dist(p.pos, next);
      if (d <= Math.max(step, 0.01)) {
        p.pos.x = next.x;
        p.pos.y = next.y;
        step -= d;
        p.route.shift();
      } else {
        p.pos.x += ((next.x - p.pos.x) / d) * step;
        p.pos.y += ((next.y - p.pos.y) / d) * step;
        step = 0;
      }
    }
    store.update(unit, { waypoint: p.route[p.route.length - 1] ?? null });
    return p.route.length === 0;
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
      const arrived = this.moveUnit(unit, goal, dt);
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
      for (const sensor of store.linked<"Sensor">(uav.id, "sensorPlatform", "reverse")) {
        sensor.props.pos = { ...uav.props.pos };
      }
    }
  }

  private updateTargets(dt: number): void {
    const store = this.store;
    const infilStarted = phaseByOrder(store, PHASE.INFIL)?.props.startedAt != null;
    for (const t of this.targets) {
      if (!t.active && t.activation === "infil" && infilStarted && t.speed > 0) t.active = true;
      if (t.active && t.boundTo) {
        const bound = store.get(t.boundTo);
        const neutralized =
          (bound?.type === "Structure" && (bound as OntObject<"Structure">).props.status === "Cleared") ||
          (bound?.type === "Compound" && (bound as OntObject<"Compound">).props.status === "Secured");
        if (neutralized) t.active = false;
      }
      moveTarget(t, dt);
    }
  }

  private runRadar(dt: number): void {
    const store = this.store;
    const span = Math.min(TWO_PI, (TWO_PI * dt) / RADAR.periodS);
    const from = this.radarAngle;
    const detections: RawDetection[] = [];
    const observed = [
      ...this.targets.filter((t) => t.active).map((t) => ({ id: t.id, pos: t.pos, pd: RADAR.pd[t.kind] })),
      ...this.friendlyPositions().map((f) => ({ ...f, pd: RADAR.pd.Person })),
    ];
    for (const o of observed) {
      const dx = o.pos.x - RADAR.pos.x;
      const dy = o.pos.y - RADAR.pos.y;
      const range = Math.hypot(dx, dy);
      if (range < RADAR.minRange || range > RADAR.maxRange) continue;
      if (!angleInSweep(Math.atan2(dy, dx), from, span)) continue;
      if (this.rng() < o.pd) detections.push(radarMeasure(this.rng, o.pos, store.clockMs, o.id));
    }
    const falseAlarms = poisson(this.rng, (RADAR.falseAlarmsPerScan * span) / TWO_PI);
    for (let i = 0; i < falseAlarms; i++) {
      const r = RADAR.minRange + this.rng() * (RADAR.maxRange - RADAR.minRange);
      detections.push(radarPlot(r, from + this.rng() * span, store.clockMs, null));
    }
    this.radarAngle = (from + span) % TWO_PI;
    const sensor = store.get(RADAR.id) as OntObject<"Sensor"> | undefined;
    if (sensor) sensor.props.sweepDeg = ((this.radarAngle * 180) / Math.PI + 90) % 360;
    this.tracker.ingest(
      detections,
      store.clockMs,
      this.friendlyPositions().map((f) => f.pos),
      this.truthPos,
    );
  }

  private runEo(): void {
    const store = this.store;
    if (store.clockMs < this.nextEoScanMs) return;
    this.nextEoScanMs = store.clockMs + EO.periodS * 1000;
    const detections: RawDetection[] = [];
    const observed = [...this.targets.filter((t) => t.active), ...this.friendlyPositions()];
    for (const o of observed) {
      if (inEoFootprint(o.pos) && this.rng() < EO.pd) detections.push(eoMeasure(this.rng, o.pos, store.clockMs, o.id));
    }
    for (let i = poisson(this.rng, EO.falseAlarmsPerScan); i > 0; i--) {
      const r = EO.radius * Math.sqrt(this.rng());
      const a = this.rng() * TWO_PI;
      detections.push(eoPlot({ x: EO.stare.x + r * Math.cos(a), y: EO.stare.y + r * Math.sin(a) }, store.clockMs, null));
    }
    this.tracker.ingest(
      detections,
      store.clockMs,
      this.friendlyPositions().map((f) => f.pos),
      this.truthPos,
    );
  }

  private trackAlerts(): void {
    const store = this.store;
    const lzs = store.list("LandingZone").filter((lz) => lz.props.status === "Suitable");
    for (const t of store.list("Track")) {
      if (t.props.status === "Tentative" || t.props.affiliation === "Neutral") continue;
      for (const lz of lzs) {
        if (store.linked(lz.id, "platformLz", "reverse").length === 0) continue;
        const d = dist(t.props.pos, lz.props.pos);
        const key = `${t.id}:${lz.id}`;
        const closing =
          d > 0 ? (t.props.vel.x * (lz.props.pos.x - t.props.pos.x) + t.props.vel.y * (lz.props.pos.y - t.props.pos.y)) / d : 0;
        const closingLowerBound = closing - 2 * t.props.sigmaVel;
        const threatening = d < LZ_CLOSE_RANGE_M || (d < LZ_ALERT_RANGE_M && closingLowerBound > LZ_CLOSING_MPS);
        if (threatening && !this.alerted.has(key)) {
          this.alerted.add(key);
          store.log(
            "warning",
            `${t.props.label} ${Math.round(d)} m from ${lz.props.name}, closing at ${Math.max(closing, 0).toFixed(1)} m/s`,
            [t.id, lz.id],
          );
        }
      }
      const at = store.linkedOne<"Structure">(t.id, "trackStructure");
      if (at && at.props.threat === "None" && at.props.status !== "Cleared") {
        store.update(at, { threat: "Possible" });
        store.log("system", `${at.props.name} threat raised to POSSIBLE by ${t.props.label}`, [at.id, t.id]);
      }
    }
  }

  private checkPhases(): void {
    const store = this.store;
    const phase = activePhase(store);
    if (!phase) return;
    const units = store.list("Unit");

    switch (phase.props.order) {
      case PHASE.INFIL:
        if (units.every((u) => !carrierOf(store, u))) {
          store.update(phase, { status: "Complete", endedAt: store.clockMs });
          store.log("system", "P1 Infil complete. All elements on the ground.", [phase.id]);
        }
        break;

      case PHASE.APPROACH: {
        const tasked = units.filter((u) => u.props.role === "Overwatch" || objectiveOf(store, u));
        if (tasked.length > 0 && tasked.every((u) => u.props.status === "In position")) {
          store.update(phase, { status: "Complete", endedAt: store.clockMs });
          store.log("system", "P2 Approach complete. All elements set. Ready for Assault.", [phase.id]);
        }
        break;
      }

      case PHASE.EXFIL:
        if (units.every((u) => u.props.status === "Extracted")) {
          store.update(phase, { status: "Complete", endedAt: store.clockMs });
          const aborted = phases(store).some((p) => p.props.status === "Aborted");
          store.update(region(store), { missionStatus: aborted ? "Aborted" : "Complete" });
          store.log(
            "system",
            aborted ? "All elements extracted. Mission aborted." : "All elements extracted. Mission complete.",
            [phase.id],
          );
        }
        break;

      default:
        break;
    }
  }
}
