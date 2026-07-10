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
