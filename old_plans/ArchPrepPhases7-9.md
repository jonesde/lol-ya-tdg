# Architecture Prep — Phases 7–9

**Scope:** implementation notes for moving the simulation from the main thread into a dedicated Web Worker, as described in `plans/ArchitecturePlan.md`. These phases are the actual migration — Phases 0–6 (see `plans/ArchPrepPhases0-6.md`) were behavior-preserving preparation; Phases 7–9 reshape the runtime topology. They should be done together to avoid an intermediate state where the engine is worker-compatible but not yet in a worker.

**Audience:** same as the Phases 0–6 doc. Game-specific and worker-specific terms (`dedicated worker`, `postMessage`, `structured clone`, `transfer list`, `requestAnimationFrame`, fixed-timestep accumulator, `setTimeout`-driven loop, `AudioContext` main-thread restriction, double-buffering, seqlock) are used without softening.

**Prerequisite:** Phases 0–6 are complete. The completion criteria at the end of `ArchPrepPhases0-6.md` are all checked off.

---

## Cross-cutting: worker entry and module boundary

The worker is a separate Vite entry. Vite supports worker entries via the `?worker` import suffix or via a separate `worker` field in `vite.config.ts`. Recommend the `?worker` suffix for clarity — it makes the worker boundary explicit at the import site.

```
src/
├── sim/                        # All sim contracts (no Pinia, no DOM)
│   ├── HostBindings.ts
│   ├── GameRunState.ts
│   ├── PersistState.ts
│   ├── Command.ts
│   ├── SimulationSnapshot.ts
│   ├── SnapshotSerializer.ts
│   ├── SpatialIndex.ts
│   ├── WorkerHostBindings.ts   # NEW (Phase 7) — host-side shim that posts messages
│   ├── WorkerEntry.ts          # NEW (Phase 7) — the worker's main module
│   └── applyCommand.ts         # NEW (Phase 7) — extracted from MainThreadCommandDispatcher
└── components/
    └── SvgGameRoot.vue         # Owns the Worker instance and snapshot store
```

### `vite.config.ts` worker config

```ts
// vite.config.ts
export default defineConfig({
  // ... existing config ...
  worker: {
    format: 'es',  // ESM workers — required for `import` syntax in the worker
  },
});
```

The existing `@/` alias works inside the worker bundle because Vite resolves it from `tsconfig.json` paths.

---

## Phase 7 — Worker creation, snapshot production, command dispatch

### Goal
Move `GameEngine` (and its dependencies — `TowerManager`, `EnemyManager`, `WaveManager`, `ProjectileManager`, `ParticleSystem`, `WaveGraphTracker`, `Grid`) into the worker. The worker owns the authoritative `GameRunState` and `PersistState`. The main thread owns a `SnapshotStore` (a plain object updated by worker messages) and a `WorkerHostBindings` that posts commands to the worker.

The previous `MainThreadCommandDispatcher` (Phase 6) is replaced by a `WorkerCommandDispatcher` that posts commands via `worker.postMessage`. The previous `MainThreadHostBindings` is replaced by a `WorkerHostBindings` that the engine inside the worker uses to reach back to the main thread for sound/UI/persist/confirm.

### Worker → Main message types

```ts
// src/sim/WorkerProtocol.ts
import type { SimulationSnapshot } from "./SimulationSnapshot.js";
import type { ConfirmPayload, PersistStateSlice, SoundName, UiEvent } from "./HostBindings.js";

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
  | { type: "setTheme"; themeBundle: ThemeBundle }  // defensive no-op in Phase 7 (mid-run theme switching out of scope per README.md); kept for forward-compat
  | { type: "dispose" };
```

### `WorkerHostBindings` — the engine's view of the outside world, inside the worker

```ts
// src/sim/WorkerHostBindings.ts
import type {
  HostBindings, ConfirmPayload, PersistStateSlice, SoundName, UiEvent,
} from "./HostBindings.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope.
// postMessage is available on self directly.
declare const self: DedicatedWorkerGlobalScope;

export class WorkerHostBindings implements HostBindings {
  private confirmRequestCounter = 0;
  private pendingConfirms = new Map<number, (confirmed: boolean) => void>();

  playSound(name: SoundName): void {
    self.postMessage({ type: "playSound", name });
  }

  notifyUi(event: UiEvent): void {
    self.postMessage({ type: "notifyUi", event });
  }

  schedulePersistSave(state: PersistStateSlice): void {
    self.postMessage({ type: "schedulePersistSave", state });
  }

  async requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    const requestId = ++this.confirmRequestCounter;
    return new Promise<boolean>((resolve) => {
      this.pendingConfirms.set(requestId, resolve);
      self.postMessage({ type: "requestConfirm", payload, requestId });
    });
  }

  // Called by the worker's message handler when a confirmResult arrives.
  resolveConfirm(requestId: number, confirmed: boolean): void {
    const resolve = this.pendingConfirms.get(requestId);
    if (resolve) {
      this.pendingConfirms.delete(requestId);
      resolve(confirmed);
    }
  }
}
```

