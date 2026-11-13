import type { Point } from "../ontology/schema";

export const GRID_ORIGIN = { easting: 40000, northing: 31000 };

export function easting(x: number): number {
  return GRID_ORIGIN.easting + Math.round(x);
}

export function northing(y: number): number {
  return GRID_ORIGIN.northing - Math.round(y);
}

export function toGrid(p: Point): string {
  return `${easting(p.x)} ${northing(p.y)}`;
}
