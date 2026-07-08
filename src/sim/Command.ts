import type { ThemeBundle } from "./HostBindings.js";
import type { PersistState } from "./PersistState.js";

// Discriminated union. Every intent flowing into the simulation is one of
// these. The worker drains a queue of these at the start of each tick.
//
// The commandId is echoed back in the snapshot as lastAppliedCommandId so
// the host can detect confirmation or rejection. It is a monotonic number
// assigned by the host dispatcher.
export type Command =
  // ---- Input events (low-level, from Input.ts and SvgGameRoot click handlers) ----
  | { commandId: number; type: "input:click"; worldX: number; worldY: number }
  | { commandId: number; type: "input:key"; key: string; direction: "down" | "up" }
  // NOTE: hover is NOT a command — it's main-thread-only UI state (see §6.2 of ArchitecturePlan.md)
  // NOTE: selectBuildType is NOT a command — `selectedTowerType` is host-authoritative
  //   (updated directly on gameStore by Input.ts/SvgGameRoot.vue, echoed back in the
  //   snapshot's meta.selectedTowerType unchanged by the worker). See §6.2 of ArchitecturePlan.md.

  // ---- High-level actions (wrapping GameEngine public methods) ----
  | { commandId: number; type: "action:togglePause" }
  | { commandId: number; type: "action:cycleSpeed"; direction: 1 | -1 }
  | { commandId: number; type: "action:upgradeSelected" }
  | { commandId: number; type: "action:sellSelected" } // triggers confirm via host
  | { commandId: number; type: "action:executeSell"; towerId: string } // post-confirm
  | { commandId: number; type: "action:downgradeSelected" }
  | { commandId: number; type: "action:specialize"; variant: "A" | "B" }
  | { commandId: number; type: "action:cancelSelected" }
  | { commandId: number; type: "action:setTargeting"; mode: string }
  | { commandId: number; type: "action:setFixedAimDir"; dir: "N" | "E" | "S" | "W" | null }
  | { commandId: number; type: "action:cancelBuildMode" }
  // @tech-debt PHASE 6 STUB — this command variant is DEFINED in the schema
  // here in Phase 5 but is NOT DISPATCHED by Phase 6's applyCommand (it's a
  // no-op `break` there). Phase 7 implements engine.selectTowerById(id) and
  // wires this case. For Phase 6, the existing gameStore.selectTower(tower)
  // calls in Input.ts and SvgGameRoot.vue stay direct (not via the dispatcher).
  | { commandId: number; type: "action:selectTower"; towerId: string | null }

  // ---- Lifecycle ----
  | {
      commandId: number;
      type: "lifecycle:init";
      persistState: PersistState;
      themeBundle: ThemeBundle;
      mapIndex: number;
      randomMapParams?: unknown;
    }
  | { commandId: number; type: "lifecycle:dispose" }

  // ---- Future LLM commands (stubs — implementations deferred to commander plane) ----
  | { commandId: number; type: "llm:routeGroup"; groupId: string; waypoints: Array<{ x: number; y: number }> }
  | { commandId: number; type: "llm:setTargeting"; enemyIds: string[]; mode: string }
  | { commandId: number; type: "llm:holdFormation"; groupId: string; chokepointId: string; untilWave: number };
