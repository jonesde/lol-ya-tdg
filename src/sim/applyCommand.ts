import { GameState } from "@/game/Constants.js";
import type { TowerId } from "@/game/ConstantsTower.js";
import type { GameEngine } from "@/game/GameEngine.js";
import { setGameState } from "@/sim/GameRunState.js";
import type { Command } from "./Command.js";

// This is the single switch that maps Command → engine method. It is shared by
// the worker (WorkerEntry) and both command dispatchers (WorkerCommandDispatcher
// on the main thread, the legacy MainThreadCommandDispatcher) so the command→
// engine logic lives in exactly one place.
// Applies a command to the engine. Returns true if the command mutated visible
// runState/persistState (so the worker knows it must post a snapshot even while
// paused), false for pure no-ops. Every command that touches runState/persistState
// returns true; only reserved/forward-compat stubs return false.
export function applyCommand(engine: GameEngine, command: Command): boolean {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      return true;
    case "input:key":
      // Raw key events are not serialized — Input.ts maps keys to action:*
      // commands locally. Reserved for the worker era if key intents move.
      return false;
    case "action:togglePause":
      engine.togglePause();
      return true;
    case "action:cycleSpeed":
      if (command.direction === 1) {
        engine.cycleSpeed();
      } else {
        engine.cycleSpeedReverse();
      }
      return true;
    case "action:upgradeSelected":
      engine.upgradeSelected();
      return true;
    case "action:sellSelected":
      void engine.sellSelected();
      return true;
    case "action:executeSell":
      engine.executeSellById(command.towerId);
      return true;
    case "action:downgradeSelected":
      engine.downgradeSelected();
      return true;
    case "action:specialize":
      engine.specializeSelected(command.variant);
      return true;
    case "action:cancelSelected":
      engine.cancelSelected();
      return true;
    case "action:setTargeting":
      engine.setTargeting(command.mode);
      return true;
    case "action:setFixedAimDir":
      engine.setFixedAimDir(command.dir);
      return true;
    case "action:cancelBuildMode":
      engine.cancelBuildMode();
      return true;
    case "action:selectBuildType":
      // The worker is authoritative for runState.selectedTowerType; the main thread
      // sets gameStore.selectedTowerType for the local build preview and dispatches
      // this command so the worker can place towers on input:click. Fix #1.
      engine.runState.selectedTowerType = command.towerType as TowerId | null;
      return true;
    case "action:selectTower":
      // Phase 7 implements selectTowerById (was tech debt in Phase 6).
      engine.selectTowerById(command.towerId);
      return true;
    case "action:debugEndRun":
      // Test-only hook: force a terminal state so worker-roundtrip tests can
      // assert the final-snapshot + stopLoop path deterministically.
      setGameState(engine.runState, command.victory === false ? GameState.GAME_OVER : GameState.VICTORY);
      return true;
    // NOTE: lifecycle:setTheme is intentionally absent — mid-run theme
    // switching is out of scope per README.md. The WorkerEntry message handler
    // retains a defensive no-op "setTheme" case for forward-compat.
    // LLM commands stub to no-op for now — implemented when the commander plane lands.
    case "llm:routeGroup":
    case "llm:setTargeting":
    case "llm:holdFormation":
      // No-op until the commander plane is built (ArchitecturePlan.md §4.3).
      return false;
    // init and dispose are lifecycle messages handled by the worker entry
    // (not pushed onto the command queue), but they are part of the Command
    // union so we list them here as no-ops for exhaustiveness.
    case "lifecycle:init":
    case "lifecycle:dispose":
      return false;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      return false;
    }
  }
}
