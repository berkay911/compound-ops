import type { PropertyFormat } from "../ontology/schema";
import { toGrid } from "./grid";

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatValue(value: unknown, format: PropertyFormat): string {
  if (value === null || value === undefined) return "—";
  const n = value as number;
  switch (format) {
    case "point":
      return toGrid(value as { x: number; y: number });
    case "percent":
      return `${n.toFixed(0)}%`;
    case "prob":
      return `${Math.round(n * 100)}%`;
    case "clock":
      return formatClock(n);
    case "feet":
      return `${Math.round(n)} ft`;
    case "meters":
      return n < 100 ? `${n.toFixed(1)} m` : `${Math.round(n)} m`;
    case "mps":
      return `${n.toFixed(1)} m/s`;
    case "deg":
      return `${String(Math.round(n) % 360).padStart(3, "0")}°`;
    default:
      return String(value);
  }
}

const ALERT = new Set(["Risky", "Aborted", "Confirmed", "Contested", "Coasting", "Hold", "Holding off"]);

export function toneOf(value: unknown, key = "status"): string {
  const v = String(value);
  if (v === "Hostile") return "tone-hostile";
  if (key === "affiliation" && v === "Friendly") return "tone-friend";
  if (key === "status" && v === "Confirmed") return "";
  if (ALERT.has(v)) return "tone-alert";
  if (v === "Pending" || v === "Unknown" || v === "None" || v === "—") return "tone-dim";
  return "";
}