### `WorkerEntry.ts` — the worker's main module

```ts
// src/sim/WorkerEntry.ts
import { GameEngine } from "@/game/GameEngine.js";
import { WorkerHostBindings } from "./WorkerHostBindings.js";
import { applyCommand } from "./applyCommand.js";
import { buildSnapshot } from "./SnapshotSerializer.js";
import type {
  MainToWorkerMessage, WorkerToMainMessage,
} from "./WorkerProtocol.js";
import type { Command } from "./Command.js";
import { FIXED_DT, MAX_ACCUM, GameState } from "@/game/Constants.js";

declare const self: DedicatedWorkerGlobalScope;

let engine: GameEngine | null = null;
const host = new WorkerHostBindings();

// Command queue — drained at the start of each tick. This eliminates the
// input/sim race condition: messages arriving mid-tick wait for the next
// drain boundary.
const commandQueue: Command[] = [];
let lastAppliedCommandId = 0;

// Fixed-timestep accumulator — same structure as the current GameEngine.loop
// at GameEngine.ts:212-232, but driven by setTimeout instead of requestAnimationFrame.
let lastTime = 0;
let accumulator = 0;
let tickTimeoutId: ReturnType<typeof setTimeout> | null = null;
let running = false;

const TARGET_FRAME_MS = 1000 / 60;  // 16.67ms

function postMessage(msg: WorkerToMainMessage): void {
  self.postMessage(msg);
}

function startLoop(): void {
  if (running) return;
  running = true;
  lastTime = 0;  // re-anchored on first tick
  scheduleTick();
}

function scheduleTick(): void {
  // setTimeout (not setInterval) — setTimeout reschedules after each tick,
  // so a slow tick doesn't cause pile-up. setInterval can drift under load.
  tickTimeoutId = setTimeout(tick, TARGET_FRAME_MS);
}

function tick(): void {
  if (!engine || !running) return;

  const now = performance.now();  // available in workers, no self. prefix needed
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
      postMessage({
        type: "workerError",
        message: `Command ${command.type} failed: ${(err as Error).message}`,
        stack: (err as Error).stack,
      });
    }
  }

  // Fixed-timestep accumulator — same logic as GameEngine.ts:222-227.
  // timeScale comes from runState, which input commands may have updated.
  const scaledDt = rawDt * (engine.runState.state === GameState.PAUSED ? 0 : engine.runState.timeScale);
  accumulator += scaledDt;
  while (accumulator >= FIXED_DT) {
    engine.update(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  // Produce and post snapshot every tick.
  // Phase 7: one snapshot per tick (60Hz). Throttling is a later optimization.
  const snapshot = buildSnapshot(engine, lastAppliedCommandId);
  postMessage({ type: "snapshot", snapshot });

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

// Message handler — runs synchronously between ticks. Commands queue;
// lifecycle messages act immediately.
self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      // Construct the engine with plain state and the worker host bindings.
      // The engine no longer takes Pinia stores — Phase 1 made runState/persistState
      // authoritative. We pass them in directly.
      engine = new GameEngine(
        msg.persistState,                  // PersistState (plain)
        msg.themeBundle,                   // ThemeBundle
        host,                              // WorkerHostBindings
        msg.mapIndex,
        msg.randomMapParams,
      );
      engine.loadMap(msg.mapIndex);
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
      // The MainToWorkerMessage type still includes setTheme for forward-compat;
      // if mid-run switching ever becomes in-scope, wire it to engine.setTheme
      // and add a lifecycle:setTheme command to the Command schema.
      break;
    }
    case "dispose": {
      stopLoop();
      if (engine) {
        // Flush any dirty persist state before termination.
        if (engine.persistDirty) {
          host.schedulePersistSave(/* current persist slice */);
        }
        engine.dispose();
        engine = null;
      }
      postMessage({ type: "workerReady" });  // signal safe to terminate
      break;
    }
  }
};
```

### `GameEngine` constructor — final shape

After Phases 1–6, the constructor took `(gameStore, persistStore, themeBundle, host)`. Phase 7 drops the Pinia store arguments entirely — the engine is constructed inside the worker where Pinia doesn't exist:

```ts
// src/game/GameEngine.ts (final shape)
export class GameEngine {
  runState: GameRunState;
  persistState: PersistState;
  host: HostBindings;
  themeBundle: ThemeBundle;
  persistDirty: boolean = false;  // set when persistState mutates; cleared by host flush

  constructor(
    persistState: PersistState,
    themeBundle: ThemeBundle,
    host: HostBindings,
    mapIndex: number,
    randomMapParams?: unknown,
  ) {
    this.persistState = persistState;
    this.themeBundle = themeBundle;
    this.host = host;
    // runState is initialized in loadMap() using StartingGold and the map.
    // ...
  }
}
```

