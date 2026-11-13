// Read-only helpers over the ontology that both actions and the simulator use.

import type { OntObject, Point } from "./schema";
import type { OntologyStore } from "./store";

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function region(store: OntologyStore): OntObject<"Region"> {
  const r = store.list("Region")[0];
  if (!r) throw new Error("Scenario has no region");
  return r;
}

export function phases(store: OntologyStore): OntObject<"Phase">[] {
  return store.list("Phase").sort((a, b) => a.props.order - b.props.order);
}

export function activePhase(store: OntologyStore): OntObject<"Phase"> | undefined {
  return phases(store).find((p) => p.props.status === "Active");
}

export function phaseByOrder(store: OntologyStore, order: number): OntObject<"Phase"> | undefined {
  return phases(store).find((p) => p.props.order === order);
}

export const PHASE = { INFIL: 1, APPROACH: 2, ASSAULT: 3, EXFIL: 4 } as const;

/** Nearest suitable landing zone other than `lz`, if any. */
export function alternateLz(
  store: OntologyStore,
  lz: OntObject<"LandingZone">,
): OntObject<"LandingZone"> | undefined {
  return store
    .list("LandingZone")
    .filter((other) => other.id !== lz.id && other.props.status === "Suitable")
    .sort((a, b) => dist(a.props.pos, lz.props.pos) - dist(b.props.pos, lz.props.pos))[0];
}

export function objectiveOf(store: OntologyStore, unit: OntObject<"Unit">): OntObject<"Structure"> | undefined {
  return store.linkedOne<"Structure">(unit.id, "unitObjective");
}

export function liftOf(store: OntologyStore, unit: OntObject<"Unit">): OntObject<"Platform"> | undefined {
  return store.linkedOne<"Platform">(unit.id, "unitLift");
}

export function lzOf(store: OntologyStore, platform: OntObject<"Platform">): OntObject<"LandingZone"> | undefined {
  return store.linkedOne<"LandingZone">(platform.id, "platformLz");
}

export function carrierOf(store: OntologyStore, unit: OntObject<"Unit">): OntObject<"Platform"> | undefined {
  return store.linkedOne<"Platform">(unit.id, "platformCarries", "reverse");
}

export function missionOver(store: OntologyStore): boolean {
  const s = region(store).props.missionStatus;
  return s === "Complete" || s === "Aborted";
}
