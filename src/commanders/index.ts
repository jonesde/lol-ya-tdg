import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { usePersistStore } from "@/stores/persist.js";
import { startRelay, stopRelay } from "./relay.js";

export const BUILTIN_STUBBY = "stubby";
export const BUILTIN_STUBBS = "stubbs";

// Owns the commander worker + relay lifecycle. For a built-in id it starts the
// relay (which spawns the worker and sends `start` with the kind); for a non-builtin
// id it looks up an LLM commander config and starts the relay with "llm" + config;
// "none" stops it.
export function setEnemyCommander(id: string | "none"): void {
  if (id === "none") {
    stopEnemyCommander();
    return;
  }
  stopRelay();
  if (id === BUILTIN_STUBBY || id === BUILTIN_STUBBS) {
    startRelay(id);
    return;
  }
  const llmCommanderConfig = usePersistStore().llmCommanders.find((config) => config.id === id);
  if (llmCommanderConfig) {
    startRelay("llm", llmCommanderConfig);
    return;
  }
  stopEnemyCommander();
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