Everywhere the engine previously called `this.gameStore.method(...)` now calls either a pure helper on `this.runState` (Phase 1) or mutates `this.runState` directly. The `gameStore` field is deleted.

### `applyCommand.ts` — extracted from the Phase 6 dispatcher

```ts
// src/sim/applyCommand.ts
import type { GameEngine } from "@/game/GameEngine.js";
import type { Command } from "./Command.js";

// This is the single switch that maps Command → engine method. It was
// inline in MainThreadCommandDispatcher in Phase 6; Phase 7 moves it here
// so the worker can import it without importing the dispatcher class.
export function applyCommand(engine: GameEngine, command: Command): void {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      break;
    case "action:togglePause":       engine.togglePause(); break;
    case "action:cycleSpeed":
      command.direction === 1 ? engine.cycleSpeed() : engine.cycleSpeedReverse();
      break;
    case "action:upgradeSelected":   engine.upgradeSelected(); break;
    case "action:sellSelected":      void engine.sellSelected(); break;
    case "action:executeSell":       engine.executeSellById(command.towerId); break;  // defined in Phase 4
    case "action:downgradeSelected": engine.downgradeSelected(); break;
    case "action:specialize":        engine.specializeSelected(command.variant); break;
    case "action:cancelSelected":    engine.cancelSelected(); break;
    case "action:setTargeting":      engine.setTargeting(command.mode); break;
    case "action:setFixedAimDir":    engine.setFixedAimDir(command.dir); break;
    case "action:cancelBuildMode":   engine.cancelBuildMode(); break;
    // NOTE: action:selectBuildType is intentionally absent — selectedTowerType
    // is host-authoritative (updated directly on gameStore by Input.ts /
    // SvgGameRoot.vue on the main thread, echoed back in the snapshot's
    // meta.selectedTowerType unchanged by the worker). The worker does NOT
    // write selectedTowerType. See §6.2 of ArchitecturePlan.md.
    case "action:selectTower":
      // Phase 7 implements selectTowerById (was tech debt in Phase 6).
      engine.selectTowerById(command.towerId);
      break;
    // NOTE: lifecycle:setTheme is intentionally absent — mid-run theme
    // switching is out of scope per README.md. If it ever becomes in-scope,
    // add the command and wire it here. The WorkerEntry message handler
    // (below) retains a defensive no-op "setTheme" case for forward-compat.
    // init and dispose are handled by the worker entry, not applyCommand.
    // LLM commands stub to no-op for now — implemented when the commander plane lands.
    case "llm:routeGroup":
    case "llm:setTargeting":
      // No-op until the commander plane is built (ArchitecturePlan.md §4.3).
      break;
    default:
      const _exhaustive: never = command;
      void _exhaustive;
  }
}
```

### `executeSellById` — Phase 7 update

The `executeSellById(towerId)` method was **added in Phase 4** (see `ArchPrepPhases0-6.md`), where it uses `this.gameStore` and `this.towerManager!.sell(tower, this.persistStore.$state)`. Phase 7 updates it to use the now-authoritative plain state instead of the Pinia store:

```ts
// src/game/GameEngine.ts — Phase 7 update to the Phase 4 method
executeSellById(towerId: string): void {
  const tower = this.towerManager?.getTowerById(towerId);
  if (!tower) return;
  const isRefund = this.persistState.generalAddons?.sellActive === "refund";
  const value = isRefund ? tower.totalInvested : this.towerManager!.sell(tower, this.persistState);
  this.runState.gold += value;
  this.totalGoldEarned += value;
  this.runState.selectedTowerId = null;
  this.persistDirty = true;
}
```

The change from Phase 4 to Phase 7: `this.gameStore.setGold(...)` → `this.runState.gold += value`, and `this.persistStore.$state` → `this.persistState` for the `sell` call. The method signature and the `towerId`-based lookup are unchanged from Phase 4.

### Main-thread side: `WorkerCommandDispatcher`

```ts
// src/sim/WorkerCommandDispatcher.ts
import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";
import type { WorkerToMainMessage, MainToWorkerMessage } from "./WorkerProtocol.js";

export class WorkerCommandDispatcher implements CommandDispatcher {
  private worker: Worker;
  private nextCommandId = 1;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  dispatch(command: Command): void {
    if (command.commandId === undefined) {
      (command as { commandId: number }).commandId = this.nextCommandId++;
    }
    const msg: MainToWorkerMessage = { type: "command", command };
    this.worker.postMessage(msg);
  }
}
```

### Main-thread side: `SnapshotStore` and reactive mirror

