import type { Command } from "./Command.js";
import type { ConfirmPayload, PersistStateSlice, SoundName, ThemeBundle, UiEvent } from "./HostBindings.js";
import type { PersistState } from "./PersistState.js";
import type { SimulationSnapshot } from "./SimulationSnapshot.js";

// Worker → Main
export type WorkerToMainMessage =
  | { type: "snapshot"; snapshot: SimulationSnapshot }
  | { type: "playSound"; name: SoundName }
  | { type: "notifyUi"; event: UiEvent }
  | { type: "schedulePersistSave"; state: PersistStateSlice }
  | { type: "requestConfirm"; payload: ConfirmPayload; requestId: number }
  | { type: "workerReady" }
  | { type: "workerError"; message: string; stack?: string };

// Main → Worker
export type MainToWorkerMessage =
  | { type: "init"; persistState: PersistState; themeBundle: ThemeBundle; mapIndex: number; randomMapParams?: unknown }
  | { type: "command"; command: Command }
  | { type: "confirmResult"; requestId: number; confirmed: boolean }
  | { type: "setTheme"; themeBundle: ThemeBundle } // defensive no-op in Phase 7 (mid-run theme switching out of scope)
  | { type: "dispose" };
