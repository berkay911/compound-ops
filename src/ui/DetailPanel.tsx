import { useState } from "react";
import { Button, HTMLSelect } from "@blueprintjs/core";
import { useOps } from "./world";
import { OBJECT_TYPES, titleOf, type OntObject } from "../ontology/schema";
import { actionsFor, type ActionDef, type ActionParams } from "../ontology/actions";
import type { ResolvedLink } from "../ontology/store";
import { formatClock, formatValue, toneOf } from "./format";
import { ageText, delaySec, nodeName, structureStatus, unitPicture, visibleEvents } from "./view";
import type { World } from "./world";

function pictureProps(world: World, obj: OntObject): Record<string, unknown> {
  const props = { ...(obj.props as unknown as Record<string, unknown>) };
  if (obj.type === "Unit") {
    const pic = unitPicture(world, obj as OntObject<"Unit">);
    props.status = pic.status;
    props.pos = pic.pos;
    if (pic.stale) props.waypoint = null;
  }
  if (obj.type === "Structure") {
    const r = structureStatus(world, obj as OntObject<"Structure">);
    props.status = r.status;
    props.clearedBy = r.by;
  }
  return props;
}

const ACTIVITY_ROWS = 10;

function identityOf(obj: OntObject): { label: string; cls: string } | null {
  if (obj.type === "Track") {
    const a = (obj as OntObject<"Track">).props.affiliation;
    return { label: a.toUpperCase(), cls: a === "Hostile" ? "id-hostile" : "id-other" };
  }
  if (obj.type === "Unit" || obj.type === "Platform" || obj.type === "Sensor") return { label: "FRIENDLY", cls: "id-friend" };
  return null;
}

export function DetailPanel() {
  const { store, world, selectedId } = useOps();
  const obj = selectedId ? store.get(selectedId) : undefined;

  if (!obj) {
    return (
      <div className="inspector empty">
        <div className="section-title">Inspector</div>
        <div className="dim">Select an object on the map, in the ontology tree or on the timeline.</div>
      </div>
    );
  }

  const def = OBJECT_TYPES[obj.type];
  const props = pictureProps(world, obj);
  const identity = identityOf(obj);

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="insp-type">
          {def.displayName}
          <span className="insp-id">{obj.id}</span>
        </div>
        <div className="insp-title">
          {titleOf(obj)}
          {identity && <span className={`id-chip ${identity.cls}`}>{identity.label}</span>}
        </div>
      </div>

      <div className="section-title">Properties</div>
      <dl className="kv">
        {def.properties.map((p) => {
          const value = props[p.key];
          const text = p.format === "status" ? String(value) : formatValue(value, p.format);
          return (
            <div key={p.key} className="kv-row">
              <dt>{p.label}</dt>
              <dd className={p.format === "status" ? toneOf(value, p.key) : "mono"}>{text}</dd>
            </div>
          );
        })}
      </dl>

      {obj.type === "Unit" && <CommsSection unit={obj as OntObject<"Unit">} />}
      <LinksSection obj={obj} />
      <ActionsSection obj={obj} />
      <ActivitySection obj={obj} />
    </div>
  );
}

function CommsSection({ unit }: { unit: OntObject<"Unit"> }) {
  const { world } = useOps();
  const pic = unitPicture(world, unit);
  const rows: [string, string, string?][] = [
    ["Contact", pic.contact ? "Yes" : "No contact", pic.contact ? "" : "tone-alert"],
    ["Route to COC", pic.route ? pic.route.map((id) => nodeName(world, id)).join(" → ") : "none"],
    ["Direct SINR", pic.sinrDb === null ? "—" : `${pic.sinrDb.toFixed(1)} dB`],
    ["Last report", `${ageText(pic.ageMs)} ago`, pic.stale ? "tone-alert" : ""],
    ["Fires uncertainty", pic.uncertaintyM > 0 ? `±${Math.round(pic.uncertaintyM)} m` : "none"],
  ];
  return (
    <>
      <div className="section-title">Comms</div>
      <dl className="kv">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="kv-row">
            <dt>{k}</dt>
            <dd className={cls || "mono"}>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function LinksSection({ obj }: { obj: OntObject }) {
  const { store, select } = useOps();
  const groups = new Map<string, ResolvedLink[]>();
  for (const link of store.linksOf(obj.id)) {
    const key = `${link.def.id}:${link.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  if (groups.size === 0) return null;
  return (
    <>
      <div className="section-title">Links</div>
      <dl className="kv">
        {[...groups.entries()].map(([key, links]) => (
          <div key={key} className="kv-row top">
            <dt>{links[0].label}</dt>
            <dd className="link-list">
              {links.map((l) => (
                <button key={l.other.id} className="link" onClick={() => select(l.other.id)}>
                  {titleOf(l.other)}
                </button>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function ActionsSection({ obj }: { obj: OntObject }) {
  const actions = actionsFor(obj.type);
  if (actions.length === 0) return null;
  return (
    <>
      <div className="section-title">Actions</div>
      <div className="actions">
        {actions.map((a) => (
          <ActionRunner key={`${obj.id}:${a.id}`} action={a} target={obj} />
        ))}
      </div>
    </>
  );
}

function ActionRunner({ action, target }: { action: ActionDef; target: OntObject }) {
  const { store } = useOps();
  const [params, setParams] = useState<ActionParams>({});
  const reason = action.check(store, target, params);

  return (
    <div className="action">
      {action.params.map((p) => {
        const options = store.list(p.objectType).filter((o) => !p.filter || p.filter(store, o as OntObject));
        return (
          <HTMLSelect
            key={p.key}
            fill
            minimal
            value={params[p.key] ?? ""}
            onChange={(e) => setParams({ ...params, [p.key]: e.currentTarget.value || undefined })}
          >
            <option value="">{p.label}…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {titleOf(o as OntObject)}
              </option>
            ))}
          </HTMLSelect>
        );
      })}
      <Button
        size="small"
        variant="outlined"
        fill
        alignText="start"
        text={action.label}
        title={reason ?? undefined}
        disabled={reason !== null}
        onClick={() => {
          action.apply(store, target, params);
          setParams({});
        }}
      />
      {reason && <div className="reason">{reason}</div>}
    </div>
  );
}

function ActivitySection({ obj }: { obj: OntObject }) {
  const { store } = useOps();
  const rows = visibleEvents(store.events)
    .filter((e) => e.refs.includes(obj.id))
    .slice(-ACTIVITY_ROWS)
    .reverse();
  if (rows.length === 0) return null;
  return (
    <>
      <div className="section-title">Activity</div>
      <div className="activity">
        {rows.map((e) => (
          <div key={e.seq} className={`act-row ${e.kind === "warning" ? "warn" : ""}`}>
            <span className="mono dim">{formatClock(e.timeMs)}</span>
            <span>
              {delaySec(e) >= 2 && <span className="delay">+{delaySec(e)}s</span>}
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
