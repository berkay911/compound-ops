import type { Gate, Point } from "../ontology/schema";
import { dist } from "../ontology/queries";

export function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function entryGate(gates: Gate[], from: Point, door: Point): Gate {
  return [...gates].sort(
    (a, b) => dist(from, a.outer) + dist(a.inner, door) - (dist(from, b.outer) + dist(b.inner, door)),
  )[0];
}

export function exitGate(gates: Gate[], from: Point, goal: Point): Gate {
  return [...gates].sort(
    (a, b) => dist(from, a.inner) + dist(a.outer, goal) - (dist(from, b.inner) + dist(b.outer, goal)),
  )[0];
}

export function planRoute(
  wall: Point[],
  gates: Gate[],
  from: Point,
  goal: Point,
  preferredEntry: string | null = null,
): Point[] {
  const fromInside = insidePolygon(from, wall);
  const goalInside = insidePolygon(goal, wall);
  if (fromInside === goalInside || gates.length === 0) return [{ ...goal }];
  if (goalInside) {
    const g = gates.find((x) => x.name === preferredEntry) ?? entryGate(gates, from, goal);
    return [{ ...g.outer }, { ...g.inner }, { ...goal }];
  }
  const g = exitGate(gates, from, goal);
  return [{ ...g.inner }, { ...g.outer }, { ...goal }];
}
