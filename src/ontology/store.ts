import {
  LINK_TYPES,
  type LinkTypeDef,
  type LinkTypeId,
  type ObjectTypeId,
  type OntObject,
  type PropsByType,
} from "./schema";

export interface LinkInstance {
  type: LinkTypeId;
  from: string;
  to: string;
}

export type EventKind = "sim" | "action" | "system" | "warning";
export type Lane = "phase" | "maneuver" | "clearing" | "sensors" | "fires" | "operator";

export interface OpsEvent {
  seq: number;
  timeMs: number;
  kind: EventKind;
  lane: Lane;
  text: string;
  refs: string[];
}

export interface ResolvedLink {
  def: LinkTypeDef;
  direction: "forward" | "reverse";
  label: string;
  other: OntObject;
}

export class OntologyStore {
  private objects = new Map<string, OntObject>();
  private links: LinkInstance[] = [];
  private eventLog: OpsEvent[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private notifyScheduled = false;
  private eventSeq = 0;
  private idSeq = 0;

  clockMs = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.version++;
      for (const l of this.listeners) l();
    });
  }

  nextId(prefix: string): string {
    this.idSeq++;
    return `${prefix}-${this.idSeq}`;
  }

  add<T extends ObjectTypeId>(type: T, id: string, props: PropsByType[T]): OntObject<T> {
    const obj: OntObject<T> = { type, id, props };
    this.objects.set(id, obj as unknown as OntObject);
    this.changed();
    return obj;
  }

  get(id: string): OntObject | undefined {
    return this.objects.get(id);
  }

  getAs<T extends ObjectTypeId>(type: T, id: string): OntObject<T> {
    const obj = this.objects.get(id);
    if (!obj || obj.type !== type) throw new Error(`No ${type} with id ${id}`);
    return obj as unknown as OntObject<T>;
  }

  list<T extends ObjectTypeId>(type: T): OntObject<T>[] {
    const out: OntObject<T>[] = [];
    for (const obj of this.objects.values()) {
      if (obj.type === type) out.push(obj as unknown as OntObject<T>);
    }
    return out;
  }

  update<T extends ObjectTypeId>(obj: OntObject<T>, patch: Partial<PropsByType[T]>): void {
    Object.assign(obj.props as object, patch);
    this.changed();
  }

  remove(id: string): void {
    if (!this.objects.delete(id)) return;
    this.links = this.links.filter((l) => l.from !== id && l.to !== id);
    this.changed();
  }

  link(type: LinkTypeId, from: string, to: string): void {
    if (this.links.some((l) => l.type === type && l.from === from && l.to === to)) return;
    this.links.push({ type, from, to });
    this.changed();
  }

  unlink(type: LinkTypeId, from: string, to?: string): void {
    const before = this.links.length;
    this.links = this.links.filter(
      (l) => !(l.type === type && l.from === from && (to === undefined || l.to === to)),
    );
    if (this.links.length !== before) this.changed();
  }

  linked<T extends ObjectTypeId>(
    id: string,
    type: LinkTypeId,
    direction: "forward" | "reverse" = "forward",
  ): OntObject<T>[] {
    const out: OntObject<T>[] = [];
    for (const l of this.links) {
      if (l.type !== type) continue;
      const otherId = direction === "forward" ? (l.from === id ? l.to : null) : l.to === id ? l.from : null;
      if (otherId === null) continue;
      const other = this.objects.get(otherId);
      if (other) out.push(other as unknown as OntObject<T>);
    }
    return out;
  }

  linkedOne<T extends ObjectTypeId>(
    id: string,
    type: LinkTypeId,
    direction: "forward" | "reverse" = "forward",
  ): OntObject<T> | undefined {
    return this.linked<T>(id, type, direction)[0];
  }

  linksOf(id: string): ResolvedLink[] {
    const out: ResolvedLink[] = [];
    for (const l of this.links) {
      const def = LINK_TYPES[l.type];
      if (l.from === id) {
        const other = this.objects.get(l.to);
        if (other) out.push({ def, direction: "forward", label: def.forwardLabel, other });
      } else if (l.to === id) {
        const other = this.objects.get(l.from);
        if (other) out.push({ def, direction: "reverse", label: def.reverseLabel, other });
      }
    }
    return out;
  }

  log(kind: EventKind, text: string, refs: string[] = [], lane?: Lane): void {
    this.eventSeq++;
    this.eventLog.push({ seq: this.eventSeq, timeMs: this.clockMs, kind, lane: lane ?? this.laneFor(kind, refs), text, refs });
    this.changed();
  }

  private laneFor(kind: EventKind, refs: string[]): Lane {
    if (kind === "action") return "operator";
    const objs = refs.map((id) => this.objects.get(id)).filter((o): o is OntObject => !!o);
    const has = (t: ObjectTypeId) => objs.some((o) => o.type === t);
    if (has("Engagement") || objs.some((o) => o.type === "Platform" && (o as OntObject<"Platform">).props.kind === "FPV")) {
      return "fires";
    }
    if (has("Track")) return "sensors";
    if (has("Structure") || has("Compound")) return "clearing";
    if (has("Unit") || has("Platform") || has("LandingZone")) return "maneuver";
    return "phase";
  }

  get events(): readonly OpsEvent[] {
    return this.eventLog;
  }

  touch(): void {
    this.changed();
  }
}