```ts
// src/sim/SnapshotStore.ts
import type { SimulationSnapshot } from "./SimulationSnapshot.js";
import type { GameStore } from "@/stores/game.js";

// Holds the latest snapshot and mirrors it into the Pinia gameStore for
// Vue reactivity. This is the "projection" layer — the snapshot is
// authoritative; gameStore is a cache updated by snapshot diffs.
export class SnapshotStore {
  private current: SimulationSnapshot | null = null;
  private gameStore: GameStore;

  constructor(gameStore: GameStore) {
    this.gameStore = gameStore;
  }

  get(): SimulationSnapshot | null {
    return this.current;
  }

  apply(snapshot: SimulationSnapshot): void {
    const prev = this.current;
    this.current = snapshot;
    if (!prev || prev.frameId !== snapshot.frameId) {
      this.mirrorToGameStore(snapshot);
    }
  }

  private mirrorToGameStore(snapshot: SimulationSnapshot): void {
    const meta = snapshot.meta;
    const gs = this.gameStore;
    // Diff-and-write — only update fields that changed, to minimize
    // Vue reactivity overhead. Pinia reactivity is fine-grained per field.
    if (gs.gold !== meta.gold) gs.gold = meta.gold;
    if (gs.lives !== meta.lives) gs.lives = meta.lives;
    if (gs.currentWave !== meta.currentWave) gs.currentWave = meta.currentWave;
    if (gs.waveCountdown !== meta.waveCountdown) gs.waveCountdown = meta.waveCountdown;
    if (gs.timeScale !== meta.timeScale) gs.timeScale = meta.timeScale;
    if (gs.state !== meta.state) gs.setState(meta.state);
    if (gs.runGemsEarned !== meta.runGemsEarned) gs.runGemsEarned = meta.runGemsEarned;
    if (gs.bossesKilledThisRun !== meta.bossesKilledThisRun) gs.bossesKilledThisRun = meta.bossesKilledThisRun;
    if (gs.bossesReachedBaseThisRun !== meta.bossesReachedBaseThisRun) {
      gs.bossesReachedBaseThisRun = meta.bossesReachedBaseThisRun;
    }
    if (gs.upgradeBtnClickAnim !== meta.upgradeBtnClickAnim) {
      gs.upgradeBtnClickAnim = meta.upgradeBtnClickAnim;
    }
    if (gs.hoverUpgradeBtn !== meta.hoverUpgradeBtn) gs.hoverUpgradeBtn = meta.hoverUpgradeBtn;
    if (gs.endScreenData !== meta.endScreenData) gs.endScreenData = meta.endScreenData;
    // selectedTower is resolved by id lookup against the snapshot's towers array
    // (see selectTowerById mirror below).
    // camera is main-thread-authoritative (input-driven) — NOT mirrored from snapshot.
  }

  // Resolve selectedTowerId → Tower object for components that bind to the
  // live object (TowerPanel.vue reads tower.level, tower.targeting, etc.).
  // This is a temporary bridge until those components are refactored to read
  // from the snapshot directly (Phase 9).
  resolveSelectedTower(): Tower | null {
    const id = this.current?.meta.selectedTowerId;
    if (!id || !this.current) return null;
    return this.current.towers.find(t => t.id === id) as unknown as Tower ?? null;
    // NOTE: the cast is intentional — components currently expect a Tower
    // instance. Phase 9 refactors them to read TowerSnapshot. Until then,
    // this returns a snapshot dressed as a Tower. Components that only read
    // fields (most of them) work; components that call methods (canUpgrade,
    // doUpgrade) will break — those code paths are routed through commands,
    // not through the live object.
  }
}
```

### `SvgGameRoot.vue` — full rewrite of the engine lifecycle

The setup script at `SvgGameRoot.vue:235-308` currently does:

```ts
engine.value = new GameEngine(gameStore, persistStore, themeStore.activeTheme);
gameStore.setEngine(engine.value);
useInput(gameStore, engine.value, uiStore);
engine.value.renderCallback = () => { /* imperative DOM writes */ };
```

Phase 7 rewrites it to:

