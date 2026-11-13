import type { OntObject, Point, UnitStatus } from "../ontology/schema";
import type { OpsEvent } from "../ontology/store";
import type { World } from "./world";
import { COC_ID } from "../sim/comms";
import { STALE_MS, keys } from "../sim/edge";
import { UNIT_SPEED } from "../sim/scenario";

export interface UnitPicture {
  pos: Point;
  status: UnitStatus;
  ageMs: number;
  contact: boolean;
  stale: boolean;
  route: string[] | null;
  sinrDb: number | null;
  uncertaintyM: number;
}

export function unitPicture(world: World, u: OntObject<"Unit">): UnitPicture {
  const { edge } = world.sim;
  const now = world.store.clockMs;
  const coc = edge.coc;
  const pos = coc.get<Point>(keys.pos(u.id)) ?? u.props.pos;
  const stamp = coc.stamp(keys.pos(u.id));
  const ageMs = stamp ? now - stamp.t : 0;
  const contact = edge.net.connected(u.id, COC_ID);
  const stale = !contact || ageMs > STALE_MS;
  return {
    pos,
    status: coc.get<UnitStatus>(keys.status(u.id)) ?? u.props.status,
    ageMs,
    contact,
    stale,
    route: edge.net.route(u.id, COC_ID),
    sinrDb: edge.net.sinrBetween(u.id, COC_ID),
    uncertaintyM: stale ? (ageMs / 1000) * UNIT_SPEED : 0,
  };
}

export function structureStatus(world: World, s: OntObject<"Structure">): { status: string; by: string | null } {
  const r = world.sim.edge.structureIn(world.sim.edge.coc, s.id);
  const unit = r.by ? world.store.get(r.by) : undefined;
  const by = unit?.type === "Unit" ? (unit as OntObject<"Unit">).props.callsign : r.by;
  return { status: r.status, by: r.status === "Cleared" ? by : null };
}

export function nodeName(world: World, id: string): string {
  if (id === COC_ID) return "COC";
  const o = world.store.get(id);
  if (!o) return id;
  return (o.props as { callsign?: string }).callsign ?? id;
}

export function visibleEvents(events: readonly OpsEvent[]): OpsEvent[] {
  return events.filter((e) => e.receivedMs !== null);
}

export function delaySec(e: OpsEvent): number {
  return e.receivedMs === null ? 0 : Math.round((e.receivedMs - e.timeMs) / 1000);
}

export function ageText(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}
