import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";

// A NON-reactive, module-level dispatch seam shared by Vue components that need
// to send intents to the simulation. The active dispatcher (a
// WorkerCommandDispatcher wrapping the worker) is registered once by
// SvgGameRoot.vue on mount. Components call dispatchCommand(...) instead of
// reaching into the old game-store engine field (which no longer exists in
// Phase 7+).
//
// IMPORTANT: this module must NOT import Pinia stores or any @/stores/* — it is
// imported by src/sim and consumed from components, and keeping it store-free
// preserves the sim/main-thread boundary. It holds only a runtime reference to
// the dispatcher object, which is fine.
let activeDispatcher: CommandDispatcher | null = null;
let nextBusCommandId = 1;

export function setCommandDispatcher(dispatcher: CommandDispatcher | null): void {
  activeDispatcher = dispatcher;
}

export function dispatchCommand(command: Command): void {
  // A commandId of 0 (or absent) is treated as "unassigned" — the dispatcher
  // reassigns a fresh monotonic id so the worker can correlate confirmations.
  if (command.commandId === undefined || command.commandId <= 0) {
    (command as { commandId: number }).commandId = nextBusCommandId++;
  }
  activeDispatcher?.dispatch(command);
}
