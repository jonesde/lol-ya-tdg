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
  // NOTE: hover is NOT a command — it's main-thread-only UI state (see §6.2 of ArchitecturePlan.md).
  // NOTE: selectBuildType IS a command (action:selectBuildType) — the main thread sets
  //   gameStore.selectedTowerType for the local build preview AND dispatches this command so the
  //   worker learns the active build type (the worker needs it to place towers on input:click).
  //   The worker is authoritative for runState.selectedTowerType; the snapshot mirrors it back
  //   into gameStore so build mode clears on off-grid / existing-tower clicks. See fix #1.

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
  | { commandId: number; type: "action:selectBuildType"; towerType: string | null }
  // action:selectTower is implemented (Phase 7) via engine.selectTowerById; it is dispatched
  // by Input.ts / SvgGameRoot.vue for keyboard and click tower selection.
  | { commandId: number; type: "action:selectTower"; towerId: string | null }
  // action:debugEndRun is a test-only hook used by worker-roundtrip tests to
  // drive the engine to a terminal state deterministically (there is no
  // production path to force VICTORY/GAME_OVER). It transitions runState and
  // returns true so the worker's terminal branch posts exactly one final snapshot.
  | { commandId: number; type: "action:debugEndRun"; victory?: boolean }

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
