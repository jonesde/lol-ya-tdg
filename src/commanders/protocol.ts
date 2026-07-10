import type { Command } from "@/sim/Command.js";
import type { EnemySnapshot, SnapshotMeta, SpawnStateSnapshot, TowerSnapshot } from "@/sim/SimulationSnapshot.js";

export type CommanderKind = "stubby" | "stubbs";

// The worker's intentional input contract — a throttled, abstracted slice of the
// full SimulationSnapshot, not "the whole snapshot". The relay owns the gridLayout
// cache and always supplies it; the other slices are passed through verbatim.
export interface CommanderSnapshotSlice {
  gridLayout: number[][] | undefined; // constant map (0=terrain,1=path,2=base,3=spawn); cached by relay
  enemies: EnemySnapshot[]; // worker converts world x/y → tile via meta.tileSize
  towers: TowerSnapshot[];
  spawnStates: SpawnStateSnapshot[]; // each carries pendingCount
  meta: SnapshotMeta; // includes remainingScheduledSpawns, tileSize, waveActive
}

export type MainToCommanderMessage =
  | { type: "start"; kind: CommanderKind }
  | { type: "stop" }
  | { type: "observation"; slice: CommanderSnapshotSlice };

export type CommanderToMainMessage = { type: "commands"; commands: Command[] };
