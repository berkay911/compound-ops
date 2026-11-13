import type { ObjectTypeId, OntObject } from "./schema";
import type { OntologyStore } from "./store";
import {
  PHASE,
  alternateLz,
  dist,
  missionOver,
  phaseByOrder,
  phases,
  region,
} from "./queries";

export type ActionIntent = "primary" | "success" | "warning" | "danger" | "none";

export interface ActionParam {
  key: string;
  label: string;
  objectType: ObjectTypeId;
  filter?: (store: OntologyStore, candidate: OntObject) => boolean;
}

export type ActionParams = Record<string, string | undefined>;

export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  intent: ActionIntent;
  appliesTo: ObjectTypeId;
  params: ActionParam[];
  check(store: OntologyStore, target: OntObject, params: ActionParams): string | null;
  apply(store: OntologyStore, target: OntObject, params: ActionParams): void;
}

interface TypedActionDef<T extends ObjectTypeId> extends Omit<ActionDef, "appliesTo" | "check" | "apply" | "params"> {
  appliesTo: T;
  params?: ActionParam[];
  check(store: OntologyStore, target: OntObject<T>, params: ActionParams): string | null;
  apply(store: OntologyStore, target: OntObject<T>, params: ActionParams): void;
}

function defineAction<T extends ObjectTypeId>(def: TypedActionDef<T>): ActionDef {
  return { ...def, params: def.params ?? [] } as unknown as ActionDef;
}

const startPhase = defineAction({
  id: "startPhase",
  label: "Start phase",
  icon: "play",
  intent: "primary",
  appliesTo: "Phase",
  check(store, phase) {
    if (missionOver(store)) return "Mission is over";
    if (phase.props.status !== "Pending") return `Phase is ${phase.props.status.toLowerCase()}`;
    const blocking = phases(store).find((p) => p.props.order < phase.props.order && p.props.status !== "Complete");
    if (blocking) return `${blocking.props.name} is not complete`;
    return null;
  },
  apply(store, phase) {
    store.update(phase, { status: "Active", startedAt: store.clockMs });
    store.update(region(store), { missionStatus: "In progress" });
    store.log("action", `${phase.props.name} started`, [phase.id]);
  },
});

const abortMission = defineAction({
  id: "abortMission",
  label: "Abort mission",
  icon: "warning-sign",
  intent: "danger",
  appliesTo: "Region",
  check(store, r) {
    if (r.props.missionStatus !== "In progress") return "No mission in progress";
    const exfil = phaseByOrder(store, PHASE.EXFIL);
    if (exfil && exfil.props.status !== "Pending") return "Exfil already under way";
    return null;
  },
  apply(store, r) {
    for (const p of phases(store)) {
      if (p.props.order < PHASE.EXFIL && p.props.status !== "Complete") {
        store.update(p, { status: "Aborted", endedAt: p.props.startedAt === null ? null : store.clockMs });
      }
    }
    const exfil = phaseByOrder(store, PHASE.EXFIL);
    if (exfil) store.update(exfil, { status: "Active", startedAt: store.clockMs });
    store.log("warning", "ABORT called. All elements exfil to assigned LZs.", [r.id]);
  },
});

const setWeapons = (weapons: "Free" | "Hold") =>
  defineAction({
    id: weapons === "Hold" ? "weaponsHold" : "weaponsFree",
    label: weapons === "Hold" ? "Weapons hold" : "Weapons free",
    icon: weapons === "Hold" ? "hand" : "locate",
    intent: weapons === "Hold" ? "warning" : "none",
    appliesTo: "Region",
    check(_store, r) {
      return r.props.weapons === weapons ? `Weapons already ${weapons.toLowerCase()}` : null;
    },
    apply(store, r) {
      store.update(r, { weapons });
      store.log(
        "action",
        weapons === "Hold"
          ? "WEAPONS HOLD. No new engagements; drones in flight break off."
          : "WEAPONS FREE. Autonomous engagement of hostile tracks resumed.",
        [r.id],
        "fires",
      );
    },
  });

const markLzRisky = defineAction({
  id: "markLzRisky",
  label: "Mark risky",
  icon: "error",
  intent: "warning",
  appliesTo: "LandingZone",
  check(_store, lz) {
    if (lz.props.status !== "Suitable") return "Already marked risky";
    return null;
  },
  apply(store, lz) {
    store.update(lz, { status: "Risky" });
    store.log("action", `${lz.props.name} marked risky`, [lz.id]);

    const alt = alternateLz(store, lz);
    for (const platform of store.linked<"Platform">(lz.id, "platformLz", "reverse")) {
      if (platform.props.status === "Landed") {
        store.log("warning", `${platform.props.callsign} is on the ground at ${lz.props.name}`, [platform.id, lz.id]);
      }
      if (!alt) {
        store.log("warning", `No alternate LZ for ${platform.props.callsign}`, [platform.id]);
        continue;
      }
      store.unlink("platformLz", platform.id);
      store.link("platformLz", platform.id, alt.id);
      store.log("system", `${platform.props.callsign} diverted to ${alt.props.name}`, [platform.id, alt.id]);
    }
  },
});

const markLzSuitable = defineAction({
  id: "markLzSuitable",
  label: "Mark suitable",
  icon: "endorsed",
  intent: "success",
  appliesTo: "LandingZone",
  check(_store, lz) {
    if (lz.props.status !== "Risky") return "Already suitable";
    return null;
  },
  apply(store, lz) {
    store.update(lz, { status: "Suitable" });
    store.log("action", `${lz.props.name} marked suitable`, [lz.id]);
  },
});

const classifyTrack = (affiliation: "Hostile" | "Neutral") =>
  defineAction({
    id: affiliation === "Hostile" ? "classifyHostile" : "classifyNeutral",
    label: affiliation === "Hostile" ? "Classify hostile" : "Classify neutral",
    icon: affiliation === "Hostile" ? "warning-sign" : "shield",
    intent: affiliation === "Hostile" ? "danger" : "success",
    appliesTo: "Track",
    check(_store, t) {
      if (t.props.affiliation === affiliation) return `Already ${affiliation.toLowerCase()}`;
      if (t.props.status === "Tentative") return "Track is not confirmed yet";
      return null;
    },
    apply(store, t) {
      store.update(t, { affiliation, classifiedBy: "Operator", assessment: "Operator classification" });
      store.log("action", `${t.props.label} classified ${affiliation.toUpperCase()}`, [t.id]);
      if (affiliation !== "Hostile") return;
      for (const s of store.linked<"Structure">(t.id, "trackStructure")) {
        if (s.props.threat !== "Confirmed" && s.props.status !== "Cleared") {
          store.update(s, { threat: "Confirmed" });
          store.log("system", `${s.props.name} threat raised to CONFIRMED by ${t.props.label}`, [s.id, t.id]);
        }
      }
      for (const lz of store.list("LandingZone")) {
        const d = dist(t.props.pos, lz.props.pos);
        if (d < 300 && lz.props.status === "Suitable") {
          store.log("warning", `Hostile ${t.props.label} is ${Math.round(d)} m from ${lz.props.name}`, [t.id, lz.id]);
        }
      }
    },
  });

export const ACTIONS: ActionDef[] = [
  startPhase,
  abortMission,
  setWeapons("Hold"),
  setWeapons("Free"),
  markLzRisky,
  markLzSuitable,
  classifyTrack("Hostile"),
  classifyTrack("Neutral"),
];

export function actionsFor(type: ObjectTypeId): ActionDef[] {
  return ACTIONS.filter((a) => a.appliesTo === type);
}
