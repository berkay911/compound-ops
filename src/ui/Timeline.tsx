import { useEffect, useRef, useState } from "react";
import { useOps } from "./world";
import { formatClock } from "./format";
import { phases } from "../ontology/queries";
import type { Lane } from "../ontology/store";
import { delaySec, visibleEvents } from "./view";

const LABEL_W = 78;
const AXIS_H = 18;
const PHASE_H = 18;
const LANE_H = 15;
const MIN_SPAN_MS = 240_000;
const LANES: { lane: Lane; label: string }[] = [
  { lane: "operator", label: "OPERATOR" },
  { lane: "maneuver", label: "MANEUVER" },
  { lane: "clearing", label: "CLEARING" },
  { lane: "sensors", label: "SENSORS" },
  { lane: "fires", label: "FIRES" },
  { lane: "comms", label: "COMMS" },
];

export function Timeline() {
  const { store, select, selectedId } = useOps();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const now = store.clockMs;
  const span = Math.max(MIN_SPAN_MS, Math.ceil((now + 30_000) / 60_000) * 60_000);
  const plotW = w - LABEL_W - 8;
  const x = (t: number) => LABEL_W + (t / span) * plotW;
  const laneY = (i: number) => AXIS_H + PHASE_H + 4 + i * LANE_H;
  const h = laneY(LANES.length) + 2;
  const stepMs = span <= 240_000 ? 30_000 : 60_000;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += stepMs) ticks.push(t);

  return (
    <div className="timeline" ref={ref}>
      <div className="section-title">Timeline</div>
      <svg width={w} height={h} className="tl-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={h} className="tl-grid" />
            <text x={x(t) + 3} y={AXIS_H - 7} className="tl-axis">
              {formatClock(t)}
            </text>
          </g>
        ))}
        <text x={0} y={AXIS_H + PHASE_H - 5} className="tl-lane">
          PHASE
        </text>
        {phases(store).map((p) => {
          if (p.props.startedAt === null) return null;
          const end = p.props.endedAt ?? now;
          const x0 = x(p.props.startedAt);
          const width = Math.max(2, x(end) - x0);
          return (
            <g key={p.id} className="clickable" onClick={() => select(p.id)}>
              <rect
                x={x0}
                y={AXIS_H + 1}
                width={width}
                height={PHASE_H - 3}
                className={`tl-phase ${p.props.status.toLowerCase()} ${selectedId === p.id ? "selected" : ""}`}
              />
              {width > 44 && (
                <text x={x0 + 5} y={AXIS_H + PHASE_H - 6} className="tl-phase-label">
                  {p.props.name.replace(/^P\d /, "").toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
        {LANES.map((l, i) => (
          <g key={l.lane}>
            <line x1={LABEL_W} x2={w - 8} y1={laneY(i) + LANE_H - 1} y2={laneY(i) + LANE_H - 1} className="tl-rule" />
            <text x={0} y={laneY(i) + LANE_H - 4} className="tl-lane">
              {l.label}
            </text>
          </g>
        ))}
        {visibleEvents(store.events).map((e) => {
          const i = LANES.findIndex((l) => l.lane === e.lane);
          if (i < 0) return null;
          const hit = selectedId !== null && e.refs.includes(selectedId);
          const cx = x(e.timeMs);
          const y0 = laneY(i);
          return (
            <g key={e.seq} className={e.refs.length ? "clickable" : ""} onClick={() => e.refs[0] && select(e.refs[0])}>
              <title>{`${formatClock(e.timeMs)}${delaySec(e) >= 2 ? ` (received +${delaySec(e)} s)` : ""}  ${e.text}`}</title>
              {delaySec(e) >= 2 && (
                <line x1={cx} x2={x(e.receivedMs!)} y1={y0 + LANE_H / 2} y2={y0 + LANE_H / 2} className="tl-latency" />
              )}
              <rect x={cx - 3} y={y0} width={6} height={LANE_H - 1} fill="transparent" />
              {e.lane === "operator" ? (
                <path d={`M${cx} ${y0 + 3}L${cx + 4} ${y0 + LANE_H - 3}H${cx - 4}Z`} className={`tl-op ${hit ? "hit" : ""}`} />
              ) : (
                <line
                  x1={cx}
                  x2={cx}
                  y1={y0 + (hit ? 1 : 3)}
                  y2={y0 + LANE_H - (hit ? 2 : 4)}
                  className={`tl-tick ${e.kind === "warning" ? "warn" : ""} ${hit ? "hit" : ""}`}
                />
              )}
            </g>
          );
        })}
        <line x1={x(now)} x2={x(now)} y1={AXIS_H - 4} y2={h} className="tl-now" />
      </svg>
    </div>
  );
}
