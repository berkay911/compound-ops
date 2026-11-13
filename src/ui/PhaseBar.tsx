import { Button, Icon, Tag, Tooltip } from "@blueprintjs/core";
import { useOps } from "./world";
import { phases, region } from "../ontology/queries";
import { ACTIONS } from "../ontology/actions";
import { statusIntent } from "./format";

const startPhase = ACTIONS.find((a) => a.id === "startPhase")!;
const abortMission = ACTIONS.find((a) => a.id === "abortMission")!;

export function PhaseBar() {
  const { store, select, selectedId } = useOps();
  const r = region(store);
  const abortReason = abortMission.check(store, r, {});

  return (
    <div className="phasebar">
      {phases(store).map((phase, i) => {
        const reason = startPhase.check(store, phase, {});
        return (
          <div key={phase.id} className="phase-wrap">
            {i > 0 && <Icon icon="chevron-right" className="phase-arrow" />}
            <div
              className={`phase ${phase.props.status.toLowerCase()} ${selectedId === phase.id ? "selected" : ""}`}
              onClick={() => select(phase.id)}
            >
              <div className="phase-name">{phase.props.name}</div>
              <Tag minimal intent={statusIntent(phase.props.status)}>
                {phase.props.status}
              </Tag>
              {reason === null && (
                <Button
                  size="small"
                  intent="primary"
                  icon="play"
                  text="Start"
                  onClick={(e) => {
                    e.stopPropagation();
                    startPhase.apply(store, phase, {});
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="spacer" />
      <Tooltip content={abortReason ?? "Pull every element back to its LZ"} placement="bottom">
        <Button
          intent="danger"
          icon="warning-sign"
          text="Abort"
          disabled={abortReason !== null}
          onClick={() => abortMission.apply(store, r, {})}
        />
      </Tooltip>
    </div>
  );
}
