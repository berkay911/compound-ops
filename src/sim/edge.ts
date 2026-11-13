import type { OntObject, Point, StructureStatus } from "../ontology/schema";
import type { OntologyStore } from "../ontology/store";
import { carrierOf } from "../ontology/queries";
import { COC_ID, Network, type Jammer, type RadioNode } from "./comms";
import { Replica } from "./replica";

export const GOSSIP_MS = 1000;
export const REPORT_MS = 1000;
export const STALE_MS = 2500;
const FT = 0.3048;

export const STRUCTURE_RANK: Record<StructureStatus, number> = { Uncleared: 0, Clearing: 1, Cleared: 2 };

export interface StructureReport {
  status: StructureStatus;
  by: string | null;
}

export const keys = {
  phase: (id: string) => `phase/${id}`,
  weapons: "region/weapons",
  pos: (id: string) => `unit/${id}/pos`,
  status: (id: string) => `unit/${id}/status`,
  objective: (id: string) => `unit/${id}/objective`,
  structure: (id: string) => `structure/${id}`,
  claim: (id: string) => `claim/${id}`,
};

export class Edge {
  readonly net = new Network();
  readonly jammer: Jammer & { host: string } = { pos: { x: 711, y: 268 }, powerDbm: 50, active: false, host: "b4" };
  readonly replicas = new Map<string, Replica>();
  readonly lastContact = new Map<string, number>();
  readonly outages: { unit: string; from: number; to: number | null }[] = [];
  private nextGossipMs = 0;
  private lastReport = new Map<string, number>();
  private contact = new Map<string, boolean>();

  constructor(private store: OntologyStore) {
    this.replicas.set(COC_ID, new Replica(COC_ID));
    for (const u of store.list("Unit")) {
      this.replicas.set(u.id, new Replica(u.id));
      this.lastContact.set(u.id, 0);
      this.contact.set(u.id, true);
    }
  }

  rep(id: string): Replica {
    return this.replicas.get(id)!;
  }

  get coc(): Replica {
    return this.rep(COC_ID);
  }

  radioNodes(): RadioNode[] {
    const store = this.store;
    const region = store.list("Region")[0];
    const nodes: RadioNode[] = [{ id: COC_ID, name: "COC", pos: region.props.fob, altM: 3, powerDbm: 47 }];
    for (const u of store.list("Unit")) {
      const carrier = carrierOf(store, u);
      nodes.push({
        id: u.id,
        name: u.props.callsign,
        pos: carrier ? carrier.props.pos : u.props.pos,
        altM: carrier ? carrier.props.altitudeFt * FT + 1.5 : 1.5,
        powerDbm: 37,
      });
    }
    for (const p of store.list("Platform")) {
      if (p.props.kind === "FPV") continue;
      nodes.push({ id: p.id, name: p.props.callsign, pos: p.props.pos, altM: p.props.altitudeFt * FT + 1, powerDbm: 40 });
    }
    return nodes;
  }

  logFrom(origin: string, kind: "sim" | "system" | "warning", text: string, refs: string[] = []): void {
    const seq = this.store.log(kind, text, refs, undefined, origin);
    if (origin !== COC_ID) this.rep(origin).events.add(seq);
  }

  publishCoc(): void {
    const store = this.store;
    const now = store.clockMs;
    for (const p of store.list("Phase")) this.coc.publish(keys.phase(p.id), p.props.status, "lww", now);
    const region = store.list("Region")[0];
    this.coc.publish(keys.weapons, region.props.weapons, "lww", now);
  }

  publishUnit(u: OntObject<"Unit">, objective: string | null): void {
    const now = this.store.clockMs;
    const rep = this.rep(u.id);
    rep.publish(keys.status(u.id), u.props.status, "lww", now);
    rep.publish(keys.objective(u.id), objective, "lww", now);
    if (now - (this.lastReport.get(u.id) ?? -Infinity) >= REPORT_MS) {
      rep.write(keys.pos(u.id), { x: Math.round(u.props.pos.x * 10) / 10, y: Math.round(u.props.pos.y * 10) / 10 }, "lww", now);
      this.lastReport.set(u.id, now);
    }
  }

  reportStructure(unitId: string, s: OntObject<"Structure">): void {
    const report: StructureReport = { status: s.props.status, by: s.props.clearedBy ?? unitId };
    this.rep(unitId).write(keys.structure(s.id), report, "max", this.store.clockMs, STRUCTURE_RANK[s.props.status]);
  }

  structureIn(rep: Replica, id: string): StructureReport {
    return rep.get<StructureReport>(keys.structure(id)) ?? { status: "Uncleared", by: null };
  }

  phaseOrderIn(rep: Replica): number | undefined {
    for (const p of this.store.list("Phase")) {
      if (rep.get(keys.phase(p.id)) === "Active") return p.props.order;
    }
    return undefined;
  }

  update(): void {
    const store = this.store;
    const now = store.clockMs;
    this.publishCoc();
    this.net.update(this.radioNodes(), this.jammer);

    for (const id of this.lastContact.keys()) {
      const u = store.get(id) as OntObject<"Unit"> | undefined;
      const up = this.net.connected(id, COC_ID);
      if (up) this.lastContact.set(id, now);
      const was = this.contact.get(id)!;
      if (up === was || !u) continue;
      this.contact.set(id, up);
      if (!up) {
        this.outages.push({ unit: id, from: now, to: null });
        const sinr = this.net.sinrBetween(id, COC_ID);
        store.log(
          "warning",
          `No contact with ${u.props.callsign}: link to COC at ${sinr === null ? "?" : sinr.toFixed(0)} dB SINR, jamming suspected`,
          [u.id],
          "comms",
        );
      } else {
        const outage = [...this.outages].reverse().find((o) => o.unit === id && o.to === null);
        if (outage) outage.to = now;
        this.pendingRestore.set(id, outage ? now - outage.from : 0);
      }
    }

    if (now < this.nextGossipMs) return;
    this.nextGossipMs = now + GOSSIP_MS;
    const before = new Set(this.coc.events);
    let cocChanged = 0;
    for (const group of this.net.components()) {
      const reps = group.map((id) => this.replicas.get(id)).filter((r): r is Replica => !!r);
      if (reps.length < 2) continue;
      const acc = new Replica("gossip");
      for (const r of reps) acc.merge(r);
      for (const r of reps) {
        const changed = r.merge(acc);
        if (r === this.coc) cocChanged += changed;
      }
    }
    let backfilled = 0;
    for (const seq of this.coc.events) {
      if (before.has(seq)) continue;
      store.markReceived(seq);
      backfilled++;
    }
    if (this.pendingRestore.size > 0) {
      const names = [...this.pendingRestore.keys()].map((id) => (store.get(id) as OntObject<"Unit">).props.callsign);
      const gap = Math.max(...this.pendingRestore.values());
      store.log(
        "system",
        `Contact with ${names.join(", ")} restored after ${Math.round(gap / 1000)} s: ${cocChanged} updates merged, ${backfilled} delayed reports backfilled`,
        [...this.pendingRestore.keys()],
        "comms",
      );
    }
    this.pendingRestore.clear();
  }

  private pendingRestore = new Map<string, number>();

  reportedPos(id: string): { pos: Point; ageMs: number } | null {
    const pos = this.coc.get<Point>(keys.pos(id));
    const s = this.coc.stamp(keys.pos(id));
    if (!pos || !s) return null;
    return { pos, ageMs: this.store.clockMs - s.t };
  }
}
