import type { OntObject, Point, Rect } from "../ontology/schema";
import type { OntologyStore } from "../ontology/store";
import { dist, region } from "../ontology/queries";
import { toGrid } from "../ui/grid";
import { FPV_LAUNCH, UNIT_SPEED } from "./scenario";
import { COC_ID, RADIO, sinrDb, type RadioNode } from "./comms";
import { STALE_MS, keys, type Edge } from "./edge";
import type { TruthTarget } from "./targets";

export const MIN_FRIENDLY_M = 50;
const DECISION_CLEAR_M = 60;
const HOLD_OFF_M = 56;
const RESUME_M = 62;
const BYSTANDER_M = 25;
const FPV_SPEED = 30;
const SEEKER_RANGE_M = 40;
const SEEKER_GATE_M = 15;
const IMPACT_M = 2.5;
const MIN_HITS = 4;
const MAX_SIGMA_M = 20;
const VEHICLE_MPS = 4.5;
const LZ_THREAT_RANGE_M = 600;
const LZ_CLOSING_MPS = 3;
const NEUTRAL_AFTER_MS = 15_000;
const PEDESTRIAN_MPS = 3;
const NEUTRAL_STANDOFF_M = 60;
const BATTERY_PER_S = 0.25;
const BATTERY_ABORT = 12;
const FPV_POWER_DBM = 30;
const FPV_ALT_M = 45;

export interface FriendlyFix {
  name: string;
  pos: Point;
  radius: number;
  ageMs: number;
}

export interface Clearance {
  name: string;
  d: number;
  raw: number;
  radius: number;
  ageMs: number;
}

export function describeClearance(c: Clearance): string {
  if (c.radius < 1) return `${c.name} ${Math.round(c.raw)} m`;
  return `${c.name} ${Math.round(c.d)} m (last report ${Math.round(c.ageMs / 1000)} s old, ±${Math.round(c.radius)} m)`;
}

export interface Impact {
  timeMs: number;
  engagementId: string;
  truthId: string;
  pos: Point;
  nearestFriendly: string;
  nearestFriendlyM: number;
}

type Track = OntObject<"Track">;
type Drone = OntObject<"Platform">;
type Engagement = OntObject<"Engagement">;

function inRect(p: Point, r: Rect, margin = 0): boolean {
  return p.x >= r.x - margin && p.x <= r.x + r.w + margin && p.y >= r.y - margin && p.y <= r.y + r.h + margin;
}

function rectDistance(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function interceptPoint(from: Point, p: Point, v: Point, speed: number): { aim: Point; t: number } {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const a = v.x * v.x + v.y * v.y - speed * speed;
  const b = 2 * (dx * v.x + dy * v.y);
  const c = dx * dx + dy * dy;
  let t = Math.sqrt(c) / speed;
  if (Math.abs(a) < 1e-6) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r1 = (-b - Math.sqrt(disc)) / (2 * a);
      const r2 = (-b + Math.sqrt(disc)) / (2 * a);
      const roots = [r1, r2].filter((r) => r > 0);
      if (roots.length > 0) t = Math.min(...roots);
    }
  }
  t = Math.min(t, 60);
  return { aim: { x: p.x + v.x * t, y: p.y + v.y * t }, t };
}

export class FiresCell {
  readonly impacts: Impact[] = [];
  private seq = 0;
  private withheld = new Map<string, string>();
  private peakSpeed = new Map<string, number>();
  private locks = new Map<string, string>();

  constructor(
    private store: OntologyStore,
    private edge: Edge,
    private targets: TruthTarget[],
    private onKill: (truthId: string, by: string, trackId: string) => void,
  ) {}

  tick(dt: number): void {
    const inProgress = region(this.store).props.missionStatus === "In progress";
    if (inProgress) {
      this.assess();
      if (region(this.store).props.weapons === "Free") this.assign();
    }
    this.fly(dt);
  }

