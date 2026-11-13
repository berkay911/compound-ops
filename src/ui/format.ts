import type { Intent } from "@blueprintjs/core";
import type { PropertyFormat } from "../ontology/schema";

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatValue(value: unknown, format: PropertyFormat): string {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "point": {
      const p = value as { x: number; y: number };
      return `${Math.round(p.x)}, ${Math.round(p.y)}`;
    }
    case "percent":
      return `${(value as number).toFixed(0)}%`;
    case "clock":
      return formatClock(value as number);
    case "feet":
      return `${Math.round(value as number)} ft`;
    default:
      return String(value);
  }
}

const SUCCESS = new Set(["Secured", "Cleared", "Complete", "Suitable", "In position", "Extracted", "RTB complete"]);
const DANGER = new Set(["Confirmed", "Risky", "Aborted", "High"]);
const WARNING = new Set([
  "Clearing",
  "Clear reported",
  "Contested",
  "Possible",
  "Active",
  "Medium",
  "Inbound",
  "Moving",
  "Assaulting",
  "Egress",
  "In progress",
  "New",
]);
const PRIMARY = new Set(["Landed", "Embarked", "On station", "On ground", "Holding"]);

export function statusIntent(value: unknown): Intent {
  const v = String(value);
  if (SUCCESS.has(v)) return "success";
  if (DANGER.has(v)) return "danger";
  if (WARNING.has(v)) return "warning";
  if (PRIMARY.has(v)) return "primary";
  return "none";
}
