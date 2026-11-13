import type { Gate, Point } from "../ontology/schema";
import { findPath, pathLength, type NavGrid } from "./nav";

export function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function entryGate(nav: NavGrid, gates: Gate[], from: Point, door: Point): Gate {
  const cost = (g: Gate) => pathLength(from, findPath(nav, from, g.outer)) + pathLength(g.inner, findPath(nav, g.inner, door));
  return gates.map((g) => ({ g, c: cost(g) })).sort((a, b) => a.c - b.c)[0].g;
}
