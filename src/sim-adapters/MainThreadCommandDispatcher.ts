import type { GameEngine } from "@/game/GameEngine.js";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";

// Main-thread adapter. Lives outside the `src/sim/` boundary so it can reach
// into the engine directly. Phase 7 swaps this for a worker postMessage shim.
// The seam (CommandDispatcher) is identical, so no caller changes.
export class MainThreadCommandDispatcher implements CommandDispatcher {
  private engine: GameEngine;
  private nextCommandId = 1;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  dispatch(command: Command): void {
    if (command.commandId === undefined) {
      (command as { commandId: number }).commandId = this.nextCommandId++;
    }
    applyCommand(this.engine, command);
  }
}

function applyCommand(engine: GameEngine, command: Command): void {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      break;
    case "input:key":
      // Phase 6: raw key events are not serialized — Input.ts maps keys to
      // action:* commands locally. Reserved for the worker era (Phase 7+),
      // when the host sends key intents over the boundary.
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
    case "action:selectTower":
      // PROMINENT TECH DEBT — Phase 6 no-op. Phase 7 implements
      // engine.selectTowerById(id) and wires this case. For Phase 6 the
      // gameStore.selectTower calls in Input.ts / SvgGameRoot.vue stay direct.
      break;
    case "lifecycle:init":
    case "lifecycle:dispose":
      // Phase 6: engine lifecycle is owned by SvgGameRoot directly; the
      // worker-era lifecycle commands are no-ops on the main thread.
      break;
    case "llm:routeGroup":
    case "llm:setTargeting":
    case "llm:holdFormation":
      // Phase 6: LLM commands are not wired; reserved for the commander plane.
      break;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
    }
  }
}
