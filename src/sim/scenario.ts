// Fictional scenario. All names, places and coordinates are invented; the map
// is an abstract 1000 x 700 grid.

import type { OntologyStore } from "../ontology/store";

export const MAP = { width: 1000, height: 700 } as const;

export function loadScenario(store: OntologyStore): void {
  const region = store.add("Region", "region-granite", {
    name: "AO GRANITE",
    weather: "Clear, wind 6 kt",
    illumination: "Night, 12% moon",
    missionStatus: "Planning",
    fob: { x: 50, y: 650 },
    holdingArea: { x: 190, y: 640 },
  });

  // ---- plan -----------------------------------------------------------------
  const phaseNames = ["Infil", "Approach", "Assault", "Exfil"];
  phaseNames.forEach((name, i) => {
    const id = `phase-${i + 1}`;
    store.add("Phase", id, { name: `P${i + 1} ${name}`, order: i + 1, status: "Pending", startedAt: null });
    store.link("regionPhase", region.id, id);
  });

  // ---- objective --------------------------------------------------------------
  const compound = store.add("Compound", "obj-falcon", {
    name: "OBJ FALCON",
    status: "Unknown",
    wall: [
      { x: 520, y: 245 },
      { x: 735, y: 238 },
      { x: 742, y: 428 },
      { x: 526, y: 434 },
    ],
    gates: [
      { name: "North gate", pos: { x: 630, y: 241 } },
      { name: "South gate", pos: { x: 634, y: 431 } },
      { name: "West gate", pos: { x: 523, y: 340 } },
    ],
  });
  store.link("regionCompound", region.id, compound.id);

  const structures = [
    {
      id: "b1",
      name: "B1 Main house",
      floors: 2,
      rect: { x: 585, y: 268, w: 95, h: 60 },
      door: { x: 632, y: 332 },
      breachPoint: { x: 634, y: 452 },
    },
    {
      id: "b2",
      name: "B2 Guest house",
      floors: 1,
      rect: { x: 545, y: 360, w: 55, h: 45 },
      door: { x: 604, y: 382 },
      breachPoint: { x: 500, y: 340 },
    },
    {
      id: "b3",
      name: "B3 Storage",
      floors: 1,
      rect: { x: 680, y: 352, w: 45, h: 55 },
      door: { x: 676, y: 380 },
      breachPoint: { x: 660, y: 452 },
    },
    {
      id: "b4",
      name: "B4 Guard post",
      floors: 1,
      rect: { x: 698, y: 255, w: 26, h: 26 },
      door: { x: 711, y: 285 },
      breachPoint: { x: 640, y: 220 },
    },
  ];
  for (const s of structures) {
    store.add("Structure", s.id, {
      name: s.name,
      floors: s.floors,
      status: "Uncleared",
      threat: "None",
      rect: s.rect,
      door: s.door,
      breachPoint: s.breachPoint,
      clearingSince: null,
    });
    store.link("compoundStructure", compound.id, s.id);
  }

  // ---- landing zones ----------------------------------------------------------
  store.add("LandingZone", "hlz-raven", { name: "HLZ RAVEN", role: "Primary", status: "Suitable", pos: { x: 400, y: 540 } });
  store.add("LandingZone", "hlz-crow", { name: "HLZ CROW", role: "Alternate", status: "Suitable", pos: { x: 860, y: 150 } });
  store.link("regionLz", region.id, "hlz-raven");
  store.link("regionLz", region.id, "hlz-crow");

  // ---- platforms ----------------------------------------------------------------
  const fob = region.props.fob;
  store.add("Platform", "dusty-1", {
    callsign: "DUSTY-1",
    kind: "Helicopter",
    status: "Staged",
    fuel: 100,
    altitudeFt: 0,
    pos: { x: fob.x, y: fob.y - 12 },
    waypoint: null,
    landedAt: null,
  });
  store.add("Platform", "dusty-2", {
    callsign: "DUSTY-2",
    kind: "Helicopter",
    status: "Staged",
    fuel: 100,
    altitudeFt: 0,
    pos: { x: fob.x + 14, y: fob.y + 10 },
    waypoint: null,
    landedAt: null,
  });
  store.add("Platform", "overwatch-1", {
    callsign: "OVERWATCH-1",
    kind: "UAV",
    status: "On station",
    fuel: 82,
    altitudeFt: 9500,
    pos: { x: 630, y: 165 },
    waypoint: null,
    landedAt: null,
  });
  store.link("platformLz", "dusty-1", "hlz-raven");
  store.link("platformLz", "dusty-2", "hlz-raven");

  // ---- units --------------------------------------------------------------------
  const units = [
    { id: "alpha", callsign: "ALPHA", role: "Assault" as const, personnel: 8, lift: "dusty-1", objective: "b1" },
    { id: "bravo", callsign: "BRAVO", role: "Assault" as const, personnel: 8, lift: "dusty-2", objective: "b2" },
    { id: "echo", callsign: "ECHO", role: "Overwatch" as const, personnel: 2, lift: "dusty-2", objective: null },
  ];
  for (const u of units) {
    const lift = store.getAs("Platform", u.lift);
    store.add("Unit", u.id, {
      callsign: u.callsign,
      role: u.role,
      personnel: u.personnel,
      status: "Embarked",
      pos: { ...lift.props.pos },
      waypoint: null,
      overwatchPos: u.role === "Overwatch" ? { x: 470, y: 205 } : null,
    });
    store.link("unitLift", u.id, u.lift);
    store.link("platformCarries", u.lift, u.id);
    if (u.objective) store.link("unitObjective", u.id, u.objective);
  }

  store.log("system", "Scenario loaded: AO GRANITE / OBJ FALCON. Start P1 Infil when ready.", [region.id]);
}
