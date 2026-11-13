// In-memory ontology store: objects, typed links between them, and an event
// log. Mutations are coalesced into a single change notification per
// microtask so the UI re-renders once per simulation tick or action.

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

export interface OpsEvent {
  seq: number;
  timeMs: number;
  kind: EventKind;
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

  /** Mission clock in milliseconds since H-hour. */
  clockMs = 0;

  // ---- subscription -------------------------------------------------------

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

  // ---- objects ------------------------------------------------------------

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

  // ---- links --------------------------------------------------------------

  link(type: LinkTypeId, from: string, to: string): void {
    if (this.links.some((l) => l.type === type && l.from === from && l.to === to)) return;
    this.links.push({ type, from, to });
    this.changed();
  }

  /** Removes links of a type from an object; if `to` is given, only that one. */
  unlink(type: LinkTypeId, from: string, to?: string): void {
    const before = this.links.length;
    this.links = this.links.filter(
      (l) => !(l.type === type && l.from === from && (to === undefined || l.to === to)),
    );
    if (this.links.length !== before) this.changed();
  }

  /** Objects reached from `id` along `type` (forward) or against it (reverse). */
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

  /** Every link touching the object, grouped later by the UI. */
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

  // ---- events -------------------------------------------------------------

  log(kind: EventKind, text: string, refs: string[] = []): void {
    this.eventSeq++;
    this.eventLog.push({ seq: this.eventSeq, timeMs: this.clockMs, kind, text, refs });
    this.changed();
  }

  get events(): readonly OpsEvent[] {
    return this.eventLog;
  }

  /** Marks the store changed without touching any object (e.g. clock tick). */
  touch(): void {
    this.changed();
  }
}
