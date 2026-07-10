import { dispatchCommand } from "@/sim/commandBus.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import type { CommanderSnapshotSlice, CommanderToMainMessage, MainToCommanderMessage } from "./protocol.js";

// The main-thread half of the commander transport. It is a passive reader of the
// snapshot store (never posts snapshotAck — the single-ack backpressure gate is
// untouched) and the only piece that touches the snapshot module / command bus.
// It polls at ~4 Hz, builds a throttled slice (with its OWN cached gridLayout on
// every observation so the worker always has the map), posts it to the commander
// worker, and forwards any returned commands via dispatchCommand.
const RELAY_INTERVAL_MS = 250;

let commanderWorker: Worker | null = null;
let relayIntervalId: ReturnType<typeof setInterval> | null = null;
let cachedGridLayout: number[][] | undefined;
// The run the cached layout belongs to (GameEngine.runId). Keying the cache to the
// run — rather than clearing it on worker stop — keeps it valid across a *worker*
// restart within the same run (the feed stays off and the map is still correct). A
// run restart bumps runId and must drop the stale layout so the previous map is
// never forwarded to the worker for the new run.
let cachedRunId: number | null = null;

export function startRelay(kind: "stubby" | "stubbs"): void {
  if (commanderWorker) return;
  commanderWorker = new Worker(new URL("./CommanderWorker.ts", import.meta.url), { type: "module" });
  commanderWorker.onmessage = (event: MessageEvent<CommanderToMainMessage>) => {
    const message = event.data;
    if (message.type === "commands") {
      for (const command of message.commands) {
        dispatchCommand(command);
      }
    }
  };
  commanderWorker.postMessage({ type: "start", kind } satisfies MainToCommanderMessage);
  relayIntervalId = setInterval(postObservation, RELAY_INTERVAL_MS);
}

function postObservation(): void {
  const snapshot = getLatestSnapshot();
  if (!snapshot || !commanderWorker) return;
  // A run restart (engine reloaded a map) bumps runId. The gridLayout feed is
  // disabled once the worker caches the map, but each new run re-enables it — with
  // a different map in general, but possibly the *same* map on a replay. So the
  // previously cached layout is stale and must be dropped. Detecting the boundary by
  // runId (not by gridLayout presence or mapIndex) is robust to the same-map-replay
  // case. The fresh layout is re-cached from this same snapshot, since the engine
  // re-enables the feed on (re)load and the snapshot therefore carries the new map.
  if ((snapshot.meta.runId ?? null) !== cachedRunId) {
    cachedRunId = snapshot.meta.runId ?? null;
    cachedGridLayout = undefined;
  }
  if (snapshot.gridLayout) {
    cachedGridLayout = snapshot.gridLayout;
  }
  const slice: CommanderSnapshotSlice = {
    gridLayout: cachedGridLayout,
    enemies: snapshot.enemies,
    towers: snapshot.towers,
    spawnStates: snapshot.spawnStates,
    meta: snapshot.meta,
  };
  commanderWorker.postMessage({ type: "observation", slice } satisfies MainToCommanderMessage);
}

export function stopRelay(): void {
  if (relayIntervalId !== null) {
    clearInterval(relayIntervalId);
    relayIntervalId = null;
  }
  if (commanderWorker) {
    commanderWorker.postMessage({ type: "stop" } satisfies MainToCommanderMessage);
    commanderWorker.terminate();
    commanderWorker = null;
  }
  // NOTE: `cachedGridLayout` is intentionally NOT cleared here. The plan (§1.4)
  // requires the relay to own the gridLayout cache across worker restarts: once the
  // commander worker has toggled the engine feed off, a restarted worker would
  // otherwise receive no gridLayout and have no map. Keeping the cache lets the new
  // worker re-cache and re-emit the one-shot toggle (which flips the engine feed
  // back on). The cache self-corrects on a new run because the engine re-enables the
  // feed (gridLayoutEnabled resets true in _initMap), so the next snapshot refreshes it.
}