  friendlies(): FriendlyFix[] {
    const store = this.store;
    const now = store.clockMs;
    const coc = this.edge.coc;
    const out: FriendlyFix[] = [];
    for (const u of store.list("Unit")) {
      const status = coc.get<string>(keys.status(u.id));
      if (status === "Extracted" || status === "Embarked") continue;
      const pos = coc.get<Point>(keys.pos(u.id));
      const stamp = coc.stamp(keys.pos(u.id));
      if (!pos || !stamp) continue;
      const ageMs = now - stamp.t;
      const radius = ageMs > STALE_MS ? (ageMs / 1000) * UNIT_SPEED : 0;
      out.push({ name: u.props.callsign, pos, radius, ageMs });
    }
    for (const p of store.list("Platform")) {
      if (p.props.kind === "Helicopter") out.push({ name: p.props.callsign, pos: p.props.pos, radius: 0, ageMs: 0 });
    }
    for (const s of store.list("Sensor")) {
      if (s.props.kind === "Ground radar") out.push({ name: s.props.name, pos: s.props.pos, radius: 0, ageMs: 0 });
    }
    return out;
  }

  nearestFriendly(p: Point): Clearance {
    let best: Clearance = { name: "none", d: Infinity, raw: Infinity, radius: 0, ageMs: 0 };
    for (const f of this.friendlies()) {
      const raw = dist(f.pos, p);
      const d = raw - f.radius;
      if (d < best.d) best = { name: f.name, d, raw, radius: f.radius, ageMs: f.ageMs };
    }
    return best;
  }

  controlLinkDb(p: Point): number {
    const coc = this.edge.radioNodes().find((n) => n.id === COC_ID)!;
    const drone: RadioNode = { id: "fpv", name: "FPV", pos: p, altM: FPV_ALT_M, powerDbm: FPV_POWER_DBM };
    return Math.min(sinrDb(coc, drone, this.edge.jammer), sinrDb(drone, coc, this.edge.jammer));
  }

  private objArea(): Rect | null {
    return this.store.list("Compound")[0]?.props.objArea ?? null;
  }

  private hostileReason(t: Track): string | null {
    const store = this.store;
    const obj = store.list("Compound")[0];
    if (obj && inRect(t.props.pos, obj.props.objArea)) return `inside ${obj.props.name}`;
    const p = t.props;
    const speedLow = p.speedMps - 2 * p.sigmaVel;
    if (speedLow <= VEHICLE_MPS) return null;
    for (const lz of store.list("LandingZone")) {
      const d = dist(p.pos, lz.props.pos);
      if (d > LZ_THREAT_RANGE_M || d === 0) continue;
      const closing = (p.vel.x * (lz.props.pos.x - p.pos.x) + p.vel.y * (lz.props.pos.y - p.pos.y)) / d;
      if (closing - 2 * p.sigmaVel > LZ_CLOSING_MPS) {
        return `closing on ${lz.props.name} at ${closing.toFixed(1)} m/s (vehicle speed), ${Math.round(d)} m out`;
      }
    }
    return null;
  }

  private assess(): void {
    const store = this.store;
    const area = this.objArea();
    for (const t of store.list("Track")) {
      const p = t.props;
      if (p.status === "Tentative" || p.classifiedBy === "Operator" || p.hits < MIN_HITS) continue;
      const peak = Math.max(this.peakSpeed.get(t.id) ?? 0, p.speedMps - 2 * p.sigmaVel);
      this.peakSpeed.set(t.id, peak);
      const reason = this.hostileReason(t);
      if (reason && p.affiliation !== "Hostile") {
        store.update(t, { affiliation: "Hostile", classifiedBy: "System", assessment: reason });
        store.log("system", `${p.label} assessed HOSTILE: ${reason}`, [t.id], "fires");
        for (const s of store.linked<"Structure">(t.id, "trackStructure")) {
          if (s.props.threat !== "Confirmed" && s.props.status !== "Cleared") store.update(s, { threat: "Confirmed" });
        }
        continue;
      }
      if (reason || p.affiliation !== "Unknown" || !area) continue;
      if (store.clockMs - p.initiatedMs < NEUTRAL_AFTER_MS) continue;
      const fast = p.speedMps + p.sigmaVel;
      const standoff = rectDistance(p.pos, area);
      if (fast < PEDESTRIAN_MPS && peak < PEDESTRIAN_MPS - 1 && standoff > NEUTRAL_STANDOFF_M) {
        const why = `pedestrian ${p.speedMps.toFixed(1)} m/s, ${Math.round(standoff)} m outside OBJ, not closing on an LZ`;
        store.update(t, { affiliation: "Neutral", classifiedBy: "System", assessment: why });
        store.log("system", `${p.label} assessed NEUTRAL (protected): ${why}`, [t.id], "fires");
      }
    }
  }

