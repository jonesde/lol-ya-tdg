import { FIXED_DT, GameState, type GameStateValue, MAX_ACCUM } from "@/game/Constants.js";
import { GameEngine } from "@/game/GameEngine.js";
import { applyCommand } from "./applyCommand.js";
import type { Command } from "./Command.js";
import type { PersistStateSlice } from "./HostBindings.js";
import { buildSnapshot } from "./SnapshotSerializer.js";
import { WorkerHostBindings } from "./WorkerHostBindings.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./WorkerProtocol.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope.
// We declare a minimal worker-scope shape to avoid pulling in the WebWorker
// lib (which conflicts with the DOM lib used for the main thread).
interface WorkerGlobalScope {
  postMessage(message: WorkerToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
}
declare const self: WorkerGlobalScope;

let engine: GameEngine | null = null;
const host = new WorkerHostBindings();

// Command queue — drained at the start of each tick. This eliminates the
// input/sim race condition: messages arriving mid-tick wait for the next
// drain boundary.
const commandQueue: Command[] = [];
let lastAppliedCommandId = 0;

// Fixed-timestep accumulator — same structure as the current GameEngine.loop,
// but driven by setTimeout instead of requestAnimationFrame.
let lastTime = 0;
let accumulator = 0;
let tickTimeoutId: ReturnType<typeof setTimeout> | null = null;
let running = false;

// Persist-flush throttling state: the worker tracks the last snapshot's wave,
// state, and milestone-claim key count so it can flush to the host only on
// significant events (wave change / game end / milestone claim) plus a 5s
// fallback. This avoids a persist-store write on every persist mutation.
let lastFlushWave = 0;
let lastFlushState: GameStateValue | null = null;
let lastFlushMilestoneKeys = 0;
let lastFlushTime = 0;

const TARGET_FRAME_MS = 1000 / 60; // 16.67ms
const PERSIST_FLUSH_FALLBACK_MS = 5000;

function postMessage(msg: WorkerToMainMessage): void {
  self.postMessage(msg);
}

function startLoop(): void {
  if (running) return;
  running = true;
  lastTime = 0; // re-anchored on first tick
  scheduleTick();
}

function scheduleTick(): void {
  // setTimeout (not setInterval) — setTimeout reschedules after each tick,
  // so a slow tick doesn't cause pile-up. setInterval can drift under load.
  tickTimeoutId = setTimeout(tick, TARGET_FRAME_MS);
}

function tick(): void {
  if (!engine || !running) return;

  const now = performance.now(); // available in workers, no self. prefix needed
  if (lastTime === 0) lastTime = now;
  const rawDt = Math.min(MAX_ACCUM, (now - lastTime) / 1000);
  lastTime = now;

  // Drain command queue before any simulation work.
  // Commands are applied in arrival order; each may mutate runState/persistState.
  while (commandQueue.length > 0) {
    const command = commandQueue.shift()!;
    if (command.commandId !== undefined) {
      lastAppliedCommandId = command.commandId;
    }
    try {
      applyCommand(engine, command);
    } catch (err) {
      const errorMessage = `Command ${command.type} failed: ${(err as Error).message}`;
      const errorStack = (err as Error).stack;
      postMessage(
        errorStack
          ? { type: "workerError", message: errorMessage, stack: errorStack }
          : { type: "workerError", message: errorMessage },
      );
    }
  }

  // Fixed-timestep accumulator. timeScale comes from runState, which input
  // commands may have updated.
  const scaledDt = rawDt * (engine.runState.state === GameState.PAUSED ? 0 : engine.runState.timeScale);
  accumulator += scaledDt;
  while (accumulator >= FIXED_DT) {
    engine.update(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  // Produce and post snapshot every tick. Phase 7: one snapshot per tick.
  const snapshot = buildSnapshot(engine, lastAppliedCommandId);
  postMessage({ type: "snapshot", snapshot });

  // Phase 9 persist batching: flush to the host only on significant events so
  // we do not hit the persist store on every dirty mutation. Triggers: wave
  // increased, game transitioned to VICTORY/GAME_OVER, a new milestone claim
  // appeared, or a 5s fallback elapsed while dirty.
  const milestoneKeyCount = Object.keys(snapshot.meta.milestoneRewardsClaimed).length;
  const waveChanged = snapshot.meta.currentWave !== lastFlushWave;
  const stateTerminal =
    (snapshot.meta.state === GameState.VICTORY || snapshot.meta.state === GameState.GAME_OVER) &&
    lastFlushState !== snapshot.meta.state;
  const milestoneGained = milestoneKeyCount > lastFlushMilestoneKeys;
  const fallbackElapsed = now - lastFlushTime >= PERSIST_FLUSH_FALLBACK_MS;
  if (engine.persistDirty && (waveChanged || stateTerminal || milestoneGained || fallbackElapsed)) {
    host.schedulePersistSave(buildPersistSlice(engine));
    engine.persistDirty = false;
    lastFlushTime = now;
  }
  lastFlushWave = snapshot.meta.currentWave;
  lastFlushState = snapshot.meta.state;
  lastFlushMilestoneKeys = milestoneKeyCount;

  // Schedule next tick. setTimeout from inside the tick keeps the loop alive.
  scheduleTick();
}

function stopLoop(): void {
  running = false;
  if (tickTimeoutId !== null) {
    clearTimeout(tickTimeoutId);
    tickTimeoutId = null;
  }
}

// Build the persist slice the host needs to persist. Covers
// every field the worker can mutate (Phase 9). After posting, callers clear
// engine.persistDirty so the next flush only happens on a fresh mutation.
function buildPersistSlice(engineRef: GameEngine): PersistStateSlice {
  const persistState = engineRef.persistState;
  return {
    gems: persistState.gems,
    highestUnlockedMap: persistState.highestUnlockedMap,
    bestWaves: { ...persistState.bestWaves },
    activeWaves: { ...persistState.activeWaves },
    difficulty: { ...persistState.difficulty },
    firstTimeMilestones: { ...persistState.firstTimeMilestones },
    firstClears: { ...persistState.firstClears },
    generalAddons: { ...persistState.generalAddons },
    unlocked: structuredClone(persistState.unlocked),
    runHistory: [...persistState.runHistory],
  };
}

// Message handler — runs synchronously between ticks. Commands queue;
// lifecycle messages act immediately.
self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      // Construct the engine with plain state and the worker host bindings.
      // The engine no longer takes Pinia stores — Phase 1 made runState/persistState
      // authoritative. We pass them in directly.
      engine = new GameEngine(msg.persistState, msg.themeBundle, host, msg.mapIndex, msg.randomMapParams);
      // Reset persist-flush tracking for the new run.
      lastFlushWave = 0;
      lastFlushState = null;
      lastFlushMilestoneKeys = 0;
      lastFlushTime = performance.now();
      // For random maps, loadMap uses mapIndex -1; branch to loadRandomMap so
      // getMap(-1) is never hit. Normal maps use loadMap(mapIndex).
      if (msg.mapIndex === -1 && msg.randomMapParams) {
        const params = msg.randomMapParams as {
          width: number;
          height: number;
          level: number;
          style: string;
          regionId: number;
          seed: number;
        };
        engine.loadRandomMap(params.width, params.height, params.level, params.style, params.regionId, params.seed);
      } else {
        engine.loadMap(msg.mapIndex);
      }
      postMessage({ type: "workerReady" });
      startLoop();
      break;
    }
    case "command": {
      commandQueue.push(msg.command);
      break;
    }
    case "confirmResult": {
      host.resolveConfirm(msg.requestId, msg.confirmed);
      break;
    }
    case "setTheme": {
      // Defensive no-op — mid-run theme switching is out of scope per README.md.
      // The MainToWorkerMessage type still includes setTheme for forward-compat.
      break;
    }
    case "dispose": {
      stopLoop();
      if (engine) {
        // Flush any dirty persist state before termination.
        if (engine.persistDirty) {
          host.schedulePersistSave(buildPersistSlice(engine));
          engine.persistDirty = false;
        }
        engine.dispose();
        engine = null;
      }
      postMessage({ type: "workerReady" }); // signal safe to terminate
      break;
    }
  }
};
