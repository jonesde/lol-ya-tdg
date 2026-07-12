import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { startRelay, stopRelay } from "./relay.js";

export type EnemyCommanderKind = "none" | "stubby" | "stubbs";

// Owns the commander worker + relay lifecycle. For "stubby"/"stubbs" it starts the
// relay (which spawns the worker and sends `start` with the kind); "none" stops it.
export function setEnemyCommander(kind: EnemyCommanderKind): void {
  if (kind === "none") {
    stopEnemyCommander();
    return;
  }
  stopRelay();
  startRelay(kind);
}

// Stops the commander and releases any enemies it left in hold mode. Before
// terminating it reads the current enemy ids from the latest snapshot and dispatches
// one llm:routeGroup(enemyIds, []) so every held enemy reverts to its default path.
// This applies regardless of which commander was active (a no-op re-anchor for one
// that never held).
export function stopEnemyCommander(): void {
  const snapshot = getLatestSnapshot();
  if (snapshot) {
    const enemyIds = snapshot.enemies.map((enemy) => enemy.id);
    if (enemyIds.length > 0) {
      dispatchCommand({ commandId: 0, type: "llm:routeGroup", enemyIds, hold: false, waypoints: [] });
    }
  }
  stopRelay();
}
