export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Gate {
  name: string;
  pos: Point;
  outer: Point;
  inner: Point;
}

export type MissionStatus = "Planning" | "In progress" | "Complete" | "Aborted";
export type CompoundStatus = "Unknown" | "Contested" | "Secured";
export type StructureStatus = "Uncleared" | "Clearing" | "Clear reported" | "Cleared";
export type ThreatLevel = "None" | "Possible" | "Confirmed";
export type LzStatus = "Suitable" | "Risky";
export type UnitRole = "Assault" | "Overwatch";
export type UnitStatus =
  | "Staged"
  | "Embarked"
  | "On ground"
  | "Moving"
  | "In position"
  | "Assaulting"
  | "Holding"
  | "Extracted";
export type PlatformKind = "Helicopter" | "UAV";
export type PlatformStatus =
  | "Staged"
  | "Inbound"
  | "Landed"
  | "Holding"
  | "Egress"
  | "RTB complete"
  | "On station";
export type PhaseStatus = "Pending" | "Active" | "Complete" | "Aborted";
export type SensorKind = "Ground radar" | "EO/IR";
export type TrackStatus = "Tentative" | "Confirmed" | "Coasting";
export type Affiliation = "Unknown" | "Hostile" | "Neutral";

export interface PropsByType {
  Region: {
    name: string;
    weather: string;
    illumination: string;
    missionStatus: MissionStatus;
    fob: Point;
    holdingArea: Point;
  };
  Compound: {
    name: string;
    status: CompoundStatus;
    wall: Point[];
    gates: Gate[];
  };
  Structure: {
    name: string;
    floors: number;
    status: StructureStatus;
    threat: ThreatLevel;
    rect: Rect;
    door: Point;
    clearingSince: number | null;
  };
  LandingZone: {
    name: string;
    role: "Primary" | "Alternate";
    status: LzStatus;
    pos: Point;
  };
  Unit: {
    callsign: string;
    role: UnitRole;
    personnel: number;
    status: UnitStatus;
    pos: Point;
    waypoint: Point | null;
    overwatchPos: Point | null;
    entryGate: string | null;
    route: Point[];
    routeGoal: Point | null;
  };
  Platform: {
    callsign: string;
    kind: PlatformKind;
    status: PlatformStatus;
    fuel: number;
    altitudeFt: number;
    pos: Point;
    waypoint: Point | null;
    landedAt: number | null;
  };
  Phase: {
    name: string;
    order: number;
    status: PhaseStatus;
    startedAt: number | null;
    endedAt: number | null;
  };
  Sensor: {
    name: string;
    kind: SensorKind;
    status: "Operational" | "Degraded";
    pos: Point;
    rangeM: number;
    scanPeriodS: number;
    accuracy: string;
    sweepDeg: number | null;
    footprint: { center: Point; radius: number } | null;
  };
  Detection: {
    label: string;
    sensorName: string;
    timeMs: number;
    pos: Point;
    rangeM: number | null;
    bearingDeg: number | null;
  };
  Track: {
    label: string;
    status: TrackStatus;
    affiliation: Affiliation;
    pos: Point;
    vel: Point;
    speedMps: number;
    sigmaVel: number;
    headingDeg: number;
    sigmaMajor: number;
    sigmaMinor: number;
    ellipseDeg: number;
    hits: number;
    maneuverProb: number;
    sources: string;
    initiatedMs: number;
    lastUpdateMs: number;
    history: Point[];
  };
}

export type ObjectTypeId = keyof PropsByType;

export interface OntObject<T extends ObjectTypeId = ObjectTypeId> {
  type: T;
  id: string;
  props: PropsByType[T];
}

export type PropertyFormat =
  | "text"
  | "number"
  | "percent"
  | "point"
  | "clock"
  | "status"
  | "feet"
  | "meters"
  | "mps"
  | "deg"
  | "prob";

export interface PropertyDef {
  key: string;
  label: string;
  format: PropertyFormat;
}

export interface ObjectTypeDef {
  id: ObjectTypeId;
  displayName: string;
  pluralName: string;
  icon: string;
  titleKey: string;
  properties: PropertyDef[];
}