```ts
import GameWorker from "@/sim/WorkerEntry.ts?worker";
import { WorkerCommandDispatcher } from "@/sim/WorkerCommandDispatcher";
import { SnapshotStore } from "@/sim/SnapshotStore";
import { MainThreadHostBindings } from "@/sim/MainThreadHostBindings";
import { MainThemeBundleBuilder } from "@/sim/ThemeBundleBuilder";  // or inline

const soundManager = new SoundManager();
const host = new MainThreadHostBindings(soundManager);  // still used for sound/persist/confirm on main thread
const worker = new GameWorker();
const dispatcher = new WorkerCommandDispatcher(worker);
const snapshotStore = new SnapshotStore(gameStore);

// Theme bundle built once from mapThemeStore (Phase 2 helper).
const themeBundle = buildThemeBundle(mapThemeStore);

// Wire worker → main messages.
worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "snapshot":
      snapshotStore.apply(msg.snapshot);
      break;
    case "playSound":
      host.playSound(msg.name);
      break;
    case "notifyUi":
      host.notifyUi(msg.event);
      break;
    case "schedulePersistSave":
      host.schedulePersistSave(msg.state);
      break;
    case "requestConfirm": {
      // MainThreadHostBindings.requestConfirm already returns a Promise.
      // Bridge it to the worker by posting the result back.
      host.requestConfirm(msg.payload).then((confirmed) => {
        worker.postMessage({ type: "confirmResult", requestId: msg.requestId, confirmed });
      });
      break;
    }
    case "workerReady":
      // Worker initialized; game can start.
      break;
    case "workerError":
      console.error("Worker error:", msg.message, msg.stack);
      break;
  }
});

// Initialize the worker with persist state, theme, and map index.
const persistState = structuredClone(persistStore.$state);
worker.postMessage({
  type: "init",
  persistState,
  themeBundle,
  mapIndex: gameStore.mapIndex,
  randomMapParams: gameStore.randomMapParams ?? undefined,
});

// Input and click handlers now dispatch to the worker.
useInput(gameStore, dispatcher, uiStore);

// Render loop stays on the main thread, driven by requestAnimationFrame.
// It reads from the snapshot store instead of from the engine directly.
const renderLoop = () => {
  const snapshot = snapshotStore.get();
  if (!snapshot) {
    requestAnimationFrame(renderLoop);
    return;
  }
  // ... camera transform (camera is main-thread-authoritative) ...
  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, snapshot.meta.lastScaledDt);
  projectileManager.syncFromGameEngine(snapshot.projectiles);
  particleManager.syncFromGameEngine(snapshot.particles);
  // ... effect and overlay managers, using snapshot.meta fields ...
  requestAnimationFrame(renderLoop);
};
requestAnimationFrame(renderLoop);

// Cleanup on unmount.
onUnmounted(() => {
  worker.postMessage({ type: "dispose" });
  // The worker posts workerReady after disposal, then we terminate.
  // For unmount we can terminate immediately — pending saves are flushed
  // in the worker's dispose handler synchronously before the workerReady post.
  worker.terminate();
  soundManager.dispose();
});
```

### `requestAnimationFrame` loop — the key architectural point

The render loop is **decoupled from the simulation loop**. The worker ticks at its own rate (60Hz target via `setTimeout`); the main thread renders at the browser's refresh rate (typically 60Hz via `requestAnimationFrame`, but may differ — high-DPI displays can run at 120Hz or 144Hz). The render loop reads the latest snapshot whenever the browser is ready to paint; if no new snapshot has arrived, it re-renders the previous one (or skips the frame).

This decoupling is the *whole point* of the worker migration. The simulation never blocks the render, and the render never blocks the simulation. The only coupling is the snapshot, which is produced by the worker and consumed by the render.

### Router guard

`src/router/index.ts:54` currently calls `gameStore.engine?.dispose()`. Replace with:

```ts
// router/index.ts
router.beforeEach((to, from) => {
  if (from.path === "/game" && to.path !== "/game") {
    const gameStore = useGameStore();
    const worker = gameStore.worker;  // new field, set by SvgGameRoot
    if (worker) {
      worker.postMessage({ type: "dispose" });
      // The worker flushes persist state synchronously in its dispose handler.
      // We give it a microtask to drain before terminating.
      // For route changes, immediate termination is also acceptable since
      // the dispose handler's persistSave message will be queued before
      // termination takes effect (postMessage is synchronous from the
      // caller's perspective; the message is queued before terminate() runs).
      worker.terminate();
      gameStore.worker = null;
    }
    persistStore.save();  // belt-and-suspenders main-thread save
  }
  // ... existing redirect logic ...
});
```

### Hover migration

Per §6.2 of `ArchitecturePlan.md`, hover becomes main-thread-only. `GameEngine.setHover` (`GameEngine.ts:482-501`) is deleted from the engine; the main thread computes `hoverTile` from the mouse position and updates `gameStore.hoverTile` directly. The `setHover` command is not in the schema. `SvgGameRoot.vue` mouse-move handler computes the tile:

```ts
const handleMouseMove = (event: MouseEvent) => {
  const worldPos = screenToWorld(event.clientX, event.clientY);
  const tileSize = gameStore.grid?.tileSize ?? 36;
  const tileX = Math.floor(worldPos.x / tileSize);
  const tileY = Math.floor(worldPos.y / tileSize);
  if (gameStore.grid?.inBounds(tileX, tileY)) {
    gameStore.setHoverTile({ tileX, tileY });
  } else {
    gameStore.setHoverTile(null);
  }
};
```

