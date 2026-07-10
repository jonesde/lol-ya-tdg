# Enemy Commanders — Implementation Plan (Web Worker, LLM-shaped)

## Goal
A test stub for the eventual LLM enemy-commander. Stubby is a **client of the game sim**
(not part of it) that runs in **his own Web Worker**, shaped to mirror the eventual LLM
commander plane (ArchitecturePlan §4.3) as closely as possible so we can use him to test
and refine the LLM interface before a real model is wired in.

This plan now covers **two** stub brains behind the same shared transport/observation
seam: **Sergeant Stubby** (hold-then-rush, §5) and **Commander Stubbs** (aggressive
tower-routing, §10). Both plug into the identical `CommanderBrain` interface; only the
decision logic differs. Having two strategies is what makes this a strong test case:
Stubby exercises hold + empty-waypoint release, while Stubbs exercises the non-empty
`waypoints` routing path (see §10).

The worker receives a throttled **snapshot slice** from the main thread (it cannot read
`getLatestSnapshot()` directly — that state is main-thread-only), builds the abstracted
**observation JSON** itself, runs a strategy, and posts `llm:*` commands back. The main
thread relays those commands into the simulation via the existing
`dispatchCommand` → sim worker seam. The sim worker, the snapshot ack gate, and
`Command` schema are all unchanged.

The worker's "brain" is a pluggable interface so a future `LLMBrain` (prompt-assembly +
API call + response parsing) can replace `StubbyBrain` with no change to the transport,
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
- `llm:routeGroup` with **empty `waypoints`** = "release to default path" (used by Stubby
  to rush the base).
- `llm:routeGroup` with waypoints = routed path through the supplied waypoints to the base.
  **Constraint (enforced by the engine):** enemies can only traverse `path`/`base`/`spawn`
  tiles — `bfsShortestPath` refuses terrain neighbors (see `src/sim/grid/Pathfinding.ts`). So
  every waypoint MUST lie on a path tile or it cannot be routed; there is no true "any tile"
  destination capability today. The field stays in the schema for the eventual LLM, which will
  be told (via the observation / prompt) to only emit path-tile waypoints.
- These are the *exact* command surface the eventual LLM will emit.

## 2. Engine wiring (`src/sim/applyCommand.ts` + `src/sim/GameEngine.ts`)
- `GameEngine.ts`: extend the `WaveManagerRef` interface (lines 65-79) to expose the
  fields the commander needs, keeping the interface narrow per the existing pattern
  (avoid leaking the internal `WaveEntry` type):
  - `active: boolean` — whether a wave has begun (set `true` in `startNextWave`).
  - `getRemainingScheduledSpawns(): number` — returns `queue.length`, the count of
    enemies still scheduled to spawn this wave. Implement on `WaveManager` alongside
    the existing `active` field; the serializer reads
    `engine.waveManager?.getRemainingScheduledSpawns() ?? 0`.
- `applyCommand.ts`: implement the three `llm:*` cases (return `true` so the worker
  force-posts the snapshot). Each calls a new `GameEngine` method:
  - `applyCommanderHold(enemyIds, holdTile)` → `enemy.setHoldMode(holdTile)`
  - `applyCommanderRoute(enemyIds, waypoints)` → compute a routed path and `enemy.setRoutePath(path)`
  - `applyCommanderSetTargeting(enemyIds, mode)` → store `enemy.targetingMode` (used only
    by future logic; harmless now)
- `GameEngine` computes each enemy's routed path by chaining a **route-to-base** call
  through each waypoint, then to `grid.base`, dropping duplicate joints. This must use the
  **exact same routing enemies already use to reach the base** — `bfsShortestPath` alone is
  insufficient because it refuses tower tiles, whereas real enemy routing falls back to
  `dijkstraWeakestPath` (which routes *through* live towers, weighted by remaining health).
  So add a new `Grid` method, e.g. `computeRouteToBase(start: Point): Point[] | null`, that
  mirrors `Grid.recomputePaths` (`Grid.ts:222-246`):
  `bfsShortestPath(this, start, this.base, this.blocked) ?? dijkstraWeakestPath(this, start, this.base, this.towerHealthAt, this.isGhostAt)`
  (`dijkstraWeakestPath` at `Pathfinding.ts:168`). `applyCommanderRoute` chains
  `computeRouteToBase` from `currentTile → wp1 → … → wpN → base`, concatenating the segments
  and dropping duplicate joints. This keeps commander routing behavior-identical to the
  default enemy path, including the tower-crossing fallback.

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

