import type { GameEngine } from "@/game/GameEngine.js";
import type { Command } from "./Command.js";

// This is the single switch that maps Command → engine method. It was inline
// in MainThreadCommandDispatcher in Phase 6; Phase 7 moves it here so the
// worker can import it without importing the dispatcher class.
export function applyCommand(engine: GameEngine, command: Command): void {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      break;
    case "input:key":
      // Raw key events are not serialized — Input.ts maps keys to action:*
      // commands locally. Reserved for the worker era if key intents move.
      break;
    case "action:togglePause":
      engine.togglePause();
      break;
    case "action:cycleSpeed":
      if (command.direction === 1) {
        engine.cycleSpeed();
      } else {
        engine.cycleSpeedReverse();
      }
      break;
    case "action:upgradeSelected":
      engine.upgradeSelected();
      break;
    case "action:sellSelected":
      void engine.sellSelected();
      break;
    case "action:executeSell":
      engine.executeSellById(command.towerId);
      break;
    case "action:downgradeSelected":
      engine.downgradeSelected();
      break;
    case "action:specialize":
      engine.specializeSelected(command.variant);
      break;
    case "action:cancelSelected":
      engine.cancelSelected();
      break;
    case "action:setTargeting":
      engine.setTargeting(command.mode);
      break;
    case "action:setFixedAimDir":
      engine.setFixedAimDir(command.dir);
      break;
    case "action:cancelBuildMode":
      engine.cancelBuildMode();
      break;
    // NOTE: action:selectBuildType is intentionally absent — selectedTowerType
    // is host-authoritative (updated directly on gameStore by Input.ts /
    // SvgGameRoot.vue on the main thread, echoed back in the snapshot's
    // meta.selectedTowerType unchanged by the worker). The worker does NOT
    // write selectedTowerType.
    case "action:selectTower":
      // Phase 7 implements selectTowerById (was tech debt in Phase 6).
      engine.selectTowerById(command.towerId);
      break;
    // NOTE: lifecycle:setTheme is intentionally absent — mid-run theme
    // switching is out of scope per README.md. The WorkerEntry message handler
    // retains a defensive no-op "setTheme" case for forward-compat.
    // LLM commands stub to no-op for now — implemented when the commander plane lands.
    case "llm:routeGroup":
    case "llm:setTargeting":
    case "llm:holdFormation":
      // No-op until the commander plane is built (ArchitecturePlan.md §4.3).
      break;
    // init and dispose are lifecycle messages handled by the worker entry
    // (not pushed onto the command queue), but they are part of the Command
    // union so we list them here as no-ops for exhaustiveness.
    case "lifecycle:init":
    case "lifecycle:dispose":
      break;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
    }
  }
}
