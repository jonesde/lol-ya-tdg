# Commander Stubbs — Implementation Plan (Web Worker, LLM-shaped)

## Goal
A test stub for the eventual LLM enemy-commander. Stubbs is a **client of the game sim**
(not part of it) that runs in **his own Web Worker**, shaped to mirror the eventual LLM
commander plane (ArchitecturePlan §4.3) as closely as possible so we can use him to test
and refine the LLM interface before a real model is wired in.

The worker receives a throttled **snapshot slice** from the main thread (it cannot read
`getLatestSnapshot()` directly — that state is main-thread-only), builds the abstracted
**observation JSON** itself, runs a strategy, and posts `llm:*` commands back. The main
thread relays those commands into the simulation via the existing
`dispatchCommand` → sim worker seam. The sim worker, the snapshot ack gate, and
`Command` schema are all unchanged.

The worker's "brain" is a pluggable interface so a future `LLMBrain` (prompt-assembly +
API call + response parsing) can replace `StubbsBrain` with no change to the transport,
protocol, or engine wiring.

---

## 1. Command schema (`src/sim/Command.ts`)
Replace the no-op `llm:*` stubs with a usable shape (enemies are addressed by id, since
the snapshot exposes `enemy.id: number`):
```ts
| { commandId: number; type: "llm:holdFormation"; enemyIds: number[]; holdTile: { x: number; y: number } }
| { commandId: number; type: "llm:routeGroup"; enemyIds: number[]; waypoints: Array<{ x: number; y: number }> }
| { commandId: number; type: "llm:setTargeting"; enemyIds: number[]; mode: string }
```
- `llm:routeGroup` with **empty `waypoints`** = "release to default path" (used by Stubbs
  to rush the base).
- `llm:routeGroup` with waypoints = routed path through the supplied waypoints to the base.
  **Constraint (enforced by the engine):** enemies can only traverse `path`/`base`/`spawn`
  tiles — `bfsShortestPath` refuses terrain neighbors (see `src/sim/grid/Pathfinding.ts`). So
  every waypoint MUST lie on a path tile or it cannot be routed; there is no true "any tile"
  destination capability today. The field stays in the schema for the eventual LLM, which will
  be told (via the observation / prompt) to only emit path-tile waypoints.
- These are the *exact* command surface the eventual LLM will emit.

## 2. Engine wiring (`src/sim/applyCommand.ts` + `src/sim/GameEngine.ts`)
- `applyCommand.ts`: implement the three `llm:*` cases (return `true` so the worker
  force-posts the snapshot). Each calls a new `GameEngine` method:
  - `applyCommanderHold(enemyIds, holdTile)` → `enemy.setHoldMode(holdTile)`
  - `applyCommanderRoute(enemyIds, waypoints)` → compute a routed path and `enemy.setRoutePath(path)`
  - `applyCommanderSetTargeting(enemyIds, mode)` → store `enemy.targetingMode` (used only
    by future logic; harmless now)
- `GameEngine` computes each enemy's routed path by chaining
  `bfsShortestPath(grid, currentTile, wp, blocked)` (from `src/sim/grid/Pathfinding.ts`)
  through each waypoint, then to `grid.base`, dropping duplicate joints. Reuses the
  existing BFS avoidance of live towers.

## 3. Enemy routing override (`src/sim/enemies/Enemy.ts`)
Add state + behavior, taking precedence over the default grid path:
- Fields: `routingMode: "default" | "hold" | "route"`, `holdTile`, `routedPath`, `routedIdx`.
- `setHoldMode(tile)`: enemy advances toward `holdTile` center and stops there (still
  attacks towers in contact, reusing existing approach/attack logic with `holdTile` as the
  target).
- `setRoutePath(path)`: follow `routedPath` waypoints; when exhausted, revert
  `routingMode = "default"` and re-anchor to the grid path to the base.
- In `update()`, gate the existing `reanchorToPath`/path-follow block on
  `routingMode === "default"`; for `hold`/`route` drive movement off `holdTile`/`routedPath`.
  Minimize refactor by injecting only the "current target tile" decision.

## 4. Snapshot additions (for Stubbs' observation + wave-emergence detection)
`src/sim/SimulationSnapshot.ts` + `src/sim/SnapshotSerializer.ts`:
- **`gridLayout: number[][]`** posted on `grid.pathVersion` change (gated like `paths`):
  `0=terrain, 1=path, 2=base, 3=spawn`, built from `engine.grid.tiles`. Satisfies the
  "binary Path/Terrain map" requirement.
