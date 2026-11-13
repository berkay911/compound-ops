import type { Gate, Point, Rect } from "../ontology/schema";

export const NAV_CELL_M = 2;
const WALL_CLEARANCE_M = 2.2;
const GATE_HALF_WIDTH_M = 6;
const BUILDING_CLEARANCE_M = 1.6;
const SQRT2 = Math.SQRT2;

export interface NavObstacles {
  wall: Point[];
  gates: Gate[];
  buildings: Rect[];
}

export interface NavGrid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function blockedAt(o: NavObstacles, p: Point): boolean {
  for (const r of o.buildings) {
    const m = BUILDING_CLEARANCE_M;
    if (p.x > r.x - m && p.x < r.x + r.w + m && p.y > r.y - m && p.y < r.y + r.h + m) return true;
  }
  const n = o.wall.length;
  for (let i = 0; i < n; i++) {
    if (segDist(p, o.wall[i], o.wall[(i + 1) % n]) < WALL_CLEARANCE_M) {
      return !o.gates.some((g) => Math.hypot(p.x - g.pos.x, p.y - g.pos.y) < GATE_HALF_WIDTH_M);
    }
  }
  return false;
}

export function buildNavGrid(o: NavObstacles, bounds = { x0: -100, y0: -100, x1: 1100, y1: 800 }): NavGrid {
  const cols = Math.ceil((bounds.x1 - bounds.x0) / NAV_CELL_M);
  const rows = Math.ceil((bounds.y1 - bounds.y0) / NAV_CELL_M);
  const blocked = new Uint8Array(cols * rows);
  const xs = [...o.wall.map((p) => p.x), ...o.buildings.flatMap((r) => [r.x, r.x + r.w])];
  const ys = [...o.wall.map((p) => p.y), ...o.buildings.flatMap((r) => [r.y, r.y + r.h])];
  const pad = 10;
  const c0 = Math.max(0, Math.floor((Math.min(...xs) - pad - bounds.x0) / NAV_CELL_M));
  const c1 = Math.min(cols - 1, Math.ceil((Math.max(...xs) + pad - bounds.x0) / NAV_CELL_M));
  const r0 = Math.max(0, Math.floor((Math.min(...ys) - pad - bounds.y0) / NAV_CELL_M));
  const r1 = Math.min(rows - 1, Math.ceil((Math.max(...ys) + pad - bounds.y0) / NAV_CELL_M));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const p = { x: bounds.x0 + (c + 0.5) * NAV_CELL_M, y: bounds.y0 + (r + 0.5) * NAV_CELL_M };
      if (blockedAt(o, p)) blocked[r * cols + c] = 1;
    }
  }
  return { x0: bounds.x0, y0: bounds.y0, cols, rows, blocked };
}

function cellOf(g: NavGrid, p: Point): number {
  const c = Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - g.x0) / NAV_CELL_M)));
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor((p.y - g.y0) / NAV_CELL_M)));
  return r * g.cols + c;
}

function centerOf(g: NavGrid, i: number): Point {
  return { x: g.x0 + ((i % g.cols) + 0.5) * NAV_CELL_M, y: g.y0 + (Math.floor(i / g.cols) + 0.5) * NAV_CELL_M };
}

function isBlocked(g: NavGrid, p: Point): boolean {
  const c = Math.floor((p.x - g.x0) / NAV_CELL_M);
  const r = Math.floor((p.y - g.y0) / NAV_CELL_M);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return true;
  return g.blocked[r * g.cols + c] === 1;
}

function nearestFree(g: NavGrid, start: number): number {
  if (!g.blocked[start]) return start;
  const seen = new Set([start]);
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const n = nr * g.cols + nc;
      if (seen.has(n)) continue;
      if (!g.blocked[n]) return n;
      seen.add(n);
      queue.push(n);
    }
  }
  return start;
}

export function lineOfSight(g: NavGrid, a: Point, b: Point): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / (NAV_CELL_M * 0.25)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isBlocked(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

class MinHeap {
  private items: number[] = [];
  constructor(private score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

function astar(g: NavGrid, start: number, goal: number): number[] | null {
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % g.cols;
  const gr = Math.floor(goal / g.cols);
  const h = (i: number) => {
    const dx = Math.abs((i % g.cols) - gc);
    const dy = Math.abs(Math.floor(i / g.cols) - gr);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new MinHeap(fScore);
  gScore[start] = 0;
  fScore[start] = h(start);
  open.push(start);
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      for (let i = came[cur]; i !== -1; i = came[i]) path.push(i);
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % g.cols;
    const r = Math.floor(cur / g.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const nb = nr * g.cols + nc;
        if (g.blocked[nb] || closed[nb]) continue;
        if (dr !== 0 && dc !== 0 && (g.blocked[r * g.cols + nc] || g.blocked[nr * g.cols + c])) continue;
        const tentative = gScore[cur] + (dr !== 0 && dc !== 0 ? SQRT2 : 1);
        if (tentative >= gScore[nb]) continue;
        came[nb] = cur;
        gScore[nb] = tentative;
        fScore[nb] = tentative + h(nb);
        open.push(nb);
      }
    }
  }
  return null;
}

export function findPath(g: NavGrid, from: Point, to: Point): Point[] {
  if (lineOfSight(g, from, to)) return [{ ...to }];
  const start = nearestFree(g, cellOf(g, from));
  const goal = nearestFree(g, cellOf(g, to));
  const cells = astar(g, start, goal);
  if (!cells) return [];
  const raw = cells.map((i) => centerOf(g, i));
  const end = isBlocked(g, to) ? raw[raw.length - 1] : { ...to };
  const origin = isBlocked(g, from) ? raw[0] : from;
  const out: Point[] = origin === from ? [] : [origin];
  const pts = [...raw, end];
  let anchor = origin;
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(g, anchor, pts[j])) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j;
  }
  if (out.length === 0) out.push(end);
  return out;
}

export function pathLength(from: Point, path: Point[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}
