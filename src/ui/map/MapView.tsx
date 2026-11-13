import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button, Checkbox } from "@blueprintjs/core";
import { useOps } from "../world";
import { easting, northing, toGrid } from "../grid";
import { region } from "../../ontology/queries";
import type { OntObject, Point } from "../../ontology/schema";
import { CHI2_95_SCALE } from "../../sim/kalman";
import { EO, RADAR } from "../../sim/sensors";
import { COC_ID } from "../../sim/comms";
import { ageText, structureStatus, unitPicture } from "../view";
import { DOMAIN, ROAD, WADI, buildContours, heightAt, hillshadeDataUrl, peak } from "./terrain";
import {
  AFFILIATION_COLOR,
  AirSymbol,
  IDENTITY,
  GroundUnitSymbol,
  LandingZoneSymbol,
  RadarSymbol,
  TrackSymbol,
} from "./symbols";

const MAP_W = 1000;
const MAP_H = 700;

type LayerKey = "terrain" | "grid" | "graphics" | "coverage" | "comms" | "plots" | "tracks" | "ellipses" | "truth";

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: "terrain", label: "Terrain and contours" },
  { key: "grid", label: "100 m grid" },
  { key: "graphics", label: "Control measures" },
  { key: "coverage", label: "Sensor coverage" },
  { key: "comms", label: "Comms routes to COC" },
  { key: "plots", label: "Raw plots" },
  { key: "tracks", label: "Tracks" },
  { key: "ellipses", label: "95% error ellipses" },
  { key: "truth", label: "Ground truth" },
];

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  terrain: true,
  grid: true,
  graphics: true,
  coverage: false,
  comms: true,
  plots: false,
  tracks: true,
  ellipses: true,
  truth: false,
};

const LOD = { names: 1.45, detail: 2.4 };

const pts = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

