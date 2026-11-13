import { useOps } from "./world";
import { formatClock } from "./format";
import type { Lane } from "../ontology/store";

export const LANE_CODE: Record<Lane, string> = {
  phase: "SYS",
  maneuver: "MNV",
  clearing: "CLR",
  sensors: "SNS",
  fires: "FIR",
  operator: "OPR",
};

export function EventFeed() {
  const { store, select, selectedId } = useOps();
  const events = [...store.events].reverse().slice(0, 150);

  return (
    <div className="log">
      <div className="section-title">Event log</div>
      <div className="log-list">
        {events.map((e) => (
          <div
            key={e.seq}
            className={`log-row ${e.kind === "warning" ? "warn" : ""} ${selectedId && e.refs.includes(selectedId) ? "hit" : ""} ${
              e.refs.length ? "clickable" : ""
            }`}
            onClick={() => e.refs[0] && select(e.refs[0])}
          >
            <span className="mono dim">{formatClock(e.timeMs)}</span>
            <span className="mono lane-code">{LANE_CODE[e.lane]}</span>
            <span className="log-text">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
