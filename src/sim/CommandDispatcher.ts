import type { Command } from "./Command.js";

// The seam every intent flows through. In Phase 6 the dispatcher calls the
// engine directly (synchronously). Phase 7 replaces the main-thread adapter
// with a shim that forwards the command to the worker via postMessage.
export interface CommandDispatcher {
  dispatch(command: Command): void;
}
