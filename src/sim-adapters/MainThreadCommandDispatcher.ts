import type { GameEngine } from "@/game/GameEngine.js";
import { applyCommand } from "@/sim/applyCommand.js";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";

// Main-thread adapter. Lives outside the `src/sim/` boundary so it can reach
// into the engine directly. Phase 7 swaps this for a worker postMessage shim
// (WorkerCommandDispatcher). The seam (CommandDispatcher) is identical, so no
// caller changes. The command→engine switch lives in src/sim/applyCommand.ts
// so both the worker and this adapter share one implementation.
export class MainThreadCommandDispatcher implements CommandDispatcher {
  private targetEngine: GameEngine;

  constructor(engine: GameEngine) {
    this.targetEngine = engine;
  }

  dispatch(command: Command): void {
    applyCommand(this.targetEngine, command);
  }
}
