import type { Point } from "../ontology/schema";
import type { Mat } from "./kalman";
import { gaussian, type Rng } from "./random";

export interface RawDetection {
  sensorId: string;
  timeMs: number;
  z: Point;
  R: Mat;
  truthId: string | null;
  rangeM: number | null;
  bearingDeg: number | null;
}

export const RADAR = {
  id: "gr-1",
  name: "GR-1",
  pos: { x: 130, y: 548 },
  minRange: 40,
  maxRange: 1100,
  periodS: 1.5,
  sigmaR: 4,
  sigmaTheta: (1.2 * Math.PI) / 180,
  pd: { Person: 0.9, Vehicle: 0.97 },
  falseAlarmsPerScan: 0.8,
} as const;

export const EO = {
  id: "eo-1",
  name: "OVERWATCH-1 EO/IR",
  stare: { x: 632, y: 336 },
  radius: 160,
  periodS: 0.5,
  sigma: 2.5,
  pd: 0.85,
  falseAlarmsPerScan: 0.04,
} as const;

export function compassDeg(from: Point, to: Point): number {
  const deg = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function radarPlot(r: number, theta: number, timeMs: number, truthId: string | null): RawDetection {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const sr2 = RADAR.sigmaR ** 2;
  const st2 = RADAR.sigmaTheta ** 2;
  const z = { x: RADAR.pos.x + r * c, y: RADAR.pos.y + r * s };
  const cross = c * s * sr2 - r * r * s * c * st2;
  return {
    sensorId: RADAR.id,
    timeMs,
    z,
    R: [
      [c * c * sr2 + r * r * s * s * st2, cross],
      [cross, s * s * sr2 + r * r * c * c * st2],
    ],
    truthId,
    rangeM: r,
    bearingDeg: compassDeg(RADAR.pos, z),
  };
}

export function radarMeasure(rng: Rng, truth: Point, timeMs: number, truthId: string): RawDetection {
  const dx = truth.x - RADAR.pos.x;
  const dy = truth.y - RADAR.pos.y;
  const r = Math.hypot(dx, dy) + gaussian(rng) * RADAR.sigmaR;
  const theta = Math.atan2(dy, dx) + gaussian(rng) * RADAR.sigmaTheta;
  return radarPlot(r, theta, timeMs, truthId);
}

export function eoPlot(z: Point, timeMs: number, truthId: string | null): RawDetection {
  const v = EO.sigma ** 2;
  return {
    sensorId: EO.id,
    timeMs,
    z,
    R: [
      [v, 0],
      [0, v],
    ],
    truthId,
    rangeM: null,
    bearingDeg: null,
  };
}

export function eoMeasure(rng: Rng, truth: Point, timeMs: number, truthId: string): RawDetection {
  return eoPlot({ x: truth.x + gaussian(rng) * EO.sigma, y: truth.y + gaussian(rng) * EO.sigma }, timeMs, truthId);
}

export function inEoFootprint(p: Point): boolean {
  return Math.hypot(p.x - EO.stare.x, p.y - EO.stare.y) <= EO.radius;
}

export function angleInSweep(angle: number, from: number, span: number): boolean {
  const twoPi = Math.PI * 2;
  const rel = (((angle - from) % twoPi) + twoPi) % twoPi;
  return rel > 0 && rel <= span;
}
