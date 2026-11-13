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
export type Confidence = "Low" | "Medium" | "High";
export type ObservationStatus = "New" | "Confirmed" | "Dismissed";
export type PhaseStatus = "Pending" | "Active" | "Complete" | "Aborted";

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
    gates: { name: string; pos: Point }[];
  };
  Structure: {
    name: string;
    floors: number;
    status: StructureStatus;
    threat: ThreatLevel;
    rect: Rect;
    door: Point;
    breachPoint: Point;
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
  Observation: {
    summary: string;
    confidence: Confidence;
    status: ObservationStatus;
    timeMs: number;
    pos: Point;
  };
  Phase: {
    name: string;
    order: number;
    status: PhaseStatus;
    startedAt: number | null;
  };
}

export type ObjectTypeId = keyof PropsByType;

export interface OntObject<T extends ObjectTypeId = ObjectTypeId> {
  type: T;
  id: string;
  props: PropsByType[T];
}

export type PropertyFormat = "text" | "number" | "percent" | "point" | "clock" | "status" | "feet";

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
      { key: "breachPoint", label: "Breach point", format: "point" },
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
      { key: "pos", label: "Position", format: "point" },
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
      { key: "pos", label: "Position", format: "point" },
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
      { key: "pos", label: "Position", format: "point" },
      { key: "waypoint", label: "Waypoint", format: "point" },
    ],
  },
  Observation: {
    id: "Observation",
    displayName: "Observation",
    pluralName: "Observations",
    icon: "eye-open",
    titleKey: "summary",
    properties: [
      { key: "status", label: "Status", format: "status" },
      { key: "confidence", label: "Confidence", format: "status" },
      { key: "timeMs", label: "Time", format: "clock" },
      { key: "pos", label: "Position", format: "point" },
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
    ],
  },
};

export const TYPE_ORDER: ObjectTypeId[] = [
  "Region",
  "Phase",
  "Compound",
  "Structure",
  "LandingZone",
  "Platform",
  "Unit",
  "Observation",
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
  | "observationSource"
  | "observationStructure"
  | "observationLz";

export const LINK_TYPES: Record<LinkTypeId, LinkTypeDef> = {
  regionCompound: { id: "regionCompound", from: "Region", to: "Compound", forwardLabel: "Compounds", reverseLabel: "Region" },
  regionLz: { id: "regionLz", from: "Region", to: "LandingZone", forwardLabel: "Landing zones", reverseLabel: "Region" },
  regionPhase: { id: "regionPhase", from: "Region", to: "Phase", forwardLabel: "Plan phases", reverseLabel: "Region" },
  compoundStructure: { id: "compoundStructure", from: "Compound", to: "Structure", forwardLabel: "Structures", reverseLabel: "Compound" },
  platformCarries: { id: "platformCarries", from: "Platform", to: "Unit", forwardLabel: "Carrying", reverseLabel: "Aboard" },
  platformLz: { id: "platformLz", from: "Platform", to: "LandingZone", forwardLabel: "Assigned LZ", reverseLabel: "Assigned platforms" },
  unitLift: { id: "unitLift", from: "Unit", to: "Platform", forwardLabel: "Lift", reverseLabel: "Lift for" },
  unitObjective: { id: "unitObjective", from: "Unit", to: "Structure", forwardLabel: "Objective", reverseLabel: "Assigned units" },
  observationSource: { id: "observationSource", from: "Observation", to: "Platform", forwardLabel: "Source", reverseLabel: "Observations" },
  observationStructure: { id: "observationStructure", from: "Observation", to: "Structure", forwardLabel: "Concerns", reverseLabel: "Observations" },
  observationLz: { id: "observationLz", from: "Observation", to: "LandingZone", forwardLabel: "Concerns", reverseLabel: "Observations" },
};

export function titleOf(obj: OntObject): string {
  const key = OBJECT_TYPES[obj.type].titleKey;
  return String((obj.props as unknown as Record<string, unknown>)[key]);
}
