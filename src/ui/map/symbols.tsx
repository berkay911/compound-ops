import type { MouseEvent, ReactNode } from "react";
import type { Affiliation, TrackStatus } from "../../ontology/schema";

export const FILL = {
  friend: "#80E0FF",
  hostile: "#FF8080",
  neutral: "#AAFFAA",
  unknown: "#FFFF80",
};

export const AFFILIATION_COLOR: Record<Affiliation, string> = {
  Unknown: FILL.unknown,
  Hostile: "#FF5A5A",
  Neutral: "#7FE07F",
};

const INK = "#07090b";

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
          d={`M${-s} ${-s + 8}V${-s}H${-s + 8}M${s - 8} ${-s}H${s}V${-s + 8}M${s} ${s - 8}V${s}H${s - 8}M${-s + 8} ${s}H${-s}V${s - 8}`}
        />
      )}
      {children}
    </g>
  );
}

function Labels({ lines, x = 24, y = -3 }: { lines: (string | null)[]; x?: number; y?: number }) {
  const shown = lines.filter((l): l is string => !!l);
  return (
    <text x={x} y={y} className="sym-label">
      {shown.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 13} className={i === 0 ? "sym-label-main" : "sym-label-sub"}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

export function GroundUnitSymbol(
  props: SymbolProps & { icon: "infantry" | "recon"; echelon: "team" | "squad"; lines: (string | null)[] },
) {
  const { icon, echelon, lines } = props;
  return (
    <Frame {...props}>
      <rect x={-18} y={-12} width={36} height={24} fill={FILL.friend} stroke={INK} strokeWidth={1.6} />
      {icon === "infantry" ? (
        <path d="M-18 -12L18 12M18 -12L-18 12" stroke={INK} strokeWidth={1.4} />
      ) : (
        <path d="M-18 12L18 -12" stroke={INK} strokeWidth={1.4} />
      )}
      {echelon === "squad" ? (
        <circle cx={0} cy={-17} r={2.2} fill="#e6edf3" />
      ) : (
        <g stroke="#e6edf3" strokeWidth={1.3} fill="none">
          <circle cx={0} cy={-18} r={3.5} />
          <path d="M-5 -14L5 -22" />
        </g>
      )}
      <Labels lines={lines} />
    </Frame>
  );
}

export function AirSymbol(props: SymbolProps & { icon: "rotary" | "uav"; lines: (string | null)[]; landed?: boolean }) {
  const { icon, lines, landed } = props;
  return (
    <Frame {...props} half={18}>
      <path d="M-17 7A17 17 0 0 1 17 7Z" fill={landed ? "#5aa9c2" : FILL.friend} stroke={INK} strokeWidth={1.6} />
      {icon === "rotary" ? (
        <path d="M-10 -5L0 0L-10 5ZM10 -5L0 0L10 5Z" fill={INK} />
      ) : (
        <path d="M-11 -6L0 3L11 -6L0 -1Z" fill={INK} />
      )}
      <Labels lines={lines} x={22} />
    </Frame>
  );
}

export function RadarSymbol(props: SymbolProps & { lines: string[] }) {
  return (
    <Frame {...props} half={14}>
      <circle r={13} fill={FILL.friend} stroke={INK} strokeWidth={1.6} />
      <path d="M-8 4L-4 -5L0 4L4 -5L8 4" fill="none" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <Labels lines={props.lines} x={19} />
    </Frame>
  );
}

export function TrackSymbol(
  props: SymbolProps & { affiliation: Affiliation; status: TrackStatus; lines: (string | null)[] },
) {
  const { affiliation, status, lines, selected } = props;
  if (status === "Tentative") {
    return (
      <Frame {...props} half={7}>
        <circle r={5} fill="none" stroke={FILL.unknown} strokeWidth={1.2} strokeDasharray="2 2" opacity={0.75} />
        {selected && <Labels lines={lines} x={10} />}
      </Frame>
    );
  }
  let frame: ReactNode;
  if (affiliation === "Hostile") {
    frame = <path d="M0 -15L15 0L0 15L-15 0Z" fill={FILL.hostile} stroke={INK} strokeWidth={1.6} />;
  } else if (affiliation === "Neutral") {
    frame = <rect x={-11} y={-11} width={22} height={22} fill={FILL.neutral} stroke={INK} strokeWidth={1.6} />;
  } else {
    const lobes = [
      [0, -6],
      [6, 0],
      [0, 6],
      [-6, 0],
    ];
    frame = (
      <>
        {lobes.map(([cx, cy], i) => (
          <circle key={`s${i}`} cx={cx} cy={cy} r={7.5} fill="none" stroke={INK} strokeWidth={3.2} />
        ))}
        {lobes.map(([cx, cy], i) => (
          <circle key={`f${i}`} cx={cx} cy={cy} r={7.5} fill={FILL.unknown} />
        ))}
      </>
    );
  }
  return (
    <Frame {...props} half={16}>
      <g opacity={status === "Coasting" ? 0.5 : 1}>
        {frame}
        <Labels lines={lines} x={20} />
      </g>
    </Frame>
  );
}

export function LandingZoneSymbol(props: SymbolProps & { risky: boolean; name: string }) {
  const { risky, name } = props;
  const color = risky ? "#ff5a5a" : "#7fe07f";
  return (
    <Frame {...props} half={18}>
      <circle r={17} fill="rgba(7,9,11,0.55)" stroke={color} strokeWidth={2} strokeDasharray={risky ? "5 3" : undefined} />
      <text y={6} textAnchor="middle" className="lz-h" fill={color}>
        H
      </text>
      {risky && <path d="M-12 -12L12 12M12 -12L-12 12" stroke={color} strokeWidth={2} />}
      <text y={33} textAnchor="middle" className="sym-label sym-label-main">
        {name}
      </text>
    </Frame>
  );
}
