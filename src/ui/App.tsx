import { useEffect, useMemo, useState } from "react";
import { Button, Classes } from "@blueprintjs/core";
import { OpsContext, createWorld, useOps, type World } from "./world";
import { ObjectExplorer } from "./ObjectExplorer";
import { MapView } from "./map/MapView";
import { DetailPanel } from "./DetailPanel";
import { EventFeed } from "./EventFeed";
import { Timeline } from "./Timeline";
import { PhaseBar } from "./PhaseBar";
import { formatClock } from "./format";
import { region } from "../ontology/queries";
import { ACTIONS, type ActionParams } from "../ontology/actions";

const TICK_MS = 100;
const SPEEDS = [1, 2, 4, 8];
const CAPTURE = new URLSearchParams(window.location.search).has("capture");

export function App() {
  const [world, setWorld] = useState<World>(() => createWorld());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(!CAPTURE);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => world.sim.tick(TICK_MS * speed), TICK_MS);
    return () => clearInterval(timer);
  }, [world, running, speed]);

  useEffect(() => {
    if (!CAPTURE) return;
    Object.assign(window, {
      __ops: {
        store: world.store,
        sim: world.sim,
        step: (ms: number) => world.sim.tick(ms),
        select: (id: string | null) => setSelectedId(id),
        act: (id: string, target: string, params: ActionParams = {}) => {
          const action = ACTIONS.find((a) => a.id === id);
          const obj = world.store.get(target);
          if (!action || !obj) return `missing ${id} or ${target}`;
          const reason = action.check(world.store, obj, params);
          if (reason === null) action.apply(world.store, obj, params);
          return reason;
        },
        view: (cx: number, cy: number, zoom: number) =>
          window.dispatchEvent(new CustomEvent("ops:view", { detail: { cx, cy, zoom } })),
      },
    });
  }, [world]);

  const ctx = useMemo(() => ({ world, selectedId, select: setSelectedId }), [world, selectedId]);

  const reset = () => {
    setWorld(createWorld());
    setSelectedId(null);
    setRunning(true);
  };

  return (
    <OpsContext.Provider value={ctx}>
      <div className={`app ${Classes.DARK}`}>
        <div className="banner">UNCLASSIFIED // EXERCISE // FICTIONAL SCENARIO</div>
        <TopBar running={running} setRunning={setRunning} speed={speed} setSpeed={setSpeed} reset={reset} />
        <main className="workspace">
          <aside className="pane explorer">
            <ObjectExplorer />
          </aside>
          <section className="pane map">
            <MapView />
          </section>
          <aside className="pane detail">
            <DetailPanel />
          </aside>
        </main>
        <footer className="pane bottom">
          <Timeline />
          <EventFeed />
        </footer>
      </div>
    </OpsContext.Provider>
  );
}

const weaponsHold = ACTIONS.find((a) => a.id === "weaponsHold")!;
const weaponsFree = ACTIONS.find((a) => a.id === "weaponsFree")!;

function WeaponsSwitch() {
  const { store, select } = useOps();
  const r = region(store);
  const hold = r.props.weapons === "Hold";
  const active = store.list("Engagement").filter((e) => e.props.status === "In flight" || e.props.status === "Holding off").length;
  return (
    <div className={`weapons ${hold ? "hold" : ""}`}>
      <button className="weapons-state" onClick={() => select(r.id)}>
        WEAPONS {hold ? "HOLD" : "FREE"}
        <span className="weapons-sub">{active} in flight</span>
      </button>
      <button
        className="weapons-toggle"
        onClick={() => (hold ? weaponsFree : weaponsHold).apply(store, r, {})}
        title={hold ? "Resume autonomous engagement" : "Stop all engagements and recall drones in flight"}
      >
        {hold ? "Release" : "Hold"}
      </button>
    </div>
  );
}

interface TopBarProps {
  running: boolean;
  setRunning: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  reset: () => void;
}

function TopBar({ running, setRunning, speed, setSpeed, reset }: TopBarProps) {
  const { store } = useOps();
  const r = region(store);
  return (
    <header className="topbar">
      <span className="brand">COMPOUND OPS</span>
      <span className="sep" />
      <span className="crumb">{r.props.name}</span>
      <span className="crumb dim">/</span>
      <span className="crumb">OBJ FALCON</span>
      <span className="mission">{r.props.missionStatus}</span>
      <PhaseBar />
      <WeaponsSwitch />
      <span className="spacer" />
      <span className="clock">{formatClock(store.clockMs)}</span>
      <span className="sep" />
      <Button
        size="small"
        variant="minimal"
        icon={running ? "pause" : "play"}
        onClick={() => setRunning(!running)}
        aria-label={running ? "Pause" : "Run"}
      />
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <Button size="small" variant="minimal" icon="reset" onClick={reset} aria-label="Reset" />
    </header>
  );
}
