import { createContext, useContext, useSyncExternalStore } from "react";
import { OntologyStore } from "../ontology/store";
import { Simulator } from "../sim/simulator";
import { loadScenario } from "../sim/scenario";

export interface World {
  store: OntologyStore;
  sim: Simulator;
}

export function createWorld(): World {
  const store = new OntologyStore();
  loadScenario(store);
  return { store, sim: new Simulator(store) };
}

export interface OpsContextValue {
  world: World;
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const OpsContext = createContext<OpsContextValue | null>(null);

export function useOps(): OpsContextValue & { store: OntologyStore; version: number } {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error("useOps outside OpsContext");
  const { store } = ctx.world;
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  return { ...ctx, store, version };
}