The `hoverUpgradeBtn` field is also main-thread-only — computed from mouse position relative to the selected tower's upgrade button bounds (the `isUpgradeBtnAt` logic at `GameEngine.ts:469-476` moves to the main thread, since it depends only on `selectedTower.tileX/tileY` and `grid.tileSize`, both available in the snapshot).

### `gameStore.engine` field

Delete the `engine: GameEngine | null` field from `game.ts:105,143` and the `setEngine`/`clearEngine` actions (`game.ts:256-262`). Replace with `worker: Worker | null` if any code path needs to reach the worker (the router guard does). Most code paths that previously called `engine.method()` now dispatch commands through the `WorkerCommandDispatcher`.

---

## Phase 8 — Render loop adaptation

### Goal
The render loop at `SvgGameRoot.vue:302-353` reads exclusively from the `SnapshotStore`. The `renderCallback` field on `GameEngine` is deleted. All reads of `engine.value.*` and `gameStore.enemyManager`/`towerManager`/`projectileManager`/`particleManager` from the render path are replaced with snapshot reads.

### Reads to migrate

The current render callback reads:

| Current read | Phase 8 source |
|---|---|
| `gameStore.camera` (`SvgGameRoot.vue:303`) | unchanged — camera is main-thread-authoritative |
| `engine.value.lastScaledDt` (`:308`) | `snapshot.meta.lastScaledDt` |
| `gameStore.enemyManager.enemies` (`:309`) | `snapshot.enemies` |
| `gameStore.towerManager.towers` (`:310`) | `snapshot.towers` |
| `engine.value.projectileManager.getRenderData()` (`:311`) | `snapshot.projectiles` (already in the snapshot) |
| `engine.value.particleManager.getRenderData()` (`:312`) | `snapshot.particles` |
| `gameStore.selectedTowerType` (`:319`) | `snapshot.meta.selectedTowerType` |
| `gameStore.selectedTower` (`:321,325`) | `snapshotStore.resolveSelectedTower()` (temporary — see below) |
| `gameStore.grid` (`:326,334`) | unchanged — grid is static after init, sent once at `lifecycle:init` and cached on the main thread |
| `gameStore.enemyManager` (`:327`) | `snapshot.enemies` + a cached `spawnStates` field — the `syncPendingQueueOverlays` call needs spawn queue data, which is in `snapshot.spawnStates` |
| `engine.value.waveManager.spawnStates` (`:329`) | `snapshot.spawnStates` |

### `selectedTower` — the temporary bridge

Several render managers (`EffectManager.syncFromGameEngine`, `UiOverlayManager.syncFromGameEngine`) take a `Tower | null` parameter. They read fields like `tower.tileX`, `tower.tileY`, `tower.level`, `tower.totalInvested`, `tower.targeting`. These reads work against a `TowerSnapshot` if the snapshot has the same field names — which it does (the snapshot schema was designed to match).

The temporary bridge in `SnapshotStore.resolveSelectedTower()` (Phase 7) returns a `TowerSnapshot` cast to `Tower`. This works for field reads but breaks for method calls. Audit the render managers — if any call methods on the `Tower` parameter (e.g., `tower.canUpgrade()`), those calls must be removed or routed through commands. The render path should only *read* state; any *action* goes through `CommandDispatcher`.

If the audit reveals method calls in the render path, that's a Phase 8 fix: refactor the render manager to read the precomputed value from the snapshot (e.g., `tower.canUpgrade` becomes a `canUpgrade: boolean` field on `TowerSnapshot`, computed by the engine during snapshot construction).

### Static grid data

The grid is static after `lifecycle:init` — paths, base locations, terrain don't change during a run. Send it once in the `init` message (or a separate `initGrid` message) and cache it on the main thread. The render path reads from the cache. `gameStore.grid` stays populated for Vue components that bind to it; it's set once at init from the cached data.

### Path highlights

