import { useState } from "react";
import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useOps } from "./world";
import { OBJECT_TYPES, TYPE_ORDER, titleOf, type ObjectTypeId, type OntObject } from "../ontology/schema";
import { toneOf } from "./format";

function statusOf(obj: OntObject): { value: string; key: string } | undefined {
  if (obj.type === "Track") {
    const t = obj as OntObject<"Track">;
    return t.props.affiliation === "Unknown"
      ? { value: t.props.status, key: "status" }
      : { value: t.props.affiliation, key: "affiliation" };
  }
  const props = obj.props as unknown as Record<string, unknown>;
  const s = props.status ?? props.missionStatus;
  return s === undefined ? undefined : { value: String(s), key: "status" };
}

const TRACK_RANK = { Confirmed: 0, Coasting: 1, Tentative: 2 };
const COLLAPSED_BY_DEFAULT: ObjectTypeId[] = ["Sensor", "Phase"];

export function ObjectExplorer() {
  const { store, selectedId, select } = useOps();
  const [collapsed, setCollapsed] = useState<Set<ObjectTypeId>>(() => new Set(COLLAPSED_BY_DEFAULT));

  const toggle = (type: ObjectTypeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div className="explorer-inner">
      <div className="section-title pad">Ontology</div>
      {TYPE_ORDER.map((type) => {
        const def = OBJECT_TYPES[type];
        let objects: OntObject[] = store.list(type);
        if (type === "Track") {
          objects = [...(objects as OntObject<"Track">[])]
            .filter((t) => t.props.status !== "Tentative")
            .sort(
              (a, b) =>
                TRACK_RANK[a.props.status] - TRACK_RANK[b.props.status] || a.props.label.localeCompare(b.props.label),
            );
        }
        const open = !collapsed.has(type);
        return (
          <div key={type} className="tree-group">
            <button className="tree-head" onClick={() => toggle(type)}>
              <Icon icon={open ? "caret-down" : "caret-right"} size={12} />
              <Icon icon={def.icon as IconName} size={12} className="dim" />
              <span>{def.pluralName}</span>
              <span className="count">{objects.length}</span>
            </button>
            {open &&
              objects.map((obj) => {
                const status = statusOf(obj);
                return (
                  <button
                    key={obj.id}
                    className={`tree-row ${obj.id === selectedId ? "selected" : ""}`}
                    onClick={() => select(obj.id)}
                  >
                    <span className="tree-name">{titleOf(obj)}</span>
                    {status && <span className={`tree-status ${toneOf(status.value, status.key)}`}>{status.value}</span>}
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
