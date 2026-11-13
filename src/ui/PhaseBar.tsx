import { Button } from "@blueprintjs/core";
import { useOps } from "./world";
import { phases, region } from "../ontology/queries";
import { ACTIONS } from "../ontology/actions";

const startPhase = ACTIONS.find((a) => a.id === "startPhase")!;
const abortMission = ACTIONS.find((a) => a.id === "abortMission")!;

export function PhaseBar() {
  const { store, select, selectedId } = useOps();
  const r = region(store);
  const abortReason = abortMission.check(store, r, {});

  return (
    <div className="phasebar">
      {phases(store).map((phase) => {
        const startable = startPhase.check(store, phase, {}) === null;
        const label = phase.props.name.replace(/^P\d /, "");
        const state = phase.props.status.toLowerCase();
        return (
          <div
            key={phase.id}
            className={`phase ${state} ${startable ? "startable" : ""} ${selectedId === phase.id ? "selected" : ""}`}
            onClick={() => select(phase.id)}
          >
            <span className="phase-index">{phase.props.order}</span>
            {startable ? (
              <button
                className="phase-go"
                onClick={(e) => {
                  e.stopPropagation();
                  startPhase.apply(store, phase, {});
                }}
              >
                {label}
              </button>
            ) : (
              <span className="phase-name">{label}</span>
            )}
            <span className="phase-state">{phase.props.status === "Pending" ? "" : phase.props.status}</span>
          </div>
        );
      })}
      <Button
        size="small"
        variant="outlined"
        className="abort"
        text="Abort"
        title={abortReason ?? "Pull every element back to its LZ"}
        disabled={abortReason !== null}
        onClick={() => abortMission.apply(store, r, {})}
      />
    </div>
  );
}