const TerrainLayer = memo(function TerrainLayer({ detail, fs }: { detail: boolean; fs: number }) {
  const image = useMemo(() => hillshadeDataUrl(), []);
  const contours = useMemo(() => buildContours(), []);
  const top = useMemo(() => peak(), []);
  return (
    <g>
      {image && (
        <image
          href={image}
          x={DOMAIN.x0}
          y={DOMAIN.y0}
          width={DOMAIN.x1 - DOMAIN.x0}
          height={DOMAIN.y1 - DOMAIN.y0}
          preserveAspectRatio="none"
        />
      )}
      <path d={contours.minor} className="contour" vectorEffect="non-scaling-stroke" />
      <path d={contours.index} className="contour contour-index" vectorEffect="non-scaling-stroke" />
      {detail &&
        contours.labels.map((l, i) => (
        <text key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`} className="contour-label" textAnchor="middle" dy={3 * fs} fontSize={7.5 * fs}>
          {l.text}
        </text>
      ))}
      <polyline points={pts(WADI)} className="wadi-bank" vectorEffect="non-scaling-stroke" />
      <polyline points={pts(WADI)} className="wadi" vectorEffect="non-scaling-stroke" />
      <text x={860} y={590} fontSize={9 * fs} className="terrain-label italic">
        WADI SAKHR
      </text>
      <polyline points={pts(ROAD)} className="road-casing" vectorEffect="non-scaling-stroke" />
      <polyline points={pts(ROAD)} className="road" vectorEffect="non-scaling-stroke" />
      <text x={300} y={572} fontSize={9 * fs} className="terrain-label" transform="rotate(-31 300 572)">
        RTE IRON
      </text>
      <path d={`M${top.x} ${top.y - 5}L${top.x + 4.5} ${top.y + 3}L${top.x - 4.5} ${top.y + 3}Z`} className="spot" />
      {detail && (
        <text x={top.x + 8} y={top.y + 4} fontSize={9 * fs} className="terrain-label">
          {Math.round(top.h)}
        </text>
      )}
      <text x={top.x - 40} y={top.y - 48} fontSize={9 * fs} className="terrain-label">
        RIDGE {Math.round(top.h)}
      </text>
    </g>
  );
});

const GridLines = memo(function GridLines() {
  const d = useMemo(() => {
    const parts: string[] = [];
    for (let x = Math.ceil(DOMAIN.x0 / 100) * 100; x <= DOMAIN.x1; x += 100) parts.push(`M${x} ${DOMAIN.y0}V${DOMAIN.y1}`);
    for (let y = Math.ceil(DOMAIN.y0 / 100) * 100; y <= DOMAIN.y1; y += 100) parts.push(`M${DOMAIN.x0} ${y}H${DOMAIN.x1}`);
    return parts.join("");
  }, []);
  return <path d={d} className="grid-line" vectorEffect="non-scaling-stroke" />;
});

const ControlMeasures = memo(function ControlMeasures({ names, fs }: { names: boolean; fs: number }) {
  return (
    <g className="cm">
      <rect x={488} y={198} width={290} height={276} rx={34} className="cm-line" vectorEffect="non-scaling-stroke" />
      <text x={680} y={192} fontSize={10 * fs} className="cm-label strong">
        OBJ FALCON
      </text>
      <polyline points="250,478 520,494 940,522" className="cm-line" vectorEffect="non-scaling-stroke" />
      <circle cx={520} cy={506} r={11} className="cm-line" vectorEffect="non-scaling-stroke" />
      <polyline points="64,640 225,595 386,540" className="cm-air" vectorEffect="non-scaling-stroke" />
      <circle cx={225} cy={595} r={7} className="cm-air" vectorEffect="non-scaling-stroke" />
      <polyline points="874,150 1030,95" className="cm-air" vectorEffect="non-scaling-stroke" />
      <path d="M470 186L482 206H458Z" className="cm-line" vectorEffect="non-scaling-stroke" />
      <ellipse cx={190} cy={640} rx={36} ry={20} className="cm-line dashed" vectorEffect="non-scaling-stroke" />
      <rect x={14} y={612} width={84} height={76} className="cm-line" vectorEffect="non-scaling-stroke" />
      <text x={16} y={704} fontSize={10 * fs} className="cm-label strong">
        FOB ANVIL
      </text>
      {names && (
        <g>
          <text x={252} y={472} fontSize={9 * fs} className="cm-label">
            PL OAK
          </text>
          <text x={900} y={515} fontSize={9 * fs} className="cm-label">
            PL OAK
          </text>
          <text x={535} y={512} fontSize={9 * fs} className="cm-label">
            ORP
          </text>
          <text x={214} y={580} fontSize={9 * fs} className="cm-label">
            ACP 1
          </text>
          <text x={120} y={604} fontSize={9 * fs} className="cm-label" transform="rotate(-16 120 604)">
            AR BLUE
          </text>
          <text x={452} y={200} fontSize={9 * fs} className="cm-label" textAnchor="end">
            OP 1
          </text>
          <text x={160} y={672} fontSize={9 * fs} className="cm-label">
            HA DUSTY
          </text>
        </g>
      )}
    </g>
  );
});

function niceScale(z: number): number {
  const options = [10, 25, 50, 100, 200, 250, 500, 1000];
  return options.find((m) => m * z >= 70) ?? 1000;
}

export function MapView() {
  const { store, world, selectedId, select } = useOps();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState<{ cx: number; cy: number; z: number } | null>(null);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [layersOpen, setLayersOpen] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, cx: 0, cy: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.max(entry.contentRect.width, 50), h: Math.max(entry.contentRect.height, 50) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitZ = Math.min(size.w / MAP_W, size.h / MAP_H) * 0.97;
  const v = view ?? { cx: MAP_W / 2, cy: MAP_H / 2, z: fitZ };
  const lod = v.z / fitZ;
  const names = lod >= LOD.names;
  const detail = lod >= LOD.detail;
  const k = (1 / v.z) * (names ? 1 : 0.82);
  const vb = { x: v.cx - size.w / 2 / v.z, y: v.cy - size.h / 2 / v.z, w: size.w / v.z, h: size.h / v.z };

  const latest = useRef({ v, vb, fitZ });
  latest.current = { v, vb, fitZ };

  const toMap = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { vb: b, v: cur } = latest.current;
    return { x: b.x + (clientX - rect.left) / cur.z, y: b.y + (clientY - rect.top) / cur.z };
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { v: cur, fitZ: fit } = latest.current;
      const m = toMap(e.clientX, e.clientY);
      const z = Math.min(Math.max(cur.z * Math.exp(-e.deltaY * 0.0015), fit * 0.6), fit * 12);
      setView({ cx: m.x - ((m.x - cur.cx) * cur.z) / z, cy: m.y - ((m.y - cur.cy) * cur.z) / z, z });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onView = (e: Event) => {
      const { cx, cy, zoom } = (e as CustomEvent<{ cx: number; cy: number; zoom: number }>).detail;
      setView({ cx, cy, z: latest.current.fitZ * zoom });
    };
    window.addEventListener("ops:view", onView);
    return () => window.removeEventListener("ops:view", onView);
  }, []);

  const zoomBy = (f: number) => {
    const z = Math.min(Math.max(v.z * f, fitZ * 0.6), fitZ * 12);
    setView({ cx: v.cx, cy: v.cy, z });
  };

  const pick = (id: string) => (e: MouseEvent) => {
    e.stopPropagation();
    if (!drag.current.moved) select(id);
  };
  const sel = (id: string) => selectedId === id;

  const r = region(store);
  const compound = store.list("Compound")[0];
  const structures = store.list("Structure");
  const lzs = store.list("LandingZone");
  const allPlatforms = store.list("Platform");
  const platforms = allPlatforms.filter((p) => p.props.kind !== "FPV");
  const drones = allPlatforms.filter((p) => p.props.kind === "FPV");
  const flying = drones.filter((d) => d.props.status !== "Ready" && d.props.status !== "Expended");
  const readyCount = drones.filter((d) => d.props.status === "Ready").length;
  const hits = store.list("Engagement").filter((e) => e.props.status === "Hit");
  const units = store.list("Unit").filter((u) => !store.linkedOne(u.id, "platformCarries", "reverse"));
  const tracks = store.list("Track");
  const radar = store.get(RADAR.id) as OntObject<"Sensor"> | undefined;
  const uav = platforms.find((p) => p.props.kind === "UAV");
  const pictures = new Map(units.map((u) => [u.id, unitPicture(world, u)]));
  const gatesInUse = new Set(units.filter((u) => !pictures.get(u.id)!.stale).map((u) => u.props.entryGate).filter(Boolean));
  const edge = world.sim.edge;
  const nodePos = new Map(edge.net.nodes.map((n) => [n.id, pictures.get(n.id)?.pos ?? n.pos]));
  const commsSegments = new Map<string, [Point, Point]>();
  if (layers.comms) {
    for (const n of edge.net.nodes) {
      if (n.id === COC_ID) continue;
      const route = edge.net.route(n.id, COC_ID);
      if (!route) continue;
      for (let i = 1; i < route.length; i++) {
        const key = [route[i - 1], route[i]].sort().join("|");
        commsSegments.set(key, [nodePos.get(route[i - 1])!, nodePos.get(route[i])!]);
      }
    }
  }
  const c = RADAR.pos;

  const gridLabelsX: number[] = [];
  for (let x = Math.ceil(vb.x / 100) * 100; x <= vb.x + vb.w; x += 100) gridLabelsX.push(x);
  const gridLabelsY: number[] = [];
  for (let y = Math.ceil(vb.y / 100) * 100; y <= vb.y + vb.h; y += 100) gridLabelsY.push(y);

  const scaleM = niceScale(v.z);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="mapsvg"
        width={size.w}
        height={size.h}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, cx: v.cx, cy: v.cy };
        }}
        onPointerMove={(e) => {
          setCursor(toMap(e.clientX, e.clientY));
          const d = drag.current;
          if (!d.active) return;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
          if (d.moved) setView({ cx: d.cx - dx / v.z, cy: d.cy - dy / v.z, z: v.z });
        }}
        onPointerUp={() => {
          drag.current.active = false;
        }}
        onPointerLeave={() => {
          drag.current.active = false;
          setCursor(null);
        }}
        onClick={() => {
          if (!drag.current.moved) select(null);
        }}
      >
        <defs>
          <pattern id="roof-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0V5" stroke="rgba(255,255,255,0.07)" strokeWidth="1.2" />
          </pattern>
        </defs>
        <rect x={DOMAIN.x0 - 4000} y={DOMAIN.y0 - 4000} width={10000} height={10000} className="map-void" />
        {layers.terrain && <TerrainLayer detail={detail} fs={1 / v.z} />}
        {layers.grid && <GridLines />}

        {layers.coverage && (
          <g>
            {[250, 500, 750, 1000].map((rr) => (
              <g key={rr}>
                <circle cx={c.x} cy={c.y} r={rr} className="range-ring" vectorEffect="non-scaling-stroke" />
                <text x={c.x + 4 * k} y={c.y - rr - 3 * k} className="range-label" fontSize={10 * k}>
                  {rr} m
                </text>
              </g>
            ))}
            <circle cx={EO.stare.x} cy={EO.stare.y} r={EO.radius} className="eo-fov" vectorEffect="non-scaling-stroke" />
            {uav && (
              <line
                x1={uav.props.pos.x}
                y1={uav.props.pos.y}
                x2={EO.stare.x}
                y2={EO.stare.y}
                className="eo-los"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )}

        {compound && (
          <g onClick={pick(compound.id)} className="clickable">
            <polygon
              points={pts(compound.props.wall)}
              className={`wall ${sel(compound.id) ? "selected" : ""}`}
              vectorEffect="non-scaling-stroke"
            />
            {compound.props.gates.map((g) => {
              const vertical = Math.abs(g.outer.x - g.pos.x) > Math.abs(g.outer.y - g.pos.y);
              const inUse = gatesInUse.has(g.name);
              return (
                <g key={g.name}>
                  <rect
                    x={g.pos.x - (vertical ? 2.5 : 7)}
                    y={g.pos.y - (vertical ? 7 : 2.5)}
                    width={vertical ? 5 : 14}
                    height={vertical ? 14 : 5}
                    className={`gate ${inUse ? "in-use" : ""}`}
                  />
                  {detail && (
                    <text
                      x={g.outer.x + (vertical ? -10 : 10)}
                      y={g.outer.y + (vertical ? -6 : 3)}
                      className="gate-label"
                      fontSize={9 * k}
                    >
                      {g.name.split(" ")[0][0]}G
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {structures.map((s) => {
          const { rect, name } = s.props;
          const status = structureStatus(world, s).status;
          return (
            <g key={s.id} onClick={pick(s.id)} className="clickable">
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                className={`bldg ${status.replace(" ", "-").toLowerCase()} ${sel(s.id) ? "selected" : ""}`}
                vectorEffect="non-scaling-stroke"
              />
              {status !== "Cleared" && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="url(#roof-hatch)" />}
              {(names || sel(s.id)) && (
                <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 3.5 * k} textAnchor="middle" className="bldg-label" fontSize={10 * k}>
                  {name.split(" ")[0]}
                </text>
              )}
            </g>
          );
        })}

        {layers.graphics && <ControlMeasures names={names} fs={1 / v.z} />}

        {lzs.map((lz) => (
          <LandingZoneSymbol
            key={lz.id}
            x={lz.props.pos.x}
            y={lz.props.pos.y}
            k={k}
            risky={lz.props.status === "Risky"}
            name={lz.props.name}
            selected={sel(lz.id)}
            onPick={pick(lz.id)}
          />
        ))}

        {[...commsSegments.entries()].map(([key, [a, b]]) => (
          <line key={`net-${key}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="net-link" vectorEffect="non-scaling-stroke" />
        ))}
        {units.map((u) => {
          const pic = pictures.get(u.id)!;
          if (!pic.stale || pic.uncertaintyM < 4) return null;
          return (
            <circle
              key={`unc-${u.id}`}
              cx={pic.pos.x}
              cy={pic.pos.y}
              r={pic.uncertaintyM}
              className="uncertainty"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {units.map((u) =>
          u.props.route.length > 0 && !pictures.get(u.id)!.stale ? (
            <polyline
              key={`route-${u.id}`}
              points={pts([u.props.pos, ...u.props.route])}
              className={`route ${sel(u.id) ? "selected" : ""}`}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {platforms.map((p) =>
          p.props.waypoint ? (
            <line
              key={`wp-${p.id}`}
              x1={p.props.pos.x}
              y1={p.props.pos.y}
              x2={p.props.waypoint.x}
              y2={p.props.waypoint.y}
              className="route air"
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}

        {hits.map((e) => (
          <g key={`hit-${e.id}`} transform={`translate(${e.props.aimPoint.x} ${e.props.aimPoint.y}) scale(${k})`} onClick={pick(e.id)} className="clickable">
            <path d="M-4 -4L4 4M4 -4L-4 4" className={`impact ${sel(e.id) ? "selected" : ""}`} />
            {(detail || sel(e.id)) && (
              <text x={7} y={3} className="sym-label sym-label-sub">
                {e.props.label}
              </text>
            )}
          </g>
        ))}
        {flying.map((d) =>
          d.props.waypoint ? (
            <g key={`aim-${d.id}`}>
              <line
                x1={d.props.pos.x}
                y1={d.props.pos.y}
                x2={d.props.waypoint.x}
                y2={d.props.waypoint.y}
                className="route fpv"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={d.props.waypoint.x} cy={d.props.waypoint.y} r={4 * k} className="aim" vectorEffect="non-scaling-stroke" />
            </g>
          ) : null,
        )}
        {layers.graphics && (
          <text x={16} y={718} fontSize={9 / v.z} className="cm-label">
            FPV VIPER {readyCount}/{drones.length} READY
          </text>
        )}

        {layers.plots &&
          world.sim.tracker.plots.map((p, i) => {
            const t = `translate(${p.pos.x} ${p.pos.y}) scale(${k})`;
            if (p.friendly) return <circle key={i} transform={t} r={1.8} className="plot-bft" />;
            if (p.sensorId === RADAR.id) return <path key={i} transform={t} d="M-3 0H3M0 -3V3" className="plot-radar" />;
            return <rect key={i} transform={t} x={-1.8} y={-1.8} width={3.6} height={3.6} className="plot-eo" />;
          })}

        {layers.tracks &&
          tracks.map((t) => {
            const p = t.props;
            if (p.status === "Tentative") return null;
            const color = AFFILIATION_COLOR[p.affiliation];
            const lead = { x: p.pos.x + p.vel.x * 20, y: p.pos.y + p.vel.y * 20 };
            const angle = (Math.atan2(p.vel.y, p.vel.x) * 180) / Math.PI;
            return (
              <g key={`trk-${t.id}`} opacity={p.status === "Coasting" ? 0.55 : 1}>
                {layers.ellipses && (
                  <ellipse
                    cx={p.pos.x}
                    cy={p.pos.y}
                    rx={Math.max(p.sigmaMajor * CHI2_95_SCALE, 0.5)}
                    ry={Math.max(p.sigmaMinor * CHI2_95_SCALE, 0.5)}
                    transform={`rotate(${p.ellipseDeg} ${p.pos.x} ${p.pos.y})`}
                    className={`ellipse ${p.status === "Coasting" ? "coasting" : ""}`}
                    stroke={color}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {p.history.map((h, i) => (
                  <circle key={i} cx={h.x} cy={h.y} r={1.3 * k} fill={color} opacity={0.12 + (0.35 * i) / p.history.length} />
                ))}
                {p.speedMps > 0.6 && (
                  <g>
                    <line x1={p.pos.x} y1={p.pos.y} x2={lead.x} y2={lead.y} stroke={color} className="leader" vectorEffect="non-scaling-stroke" />
                    <path transform={`translate(${lead.x} ${lead.y}) rotate(${angle}) scale(${k})`} d="M0 0L-7 -3.5L-7 3.5Z" fill={color} />
                  </g>
                )}
              </g>
            );
          })}

        {layers.truth &&
          units.map((u) => (
            <g key={`truthu-${u.id}`} transform={`translate(${u.props.pos.x} ${u.props.pos.y}) scale(${k})`} className="truth friend">
              <path d="M-4 -4L4 4M4 -4L-4 4" />
              <text x={6} y={-5}>
                {u.props.callsign.toLowerCase()}
              </text>
            </g>
          ))}
        {layers.truth && edge.jammer.active && (
          <g transform={`translate(${edge.jammer.pos.x} ${edge.jammer.pos.y}) scale(${k})`} className="truth">
            <circle r={6} className="jammer" />
            <text x={9} y={-6}>
              jammer
            </text>
          </g>
        )}
        {layers.truth &&
          world.sim.targets
            .filter((g) => g.active)
            .map((g) => (
              <g key={`truth-${g.id}`} transform={`translate(${g.pos.x} ${g.pos.y}) scale(${k})`} className="truth">
                <path d="M-4 -4L4 4M4 -4L-4 4" />
                <text x={6} y={-5}>
                  {g.id}
                </text>
              </g>
            ))}

        {radar && (
          <RadarSymbol x={c.x} y={c.y} k={k} lines={[names ? RADAR.name : null]} selected={sel(radar.id)} onPick={pick(radar.id)} />
        )}

        {layers.tracks &&
          tracks.map((t) => {
            const full = detail || sel(t.id);
            return (
              <TrackSymbol
                key={t.id}
                x={t.props.pos.x}
                y={t.props.pos.y}
                k={k}
                affiliation={t.props.affiliation}
                status={t.props.status}
                lines={[
                  names || sel(t.id) ? t.props.label : null,
                  full
                    ? t.props.speedMps > 0.6
                      ? `${t.props.speedMps.toFixed(1)} m/s ${String(Math.round(t.props.headingDeg)).padStart(3, "0")}°`
                      : "STATIONARY"
                    : null,
                ]}
                selected={sel(t.id)}
                onPick={pick(t.id)}
              />
            );
          })}

        {units.map((u) => {
          const pic = pictures.get(u.id)!;
          return (
            <GroundUnitSymbol
              key={u.id}
              x={pic.pos.x}
              y={pic.pos.y}
              k={k}
              icon={u.props.role === "Assault" ? "infantry" : "recon"}
              echelon={u.props.role === "Assault" ? "squad" : "team"}
              stale={pic.stale}
              lines={[
                u.props.callsign,
                pic.stale ? `NO CONTACT ${ageText(pic.ageMs)}` : detail || sel(u.id) ? pic.status.toUpperCase() : null,
              ]}
              selected={sel(u.id)}
              onPick={pick(u.id)}
            />
          );
        })}

        {platforms.map((p) => (
          <AirSymbol
            key={p.id}
            x={p.props.pos.x}
            y={p.props.pos.y}
            k={k}
            icon={p.props.kind === "UAV" ? "uav" : "rotary"}
            landed={p.props.altitudeFt === 0}
            lines={[
              p.props.callsign,
              detail || sel(p.id) ? (p.props.altitudeFt > 0 ? `${p.props.altitudeFt} FT` : "ON DECK") : null,
            ]}
            selected={sel(p.id)}
            onPick={pick(p.id)}
          />
        ))}

        {flying.map((d) => (
          <AirSymbol
            key={d.id}
            x={d.props.pos.x}
            y={d.props.pos.y}
            k={k}
            icon="fpv"
            lines={[names || sel(d.id) ? d.props.callsign : null, detail || sel(d.id) ? d.props.status.toUpperCase() : null]}
            selected={sel(d.id)}
            onPick={pick(d.id)}
          />
        ))}

        {layers.grid && (
          <g className="grid-labels" fontSize={9 * (1 / v.z)}>
            {gridLabelsX.map((x) => (
              <text key={`gx${x}`} x={x + 3 / v.z} y={vb.y + 11 / v.z}>
                {Math.floor(easting(x) / 100)}
              </text>
            ))}
            {gridLabelsY.map((y) => (
              <text key={`gy${y}`} x={vb.x + 4 / v.z} y={y - 3 / v.z}>
                {Math.floor(northing(y) / 100)}
              </text>
            ))}
          </g>
        )}
      </svg>

      <div className="hud hud-tl">
        <div className="hud-title">{r.props.name} · OBJ FALCON</div>
        <div>GRID 100 M · CI 2 M · {r.props.illumination.toUpperCase()}</div>
      </div>

      <div className="hud hud-tr">
        <div className="hud-buttons">
          <Button size="small" variant="minimal" icon="layers" active={layersOpen} onClick={() => setLayersOpen(!layersOpen)} aria-label="Layers" />
          <Button size="small" variant="minimal" icon="plus" onClick={() => zoomBy(1.4)} aria-label="Zoom in" />
          <Button size="small" variant="minimal" icon="minus" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" />
          <Button size="small" variant="minimal" icon="zoom-to-fit" onClick={() => setView(null)} aria-label="Fit" />
        </div>
        {layersOpen && (
          <div className="layers-panel">
            <div className="section-title">Layers</div>
            {LAYERS.map((l) => (
              <Checkbox
                key={l.key}
                checked={layers[l.key]}
                label={l.label}
                onChange={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="hud hud-bl">
        <div className="mono">
          {cursor ? `${toGrid(cursor)} · EL ${Math.round(heightAt(cursor.x, cursor.y))} M` : "----- ----- · EL --- M"}
        </div>
      </div>

      <div className="hud hud-br">
        <div className="hud-key">
          <span className="key-swatch" style={{ background: IDENTITY.friend }} /> FRD
          <span className="key-swatch" style={{ background: IDENTITY.hostile }} /> HOS
          <span className="key-swatch outline" /> UNK
          <span className="key-swatch" style={{ background: IDENTITY.neutral }} /> NEU
        </div>
        <svg width={20} height={30} viewBox="-10 -16 20 32" className="north">
          <path d="M0 -13L5.5 6L0 2L-5.5 6Z" />
          <text y={15} textAnchor="middle">
            N
          </text>
        </svg>
        <div className="scalebar">
          <div className="scalebar-bar" style={{ width: scaleM * v.z }}>
            <span style={{ width: (scaleM * v.z) / 2 }} />
          </div>
          <div className="scalebar-text">
            0 <span>{scaleM} M</span>
          </div>
        </div>
      </div>
    </div>
  );
}
