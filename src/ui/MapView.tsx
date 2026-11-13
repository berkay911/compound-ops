import { Colors } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useOps } from "./world";
import { MAP } from "../sim/scenario";
import { region } from "../ontology/queries";
import type { OntObject, Point } from "../ontology/schema";

const FRIENDLY = Colors.BLUE5;
const STRUCTURE_FILL: Record<string, string> = {
  Uncleared: Colors.DARK_GRAY5,
  Clearing: Colors.ORANGE2,
  "Clear reported": Colors.ORANGE4,
  Cleared: Colors.GREEN2,
};
const OBS_COLOR: Record<string, string> = {
  New: Colors.ORANGE5,
  Confirmed: Colors.RED5,
  Dismissed: Colors.GRAY3,
};

export function MapView() {
  const { store, selectedId, select } = useOps();
  const r = region(store);
  const compound = store.list("Compound")[0];
  const structures = store.list("Structure");
  const lzs = store.list("LandingZone");
  const platforms = store.list("Platform");
  const units = store.list("Unit").filter((u) => !store.linkedOne(u.id, "platformCarries", "reverse"));
  const observations = store
    .list("Observation")
    .filter((o) => o.props.status !== "Dismissed")
    .slice(-14);

  const pick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    select(id);
  };
  const sel = (id: string) => selectedId === id;

  return (
    <svg className="mapsvg" viewBox={`0 0 ${MAP.width} ${MAP.height}`} onClick={() => select(null)}>
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke={Colors.DARK_GRAY4} strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width={MAP.width} height={MAP.height} fill={Colors.DARK_GRAY1} />
      <rect width={MAP.width} height={MAP.height} fill="url(#grid)" />

      <path
        d="M 0 470 C 160 430 260 600 420 610 S 760 520 1000 560"
        fill="none"
        stroke={Colors.DARK_GRAY5}
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.6"
      />
      <text x="880" y="585" className="map-label faint">
        WADI
      </text>
      <path
        d="M 60 650 L 260 600 L 470 470 L 634 452"
        fill="none"
        stroke={Colors.GRAY1}
        strokeWidth="2"
        strokeDasharray="8 6"
      />
      <ellipse cx="470" cy="190" rx="70" ry="40" fill="none" stroke={Colors.DARK_GRAY5} strokeWidth="1.5" />
      <ellipse cx="470" cy="195" rx="40" ry="22" fill="none" stroke={Colors.DARK_GRAY5} strokeWidth="1.5" />
      <text x="420" y="140" className="map-label faint">
        RIDGE 412
      </text>

      <g>
        <rect x={r.props.fob.x - 18} y={r.props.fob.y - 26} width="52" height="50" fill="none" stroke={FRIENDLY} strokeDasharray="4 3" />
        <text x={r.props.fob.x - 16} y={r.props.fob.y + 38} className="map-label">
          FOB
        </text>
        <circle cx={r.props.holdingArea.x} cy={r.props.holdingArea.y} r="22" fill="none" stroke={Colors.GRAY1} strokeDasharray="3 4" />
        <text x={r.props.holdingArea.x - 20} y={r.props.holdingArea.y + 36} className="map-label faint">
          HOLDING
        </text>
      </g>

      <circle cx="632" cy="336" r="175" fill="none" stroke={Colors.BLUE2} strokeDasharray="2 6" opacity="0.6" />

      {compound && (
        <g onClick={pick(compound.id)} className="clickable">
          <polygon
            points={compound.props.wall.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={compound.props.status === "Secured" ? "rgba(35,133,81,0.10)" : "rgba(200,118,25,0.06)"}
            stroke={sel(compound.id) ? Colors.WHITE : Colors.GRAY3}
            strokeWidth={sel(compound.id) ? 3 : 2}
          />
          {compound.props.gates.map((g) => (
            <rect key={g.name} x={g.pos.x - 8} y={g.pos.y - 4} width="16" height="8" fill={Colors.DARK_GRAY1} stroke={Colors.GRAY3} />
          ))}
          <text x={compound.props.wall[0].x} y={compound.props.wall[0].y - 12} className="map-label strong">
            {compound.props.name}
          </text>
        </g>
      )}

      {structures.map((s) => (
        <StructureShape key={s.id} s={s} selected={sel(s.id)} onPick={pick(s.id)} />
      ))}

      {lzs.map((lz) => (
        <g key={lz.id} onClick={pick(lz.id)} className="clickable">
          <circle
            cx={lz.props.pos.x}
            cy={lz.props.pos.y}
            r="26"
            fill="none"
            stroke={lz.props.status === "Suitable" ? Colors.GREEN4 : Colors.RED4}
            strokeWidth={sel(lz.id) ? 4 : 2}
            strokeDasharray={lz.props.status === "Risky" ? "6 4" : undefined}
          />
          <text x={lz.props.pos.x} y={lz.props.pos.y + 7} textAnchor="middle" className="lz-h">
            H
          </text>
          {lz.props.status === "Risky" && (
            <path
              d={`M ${lz.props.pos.x - 18} ${lz.props.pos.y - 18} L ${lz.props.pos.x + 18} ${lz.props.pos.y + 18} M ${lz.props.pos.x + 18} ${lz.props.pos.y - 18} L ${lz.props.pos.x - 18} ${lz.props.pos.y + 18}`}
              stroke={Colors.RED4}
              strokeWidth="2"
            />
          )}
          <text x={lz.props.pos.x} y={lz.props.pos.y + 44} textAnchor="middle" className="map-label">
            {lz.props.name}
          </text>
        </g>
      ))}

      {observations.map((o) => {
        const age = (store.clockMs - o.props.timeMs) / 1000;
        const opacity = o.props.status === "New" ? Math.max(0.45, 1 - age / 60) : 0.8;
        const { x, y } = o.props.pos;
        return (
          <g key={o.id} onClick={pick(o.id)} className="clickable" opacity={opacity}>
            <path
              d={`M ${x} ${y - 7} L ${x + 7} ${y} L ${x} ${y + 7} L ${x - 7} ${y} Z`}
              fill={OBS_COLOR[o.props.status]}
              stroke={sel(o.id) ? Colors.WHITE : "none"}
              strokeWidth="2"
            />
            {age < 3 && o.props.status === "New" && (
              <circle cx={x} cy={y} r={8 + age * 8} fill="none" stroke={Colors.ORANGE5} opacity={1 - age / 3} />
            )}
          </g>
        );
      })}

      {[...platforms, ...units].map((o) =>
        o.props.waypoint ? (
          <line
            key={`wp-${o.id}`}
            x1={o.props.pos.x}
            y1={o.props.pos.y}
            x2={o.props.waypoint.x}
            y2={o.props.waypoint.y}
            stroke={FRIENDLY}
            strokeDasharray="3 5"
            opacity="0.55"
          />
        ) : null,
      )}

      {platforms.map((p) => (
        <PlatformShape key={p.id} p={p} selected={sel(p.id)} onPick={pick(p.id)} />
      ))}
      {units.map((u, i) => (
        <UnitShape key={u.id} u={u} index={i} selected={sel(u.id)} onPick={pick(u.id)} />
      ))}
    </svg>
  );
}

