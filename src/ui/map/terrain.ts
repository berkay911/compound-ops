import type { Point } from "../../ontology/schema";

export const DOMAIN = { x0: -300, y0: -200, x1: 1300, y1: 900 };

const HILLS = [
  { x: 470, y: 190, a: 30, sx: 130, sy: 60, rot: -0.3 },
  { x: 900, y: 100, a: 20, sx: 120, sy: 90, rot: 0.4 },
  { x: 130, y: 230, a: 24, sx: 150, sy: 110, rot: 0.2 },
  { x: 1150, y: 760, a: 18, sx: 160, sy: 120, rot: 0 },
  { x: -150, y: 820, a: 14, sx: 180, sy: 140, rot: 0 },
  { x: 780, y: 820, a: 10, sx: 220, sy: 90, rot: 0.1 },
  { x: 250, y: 380, a: 6, sx: 90, sy: 70, rot: 0 },
  { x: 1180, y: 300, a: 16, sx: 110, sy: 150, rot: -0.2 },
];

function bezier(p0: Point, c1: Point, c2: Point, p1: Point, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

export const WADI: Point[] = [
  { x: -300, y: 520 },
  { x: 0, y: 470 },
  ...bezier({ x: 0, y: 470 }, { x: 160, y: 430 }, { x: 260, y: 600 }, { x: 420, y: 610 }, 18),
  ...bezier({ x: 420, y: 610 }, { x: 580, y: 620 }, { x: 760, y: 520 }, { x: 1000, y: 560 }, 18),
  { x: 1300, y: 600 },
];

export const ROAD: Point[] = [
  { x: -300, y: 720 },
  { x: 50, y: 650 },
  { x: 260, y: 600 },
  { x: 470, y: 470 },
  { x: 634, y: 452 },
];

function distToPolyline(p: Point, line: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function heightAt(x: number, y: number): number {
  let h = 382 - 0.006 * (y - 350);
  for (const k of HILLS) {
    const c = Math.cos(k.rot);
    const s = Math.sin(k.rot);
    const dx = x - k.x;
    const dy = y - k.y;
    const u = (dx * c + dy * s) / k.sx;
    const v = (-dx * s + dy * c) / k.sy;
    h += k.a * Math.exp(-(u * u + v * v) / 2);
  }
  const w = distToPolyline({ x, y }, WADI);
  h -= 8 * Math.exp(-(w * w) / (2 * 26 * 26));
  return h;
}

const STEP = 10;

function heightGrid(): { grid: number[][]; cols: number; rows: number } {
  const cols = Math.round((DOMAIN.x1 - DOMAIN.x0) / STEP) + 1;
  const rows = Math.round((DOMAIN.y1 - DOMAIN.y0) / STEP) + 1;
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < cols; i++) row.push(heightAt(DOMAIN.x0 + i * STEP, DOMAIN.y0 + j * STEP));
    grid.push(row);
  }
  return { grid, cols, rows };
}

type Edge = "top" | "right" | "bottom" | "left";

const CASES: Record<number, [Edge, Edge][]> = {
  1: [["left", "bottom"]],
  2: [["bottom", "right"]],
  3: [["left", "right"]],
  4: [["top", "right"]],
  5: [
    ["top", "right"],
    ["left", "bottom"],
  ],
  6: [["top", "bottom"]],
  7: [["left", "top"]],
  8: [["left", "top"]],
  9: [["top", "bottom"]],
  10: [
    ["left", "top"],
    ["bottom", "right"],
  ],
  11: [["top", "right"]],
  12: [["left", "right"]],
  13: [["bottom", "right"]],
  14: [["left", "bottom"]],
};

export interface ContourLabel {
  x: number;
  y: number;
  angle: number;
  text: string;
}

export interface Contours {
  minor: string;
  index: string;
  labels: ContourLabel[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildContours(interval = 2, indexEvery = 10): Contours {
  const { grid, cols, rows } = heightGrid();
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }

  const minor: string[] = [];
  const index: string[] = [];
  const labels: ContourLabel[] = [];

  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    const isIndex = level % indexEvery === 0;
    const out = isIndex ? index : minor;
    let count = 0;
    let labelled = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const tl = grid[j][i];
        const tr = grid[j][i + 1];
        const br = grid[j + 1][i + 1];
        const bl = grid[j + 1][i];
        const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        const segs = CASES[idx];
        if (!segs) continue;
        const x = DOMAIN.x0 + i * STEP;
        const y = DOMAIN.y0 + j * STEP;
        const lerp = (a: number, b: number) => (level - a) / (b - a);
        const pt = (e: Edge): Point => {
          switch (e) {
            case "top":
              return { x: x + lerp(tl, tr) * STEP, y };
            case "right":
              return { x: x + STEP, y: y + lerp(tr, br) * STEP };
            case "bottom":
              return { x: x + lerp(bl, br) * STEP, y: y + STEP };
            default:
              return { x, y: y + lerp(tl, bl) * STEP };
          }
        };
        for (const [ea, eb] of segs) {
          const a = pt(ea);
          const b = pt(eb);
          out.push(`M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`);
          count++;
          if (isIndex && count % 90 === 45 && labelled < 4) {
            let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;
            labels.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle, text: String(level) });
            labelled++;
          }
        }
      }
    }
  }
  return { minor: minor.join(""), index: index.join(""), labels };
}

export function peak(): Point & { h: number } {
  let best = { x: 0, y: 0, h: -Infinity };
  for (let x = 380; x <= 560; x += 2) {
    for (let y = 130; y <= 250; y += 2) {
      const h = heightAt(x, y);
      if (h > best.h) best = { x, y, h };
    }
  }
  return best;
}

export function hillshadeDataUrl(): string | null {
  if (typeof document === "undefined") return null;
  const res = 4;
  const w = Math.round((DOMAIN.x1 - DOMAIN.x0) / res);
  const h = Math.round((DOMAIN.y1 - DOMAIN.y0) / res);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const exaggeration = 4;
  const light = { x: -0.5, y: -0.5, z: Math.SQRT1_2 };
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = DOMAIN.x0 + px * res + res / 2;
      const y = DOMAIN.y0 + py * res + res / 2;
      const dzdx = ((heightAt(x + 2, y) - heightAt(x - 2, y)) / 4) * exaggeration;
      const dzdy = ((heightAt(x, y + 2) - heightAt(x, y - 2)) / 4) * exaggeration;
      const len = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * light.x - dzdy * light.y + light.z) / len);
      const elev = Math.max(0, Math.min(1, (heightAt(x, y) - 372) / 45));
      const k = (py * w + px) * 4;
      img.data[k] = 14 + shade * 26 + elev * 10;
      img.data[k + 1] = 18 + shade * 28 + elev * 8;
      img.data[k + 2] = 20 + shade * 26 + elev * 2;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