  activeEngagements(): Engagement[] {
    return this.store.list("Engagement").filter((e) => e.props.status === "In flight" || e.props.status === "Holding off");
  }

  private withhold(t: Track, kind: string, text: string): void {
    if (this.withheld.get(t.id) === kind) return;
    this.withheld.set(t.id, kind);
    this.store.log("warning", `${t.props.label} engagement withheld: ${text}`, [t.id], "fires");
  }

  private bystanderNear(t: Track, p: Point): Track | undefined {
    return this.store
      .list("Track")
      .find((o) => o.id !== t.id && o.props.status !== "Tentative" && o.props.affiliation !== "Hostile" && dist(o.props.pos, p) < BYSTANDER_M);
  }

  private assign(): void {
    const store = this.store;
    let active = this.activeEngagements();
    for (const t of store.list("Track")) {
      const p = t.props;
      if (p.affiliation !== "Hostile" || p.status !== "Confirmed" || p.sigmaMajor > MAX_SIGMA_M) continue;
      if (active.some((e) => store.linkedOne(e.id, "engagementTarget")?.id === t.id)) continue;
      const ready = store
        .list("Platform")
        .filter((d) => d.props.kind === "FPV" && d.props.status === "Ready")
        .sort((a, b) => dist(a.props.pos, p.pos) - dist(b.props.pos, p.pos));
      const drone = ready[0];
      if (!drone) {
        this.withhold(t, "effector", "no FPV available");
        continue;
      }
      const nf = this.nearestFriendly(p.pos);
      if (nf.d < DECISION_CLEAR_M) {
        const kind = nf.radius > 0 ? "uncertain" : "friendly";
        this.withhold(t, kind, `${describeClearance(nf)} from target (needs ${DECISION_CLEAR_M} m at launch)`);
        continue;
      }
      const link = this.controlLinkDb(p.pos);
      if (link < RADIO.upDb) {
        this.withhold(t, "jammed", `control link at the target only ${link.toFixed(0)} dB SINR (jammed)`);
        continue;
      }
      const bystander = this.bystanderNear(t, p.pos);
      if (bystander) {
        this.withhold(t, "bystander", `${bystander.props.label} (${bystander.props.affiliation.toLowerCase()}) within ${BYSTANDER_M} m`);
        continue;
      }
      this.withheld.delete(t.id);
      this.launch(drone, t, nf);
      active = this.activeEngagements();
    }
  }

  private launch(drone: Drone, t: Track, nf: Clearance): void {
    const store = this.store;
    const label = `ENG-${String(++this.seq).padStart(2, "0")}`;
    const id = `eng-${this.seq}`;
    const { aim, t: tti } = interceptPoint(drone.props.pos, t.props.pos, t.props.vel, FPV_SPEED);
    const checks = [
      "weapons free",
      `nearest friendly ${describeClearance(nf)} (min ${MIN_FRIENDLY_M})`,
      `control link ${this.controlLinkDb(t.props.pos).toFixed(0)} dB`,
      `no neutral or unknown track within ${BYSTANDER_M} m`,
      `track 1σ ${t.props.sigmaMajor.toFixed(1)} m`,
    ].join(" · ");
    store.add("Engagement", id, {
      label,
      status: "In flight",
      targetLabel: t.props.label,
      effector: drone.props.callsign,
      decidedAt: store.clockMs,
      closedAt: null,
      rationale: `${t.props.label} hostile: ${t.props.assessment}`,
      checks,
      outcome: `Intercept in ${Math.round(tti)} s`,
      aimPoint: aim,
      nearestFriendlyM: nf.d,
    });
    store.link("engagementTarget", id, t.id);
    store.link("engagementEffector", id, drone.id);
    store.update(drone, { status: "Engaging", altitudeFt: 150, waypoint: aim });
    store.log(
      "system",
      `${label} ${drone.props.callsign} → ${t.props.label}: ${t.props.assessment}; ${checks}; intercept ${Math.round(tti)} s`,
      [id, t.id, drone.id],
      "fires",
    );
  }