The path-highlight rendering at `SvgGameRoot.vue:334-351` reads `gameStore.grid.paths`. Since `gameStore.grid` is set once at init and is static, this code is unchanged. The grid object is constructed on the main thread (it doesn't need to come from the worker — the worker constructs its own `Grid` instance from the same `mapData`, and the main thread constructs its own for rendering).

Actually — the worker needs the grid for pathfinding and build validation; the main thread needs it for rendering and click coordinate conversion. Both construct a `Grid` from the same `GeneratedMap`. The `Grid` class (`src/grid/Grid.ts`) is deterministic given `mapData`, so both instances are identical. This is a minor duplication; acceptable for now. If it becomes a memory concern, the grid can be sent once via `postMessage` (it's plain data — tile arrays, path arrays, base/spawn locations).

### `EffectManager` build preview

`EffectManager.syncFromGameEngine` (`src/render/svg/EffectManager.ts:173`) takes `buildPreviewTilePos`, `selectedTowerType`, `buildPreviewColor`, `selectedTower`, `buildPreviewValid`, `dt`. All of these are available on the main thread:

- `buildPreviewTilePos` — computed from `gameStore.hoverTile` (main-thread-authoritative now)
- `selectedTowerType` — `snapshot.meta.selectedTowerType`
- `buildPreviewColor` — computed from the theme (main-thread, via `mapThemeStore.getTowerVisual`)
- `selectedTower` — `snapshotStore.resolveSelectedTower()` (or null)
- `buildPreviewValid` — computed from `gameStore.grid.canBuild` and `gameStore.gold >= cost` (both available on main thread)
- `dt` — `snapshot.meta.lastScaledDt`

No snapshot extension needed — these are all UI-layer computations.

### Test impact

- New tests for `SnapshotStore`: apply a snapshot, assert `gameStore` fields mirror it; apply a second snapshot with changed fields, assert only changed fields were written.
- Render manager tests (`tests/unit/svg-effect-manager.test.ts`) already updated in Phase 5 to take snapshots; no further changes.
- Integration test: post a `lifecycle:init` message to a real worker, post a few commands, assert snapshots arrive with the expected mutations. This is the first test that exercises the actual worker round-trip — see Phase 9 for the test harness details.

---

## Phase 9 — Persistence batching and final wiring

### Goal
Replace the per-mutation `persistStore.save()` calls (currently at `GameEngine.ts:202,443` via `this.persistStore.save()`) with batched saves posted through `HostBindings.schedulePersistSave`. The worker sets a `persistDirty` flag when persist state mutates; the snapshot carries `persistDirty` to the host; the host flushes to `localStorage` on significant events (end of wave, end of game) and on dispose.

### `persistDirty` lifecycle

```ts
// src/game/GameEngine.ts
// Any mutation of this.persistState sets this.persistDirty = true.
// Examples:
//   this.persistState.gems += afterRegion;          → this.persistDirty = true;
//   markFirstTimeMilestone(this.persistState, ...); → this.persistDirty = true;
//   updateBestWave(this.persistState, ...);         → this.persistDirty = true;
```

The `buildSnapshot` function reads `engine.persistDirty` and includes it in the snapshot (`SimulationSnapshot.persistDirty`). The host reads it on each snapshot:

```ts
// In SvgGameRoot.vue's worker message handler, case "snapshot":
case "snapshot":
  snapshotStore.apply(msg.snapshot);
  if (msg.snapshot.persistDirty) {
    // Throttle: only flush on significant events, not every dirty snapshot.
    // For Phase 9, flush immediately on end-of-wave and end-of-game signals
    // (detected via snapshot.meta.state transitions or wave changes).
    // A simple heuristic: flush if persistDirty and (wave changed OR state changed OR 5s since last flush).
    maybeFlushPersist(msg.snapshot);
  }
  break;
```

### `schedulePersistSave` on the host

The `MainThreadHostBindings.schedulePersistSave` (Phase 0) currently does `Object.assign(persistStore.$state, state); persistStore.save();`. In Phase 9, the host receives a `PersistStateSlice` from the worker and applies it to the Pinia store. The slice must cover all fields the worker can mutate: `gems`, `bestWaves`, `activeWaves`, `firstTimeMilestones`, `firstClears`, `runHistory`, `highestUnlockedMap`, `difficulty`, `generalAddons`, `unlocked`.

```ts
// src/sim/MainThreadHostBindings.ts (Phase 9 update)
schedulePersistSave(state: PersistStateSlice): void {
  const persistStore = usePersistStore();
  // Field-by-field assignment to preserve Pinia reactivity on each field.
  // Object.assign on $state can break reactivity in some Pinia versions.
  persistStore.gems = state.gems;
  persistStore.bestWaves = { ...state.bestWaves };
  persistStore.activeWaves = { ...state.activeWaves };
  persistStore.firstTimeMilestones = { ...state.firstTimeMilestones };
  persistStore.firstClears = { ...state.firstClears };
  persistStore.runHistory = [...state.runHistory];
  persistStore.highestUnlockedMap = state.highestUnlockedMap;
  persistStore.difficulty = { ...state.difficulty };
  persistStore.generalAddons = { ...state.generalAddons };
  persistStore.unlocked = structuredClone(state.unlocked);
  persistStore.save();
}
```

### Throttling policy

Flush triggers:
1. **End of wave** — detected by `snapshot.meta.currentWave` increasing.
2. **End of game** — detected by `snapshot.meta.state` transitioning to `VICTORY` or `GAME_OVER`.
3. **Milestone claim** — detected by `snapshot.meta.milestoneRewardsClaimed` gaining a key.
4. **Dispose** — the worker's dispose handler posts a final `schedulePersistSave` synchronously before signaling ready-to-terminate.
5. **Fallback** — if no above trigger fires for 5 seconds and `persistDirty` is true, flush.

This is a behavior change from the current per-mutation save — saves are less frequent, so a browser crash between flushes could lose a small amount of progress (at most: one wave's worth of gem earnings). Acceptable for a single-player game; the tradeoff is much lower I/O on the main thread.

### Worker-side persist slice construction

When the worker's dispose handler (or the periodic flush) needs to send a persist slice, it constructs one from `engine.persistState`:

```ts
// src/sim/WorkerEntry.ts (inside the dispose handler and the periodic flush)
function buildPersistSlice(engine: GameEngine): PersistStateSlice {
  const p = engine.persistState;
  return {
    gems: p.gems,
    bestWaves: { ...p.bestWaves },
    activeWaves: { ...p.activeWaves },
    firstTimeMilestones: { ...p.firstTimeMilestones },
    firstClears: { ...p.firstClears },
    runHistory: [...p.runHistory],
    highestUnlockedMap: p.highestUnlockedMap,
    difficulty: { ...p.difficulty },
    generalAddons: { ...p.generalAddons },
    unlocked: structuredClone(p.unlocked),
  };
}
```

After posting, clear `engine.persistDirty = false`.

### Final wiring: `main.ts`

`main.ts` currently calls `persistStore.load()` and `mapThemeStore.preloadDefault()` before `app.mount()`. No change in Phase 9 — the worker is created lazily in `SvgGameRoot.vue` when the `/game` route mounts. The persist state is read from `persistStore.$state` at worker init time and posted in the `init` message.

### Test harness for worker round-trip

Add a Vitest environment that can spawn a real worker. Vitest supports this with the `--pool=forks` option and proper worker configuration:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    pool: "forks",
    server: {
      // ... Vite server config for worker resolution ...
    },
  },
});
```

```ts
// tests/integration/worker-roundtrip.test.ts
import { describe, it, expect } from "vitest";
import GameWorker from "@/sim/WorkerEntry.ts?worker";