- **`meta.remainingScheduledSpawns`** = `engine.waveManager.queue.length` (count of enemies
  still scheduled to spawn this wave). This — not the overflow-only pending queue — is
  the correct "entire wave emerged" signal. `pendingEnemyCount` (sum of
  `getPendingCountForSpawn`) counts only the overflow queue (used when the render pool
  is exhausted) and is `0` for almost every wave, so it alone cannot detect emergence.
  Stubbs rushes when `remainingScheduledSpawns === 0` AND the overflow pending count
  is `0` (i.e. every enemy is now active on the field, held by Stubbs).
- **`meta.tileSize`** (always included) so Stubbs converts world `x/y` → tile coords with
  the correct constant.

## 5. Commander client — `src/commanders/` (own Web Worker, option B)
Stubbs is a client of the sim, in his own worker. Layout:

- `src/commanders/protocol.ts`: `MainToCommanderMessage` / `CommanderToMainMessage`
  (mirrors `src/sim/WorkerProtocol.ts`) — `start`, `stop`, `observation` (snapshot slice),
  `commands` (array of `llm:*` `Command`s). Keeps the two sides decoupled and serializable.
- `src/commanders/stubbs/observation.ts`: `buildObservation(snapshotSlice): CommanderObservation`
  — pure function turning the throttled snapshot slice into the abstracted JSON
  (`{ map, enemies, towers, wave }`). This is the "semantic view" projection from §4.3.
- `src/commanders/stubbs/brain.ts`: `CommanderBrain` interface —
  `decide(observation, memory): CommanderCommand[]` — the pluggable brain. `StubbsBrain`
  implements the hold-then-rush strategy deterministically; a future `LLMBrain` would
  assemble a prompt, call the API, parse the response into the same command shape.
- `src/commanders/stubbs/StubbsWorker.ts`: the worker entry
  (`new Worker(new URL("./StubbsWorker.ts", import.meta.url), { type: "module" })`).
  Holds a `StubbsBrain`, a small per-wave `memory` (phase + seen-enemy-id set + wave seen),
  and an `onmessage` handler: on `observation` it runs
  `buildObservation` → `brain.decide` → posts `commands` back. No rAF, no DOM, no
  `getLatestSnapshot` — it is fed.
