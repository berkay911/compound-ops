export type MergeKind = "lww" | "max" | "fww";

export interface Stamp {
  t: number;
  c: number;
  n: string;
}

export interface Entry {
  v: unknown;
  kind: MergeKind;
  rank: number;
  s: Stamp;
}

export function compareStamps(a: Stamp, b: Stamp): number {
  return a.t - b.t || a.c - b.c || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0);
}

function beats(incoming: Entry, current: Entry): boolean {
  const order = compareStamps(incoming.s, current.s);
  switch (current.kind) {
    case "max":
      return incoming.rank > current.rank || (incoming.rank === current.rank && order > 0);
    case "fww":
      return order < 0;
    default:
      return order > 0;
  }
}

export class Replica {
  readonly entries = new Map<string, Entry>();
  readonly events = new Set<number>();
  private counter = 0;

  constructor(readonly node: string) {}

  get<T = unknown>(key: string): T | undefined {
    return this.entries.get(key)?.v as T | undefined;
  }

  stamp(key: string): Stamp | undefined {
    return this.entries.get(key)?.s;
  }

  write(key: string, v: unknown, kind: MergeKind, t: number, rank = 0): boolean {
    const entry: Entry = { v, kind, rank, s: { t, c: ++this.counter, n: this.node } };
    const current = this.entries.get(key);
    if (current && !beats(entry, current)) return false;
    this.entries.set(key, entry);
    return true;
  }

  publish(key: string, v: unknown, kind: MergeKind, t: number, rank = 0): boolean {
    const current = this.entries.get(key);
    if (current && current.rank === rank && JSON.stringify(current.v) === JSON.stringify(v)) return false;
    return this.write(key, v, kind, t, rank);
  }

  merge(other: Replica): number {
    let changed = 0;
    for (const [key, entry] of other.entries) {
      const current = this.entries.get(key);
      if (!current || beats(entry, current)) {
        this.entries.set(key, entry);
        changed++;
      }
    }
    for (const seq of other.events) {
      if (!this.events.has(seq)) {
        this.events.add(seq);
        changed++;
      }
    }
    return changed;
  }

  digest(): string {
    const keys = [...this.entries.keys()].sort();
    const body = keys.map((k) => {
      const e = this.entries.get(k)!;
      return `${k}=${JSON.stringify(e.v)}@${e.s.t}.${e.s.c}.${e.s.n}#${e.rank}`;
    });
    return `${body.join("|")}||${[...this.events].sort((a, b) => a - b).join(",")}`;
  }
}
