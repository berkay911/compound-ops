import type { OntObject, Point, TrackStatus } from "../ontology/schema";
import type { OntologyStore } from "../ontology/store";
import { dist } from "../ontology/queries";
import {
  GATE_CHI2_999,
  immCombine,
  immInit,
  immPredict,
  immUpdate,
  innovation,
  positionEllipse,
  type ImmState,
  type KalmanState,
} from "./kalman";
import { compassDeg, type RawDetection } from "./sensors";

const INIT_VELOCITY_VAR = 36;
const CONFIRM_HITS = 3;
const TENTATIVE_TIMEOUT_MS = 3500;
const COAST_AFTER_MS = 4000;
const MERGE_CHI2 = 4;
const DROP_AFTER_MS = 9000;
const DROP_SIGMA_M = 60;
const BFT_SIGMA_M = 4;
const BFT_GATE_CHI2 = 11.8;
const DETECTIONS_KEPT = 5;
const HISTORY_KEPT = 14;
const HISTORY_EVERY_MS = 1000;
const PLOT_TTL_MS = 4000;
const STRUCTURE_MARGIN_M = 12;

export interface Plot {
  pos: Point;
  sensorId: string;
  timeMs: number;
  friendly: boolean;
}

export interface ErrorStat {
  sumSq: number;
  n: number;
}

interface TrackState {
  id: string;
  label: string;
  imm: ImmState;
  kf: KalmanState;
  predictedAt: number;
  lastUpdateMs: number;
  hits: number;
  status: TrackStatus;
  sources: Set<string>;
  truthId: string | null;
  detectionIds: string[];
  history: Point[];
  historyAt: number;
}

export class Tracker {
  plots: Plot[] = [];
  readonly stats: Record<"radar" | "eo" | "track", ErrorStat> = {
    radar: { sumSq: 0, n: 0 },
    eo: { sumSq: 0, n: 0 },
    track: { sumSq: 0, n: 0 },
  };
  ghostTracks = 0;
  private tracks: TrackState[] = [];
  private nextNumber = 1;
  private nextDetection = 1;

  constructor(
    private store: OntologyStore,
    private sensorNames: Record<string, string>,
  ) {}

  ingest(
    detections: RawDetection[],
    timeMs: number,
    friendlies: Point[],
    truthPos: (id: string) => Point | undefined,
  ): void {
    const kept: RawDetection[] = [];
    for (const d of detections) {
      const friendly = friendlies.some((f) => this.matchesFriendly(d, f));
      this.plots.push({ pos: d.z, sensorId: d.sensorId, timeMs: d.timeMs, friendly });
      if (friendly) continue;
      const truth = d.truthId ? truthPos(d.truthId) : undefined;
      if (truth) {
        const stat = d.sensorId === "gr-1" ? this.stats.radar : this.stats.eo;
        stat.sumSq += dist(truth, d.z) ** 2;
        stat.n++;
      }
      kept.push(d);
    }
    if (kept.length === 0) return;

    for (const t of this.tracks) this.predictTo(t, timeMs);

    const pairs: { i: number; j: number; d2: number }[] = [];
    kept.forEach((d, i) => {
      this.tracks.forEach((t, j) => {
        const { d2 } = innovation(t.kf, [d.z.x, d.z.y], d.R);
        if (d2 < GATE_CHI2_999) pairs.push({ i, j, d2 });
      });
    });
    pairs.sort((a, b) => a.d2 - b.d2);

    const usedDetections = new Set<number>();
    const usedTracks = new Set<number>();
    for (const p of pairs) {
      if (usedDetections.has(p.i) || usedTracks.has(p.j)) continue;
      usedDetections.add(p.i);
      usedTracks.add(p.j);
      this.updateTrack(this.tracks[p.j], kept[p.i]);
    }
    kept.forEach((d, i) => {
      if (!usedDetections.has(i)) this.initiate(d);
    });
  }

