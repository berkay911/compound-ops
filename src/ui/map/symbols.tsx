import type { MouseEvent, ReactNode } from "react";
import type { Affiliation, TrackStatus } from "../../ontology/schema";

export const IDENTITY = {
  friend: "#4c8fe8",
  hostile: "#e5534b",
  unknown: "#c3c8cd",
  neutral: "#7d858c",
};

export const AFFILIATION_COLOR: Record<Affiliation, string> = {
  Unknown: IDENTITY.unknown,
  Hostile: IDENTITY.hostile,
  Neutral: IDENTITY.neutral,
};

const INK = "#0b0d0f";

interface SymbolProps {
  x: number;
  y: number;
  k: number;
  selected?: boolean;
  onPick?: (e: MouseEvent) => void;
}

function Frame({ x, y, k, selected, onPick, children, half = 20 }: SymbolProps & { children: ReactNode; half?: number }) {
  const s = half + 5;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} onClick={onPick} className="clickable">
      {selected && (
        <path
          className="sel-bracket"
          d={`M${-s} ${-s + 7}V${-s}H${-s + 7}M${s - 7} ${-s}H${s}V${-s + 7}M${s} ${s - 7}V${s}H${s - 7}M${-s + 7} ${s}H${-s}V${s - 7}`}
        />
      )}
      {children}
    </g>
  );
}

function Labels({ lines, x = 24, y = -2 }: { lines: (string | null)[]; x?: number; y?: number }) {
  const shown = lines.filter((l): l is string => !!l);
  if (shown.length === 0) return null;
  return (
    <text x={x} y={y} className="sym-label">
      {shown.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 12} className={i === 0 ? "sym-label-main" : "sym-label-sub"}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

export function GroundUnitSymbol(
  props: SymbolProps & {
    icon: "infantry" | "recon";
    echelon: "team" | "squad";
    lines: (string | null)[];
    stale?: boolean;
  },
) {
  const { icon, echelon, lines, stale } = props;
  return (
    <Frame {...props}>
      {stale ? (
        <rect x={-16} y={-11} width={32} height={22} fill="#1a2433" stroke={IDENTITY.friend} strokeWidth={1.6} strokeDasharray="4 3" />
      ) : (
        <rect x={-16} y={-11} width={32} height={22} fill={IDENTITY.friend} stroke={INK} strokeWidth={1.4} />
      )}
      {icon === "infantry" ? (
        <path d="M-16 -11L16 11M16 -11L-16 11" stroke={stale ? IDENTITY.friend : INK} strokeWidth={1.3} />
      ) : (
        <path d="M-16 11L16 -11" stroke={stale ? IDENTITY.friend : INK} strokeWidth={1.3} />
      )}
      {echelon === "squad" ? (
        <circle cx={0} cy={-15.5} r={2} className="echelon" />
      ) : (
        <g className="echelon-line">
          <circle cx={0} cy={-16.5} r={3.2} />
          <path d="M-4.5 -13L4.5 -20" />
        </g>
      )}
      <Labels lines={lines} x={21} />
    </Frame>
  );
}

export function AirSymbol(
  props: SymbolProps & { icon: "rotary" | "uav" | "fpv"; lines: (string | null)[]; landed?: boolean },
) {
  const { icon, lines, landed } = props;
  if (icon === "fpv") {
    return (
      <Frame {...props} half={9}>
        <path d="M-8 4A8 8 0 0 1 8 4Z" fill={IDENTITY.friend} stroke={INK} strokeWidth={1.2} />
        <path d="M-4 1L0 -2L4 1" fill="none" stroke={INK} strokeWidth={1.2} />
        <Labels lines={lines} x={12} y={2} />
      </Frame>
    );
  }
  return (
    <Frame {...props} half={16}>
      <path
        d="M-15 6A15 15 0 0 1 15 6Z"
        fill={landed ? "#2f5f9e" : IDENTITY.friend}
        stroke={INK}
        strokeWidth={1.4}
      />
      {icon === "rotary" ? (
        <path d="M-9 -4L0 0L-9 4ZM9 -4L0 0L9 4Z" fill={INK} />
      ) : (
        <path d="M-10 -5L0 2.5L10 -5L0 -1Z" fill={INK} />
      )}
      <Labels lines={lines} x={20} />
    </Frame>
  );
}

export function RadarSymbol(props: SymbolProps & { lines: (string | null)[] }) {
  return (
    <Frame {...props} half={12}>
      <circle r={11} fill={IDENTITY.friend} stroke={INK} strokeWidth={1.4} />
      <path d="M-7 3.5L-3.5 -4.5L0 3.5L3.5 -4.5L7 3.5" fill="none" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <Labels lines={props.lines} x={16} />
    </Frame>
  );
}

export function TrackSymbol(
  props: SymbolProps & { affiliation: Affiliation; status: TrackStatus; lines: (string | null)[] },
) {
  const { affiliation, status, lines, selected } = props;
  if (status === "Tentative") {
    return (
      <Frame {...props} half={6}>
        <circle r={3.5} fill="none" stroke={IDENTITY.unknown} strokeWidth={1} opacity={0.5} />
        {selected && <Labels lines={lines} x={9} />}
      </Frame>
    );
  }
  let frame: ReactNode;
  if (affiliation === "Hostile") {
    frame = <path d="M0 -13L13 0L0 13L-13 0Z" fill={IDENTITY.hostile} stroke={INK} strokeWidth={1.4} />;
  } else if (affiliation === "Neutral") {
    frame = <rect x={-9.5} y={-9.5} width={19} height={19} fill={IDENTITY.neutral} stroke={INK} strokeWidth={1.4} />;
  } else {
    frame = (
      <path
        d="M-5 -5A5.6 5.6 0 0 1 5 -5A5.6 5.6 0 0 1 5 5A5.6 5.6 0 0 1 -5 5A5.6 5.6 0 0 1 -5 -5Z"
        transform="scale(1.15)"
        fill="#1d2125"
        stroke={IDENTITY.unknown}
        strokeWidth={1.5}
      />
    );
  }
  return (
    <Frame {...props} half={14}>
      <g opacity={status === "Coasting" ? 0.5 : 1}>
        {frame}
        <Labels lines={lines} x={17} />
      </g>
    </Frame>
  );
}

export function LandingZoneSymbol(props: SymbolProps & { risky: boolean; name: string | null }) {
  const { risky, name } = props;
  return (
    <Frame {...props} half={15}>
      <circle r={14} className={`lz-ring ${risky ? "risky" : ""}`} />
      <text y={5} textAnchor="middle" className="lz-h">
        H
      </text>
      {risky && <path d="M-10 -10L10 10M10 -10L-10 10" className="lz-x" />}
      {name && (
        <text y={28} textAnchor="middle" className="sym-label sym-label-main">
          {name}
        </text>
      )}
    </Frame>
  );
}