## 4. Snapshot additions (for Stubby's observation + wave-emergence detection)
`src/sim/SimulationSnapshot.ts` + `src/sim/SnapshotSerializer.ts`:
- **`gridLayout: number[][]` (sent once per run, not every tick).** `gridLayout`
  (`0=terrain, 1=path, 2=base, 3=spawn`, built from `engine.grid.tiles`) is constant
  for a whole run — terrain tiles never change mid-run (only tower build/sell changes
  `pathVersion`, which must **not** trigger a re-send). So gate it with a plain boolean,
  not the `pathVersion` mechanism:
  - Add `gridLayoutSent: boolean = false` to `GameEngine` (reset to `false` in
    `_initMap` so a new run re-sends).
  - In `buildSnapshot`, include `gridLayout` only when `!engine.gridLayoutSent`; on
    first include, set `engine.gridLayoutSent = true`.
  - Add `gridLayout: number[][] | undefined` to `SimulationSnapshot` (present on exactly
    the first posted snapshot of a run; `undefined` thereafter).
  - The relay forwards the slice as-is; **Sergeant Stubby caches `gridLayout` in worker
    `memory` on first receipt and reuses it for every later `buildObservation`** (it never
    changes). This keeps the steady-state per-tick cost at zero.
- **`meta.remainingScheduledSpawns`** = `engine.waveManager.getRemainingScheduledSpawns()`
  (count of enemies still scheduled to spawn this wave, i.e. `queue.length`). This — not
  the overflow-only pending queue — is the correct "entire wave emerged" signal.
  `pendingEnemyCount` (sum of `getPendingCountForSpawn`) counts only the overflow queue
  (used when the render pool is exhausted) and is `0` for almost every wave, so it alone
  cannot detect emergence. Stubby rushes when `remainingScheduledSpawns === 0` AND the
  overflow pending count is `0` (i.e. every enemy is now active on the field, held by
  Stubby).
- **`meta.tileSize`** = `engine.grid?.tileSize ?? 36` (read from `Grid`, **not**
  `GameRunState` — `tileSize` lives on `Grid`, not on the run-state scalars). Always
  included so Stubby converts world `x/y` → tile coords with the correct constant.
- **`meta.waveActive`** = `engine.waveManager?.active ?? false` (set `true` in
  `startNextWave`; never reset). Included so the observation carries the wave-active flag
  for future use (it is **not** a valid rush signal — see §5/§8).

## 5. Commander client — `src/commanders/` (own Web Worker, option B)
Stubby is a client of the sim, in his own worker. The infrastructure is **brain-agnostic**
so a second commander (Commander Stubbs, §10) reuses all of it — only the brain differs.
Layout (shared pieces at `src/commanders/`, per-commander brains under their own folder):

- `src/commanders/protocol.ts`: `MainToCommanderMessage` / `CommanderToMainMessage`
  (mirrors `src/sim/WorkerProtocol.ts`) — `start` (carries `kind: "stubby" | "stubbs"` so
  the shared worker instantiates the matching brain), `stop`, `observation` (snapshot
  slice), `commands` (array of `llm:*` `Command`s). Keeps the two sides decoupled and
  serializable.
  Define the slice type explicitly so the worker's input contract is intentional (not "the
  whole snapshot"):
  ```ts
  // The abstracted, throttled view the relay sends to the worker. Built from
  // getLatestSnapshot(); everything Stubby needs, nothing it doesn't.
  export interface CommanderSnapshotSlice {
    gridLayout: number[][] | undefined;   // present on the first slice of a run, undefined after
    enemies: EnemySnapshot[];
    towers: TowerSnapshot[];
    spawnStates: SpawnStateSnapshot[];
    meta: SnapshotMeta;                   // includes remainingScheduledSpawns, tileSize, waveActive
  }
  ```
  `MainToCommanderMessage.observation` carries a `CommanderSnapshotSlice`.
- `src/commanders/observation.ts` (shared): `buildObservation(snapshotSlice): CommanderObservation`
  — pure function turning the throttled snapshot slice into the abstracted JSON
  (`{ map, enemies, towers, wave }`). This is the "semantic view" projection from §4.3.
  Brain-agnostic: both Stubby and Stubbs consume the same observation.
