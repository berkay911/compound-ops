import type { Point } from "../ontology/schema";

export const RADIO = {
  freqMhz: 350,
  noiseDbm: -124,
  antennaGainDbi: 2,
  processingGainDb: 20,
  upDb: 10,
  downDb: 7,
} as const;

export const COC_ID = "coc";

export interface RadioNode {
  id: string;
  name: string;
  pos: Point;
  altM: number;
  powerDbm: number;
}

export interface Jammer {
  pos: Point;
  powerDbm: number;
  active: boolean;
}

export interface LinkState {
  a: string;
  b: string;
  sinrAB: number;
  sinrBA: number;
  up: boolean;
}

function slant(a: Point, altA: number, b: Point, altB: number): number {
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y, altA - altB));
}

export function fsplDb(distanceM: number): number {
  return 32.44 + 20 * Math.log10(distanceM / 1000) + 20 * Math.log10(RADIO.freqMhz);
}

function dbmSum(...levels: number[]): number {
  return 10 * Math.log10(levels.reduce((s, l) => s + 10 ** (l / 10), 0));
}

export function jammingAt(jammer: Jammer, pos: Point, altM: number): number {
  if (!jammer.active) return -Infinity;
  return jammer.powerDbm + RADIO.antennaGainDbi - fsplDb(slant(jammer.pos, 0, pos, altM));
}

export function sinrDb(from: RadioNode, to: RadioNode, jammer: Jammer): number {
  const rx = from.powerDbm + 2 * RADIO.antennaGainDbi - fsplDb(slant(from.pos, from.altM, to.pos, to.altM));
  const j = jammingAt(jammer, to.pos, to.altM) - RADIO.processingGainDb;
  return rx - dbmSum(RADIO.noiseDbm, j);
}

export class Network {
  links = new Map<string, LinkState>();
  private parent = new Map<string, string>();
  nodes: RadioNode[] = [];

  update(nodes: RadioNode[], jammer: Jammer): void {
    this.nodes = nodes;
    const next = new Map<string, LinkState>();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const key = `${a.id}|${b.id}`;
        const sinrAB = sinrDb(a, b, jammer);
        const sinrBA = sinrDb(b, a, jammer);
        const worst = Math.min(sinrAB, sinrBA);
        const wasUp = this.links.get(key)?.up ?? worst >= RADIO.upDb;
        const up = wasUp ? worst >= RADIO.downDb : worst >= RADIO.upDb;
        next.set(key, { a: a.id, b: b.id, sinrAB, sinrBA, up });
      }
    }
    this.links = next;
    this.parent = new Map(nodes.map((n) => [n.id, n.id]));
    for (const l of next.values()) if (l.up) this.union(l.a, l.b);
  }

  private find(id: string): string {
    let r = id;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(id, r);
    return r;
  }

  private union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  connected(a: string, b: string): boolean {
    if (!this.parent.has(a) || !this.parent.has(b)) return false;
    return this.find(a) === this.find(b);
  }

  components(): string[][] {
    const groups = new Map<string, string[]>();
    for (const n of this.nodes) {
      const r = this.find(n.id);
      groups.set(r, [...(groups.get(r) ?? []), n.id]);
    }
    return [...groups.values()];
  }

  route(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const prev = new Map<string, string>([[from, from]]);
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      for (const l of this.links.values()) {
        if (!l.up) continue;
        const other = l.a === cur ? l.b : l.b === cur ? l.a : null;
        if (!other || prev.has(other)) continue;
        prev.set(other, cur);
        if (other === to) {
          const path = [to];
          for (let p = cur; p !== from; p = prev.get(p)!) path.push(p);
          path.push(from);
          return path.reverse();
        }
        queue.push(other);
      }
    }
    return null;
  }

  link(a: string, b: string): LinkState | undefined {
    return this.links.get(`${a}|${b}`) ?? this.links.get(`${b}|${a}`);
  }

  sinrBetween(a: string, b: string): number | null {
    const l = this.link(a, b);
    return l ? Math.min(l.sinrAB, l.sinrBA) : null;
  }
}