export const OBJECT_TYPES: Record<ObjectTypeId, ObjectTypeDef> = {
  Region: {
    id: "Region",
    displayName: "Region",
    pluralName: "Regions",
    icon: "globe",
    titleKey: "name",
    properties: [
      { key: "missionStatus", label: "Mission", format: "status" },
      { key: "weather", label: "Weather", format: "text" },
      { key: "illumination", label: "Illumination", format: "text" },
      { key: "fob", label: "FOB", format: "point" },
    ],
  },
  Compound: {
    id: "Compound",
    displayName: "Compound",
    pluralName: "Compounds",
    icon: "office",
    titleKey: "name",
    properties: [{ key: "status", label: "Status", format: "status" }],
  },
  Structure: {
    id: "Structure",
    displayName: "Structure",
    pluralName: "Structures",
    icon: "home",
    titleKey: "name",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "threat", label: "Threat", format: "status" },
      { key: "floors", label: "Floors", format: "number" },
      { key: "door", label: "Door", format: "point" },
    ],
  },
  LandingZone: {
    id: "LandingZone",
    displayName: "Landing zone",
    pluralName: "Landing zones",
    icon: "locate",
    titleKey: "name",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "role", label: "Role", format: "text" },
      { key: "pos", label: "Grid", format: "point" },
    ],
  },
  Unit: {
    id: "Unit",
    displayName: "Unit",
    pluralName: "Units",
    icon: "people",
    titleKey: "callsign",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "role", label: "Role", format: "text" },
      { key: "personnel", label: "Personnel", format: "number" },
      { key: "entryGate", label: "Entry gate", format: "text" },
      { key: "pos", label: "Grid", format: "point" },
      { key: "waypoint", label: "Waypoint", format: "point" },
    ],
  },
  Platform: {
    id: "Platform",
    displayName: "Platform",
    pluralName: "Platforms",
    icon: "airplane",
    titleKey: "callsign",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "kind", label: "Kind", format: "text" },
      { key: "fuel", label: "Fuel", format: "percent" },
      { key: "altitudeFt", label: "Altitude", format: "feet" },
      { key: "pos", label: "Grid", format: "point" },
      { key: "waypoint", label: "Waypoint", format: "point" },
    ],
  },
  Phase: {
    id: "Phase",
    displayName: "Phase",
    pluralName: "Phases",
    icon: "flow-linear",
    titleKey: "name",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "order", label: "Order", format: "number" },
      { key: "startedAt", label: "Started", format: "clock" },
      { key: "endedAt", label: "Ended", format: "clock" },
    ],
  },
  Sensor: {
    id: "Sensor",
    displayName: "Sensor",
    pluralName: "Sensors",
    icon: "satellite",
    titleKey: "name",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "kind", label: "Kind", format: "text" },
      { key: "accuracy", label: "Accuracy", format: "text" },
      { key: "rangeM", label: "Range", format: "meters" },
      { key: "scanPeriodS", label: "Revisit", format: "number" },
      { key: "pos", label: "Grid", format: "point" },
    ],
  },
  Detection: {
    id: "Detection",
    displayName: "Detection",
    pluralName: "Detections",
    icon: "flash",
    titleKey: "label",
    properties: [
      { key: "sensorName", label: "Sensor", format: "text" },
      { key: "timeMs", label: "Time", format: "clock" },
      { key: "pos", label: "Grid", format: "point" },
      { key: "rangeM", label: "Range", format: "meters" },
      { key: "bearingDeg", label: "Bearing", format: "deg" },
    ],
  },
  Track: {
    id: "Track",
    displayName: "Track",
    pluralName: "Tracks",
    icon: "path-search",
    titleKey: "label",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "affiliation", label: "Affiliation", format: "status" },
      { key: "pos", label: "Grid", format: "point" },
      { key: "speedMps", label: "Speed", format: "mps" },
      { key: "sigmaVel", label: "1σ velocity", format: "mps" },
      { key: "headingDeg", label: "Heading", format: "deg" },
      { key: "sigmaMajor", label: "1σ major", format: "meters" },
      { key: "sigmaMinor", label: "1σ minor", format: "meters" },
      { key: "maneuverProb", label: "IMM maneuver", format: "prob" },
      { key: "hits", label: "Updates", format: "number" },
      { key: "sources", label: "Sources", format: "text" },
      { key: "lastUpdateMs", label: "Last update", format: "clock" },
    ],
  },
};

export const TYPE_ORDER: ObjectTypeId[] = [
  "Region",
  "Phase",
  "Track",
  "Sensor",
  "Compound",
  "Structure",
  "LandingZone",
  "Platform",
  "Unit",
];

export interface LinkTypeDef {
  id: LinkTypeId;
  from: ObjectTypeId;
  to: ObjectTypeId;
  forwardLabel: string;
  reverseLabel: string;
}

export type LinkTypeId =
  | "regionCompound"
  | "regionLz"
  | "regionPhase"
  | "compoundStructure"
  | "platformCarries"
  | "platformLz"
  | "unitLift"
  | "unitObjective"
  | "sensorPlatform"
  | "detectionSensor"
  | "trackDetection"
  | "trackStructure";

export const LINK_TYPES: Record<LinkTypeId, LinkTypeDef> = {
  regionCompound: { id: "regionCompound", from: "Region", to: "Compound", forwardLabel: "Compounds", reverseLabel: "Region" },
  regionLz: { id: "regionLz", from: "Region", to: "LandingZone", forwardLabel: "Landing zones", reverseLabel: "Region" },
  regionPhase: { id: "regionPhase", from: "Region", to: "Phase", forwardLabel: "Plan phases", reverseLabel: "Region" },
  compoundStructure: { id: "compoundStructure", from: "Compound", to: "Structure", forwardLabel: "Structures", reverseLabel: "Compound" },
  platformCarries: { id: "platformCarries", from: "Platform", to: "Unit", forwardLabel: "Carrying", reverseLabel: "Aboard" },
  platformLz: { id: "platformLz", from: "Platform", to: "LandingZone", forwardLabel: "Assigned LZ", reverseLabel: "Assigned platforms" },
  unitLift: { id: "unitLift", from: "Unit", to: "Platform", forwardLabel: "Lift", reverseLabel: "Lift for" },
  unitObjective: { id: "unitObjective", from: "Unit", to: "Structure", forwardLabel: "Objective", reverseLabel: "Assigned units" },
  sensorPlatform: { id: "sensorPlatform", from: "Sensor", to: "Platform", forwardLabel: "Mounted on", reverseLabel: "Sensors" },
  detectionSensor: { id: "detectionSensor", from: "Detection", to: "Sensor", forwardLabel: "Sensor", reverseLabel: "Recent detections" },
  trackDetection: { id: "trackDetection", from: "Track", to: "Detection", forwardLabel: "Supporting detections", reverseLabel: "Track" },
  trackStructure: { id: "trackStructure", from: "Track", to: "Structure", forwardLabel: "Located at", reverseLabel: "Tracks" },
};

export function titleOf(obj: OntObject): string {
  const key = OBJECT_TYPES[obj.type].titleKey;
  return String((obj.props as unknown as Record<string, unknown>)[key]);
}