- `src/commanders/brain.ts` (shared): `CommanderBrain` interface —
  `decide(observation, memory): CommanderCommand[]` — the pluggable brain, plus a small
  `createBrain(kind)` registry. `src/commanders/stubby/brain.ts` (`StubbyBrain`)
  implements the hold-then-rush strategy deterministically; `src/commanders/stubbs/brain.ts`
  (`StubbsBrain`, §10) implements the aggressive tower-routing strategy. A future `LLMBrain`
  would assemble a prompt, call the API, parse the response into the same command shape.
- `src/commanders/CommanderWorker.ts` (shared): the worker entry
  (`new Worker(new URL("./CommanderWorker.ts", import.meta.url), { type: "module" })`).
  On `start` it builds the brain via `createBrain(kind)`; holds a small per-wave `memory`
  (seen-enemy-id set keyed by wave + strategy scratch), and an `onmessage` handler: on
  `observation` it runs `buildObservation` → `brain.decide` → posts `commands` back. No
  rAF, no DOM, no `getLatestSnapshot` — it is fed.
- `src/commanders/relay.ts` (shared): the **main-thread** half. A ~4 Hz loop (setInterval,
  250 ms, per §4.3's 1–5 Hz) reads `getLatestSnapshot()`, posts a throttled snapshot slice
  to the worker, and listens for `commands` which it forwards via `dispatchCommand`. It
  **never posts `snapshotAck`** (passive consumer). This relay is the only piece that
  touches the snapshot module / command bus.
- `src/commanders/index.ts`: `setEnemyCommander(kind: "none" | "stubby" | "stubbs")` /
  `stopEnemyCommander()` — owns the worker + relay lifecycle (create/terminate the worker
  when switching modes), forwarding `kind` in the `start` message.

### Observation JSON built in the worker (`buildObservation`)
```ts
// In CommanderWorker.onmessage(observation): cache gridLayout once, then reuse it.
if (slice.gridLayout) memory.gridLayout = slice.gridLayout;

// buildObservation reads the cached gridLayout, not the per-tick slice:
{
  map: memory.gridLayout,                // cached; 0=terrain,1=path,2=base,3=spawn
  enemies: [{ id, tileX, tileY, level, hp, maxHp }],
  towers:  [{ tileX, tileY, level, hp, maxHp }],
  wave: { currentWave, pendingEnemyCount, spawnStates, remainingScheduledSpawns, active }
}
```
`remainingScheduledSpawns` and `active` come from `meta` / `waveManager`; world `x/y`
are converted to tile coords inside the worker using `meta.tileSize`.

### Strategy (`StubbyBrain.decide`) — state machine `idle → holding → rushing`, per wave
- **Memory shape:** `memory` holds `phase: "idle" | "holding" | "rushing"`,
  `seenByWave: Map<number, Set<number>>` (enemy ids seen, keyed by wave number — see
  hardening below), `lastRushWaveNumber: number | null`, and the cached `gridLayout`.
- While spawning (`pendingEnemyCount > 0` or `remainingScheduledSpawns > 0`): issue
  `llm:holdFormation` for **newly-seen** enemy ids in the *current* wave, holding each
  at its **current tile** (≈ near spawn), tracked in `seenByWave.get(currentWave)` to
  avoid re-dispatching. New-wave enemy ids never leak into a previous wave's set.
- Once `remainingScheduledSpawns === 0` **and** the overflow pending count is `0`
  (all enemies have emerged and are active on the field): issue one
  `llm:routeGroup(enemyIds, [])` to release *only the current wave's* seen ids
  (`seenByWave.get(currentWave)`) to rush the base at once; set
  `memory.lastRushWaveNumber = currentWave` and clear that wave's set so it doesn't
  re-fire.
  (Note: `spawnStates` only transitions to `closed` after the wave is fully cleared
  — too late for this trigger — so use `remainingScheduledSpawns` + overflow pending,
  not `spawnStates`, to decide. `wave.active` is included in the observation for future
  use, but it is **not** a valid rush signal — `WaveManager.active` is set `true` at wave
  start and never reset, so it stays `true` after wave 1 and cannot distinguish
  "spawning" from "wave in progress".)
- On next wave (wave number change / new countdown): reset to `idle` and create a fresh
  `seenByWave` entry for the new wave.

### Hardening: PRE_EMPTIVE_WAVE_TIMER race (feedback §8 #5)
`PRE_EMPTIVE_WAVE_TIMER` (90 s) may start the next wave while Stubby still holds the
previous wave's enemies alive. The wave-number-keyed `seenByWave` set prevents the
rush command from being diluted: the rush captures **only** `seenByWave.get(currentWave)`
at fire time, so next-wave spillover enemies (which have a different wave number) are
never folded into the released set. Furthermore, `remainingScheduledSpawns` becomes
`> 0` the instant the next wave's queue is populated (`startNextWave` pushes the new
queue immediately), so the rush trigger can never fire *after* new-wave enemies exist —
the captured id set is always the held wave's enemies only. No separate "block
re-enter idle" flag is needed; wave-number keying plus the `remainingScheduledSpawns`
guard is sufficient.