interface ShapeProps {
  selected: boolean;
  onPick: (e: React.MouseEvent) => void;
}

function StructureShape({ s, selected, onPick }: ShapeProps & { s: OntObject<"Structure"> }) {
  const { rect, status, threat, name } = s.props;
  const threatStroke = threat === "Confirmed" ? Colors.RED4 : threat === "Possible" ? Colors.ORANGE4 : null;
  return (
    <g onClick={onPick} className="clickable">
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill={STRUCTURE_FILL[status]}
        stroke={selected ? Colors.WHITE : threatStroke ?? Colors.GRAY2}
        strokeWidth={selected ? 3 : threatStroke ? 2.5 : 1}
        strokeDasharray={threat === "Possible" && !selected ? "5 3" : undefined}
        className={status === "Clear reported" ? "pulse" : undefined}
      />
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 4} textAnchor="middle" className="map-label strong">
        {name.split(" ")[0]}
      </text>
    </g>
  );
}

function PlatformShape({ p, selected, onPick }: ShapeProps & { p: OntObject<"Platform"> }) {
  const { x, y } = p.props.pos;
  let body: ReactNode;
  if (p.props.kind === "UAV") {
    body = <path d={`M ${x} ${y - 10} L ${x + 10} ${y + 8} L ${x - 10} ${y + 8} Z`} fill={FRIENDLY} />;
  } else {
    body = (
      <>
        <circle cx={x} cy={y} r="9" fill={p.props.altitudeFt > 0 ? FRIENDLY : Colors.BLUE2} />
        <line x1={x - 15} y1={y - 15} x2={x + 15} y2={y + 15} stroke={FRIENDLY} strokeWidth="2" />
        <line x1={x + 15} y1={y - 15} x2={x - 15} y2={y + 15} stroke={FRIENDLY} strokeWidth="2" />
      </>
    );
  }
  return (
    <g onClick={onPick} className="clickable">
      {selected && <circle cx={x} cy={y} r="20" fill="none" stroke={Colors.WHITE} strokeWidth="2" />}
      {body}
      <text x={x + 16} y={y - 10} className="map-label">
        {p.props.callsign}
      </text>
    </g>
  );
}

function UnitShape({ u, index, selected, onPick }: ShapeProps & { u: OntObject<"Unit">; index: number }) {
  const { x, y } = u.props.pos;
  const w = 22;
  const h = 14;
  const label: Point = { x: x + w / 2 + 4, y: y + 4 + (index - 1) * 12 };
  return (
    <g onClick={onPick} className="clickable">
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        fill="rgba(76,144,240,0.25)"
        stroke={selected ? Colors.WHITE : FRIENDLY}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {u.props.role === "Assault" ? (
        <path
          d={`M ${x - w / 2} ${y - h / 2} L ${x + w / 2} ${y + h / 2} M ${x + w / 2} ${y - h / 2} L ${x - w / 2} ${y + h / 2}`}
          stroke={FRIENDLY}
          strokeWidth="1.5"
        />
      ) : (
        <circle cx={x} cy={y} r="3" fill={FRIENDLY} />
      )}
      <text x={label.x} y={label.y} className="map-label">
        {u.props.callsign}
      </text>
    </g>
  );
}