  private close(e: Engagement, drone: Drone, outcome: string, status: "Aborted" | "Hit"): void {
    const store = this.store;
    store.update(e, { status, closedAt: store.clockMs, outcome });
    this.locks.delete(e.id);
    if (status === "Aborted") {
      store.update(drone, { status: "Returning", waypoint: { ...FPV_LAUNCH } });
      store.log("system", `${e.props.label} aborted: ${outcome}. ${drone.props.callsign} returning`, [e.id, drone.id], "fires");
    }
  }

  private engagementOf(drone: Drone): Engagement | undefined {
    return this.activeEngagements().find((e) => this.store.linkedOne(e.id, "engagementEffector")?.id === drone.id);
  }

  private fly(dt: number): void {
    const store = this.store;
    const hold = region(store).props.weapons === "Hold";
    for (const drone of store.list("Platform")) {
      if (drone.props.kind !== "FPV") continue;
      const status = drone.props.status;
      if (status === "Ready" || status === "Expended") continue;
      drone.props.fuel = Math.max(0, drone.props.fuel - BATTERY_PER_S * dt);

      if (status === "Returning") {
        if (this.move(drone, FPV_LAUNCH, dt)) {
          store.update(drone, { status: "Ready", altitudeFt: 0, waypoint: null, fuel: 100 });
          store.log("sim", `${drone.props.callsign} recovered at FOB ANVIL`, [drone.id], "fires");
        }
        continue;
      }

      const e = this.engagementOf(drone);
      if (!e) {
        store.update(drone, { status: "Returning", waypoint: { ...FPV_LAUNCH } });
        continue;
      }
      if (hold) {
        this.close(e, drone, "WEAPONS HOLD", "Aborted");
        continue;
      }
      if (drone.props.fuel < BATTERY_ABORT) {
        this.close(e, drone, "battery low", "Aborted");
        continue;
      }
      const link = this.controlLinkDb(drone.props.pos);
      if (link < RADIO.downDb) {
        this.close(e, drone, `control link lost (${link.toFixed(0)} dB SINR), lost-link procedure`, "Aborted");
        continue;
      }

      let track = store.linkedOne<"Track">(e.id, "engagementTarget");
      if (!track) {
        track = this.reacquire(e);
        if (!track) {
          this.close(e, drone, "target track lost", "Aborted");
          continue;
        }
      }

      const lockedId = this.locks.get(e.id);
      const locked = lockedId ? this.targets.find((g) => g.id === lockedId) : undefined;
      if (lockedId && (!locked || !locked.active)) {
        this.close(e, drone, "target no longer present", "Aborted");
        continue;
      }
      const aim = locked
        ? { ...locked.pos }
        : interceptPoint(drone.props.pos, track.props.pos, track.props.vel, FPV_SPEED).aim;

      const nfAim = this.nearestFriendly(aim);
      const nfTrack = this.nearestFriendly(track.props.pos);
      const nf = nfAim.d < nfTrack.d ? nfAim : nfTrack;
      if (e.props.status === "Holding off") {
        if (nf.d < RESUME_M) {
          store.update(e, { aimPoint: aim });
          continue;
        }
        store.update(e, { status: "In flight" });
        store.update(drone, { status: "Engaging" });
        store.log("system", `${e.props.label} resumed: nearest friendly ${describeClearance(nf)}`, [e.id], "fires");
      } else if (nf.d < HOLD_OFF_M) {
        store.update(e, { status: "Holding off", aimPoint: aim });
        store.update(drone, { status: "Holding off", waypoint: null });
        store.log("warning", `${e.props.label} holding off: ${describeClearance(nf)} from aim point`, [e.id, drone.id], "fires");
        continue;
      }

      store.update(e, { aimPoint: aim });
      store.update(drone, { waypoint: aim });

      if (!locked) {
        this.move(drone, aim, dt);
        if (dist(drone.props.pos, track.props.pos) < SEEKER_RANGE_M) {
          const seen = this.targets
            .filter((g) => g.active && dist(g.pos, track!.props.pos) < SEEKER_GATE_M)
            .sort((a, b) => dist(a.pos, track!.props.pos) - dist(b.pos, track!.props.pos))[0];
          if (!seen) {
            this.close(e, drone, "no target at aim point", "Aborted");
            continue;
          }
          this.locks.set(e.id, seen.id);
        }
        continue;
      }

      const step = FPV_SPEED * dt;
      if (dist(drone.props.pos, locked.pos) > Math.max(step, IMPACT_M)) {
        this.move(drone, locked.pos, dt);
        continue;
      }
      const final = this.nearestFriendly(locked.pos);
      if (final.d < MIN_FRIENDLY_M) {
        store.update(e, { status: "Holding off" });
        store.update(drone, { status: "Holding off", waypoint: null });
        store.log("warning", `${e.props.label} pulled off at terminal: ${describeClearance(final)}`, [e.id], "fires");
        continue;
      }
      this.impact(e, drone, track, locked, final);
    }
  }