## 6. UI — pause menu drop-down (`src/stores/ui.ts` + `src/components/PauseMenu.vue`)
- `ui.ts`: add `enemyCommander: "none" | "stubby" | "stubbs"` (default `"none"`) +
  `setEnemyCommander(kind)` action that updates state **and** calls
  `setEnemyCommander`/`stopEnemyCommander` from the commanders module (which
  creates/terminates the worker + relay).
- `PauseMenu.vue`: add an **"Enemy Commander"** `<select>` with options *No Commander* /
  *Sergeant Stubby* / *Commander Stubbs*, bound to `uiStore.enemyCommander`.
- `SvgGameRoot.vue` (`onUnmounted` near `setCommandDispatcher(null)`): call
  `stopEnemyCommander()` so the worker + relay never leak when leaving `/game`.
- **Commander-stop cleanup (prevents frozen enemies):** `stopEnemyCommander()` must
  release any enemies it left in `hold` mode before terminating the worker + relay.
  On the main thread it has access to both `getLatestSnapshot()` and `dispatchCommand`,
  so immediately before terminating: read the current enemy ids from the latest snapshot
  (`getLatestSnapshot()?.enemies.map(e => e.id)`) and dispatch a single
  `llm:routeGroup(enemyIds, [])` (empty waypoints = "release to default path") so every
  held enemy reverts `routingMode = "default"` and re-anchors to its grid path. This is
  required both when the user switches the drop-down back to *No Commander* and on
  `SvgGameRoot` unmount. Without it, held enemies would stay frozen forever because no
  release command is ever sent. This cleanup applies regardless of which commander was
  active — for Commander Stubbs (who never holds) the release is a harmless no-op that
  simply re-anchors enemies to their default path.

## 7. Tests
- `tests/unit/commanders/observation.test.ts`: `buildObservation` over a fake snapshot slice
  → expected JSON shape (map codes from the **cached** `gridLayout` — present on the first
  slice, `undefined` thereafter and reused from memory; tile-coord conversion via
  `meta.tileSize`; `wave` block includes `remainingScheduledSpawns` and `active`).
- `tests/unit/commanders/stubby-brain.test.ts`: feed fake observations; assert the
  hold→rush transition (hold while `remainingScheduledSpawns > 0`, single release
  when `remainingScheduledSpawns === 0` and overflow pending is `0`), idempotent
  re-dispatch, and per-wave reset. **Also assert the rush captures only the current
  wave's seen ids when a wave boundary occurs (wave-number-keyed `seenByWave`), and
  that the rush does not fire when `remainingScheduledSpawns > 0` (next-wave spillover
  guard).** Pure-function tests, no worker.
- `tests/unit/commanders/stubbs-brain.test.ts`: feed fake observations; assert the
  aggressive tower-routing behavior — enemies are routed **immediately** on being seen
  (no hold), the emitted `llm:routeGroup` waypoints steer toward the strongest tower
  cluster, a re-route fires when the observed `towers` set changes (targeted tower dies
  or a new tower appears), and dispatch is idempotent per wave / resets across waves.
  Pure-function tests, no worker.
- `tests/unit/sim/enemy-routing.test.ts`: `setHoldMode` freezes advance; `setRoutePath`
  follows waypoints; empty-waypoint release reverts to default path / reaches base.
- `tests/unit/sim/applyCommand.test.ts` (extend): `llm:*` commands no longer no-op and
  mutate state.

