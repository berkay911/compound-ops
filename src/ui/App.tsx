import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ButtonGroup,
  Classes,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tag,
} from "@blueprintjs/core";
import { OpsContext, createWorld, useOps, type World } from "./world";
import { ObjectExplorer } from "./ObjectExplorer";
import { MapView } from "./map/MapView";
import { DetailPanel } from "./DetailPanel";
import { EventFeed } from "./EventFeed";
import { PhaseBar } from "./PhaseBar";
import { formatClock, statusIntent } from "./format";
import { region } from "../ontology/queries";

const TICK_MS = 100;
const SPEEDS = [1, 2, 4, 8];

export function App() {
  const [world, setWorld] = useState<World>(() => createWorld());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => world.sim.tick(TICK_MS * speed), TICK_MS);
    return () => clearInterval(timer);
  }, [world, running, speed]);

  const ctx = useMemo(() => ({ world, selectedId, select: setSelectedId }), [world, selectedId]);

  const reset = () => {
    setWorld(createWorld());
    setSelectedId(null);
    setRunning(true);
  };

  return (
    <OpsContext.Provider value={ctx}>
      <div className={`app ${Classes.DARK}`}>
        <div className="banner">UNCLASSIFIED // EXERCISE EXERCISE EXERCISE // FICTIONAL SCENARIO</div>
        <TopBar running={running} setRunning={setRunning} speed={speed} setSpeed={setSpeed} reset={reset} />
        <PhaseBar />
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
        <footer className="pane feed">
          <EventFeed />
        </footer>
        <div className="banner">UNCLASSIFIED // EXERCISE EXERCISE EXERCISE // FICTIONAL SCENARIO</div>
      </div>
    </OpsContext.Provider>
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
    <Navbar className="topbar">
      <NavbarGroup>
        <NavbarHeading className="brand">COMPOUND OPS</NavbarHeading>
        <NavbarDivider />
        <span className="muted">{r.props.name}</span>
        <Tag minimal intent={statusIntent(r.props.missionStatus)} className="ml">
          {r.props.missionStatus}
        </Tag>
      </NavbarGroup>
      <NavbarGroup align="right">
        <span className="clock">{formatClock(store.clockMs)}</span>
        <NavbarDivider />
        <Button
          variant="minimal"
          icon={running ? "pause" : "play"}
          text={running ? "Pause" : "Run"}
          onClick={() => setRunning(!running)}
        />
        <ButtonGroup variant="minimal">
          {SPEEDS.map((s) => (
            <Button key={s} text={`${s}x`} active={speed === s} onClick={() => setSpeed(s)} />
          ))}
        </ButtonGroup>
        <NavbarDivider />
        <Button variant="minimal" icon="reset" text="Reset" onClick={reset} />
      </NavbarGroup>
    </Navbar>
  );
}