- `src/commanders/stubbs/relay.ts`: the **main-thread** half. A ~4 Hz loop (setInterval,
  250 ms, per §4.3's 1–5 Hz) reads `getLatestSnapshot()`, posts a throttled snapshot slice
  to the worker, and listens for `commands` which it forwards via `dispatchCommand`. It
  **never posts `snapshotAck`** (passive consumer). This relay is the only piece that
  touches the snapshot module / command bus.
- `src/commanders/index.ts`: `setEnemyCommander(kind: "none" | "stubbs")` /
  `stopEnemyCommander()` — owns the worker + relay lifecycle (create/terminate the worker
  when switching modes).

### Observation JSON built in the worker (`buildObservation`)
```ts
{
  map: gridLayout,                       // 0=terrain,1=path,2=base,3=spawn
  enemies: [{ id, tileX, tileY, level, hp, maxHp }],
  towers:  [{ tileX, tileY, level, hp, maxHp }],
  wave: { currentWave, pendingEnemyCount, spawnStates }
}
```
World `x/y` are converted to tile coords inside the worker using `meta.tileSize`.

### Strategy (`StubbsBrain.decide`) — state machine `idle → holding → rushing`, per wave
- While spawning (`pendingEnemyCount > 0` or any spawn open): issue `llm:holdFormation`
  for **newly-seen** enemy ids, holding each at its **current tile** (≈ near spawn),
  tracked in the brain's `memory` set to avoid re-dispatching.
- Once `remainingScheduledSpawns === 0` **and** the overflow pending count is `0`
  (all enemies have emerged and are active on the field): issue one
  `llm:routeGroup(enemyIds, [])` to release *all* to rush the base at once; record
  `currentWave` so it doesn't re-fire.
  (Note: `spawnStates` only transitions to `closed` after the wave is fully cleared
  — too late for this trigger — so use `remainingScheduledSpawns` + overflow pending,
  not `spawnStates`, to decide.)
- On next wave (wave number change / new countdown): reset to `idle`.

## 6. UI — pause menu drop-down (`src/stores/ui.ts` + `src/components/PauseMenu.vue`)
- `ui.ts`: add `enemyCommander: "none" | "stubbs"` (default `"none"`) + `setEnemyCommander(kind)`
  action that updates state **and** calls `setEnemyCommander`/`stopEnemyCommander` from the
  commanders module (which creates/terminates the worker + relay).
- `PauseMenu.vue`: add an **"Enemy Commander"** `<select>` with options *No Commander* /
  *Commander Stubbs*, bound to `uiStore.enemyCommander`.
- `SvgGameRoot.vue` (`onUnmounted` near `setCommandDispatcher(null)`): call
  `stopEnemyCommander()` so the worker + relay never leak when leaving `/game`.

## 7. Tests
- `tests/unit/commanders/observation.test.ts`: `buildObservation` over a fake snapshot slice
  → expected JSON shape (map codes, tile-coord conversion via tileSize, wave block).
- `tests/unit/commanders/stubbs-brain.test.ts`: feed fake observations; assert the
  hold→rush transition (hold while `remainingScheduledSpawns > 0`, single release
  when `remainingScheduledSpawns === 0` and overflow pending is `0`), idempotent
  re-dispatch, and per-wave reset. Pure-function tests, no worker.
- `tests/unit/sim/enemy-routing.test.ts`: `setHoldMode` freezes advance; `setRoutePath`
  follows waypoints; empty-waypoint release reverts to default path / reaches base.
- `tests/unit/sim/applyCommand.test.ts` (extend): `llm:*` commands no longer no-op and
  mutate state.
- `tests/integration/commander.test.ts`: spin up a real `GameEngine` plus a
  test-local `CommandDispatcher` that forwards to `applyCommand(engine, cmd)`, and
  drive the **real Stubbs worker** via the existing mock-`self` import pattern
  (see `tests/integration/worker-roundtrip.test.ts`, which mocks the
  `DedicatedWorkerGlobalScope` and imports `@/commanders/stubbs/StubbsWorker.ts`).
  Feed the worker a `sim`/`observation` message built from `getLatestSnapshot()`
  after a wave has spawned, capture its `commands` posts, and apply them back
  through `applyCommand`. Assert enemies stay put (don't advance) while spawning,
  then all advance to the base together on the rush. `MainThreadCommandDispatcher`
  no longer exists (removed in Phase 7), so do **not** instantiate it.

## 8. Notes / risks
- Stubbs is a **command producer only**; everything stays within the existing spine. The
  sim worker, snapshot ack gate, and `Command` schema are untouched.
- The relay sends an *abstracted, throttled slice* to the worker — not the raw 60 Hz
  snapshot stream — so the single-ack backpressure design is unaffected (TECHNICAL.md
  "Snapshot Backpressure" open point is not engaged).
- Holding at "current tile" is a safe approximation of "near spawn" and avoids adding
  `spawnIndex` to the snapshot; revisit if exact spawn-tile loitering is desired.
- The drop-down default `none` keeps the game fully playable without the commander
  (ArchitecturePlan §2.2 / §4.3 requirement).
- **LLM-interface closeness:** `CommanderBrain`, `buildObservation`, and the `protocol`
  messages are exactly the seams the real LLM commander will use. Swapping `StubbsBrain`
  for `LLMBrain` (API transport + prompt + parse) is an isolated change with no engine,
  protocol, or UI impact — this is the point of building Stubbs this way.
- **`llm:routeGroup` waypoints must be path tiles.** Enemies can only traverse
  `path`/`base`/`spawn` tiles (BFS refuses terrain), so arbitrary-tile routing is
  impossible today. Keep the `waypoints` field for the eventual LLM, but document
  the constraint at the `Command` schema and have `buildObservation`/`StubbsBrain`
  only ever emit path-tile waypoints (Stubbs itself only uses the empty-waypoint
  release).
- **Rush signal is `remainingScheduledSpawns` (wave `queue.length`), not the
  overflow-only `pendingEnemyCount` nor `spawnStates`.** `spawnStates` close only
  after a wave is fully cleared (too late); the overflow pending count is `0` for
  almost every wave. `remainingScheduledSpawns === 0` (plus overflow pending `0`)
  is the correct "all enemies have emerged" test.
- **`PRE_EMPTIVE_WAVE_TIMER`** may start the next wave while Stubbs is still holding
  the previous wave's enemies alive. The per-wave reset (§5) handles this, but
  verify the rush can fire before the next wave's spawns dilute the "seen" set.
- All commander code (`src/commanders/`) depends on the sim only through the public seams:
  `getLatestSnapshot()`, `dispatchCommand`, and the `SimulationSnapshot`/`Command` types.
