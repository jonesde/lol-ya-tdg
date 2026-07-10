import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "./brain.js";
import { createBrain } from "./brain.js";
import type { CommanderObservation } from "./observation.js";
import { buildObservation } from "./observation.js";
import type { CommanderSnapshotSlice, CommanderToMainMessage, MainToCommanderMessage } from "./protocol.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope. Declared
// minimally to avoid pulling in the WebWorker lib (which conflicts with the DOM lib).
interface WorkerGlobalScope {
  postMessage(message: CommanderToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToCommanderMessage>) => void) | null;
}
declare const self: WorkerGlobalScope;

let brain: CommanderBrain | null = null;
const memory: CommanderMemory = {
  phase: "idle",
  seenByWave: new Map<number, Set<number>>(),
  lastRushWaveNumber: null,
  lastRoutedTowerSignature: "",
  gridLayout: undefined,
};
let gridLayoutToggleSent = false;
// The run the cached layout belongs to (GameEngine.runId). On a run restart the
// previous layout is stale and the one-shot feed-off toggle must re-arm, so the
// engine's freshly re-enabled feed is turned back off after the new map is cached.
let lastRunId: number | null = null;

function postToMain(message: CommanderToMainMessage): void {
  self.postMessage(message);
}

function resetMemory(): void {
  memory.phase = "idle";
  memory.seenByWave = new Map<number, Set<number>>();
  memory.lastRushWaveNumber = null;
  memory.lastRoutedTowerSignature = "";
  memory.gridLayout = undefined;
  gridLayoutToggleSent = false;
  lastRunId = null;
}

self.onmessage = (event: MessageEvent<MainToCommanderMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "start": {
      try {
        brain = createBrain(message.kind);
      } catch {
        brain = null;
      }
      resetMemory();
      break;
    }
    case "stop": {
      brain = null;
      break;
    }
    case "observation": {
      if (!brain) break;
      const slice: CommanderSnapshotSlice = message.slice;
      const commands: Command[] = [];
      // Detect a run restart (engine reloaded a map → runId bumped). The previous
      // run's cached layout is stale and must be dropped, and the one-shot feed-off
      // toggle must re-arm so the freshly re-enabled feed is turned back off after
      // the new map is cached. Robust to same-map replays (runId changes even when
      // mapIndex/layout do not). The first observation of a session (lastRunId null)
      // also initializes correctly.
      if ((slice.meta.runId ?? null) !== lastRunId) {
        lastRunId = slice.meta.runId ?? null;
        memory.gridLayout = undefined;
        gridLayoutToggleSent = false;
        memory.phase = "idle";
        memory.seenByWave = new Map<number, Set<number>>();
        memory.lastRushWaveNumber = null;
        memory.lastRoutedTowerSignature = "";
      }
      if (slice.gridLayout) {
        memory.gridLayout = slice.gridLayout;
        // The map never changes mid-run; emit the feed-off toggle exactly once so
        // the engine stops shipping gridLayout (steady-state per-tick cost → zero).
        if (!gridLayoutToggleSent) {
          gridLayoutToggleSent = true;
          commands.push({ commandId: 0, type: "llm:gridLayoutToggle" });
        }
      }
      const observation: CommanderObservation = buildObservation({
        ...slice,
        gridLayout: memory.gridLayout ?? slice.gridLayout,
      });
      const brainCommands = brain.decide(observation, memory);
      for (const command of brainCommands) {
        commands.push(command);
      }
      postToMain({ type: "commands", commands });
      break;
    }
  }
};
