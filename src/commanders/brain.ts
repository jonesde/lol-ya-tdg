import type { Command } from "@/sim/Command.js";
import type { CommanderObservation } from "./observation.js";
import { createStubbsBrain } from "./stubbs/brain.js";
import { createStubbyBrain } from "./stubby/brain.js";

export type CommanderPhase = "idle" | "holding" | "rushing";

// Plain-object scratch + per-run memory shared between decide() calls. The worker
// owns the live instance; brains treat it as opaque state (no closures of their own).
export interface CommanderMemory {
  phase: CommanderPhase;
  seenByWave: Map<number, Set<number>>; // enemy ids seen, keyed by wave number
  lastRushWaveNumber: number | null;
  lastRoutedTowerSignature: string;
  gridLayout: number[][] | undefined;
}

export interface CommanderBrain {
  decide(observation: CommanderObservation, memory: CommanderMemory): Command[];
}

export function createBrain(kind: "stubby" | "stubbs"): CommanderBrain {
  switch (kind) {
    case "stubby":
      return createStubbyBrain();
    case "stubbs":
      return createStubbsBrain();
    default: {
      const unknown = kind as string;
      throw new Error(`Unknown commander kind: ${unknown}`);
    }
  }
}
