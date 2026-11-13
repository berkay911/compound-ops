import type { Intent } from "@blueprintjs/core";
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

const SUCCESS = new Set([
  "Secured",
  "Cleared",
  "Complete",
  "Suitable",
  "In position",
  "Extracted",
  "RTB complete",
  "Operational",
  "Neutral",
]);
const DANGER = new Set(["Risky", "Aborted", "Hostile"]);
const WARNING = new Set([
  "Clearing",
  "Clear reported",
  "Contested",
  "Possible",
  "Active",
  "Inbound",
  "Moving",
  "Assaulting",
  "Egress",
  "In progress",
  "Coasting",
]);
const PRIMARY = new Set(["Landed", "Embarked", "On station", "On ground", "Holding"]);

export function statusIntent(value: unknown, key = "status"): Intent {
  const v = String(value);
  if (v === "Confirmed") return key === "threat" ? "danger" : "primary";
  if (v === "Unknown" && key === "affiliation") return "warning";
  if (SUCCESS.has(v)) return "success";
  if (DANGER.has(v)) return "danger";
  if (WARNING.has(v)) return "warning";
  if (PRIMARY.has(v)) return "primary";
  return "none";
}