  maintain(nowMs: number, truthPos: (id: string) => Point | undefined): void {
    this.plots = this.plots.filter((p) => nowMs - p.timeMs < PLOT_TTL_MS);
    const structures = this.store.list("Structure");
    for (const t of this.tracks) this.predictTo(t, nowMs);
    this.mergeDuplicates();

    for (const t of [...this.tracks]) {
      this.predictTo(t, nowMs);
      const age = nowMs - t.lastUpdateMs;
      const ellipse = positionEllipse(t.kf.P);

      if (t.status === "Tentative") {
        if (t.hits >= CONFIRM_HITS) {
          t.status = "Confirmed";
          if (t.truthId?.startsWith("friendly:")) this.ghostTracks++;
          this.store.log("sim", `${t.label} confirmed (${[...t.sources].join(" + ")})`, [t.id]);
        } else if (age > TENTATIVE_TIMEOUT_MS) {
          this.drop(t, false);
          continue;
        }
      } else if (t.status === "Confirmed" && age > COAST_AFTER_MS) {
        t.status = "Coasting";
      }
      if (t.status === "Coasting" && (age > DROP_AFTER_MS || ellipse.major > DROP_SIGMA_M)) {
        this.drop(t, true);
        continue;
      }

      const pos = { x: t.kf.x[0], y: t.kf.x[1] };
      if (nowMs - t.historyAt >= HISTORY_EVERY_MS) {
        t.history = [...t.history, pos].slice(-HISTORY_KEPT);
        t.historyAt = nowMs;
      }
      if (t.status !== "Tentative" && t.truthId) {
        const truth = truthPos(t.truthId);
        if (truth && t.status === "Confirmed") {
          this.stats.track.sumSq += dist(truth, pos) ** 2;
          this.stats.track.n++;
        }
      }

      const obj = this.store.get(t.id) as OntObject<"Track"> | undefined;
      if (!obj) continue;
      const vel = { x: t.kf.x[2], y: t.kf.x[3] };
      this.store.update(obj, {
        status: t.status,
        pos,
        vel,
        speedMps: Math.hypot(vel.x, vel.y),
        sigmaVel: Math.sqrt((t.kf.P[2][2] + t.kf.P[3][3]) / 2),
        headingDeg: compassDeg({ x: 0, y: 0 }, vel),
        sigmaMajor: ellipse.major,
        sigmaMinor: ellipse.minor,
        ellipseDeg: (ellipse.angleRad * 180) / Math.PI,
        hits: t.hits,
        maneuverProb: t.imm.mu[1],
        sources: [...t.sources].join(" + "),
        lastUpdateMs: t.lastUpdateMs,
        history: t.history,
      });

      const at = structures.find((s) => {
        const r = s.props.rect;
        const m = STRUCTURE_MARGIN_M;
        return pos.x > r.x - m && pos.x < r.x + r.w + m && pos.y > r.y - m && pos.y < r.y + r.h + m;
      });
      const current = this.store.linkedOne<"Structure">(t.id, "trackStructure");
      if (current?.id !== at?.id) {
        this.store.unlink("trackStructure", t.id);
        if (at) this.store.link("trackStructure", t.id, at.id);
      }
    }
  }

  get trackCount(): number {
    return this.tracks.length;
  }

  truthOf(trackId: string): string | null {
    return this.tracks.find((t) => t.id === trackId)?.truthId ?? null;
  }

  neutralize(trackId: string, reason: string): void {
    const t = this.tracks.find((x) => x.id === trackId);
    if (!t) return;
    this.store.log("sim", `${t.label} dropped: ${reason}`, [], "sensors");
    this.drop(t, false);
  }

  private matchesFriendly(d: RawDetection, f: Point): boolean {
    const bft = BFT_SIGMA_M ** 2;
    const a = d.R[0][0] + bft;
    const b = d.R[0][1];
    const c = d.R[1][1] + bft;
    const det = a * c - b * b;
    const dx = d.z.x - f.x;
    const dy = d.z.y - f.y;
    return (c * dx * dx - 2 * b * dx * dy + a * dy * dy) / det < BFT_GATE_CHI2;
  }

