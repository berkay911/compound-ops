import { useState } from "react";
import { Tag, Tree, type TreeNodeInfo } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useOps } from "./world";
import { OBJECT_TYPES, TYPE_ORDER, titleOf, type ObjectTypeId, type OntObject } from "../ontology/schema";
import { statusIntent } from "./format";

function statusOf(obj: OntObject): string | undefined {
  const props = obj.props as unknown as Record<string, unknown>;
  const s = props.status ?? props.missionStatus;
  return s === undefined ? undefined : String(s);
}

export function ObjectExplorer() {
  const { store, selectedId, select } = useOps();
  const [collapsed, setCollapsed] = useState<Set<ObjectTypeId>>(() => new Set());

  const contents: TreeNodeInfo<string>[] = TYPE_ORDER.map((type) => {
    const def = OBJECT_TYPES[type];
    let objects: OntObject[] = store.list(type);
    if (type === "Observation") {
      objects = [...objects].reverse();
    }
    return {
      id: `type:${type}`,
      label: def.pluralName,
      icon: def.icon as IconName,
      hasCaret: true,
      isExpanded: !collapsed.has(type),
      secondaryLabel: <span className="muted">{objects.length}</span>,
      nodeData: `type:${type}`,
      childNodes: objects.map((obj) => {
        const status = statusOf(obj);
        return {
          id: obj.id,
          label: <span title={titleOf(obj)}>{titleOf(obj)}</span>,
          isSelected: obj.id === selectedId,
          nodeData: obj.id,
          secondaryLabel: status ? (
            <Tag minimal intent={statusIntent(status)}>
              {status}
            </Tag>
          ) : undefined,
        };
      }),
    };
  });

  const toggle = (node: TreeNodeInfo<string>) => {
    const type = String(node.nodeData).slice("type:".length) as ObjectTypeId;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="explorer-inner">
      <div className="pane-title">Ontology</div>
      <Tree<string>
        contents={contents}
        onNodeClick={(node) => {
          if (String(node.nodeData).startsWith("type:")) toggle(node);
          else select(String(node.nodeData));
        }}
        onNodeExpand={toggle}
        onNodeCollapse={toggle}
      />
    </div>
  );
}
