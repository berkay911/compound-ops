import { useState } from "react";
import { Button, HTMLSelect, HTMLTable, Icon, NonIdealState, Tag } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useOps } from "./world";
import { OBJECT_TYPES, titleOf, type OntObject } from "../ontology/schema";
import { actionsFor, type ActionDef, type ActionParams } from "../ontology/actions";
import type { ResolvedLink } from "../ontology/store";
import { formatValue, statusIntent } from "./format";

export function DetailPanel() {
  const { store, selectedId } = useOps();
  const obj = selectedId ? store.get(selectedId) : undefined;

  if (!obj) {
    return (
      <NonIdealState
        icon="select"
        title="Nothing selected"
        description="Pick an object on the map, in the ontology tree, or in the event feed."
      />
    );
  }

  const def = OBJECT_TYPES[obj.type];
  const props = obj.props as unknown as Record<string, unknown>;

  return (
    <div className="detail-inner">
      <div className="detail-header">
        <Icon icon={def.icon as IconName} size={18} />
        <div>
          <div className="muted small">{def.displayName}</div>
          <div className="detail-title">{titleOf(obj)}</div>
        </div>
      </div>

      <div className="pane-title">Properties</div>
      <HTMLTable compact className="props">
        <tbody>
          {def.properties.map((p) => (
            <tr key={p.key}>
              <td className="muted">{p.label}</td>
              <td>
                {p.format === "status" ? (
                  <Tag minimal intent={statusIntent(props[p.key])}>
                    {String(props[p.key])}
                  </Tag>
                ) : (
                  formatValue(props[p.key], p.format)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>

      <LinksSection obj={obj} />
      <ActionsSection obj={obj} />
    </div>
  );
}

function LinksSection({ obj }: { obj: OntObject }) {
  const { store, select } = useOps();
  const groups = new Map<string, ResolvedLink[]>();
  for (const link of store.linksOf(obj.id)) {
    const key = `${link.def.id}:${link.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }

  return (
    <>
      <div className="pane-title">Links</div>
      {groups.size === 0 && <div className="muted small">No links</div>}
      {[...groups.entries()].map(([key, links]) => (
        <div key={key} className="link-group">
          <div className="muted small">{links[0].label}</div>
          <div className="link-tags">
            {links.map((l) => (
              <Tag
                key={l.other.id}
                icon={OBJECT_TYPES[l.other.type].icon as IconName}
                interactive
                onClick={() => select(l.other.id)}
              >
                {titleOf(l.other)}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ActionsSection({ obj }: { obj: OntObject }) {
  const actions = actionsFor(obj.type);
  if (actions.length === 0) return null;
  return (
    <>
      <div className="pane-title">Actions</div>
      {actions.map((a) => (
        <ActionRunner key={`${obj.id}:${a.id}`} action={a} target={obj} />
      ))}
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
        const options = store
          .list(p.objectType)
          .filter((o) => !p.filter || p.filter(store, o as OntObject));
        return (
          <HTMLSelect
            key={p.key}
            fill
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
        fill
        alignText="start"
        intent={action.intent}
        icon={action.icon as IconName}
        text={action.label}
        disabled={reason !== null}
        onClick={() => {
          action.apply(store, target, params);
          setParams({});
        }}
      />
      {reason && <div className="muted small reason">{reason}</div>}
    </div>
  );
}