## 8. Integration test (separate phase)
Implement the real-Stubby-worker round-trip **after** the unit tests above. `stubby-brain.test.ts`
already covers the hold→rush state machine (including the wave-boundary and spillover
guards), so this integration test can stay lean — it validates the transport + engine seam,
not the decision logic.
- `tests/integration/commander.test.ts`: spin up a real `GameEngine` plus a
  test-local `CommandDispatcher` that forwards to `applyCommand(engine, cmd)`, and
  drive the **real shared commander worker started with `kind: "stubby"`** via the
  existing mock-`self` import pattern (see `tests/integration/worker-roundtrip.test.ts`,
  which mocks the `DedicatedWorkerGlobalScope` and imports
  `@/commanders/CommanderWorker.ts`).
  Feed the worker an `observation` message built from `getLatestSnapshot()`
  after a wave has spawned, capture its `commands` posts, and apply them back
  through `applyCommand`. Assert enemies stay put (don't advance) while spawning,
  then all advance to the base together on the rush. `MainThreadCommandDispatcher`
  no longer exists (removed in Phase 7), so do **not** instantiate it.

## 9. Notes / risks
- Stubby is a **command producer only**; everything stays within the existing spine. The
  sim worker, snapshot ack gate, and `Command` schema are untouched.
- The relay sends an *abstracted, throttled slice* to the worker — not the raw 60 Hz
  snapshot stream — so the single-ack backpressure design is unaffected (TECHNICAL.md
  "Snapshot Backpressure" open point is not engaged).
- Holding at "current tile" is a safe approximation of "near spawn" and avoids adding
  `spawnIndex` to the snapshot; revisit if exact spawn-tile loitering is desired.
- The drop-down default `none` keeps the game fully playable without the commander
  (ArchitecturePlan §2.2 / §4.3 requirement).
- **LLM-interface closeness:** `CommanderBrain`, `buildObservation`, and the `protocol`
  messages are exactly the seams the real LLM commander will use. Swapping `StubbyBrain`
  for `LLMBrain` (API transport + prompt + parse) is an isolated change with no engine,
  protocol, or UI impact — this is the point of building Stubby this way.
- **The observation carries the full semantic view even though `StubbyBrain` doesn't use
  all of it.** `buildObservation` exposes every enemy (with tile/hp), every tower, the
  `map`/`gridLayout`, `wave.active` (`meta.waveActive`), and the `waypoints` field, so a
  future `LLMBrain` has everything it needs. `StubbyBrain`'s current deterministic strategy
  only consumes a subset (hold-at-current-tile + empty-waypoint release); the unused fields
  are present for forward-compat, not dead code.
- **`llm:routeGroup` waypoints must be path tiles.** Enemies can only traverse
  `path`/`base`/`spawn` tiles (both `bfsShortestPath` and `dijkstraWeakestPath` only visit
  those), so arbitrary-tile routing is impossible today. Routing between waypoints uses
  `Grid.computeRouteToBase` (bfs + `dijkstraWeakestPath` fallback), the **same logic the
  default enemy path uses**, so it can cross towers. Keep the `waypoints` field for the
  eventual LLM, but document the constraint at the `Command` schema and have
  `buildObservation`/`StubbyBrain` only ever emit path-tile waypoints (Stubby itself only
  uses the empty-waypoint release).
- **Rush signal is `remainingScheduledSpawns` (wave `queue.length`), not the
  overflow-only `pendingEnemyCount` nor `spawnStates`.** `spawnStates` close only
  after a wave is fully cleared (too late); the overflow pending count is `0` for
  almost every wave. `remainingScheduledSpawns === 0` (plus overflow pending `0`)
  is the correct "all enemies have emerged" test. `wave.active` (`meta.waveActive`) is
  exposed for future use but is **not** a rush signal: `WaveManager.active` is set `true` at
  wave start and never reset, so it stays `true` after wave 1.
- **`gridLayout` is shipped once per run** (gated by a `gridLayoutSent` boolean, not
  `pathVersion`) because terrain is run-constant; Stubby caches it in worker memory.
  No re-send on tower build/sell.
- **`PRE_EMPTIVE_WAVE_TIMER` race (90 s) is mitigated by wave-number-keyed `seenByWave`
  plus the `remainingScheduledSpawns` guard (see §5).** The rush captures only the
  current wave's seen ids, and cannot fire once the next wave's queue is populated, so
  spillover enemies are never folded into a released rush command.
- **Commander-stop cleanup (`stopEnemyCommander`, see §6):** before terminating the
  worker + relay it dispatches `llm:routeGroup(allCurrentEnemyIds, [])` to release any
  held enemies back to their default path. Without this, disabling the commander (drop-down
  back to *No Commander*, or leaving `/game`) would leave held enemies frozen forever, since
  no release command is ever sent.
- All commander code (`src/commanders/`) depends on the sim only through the public seams:
  `getLatestSnapshot()`, `dispatchCommand`, and the `SimulationSnapshot`/`Command` types.

## 10. Second commander — Commander Stubbs (aggressive tower-routing)
Commander Stubbs is a second stub brain that plugs into the exact same shared transport,
observation, worker, and relay as Stubby (§5). Only `src/commanders/stubbs/brain.ts`
(`StubbsBrain`) is new; the worker selects it via `createBrain("stubbs")`.

### Why he's a better test case
Stubby only ever emits `llm:holdFormation` and `llm:routeGroup(enemyIds, [])` — the
**empty-waypoint** ("release to default path") form. He therefore never exercises the
non-empty-`waypoints` routing path: `applyCommanderRoute` → `Grid.computeRouteToBase`
(§2) → the `dijkstraWeakestPath` tower-crossing fallback (`Pathfinding.ts:168`). Commander
Stubbs's whole strategy is built on non-empty waypoints, so adding him covers that engine
seam end-to-end. **No engine, schema, snapshot, or protocol changes are needed** — Stubbs
reuses the `llm:routeGroup` command and `computeRouteToBase` machinery §1/§2 already
specify.

### Strategy (`StubbsBrain.decide`) — aggressive, never holds
- **Memory shape:** `seenByWave: Map<number, Set<number>>` (enemy ids already routed,
  keyed by wave, same anti-re-dispatch pattern as §5), `lastRoutedTowerSignature: string`
  (a stable hash of the towers set — tile coords + ids — used to detect when a re-route is
  warranted), and the cached `gridLayout`.
- **On newly-seen enemies** (ids in the current wave not yet in `seenByWave.get(wave)`):
  immediately emit `llm:routeGroup(enemyIds, waypoints)` — **no hold phase at all**.
  Waypoints steer the group **through the strongest tower cluster** so the enemies attack
  and destroy those towers (reusing the existing in-contact approach/attack logic) on
  their way to the base. Add the ids to `seenByWave.get(wave)`.
- **Target selection:** from the observation `towers` (each has `tileX/tileY/hp/maxHp`),
  pick the highest-value cluster (e.g. the tower, or small neighborhood of towers, with
  the greatest combined `hp`) that sits between the enemies and the base. That cluster's
  location drives the waypoint(s).
- **Re-route trigger:** recompute the tower signature each observation; when it changes (a
  targeted tower died, or a new tower was built), re-emit `llm:routeGroup` for the
  still-active ids of the current wave so the group keeps steering into the remaining
  defenses. Update `lastRoutedTowerSignature`.
- **Per-wave reset:** on wave-number change, create a fresh `seenByWave` entry for the new
  wave (Stubbs has no idle/holding phases to reset).

### Waypoint constraint (key design tension)
Waypoints **must be path tiles** (§1): both `bfsShortestPath` and `dijkstraWeakestPath`
only visit `path`/`base`/`spawn` tiles, and a blocking tower occupies a path tile it was
built on. So `StubbsBrain` does **not** emit raw tower coordinates blindly — it selects
the **path-tile waypoint nearest the target tower cluster** (using the cached
`gridLayout`) and relies on `computeRouteToBase`'s dijkstra fallback to actually thread
the enemies *through* the blocking towers toward the base. This keeps every emitted
waypoint on a legal tile while still forcing tower contact.
- **Open point (flag for implementation):** whether a tower-occupied path tile is itself
  an acceptable waypoint (i.e. still reachable as a route joint) or must be approximated
  by the nearest adjacent open path tile. Resolve against `computeRouteToBase` behavior
  when the routing engine (§2) lands; until then Stubbs uses the nearest open path tile to
  stay unambiguously valid.

### Tests
See §7 `tests/unit/commanders/stubbs-brain.test.ts`: immediate route on spawn (no hold),
waypoints target the strongest tower cluster, re-route on tower-set change, per-wave
idempotence and reset. Pure-function tests, no worker.