  private mergeDuplicates(): void {
    const established = this.tracks.filter((t) => t.status !== "Tentative");
    for (let i = 0; i < established.length; i++) {
      for (let j = i + 1; j < established.length; j++) {
        const a = established[i];
        const b = established[j];
        if (!this.tracks.includes(a) || !this.tracks.includes(b)) continue;
        const R = [
          [b.kf.P[0][0], b.kf.P[0][1]],
          [b.kf.P[1][0], b.kf.P[1][1]],
        ];
        const { d2 } = innovation(a.kf, [b.kf.x[0], b.kf.x[1]], R);
        if (d2 >= MERGE_CHI2) continue;
        const [keep, lose] = a.hits >= b.hits ? [a, b] : [b, a];
        for (const src of lose.sources) keep.sources.add(src);
        const keepObj = this.store.get(keep.id) as OntObject<"Track"> | undefined;
        const loseObj = this.store.get(lose.id) as OntObject<"Track"> | undefined;
        if (keepObj && loseObj && keepObj.props.affiliation === "Unknown" && loseObj.props.affiliation !== "Unknown") {
          this.store.update(keepObj, {
            affiliation: loseObj.props.affiliation,
            classifiedBy: loseObj.props.classifiedBy,
            assessment: loseObj.props.assessment,
          });
        }
        this.store.log("sim", `${lose.label} merged into ${keep.label}`, [keep.id]);
        this.drop(lose, false);
      }
    }
  }

  private predictTo(t: TrackState, timeMs: number): void {
    const dt = (timeMs - t.predictedAt) / 1000;
    if (dt <= 0) return;
    t.imm = immPredict(t.imm, dt);
    t.kf = immCombine(t.imm);
    t.predictedAt = timeMs;
  }

  private updateTrack(t: TrackState, d: RawDetection): void {
    t.imm = immUpdate(t.imm, [d.z.x, d.z.y], d.R);
    t.kf = immCombine(t.imm);
    t.hits++;
    t.lastUpdateMs = d.timeMs;
    t.truthId = d.truthId;
    t.sources.add(this.sensorNames[d.sensorId] ?? d.sensorId);
    if (t.status === "Coasting") t.status = "Confirmed";
    this.addDetection(t, d);
  }

  private initiate(d: RawDetection): void {
    const label = `T-${String(this.nextNumber++).padStart(2, "0")}`;
    const id = `track-${label}`;
    const imm = immInit([d.z.x, d.z.y], d.R, INIT_VELOCITY_VAR);
    const kf = immCombine(imm);
    const ellipse = positionEllipse(kf.P);
    const t: TrackState = {
      id,
      label,
      imm,
      kf,
      predictedAt: d.timeMs,
      lastUpdateMs: d.timeMs,
      hits: 1,
      status: "Tentative",
      sources: new Set([this.sensorNames[d.sensorId] ?? d.sensorId]),
      truthId: d.truthId,
      detectionIds: [],
      history: [],
      historyAt: d.timeMs,
    };
    this.tracks.push(t);
    this.store.add("Track", id, {
      label,
      status: "Tentative",
      affiliation: "Unknown",
      pos: { ...d.z },
      vel: { x: 0, y: 0 },
      speedMps: 0,
      sigmaVel: Math.sqrt(INIT_VELOCITY_VAR),
      headingDeg: 0,
      sigmaMajor: ellipse.major,
      sigmaMinor: ellipse.minor,
      ellipseDeg: (ellipse.angleRad * 180) / Math.PI,
      hits: 1,
      maneuverProb: imm.mu[1],
      sources: [...t.sources].join(" + "),
      initiatedMs: d.timeMs,
      lastUpdateMs: d.timeMs,
      history: [],
      classifiedBy: null,
      assessment: "",
    });
    this.addDetection(t, d);
  }

  private addDetection(t: TrackState, d: RawDetection): void {
    const id = `det-${this.nextDetection++}`;
    const sensorName = this.sensorNames[d.sensorId] ?? d.sensorId;
    this.store.add("Detection", id, {
      label: `${sensorName} #${id.slice(4)}`,
      sensorName,
      timeMs: d.timeMs,
      pos: { ...d.z },
      rangeM: d.rangeM,
      bearingDeg: d.bearingDeg,
    });
    this.store.link("detectionSensor", id, d.sensorId);
    this.store.link("trackDetection", t.id, id);
    t.detectionIds.push(id);
    while (t.detectionIds.length > DETECTIONS_KEPT) this.store.remove(t.detectionIds.shift()!);
  }

  private drop(t: TrackState, announce: boolean): void {
    for (const id of t.detectionIds) this.store.remove(id);
    this.store.remove(t.id);
    this.tracks = this.tracks.filter((x) => x !== t);
    if (announce) this.store.log("sim", `${t.label} dropped`, [], "sensors");
  }
}
