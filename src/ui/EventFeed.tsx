import { Tag } from "@blueprintjs/core";
import { useOps } from "./world";
import { formatClock } from "./format";
import type { EventKind } from "../ontology/store";

const KIND_INTENT: Record<EventKind, "none" | "primary" | "warning" | "success"> = {
  sim: "none",
  action: "primary",
  system: "success",
  warning: "warning",
};

export function EventFeed() {
  const { store, select } = useOps();
  const events = [...store.events].reverse().slice(0, 200);

  return (
    <div className="feed-inner">
      <div className="pane-title">Event feed</div>
      <div className="feed-list">
        {events.map((e) => (
          <div
            key={e.seq}
            className={`feed-row ${e.refs.length ? "clickable" : ""}`}
            onClick={() => e.refs[0] && select(e.refs[0])}
          >
            <span className="clock small">{formatClock(e.timeMs)}</span>
            <Tag minimal intent={KIND_INTENT[e.kind]} className="kind">
              {e.kind}
            </Tag>
            <span>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
