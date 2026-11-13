import type { Point } from "../ontology/schema";

const BRAKE_MPS2 = 1.2;

export type TargetKind = "Person" | "Vehicle";

export interface TruthTarget {
  id: string;
  kind: TargetKind;
  pos: Point;
  vel: Point;
  route: Point[];
  next: number;
  speed: number;
  loop: boolean;
  boundTo: string | null;
  activation: "start" | "infil";
  active: boolean;
  started: boolean;
}

function target(
  id: string,
  kind: TargetKind,
  route: Point[],
  speed: number,
  loop: boolean,
  boundTo: string | null,
  activation: "start" | "infil" = "start",
): TruthTarget {
  return {
    id,
    kind,
    pos: { ...route[0] },
    vel: { x: 0, y: 0 },
    route,
    next: 1,
    speed,
    loop,
    boundTo,
    activation,
    active: activation === "start",
    started: activation === "start",
  };
}

export function createTargets(): TruthTarget[] {
  return [
    target(
      "perimeter-guard",
      "Person",
      [
        { x: 505, y: 226 },
        { x: 752, y: 220 },
        { x: 760, y: 448 },
        { x: 511, y: 454 },
      ],
      1.4,
      true,
      "obj-falcon",
    ),
    target(
      "courtyard-guard",
      "Person",
      [
        { x: 690, y: 305 },
        { x: 690, y: 262 },
        { x: 645, y: 258 },
        { x: 690, y: 262 },
      ],
      1.0,
      true,
      "b4",
    ),
    target("house-sentry", "Person", [{ x: 575, y: 280 }, { x: 575, y: 322 }], 0.6, true, "b1"),
    target("storage-sentry", "Person", [{ x: 668, y: 416 }, { x: 692, y: 419 }], 0.4, true, "b3"),
    target(
      "technical",
      "Vehicle",
      [
        { x: 780, y: 650 },
        { x: 560, y: 612 },
        { x: 455, y: 572 },
      ],
      8,
      false,
      null,
      "infil",
    ),
    target(
      "shepherd",
      "Person",
      [
        { x: 990, y: 590 },
        { x: 820, y: 615 },
        { x: 700, y: 660 },
      ],
      1.1,
      false,
      null,
    ),
  ];
}

export function moveTarget(t: TruthTarget, dt: number): void {
  if (!t.active || t.speed === 0 || dt <= 0) {
    t.vel = { x: 0, y: 0 };
    return;
  }
  const start = { ...t.pos };
  const last = t.route[t.route.length - 1];
  const braking = !t.loop && t.next === t.route.length - 1;
  const toEnd = Math.hypot(last.x - t.pos.x, last.y - t.pos.y);
  const speed = braking ? Math.min(t.speed, Math.max(0.5, Math.sqrt(2 * BRAKE_MPS2 * toEnd))) : t.speed;
  let remaining = speed * dt;
  for (let guard = 0; remaining > 0 && guard < 16; guard++) {
    const goal = t.route[t.next];
    const d = Math.hypot(goal.x - t.pos.x, goal.y - t.pos.y);
    if (d <= remaining) {
      t.pos = { ...goal };
      remaining -= d;
      if (t.next < t.route.length - 1) t.next++;
      else if (t.loop) t.next = 0;
      else {
        t.speed = 0;
        break;
      }
    } else {
      t.pos = { x: t.pos.x + ((goal.x - t.pos.x) / d) * remaining, y: t.pos.y + ((goal.y - t.pos.y) / d) * remaining };
      remaining = 0;
    }
  }
  t.vel = { x: (t.pos.x - start.x) / dt, y: (t.pos.y - start.y) / dt };
}