describe("worker round-trip", () => {
  it("initializes and produces snapshots", async () => {
    const worker = new GameWorker();
    const firstSnapshot = new Promise((resolve) => {
      worker.addEventListener("message", (event) => {
        if (event.data.type === "snapshot") resolve(event.data.snapshot);
      });
    });

    worker.postMessage({
      type: "init",
      persistState: /* mock persist state */,
      themeBundle: /* mock theme bundle */,
      mapIndex: 0,
    });

    const snapshot = await firstSnapshot;
    expect(snapshot.meta.mapIndex).toBe(0);
    expect(snapshot.meta.gold).toBeGreaterThan(0);  // StartingGold applied
    worker.terminate();
  });
});
```

This is the smoke test for the worker architecture. A full integration test (run a wave, assert gold increases, enemies die, boss reaches base) is a larger investment — defer until the worker is stable.

---

## Phase 7–9 completion criteria

- [ ] `src/sim/WorkerEntry.ts` exists and is loadable as a Vite `?worker` entry.
- [ ] `GameEngine` constructor takes `(persistState, themeBundle, host, mapIndex, randomMapParams?)` — no Pinia store arguments.
- [ ] Worker owns the simulation loop via `setTimeout`-driven fixed-timestep accumulator; `requestAnimationFrame` is no longer referenced in `src/game/` or `src/sim/`.
- [ ] Command queue is drained at the start of each tick; input/sim race conditions are impossible by construction.
- [ ] `WorkerHostBindings` posts `playSound`/`notifyUi`/`schedulePersistSave`/`requestConfirm` messages; main thread handles each and posts `confirmResult` back.
- [ ] `SnapshotStore` mirrors snapshots into `gameStore` for Vue reactivity; `gameStore.engine` field is deleted; `gameStore.worker` field is set by `SvgGameRoot.vue` and read by the router guard.
- [ ] `selectedTowerType` is host-authoritative — the worker echoes it back unchanged in `meta.selectedTowerType` and never writes it; no `action:selectBuildType` command exists.
- [ ] Render loop reads exclusively from `SnapshotStore`; no reads of `engine.*` or `gameStore.enemyManager`/`towerManager`/etc. from the render path.
- [ ] Hover and `hoverUpgradeBtn` are main-thread-only; `GameEngine.setHover` is deleted.
- [ ] Persistence is batched: `persistDirty` flag on the snapshot; host flushes on wave-end, game-end, milestone-claim, dispose, and a 5-second fallback.
- [ ] Router guard posts `dispose` and terminates the worker; `persistStore.save()` runs as a fallback on the main thread.
- [ ] `tests/integration/worker-roundtrip.test.ts` exists and passes.
- [ ] All ~710 pre-existing tests pass (with the mechanical updates noted across Phases 0–9).

Once these are met, the simulation runs in a dedicated worker, the main thread is free to render at the browser's refresh rate, and the architecture is ready for the future scaling moves in `ArchitecturePlan.md` §4 (SAB ring buffer, WASM numerical core, LLM commander plane, alternative renderers).