  private reacquire(e: Engagement): Track | undefined {
    const store = this.store;
    const active = this.activeEngagements();
    const t = store
      .list("Track")
      .filter(
        (o) =>
          o.props.affiliation === "Hostile" &&
          o.props.status !== "Tentative" &&
          dist(o.props.pos, e.props.aimPoint) < BYSTANDER_M &&
          !active.some((x) => store.linkedOne(x.id, "engagementTarget")?.id === o.id),
      )
      .sort((a, b) => dist(a.props.pos, e.props.aimPoint) - dist(b.props.pos, e.props.aimPoint))[0];
    if (!t) return undefined;
    store.link("engagementTarget", e.id, t.id);
    store.update(e, { targetLabel: t.props.label });
    store.log("system", `${e.props.label} target re-associated to ${t.props.label} after track merge`, [e.id, t.id], "fires");
    return t;
  }

  private impact(e: Engagement, drone: Drone, track: Track, target: TruthTarget, nf: Clearance): void {
    const store = this.store;
    const pos = { ...target.pos };
    target.active = false;
    target.vel = { x: 0, y: 0 };
    const outcome = `Hit at ${toGrid(pos)}; nearest friendly ${describeClearance(nf)}`;
    this.close(e, drone, outcome, "Hit");
    store.update(e, { aimPoint: pos });
    store.update(drone, { status: "Expended", altitudeFt: 0, waypoint: null, pos });
    this.impacts.push({
      timeMs: store.clockMs,
      engagementId: e.id,
      truthId: target.id,
      pos,
      nearestFriendly: nf.name,
      nearestFriendlyM: nf.d,
    });
    store.log("warning", `${e.props.label} HIT ${track.props.label} at ${toGrid(pos)} (nearest friendly ${describeClearance(nf)})`, [e.id, drone.id], "fires");
    this.onKill(target.id, e.props.label, track.id);
  }

  private move(drone: Drone, goal: Point, dt: number): boolean {
    const p = drone.props.pos;
    const d = dist(p, goal);
    const step = FPV_SPEED * dt;
    if (d <= step) {
      drone.props.pos = { ...goal };
      return true;
    }
    drone.props.pos = { x: p.x + ((goal.x - p.x) / d) * step, y: p.y + ((goal.y - p.y) / d) * step };
    return false;
  }
}
