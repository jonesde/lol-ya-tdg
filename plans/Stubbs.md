# Enemy Commanders — Implementation Plan (Web Worker, LLM-shaped)

## Goal
A test stub for the eventual LLM enemy-commander. The commander is a **client of the game sim**
(not part of it) that runs in **its own Web Worker**, shaped to mirror the eventual LLM
commander plane (ArchitecturePlan §4.3) so we can use it to test and refine the LLM interface
before a real model is wired in.

The plan covers **two** stub brains behind the same shared transport/observation seam:
**Sergeant Stubby** (hold-then-rush) and **Commander Stubbs** (aggressive tower-routing). Both
plug into the identical `CommanderBrain` interface; only the decision logic differs. Having two
strategies is what makes this a strong test case: Stubby exercises hold + empty-waypoint release,
while Stubbs exercises the non-empty `waypoints` routing path (see Phase 2).

The worker receives a throttled **snapshot slice** from the main thread (it cannot read
`getLatestSnapshot()` directly — that state is main-thread-only), builds the abstracted
**observation JSON** itself, runs a strategy, and posts `llm:*` commands back. The main thread
relays those commands into the simulation via the existing `dispatchCommand` → sim worker seam.
The sim worker, the snapshot ack gate, and the bulk of the `Command` schema are unchanged.

**Core design principle (the "target tile" model).** The commander only issues *general commands*
— chiefly "go to this tile" (optionally "and stay there"). All movement, pathing, blocking, and
tower-attack behavior stays in the game engine. An enemy obeys its last received command
autonomously and, once the command is *complete*, reverts to its default behavior of heading for
the base — **except** a hold command, which keeps the enemy in place until explicitly released.
Concretely, the desired autonomous sequence for a "go to tile T" command is:

1. The engine routes the enemy toward tile T (reusing the normal enemy movement/attack machinery).
2. If tile T (or any tile on the way) holds a **live tower**, the enemy tries to occupy that space
   by attacking the tower (existing `forwardTower`/`attackTarget` logic does this automatically).
3. When that tower is **ghosted** (or removed), the enemy completes the move onto T.
4. The command is now **complete** and the enemy defaults back to targeting the base
   (until instructed otherwise). A *hold* command is the one exception: it never auto-completes,
   so the enemy stays put (still attacking any tower on its tile) until a release is sent.

This keeps the engine as the single owner of all `Enemy.update()` logic; the commander never
micro-manages walking, collisions, or attacks.

## Architecture (one paragraph)
The commander lives in `src/commanders/`. A **main-thread relay** polls `getLatestSnapshot()` at
~4 Hz (it is a *passive* reader of the snapshot store and never posts `snapshotAck`, so the
single-ack backpressure gate is untouched), builds a throttled, abstracted **slice**, and posts it
to the commander **worker**. The worker runs a `CommanderBrain` (selected by `kind`), turns the
slice into an observation, and posts `llm:*` `Command`s back. The relay forwards those commands
through `dispatchCommand` → the sim worker, where `applyCommand` mutates the engine. The brain is
the only pluggable piece; a future `LLMBrain` (prompt + API + parse) drops in with no change to the
transport, protocol, engine wiring, or UI.

## Phases
- **Phase 1 — Seam + Sergeant Stubby:** command schema, engine wiring (`Grid.computeRoute`,
  `applyCommand` cases, enemy target-tile routing), snapshot additions, the `gridLayout` data-feed
  toggle, the whole `src/commanders/` transport + `StubbyBrain`, and the UI drop-down. This phase
  is independently playable/testable.
- **Phase 2 — Commander Stubbs:** a second `CommanderBrain` reusing the exact Phase-1 seam. No
  engine, schema, snapshot, or protocol changes.
- **Phase 3 — Tests:** unit tests for observation/build + both brains + engine routing, and the
  real-worker integration round-trip.

---

# Phase 1 — Commander Seam + Sergeant Stubby

## 1.1 Command schema (`src/sim/Command.ts`)
Replace the existing no-op `llm:*` stubs (currently `groupId: string` / `chokepointId` /
`untilWave` shapes at Command.ts:78-80; only referenced by the `applyCommand` no-op at
applyCommand.ts:89-93) with the usable, enemy-id-addressed shape:

```ts
// Enemies are addressed by id — EnemySnapshot.id is number (SimulationSnapshot.ts:97-98).
| { commandId: number; type: "llm:holdFormation"; enemyIds: number[]; holdTile: { x: number; y: number } }
| { commandId: number; type: "llm:routeGroup"; enemyIds: number[]; waypoints: Array<{ x: number; y: number }> }
| { commandId: number; type: "llm:setTargeting"; enemyIds: number[]; mode: string }
| { commandId: number; type: "llm:gridLayoutToggle" }   // data-feed toggle (see §1.4)
```

Semantics under the target-tile model:
- `llm:routeGroup` with **empty `waypoints`** = "release to default path": each enemy reverts
  `routingMode = "default"` and re-anchors to its grid path (used by Stubby to rush the base).
- `llm:routeGroup` with **non-empty `waypoints`** = route through each waypoint to the base; the
  engine chains `Grid.computeRoute` per leg (§1.2). The command *completes* when the enemy reaches
  the last waypoint, after which it defaults back to the base — which is already the final leg.
- `llm:holdFormation` = route to `holdTile` and **stay** (`routingMode = "hold"`); never
  auto-completes. Release is a later `llm:routeGroup(enemyIds, [])`.
- `llm:setTargeting` = store `enemy.targetingMode` (used only by future logic; harmless now).
- `llm:gridLayoutToggle` = flip the `gridLayout` data feed (see §1.4). **Not** a per-enemy command.

**Waypoint constraint (enforced by the engine):** enemies can only traverse `path`/`base`/`spawn`
tiles — `bfsShortestPath` refuses terrain/tower neighbors, falling back to `dijkstraWeakestPath`
(which routes *through* live towers). A waypoint may therefore land on a tower-occupied path tile;
the enemy will attack that tower (per the target-tile sequence) and proceed when it is ghosted.
This needs **no special engine work** — the existing `forwardTower`/`attackTarget` logic
(Enemy.ts:506-534) already attacks any tower on the enemy's forward tile, and `computeRoute`'s
dijkstra fallback already reaches tower tiles. The `waypoints` field stays in the schema for the
eventual LLM, which will be told (via observation/prompt) to emit path-tile waypoints.

## 1.2 Engine wiring (`src/sim/applyCommand.ts` + `src/sim/GameEngine.ts` + `src/sim/grid/Grid.ts`)
- `GameEngine.ts` `WaveManagerRef` (lines 65-79): add `active: boolean` (already on the
  `WaveManager` class at WaveManager.ts:40 but missing from the ref interface) and
  `getRemainingScheduledSpawns(): number` (returns `queue.length`, the count of enemies still
  scheduled to spawn this wave). Implement `getRemainingScheduledSpawns` on `WaveManager`
  (alongside the existing `active` field); the serializer reads
  `engine.waveManager?.getRemainingScheduledSpawns() ?? 0`.
- `Grid.ts`: add `computeRoute(start: Point, goal: Point = this.base): Point[] | null` that mirrors
  `Grid.recomputePaths` (Grid.ts:222-246):
  `bfsShortestPath(this, start, goal, this.blocked) ?? dijkstraWeakestPath(this, start, goal, this.towerHealthAt, this.isGhostAt)`
  (`dijkstraWeakestPath` at Pathfinding.ts:168). Add the convenience wrapper
  `computeRouteToBase(start: Point): Point[] | null { return this.computeRoute(start, this.base); }`.
  Use `computeRoute` (not `computeRouteToBase`) for each chained leg in `applyCommanderRoute` so
  every waypoint is honored, not just the first.
- `applyCommand.ts`: implement the `llm:*` cases (return `true` so the worker force-posts the
  snapshot). Each needs to map `enemyIds` → `Enemy` instances — add
  `GameEngine.getEnemiesByIds(ids): Enemy[]` (filter `this.enemyManager.enemies` by `e.id`).
  - `llm:holdFormation(enemyIds, holdTile)` → for each enemy, compute
    `route = engine.grid.computeRoute(enemy.currentTile(), holdTile)` and call
    `enemy.applyRoute(route, "hold")`.
  - `llm:routeGroup(enemyIds, waypoints)`:
    - **empty** → `enemy.releaseToDefault()` for each (identical to the §1.3 stop-cleanup
      release, so held enemies unfreeze and rejoin the grid path).
    - **non-empty** → for each enemy, chain `computeRoute` for each leg
      (`currentTile → wp1`, `wp1 → wp2`, …, `wp(N-1) → wpN`, `wpN → base`), concatenating the
      segments and dropping duplicate joints; call `enemy.applyRoute(chainedRoute, "route")`.
      This keeps Stubbs routing behavior-identical to default enemy pathing (including the
      tower-crossing dijkstra fallback) and honors **every** waypoint.
  - `llm:setTargeting(enemyIds, mode)` → store `enemy.targetingMode`.
  - `llm:gridLayoutToggle` → `engine.gridLayoutEnabled = !engine.gridLayoutEnabled; return false;`
    (a config flip, no visible runState mutation; no force-post needed).

## 1.3 Enemy target-tile routing (`src/sim/enemies/Enemy.ts`)
Add state, taking precedence over the default grid path, but **reusing all existing movement,
blocking, and attack logic**:
- Fields: `routingMode: "default" | "hold" | "route"`, plus a small `arrived: boolean` (hold only).
- `currentTile(): Point` helper → `this.grid.worldToTile(this.centerX, this.centerY)` (the engine
  uses this as the `computeRoute` start).
- `applyRoute(routePath: Point[], mode: "hold" | "route")`: set `this.path = routePath`,
  `this.routingMode = mode`, `this.pathIdx = 0` (or snap to the nearest forward tile within
  `routePath` so a mid-corridor enemy doesn't backtrack), `this.arrived = false`.
- `releaseToDefault()`: `this.routingMode = "default"; this.path = this.grid.getPathFor(this.spawnIndex);`
  then `this.reanchorToPath(this.path)` (reuses the existing re-anchor at Enemy.ts:336-427).
- **`update()` changes (the only engine refactor, and it is small):**
  - The `pathVersion` re-anchor block (Enemy.ts:488-499) must be gated to
    `if (this.routingMode === "default")` — for `hold`/`route` the engine already owns the path,
    so do **not** re-anchor to the grid path on tower build/sell.
  - The end-of-path check (Enemy.ts:479 `if (!this.path || this.pathIdx >= this.path.length - 1)`)
    becomes mode-aware:
    - `default` → `this.reachedBase = true; return;` (unchanged).
    - `hold` → `this.arrived = true; return;` (enemy stays in place; if a tower sits on its tile
      it keeps attacking it via the existing `forwardTower` logic).
    - `route` → `this.releaseToDefault();` then fall through so the enemy immediately starts
      following the grid path toward the base.
  - Everything downstream of those two gates — the `forwardTower`/`attackTarget` resolution
    (Enemy.ts:506-534), the walk/approach movement (537-570), collision separation (575), the
    attack tick (579-586), and the lane-offset/position derivation (588-604) — is **untouched**.
    Because `route`/`hold` store their target as `this.path`, the existing code already reads
    `this.path[this.pathIdx + 1]` for the forward tile and attacks any tower there. This is exactly
    how the target-tile sequence (attack tower → ghosted → occupy → complete) falls out for free.
- No change to how a `route`/`hold` enemy attacks towers in contact: it reuses the same
  `findAdjacentLiveTowerInContact` (Enemy.ts:659-679) and `forwardTower` logic as a default enemy.

## 1.4 Snapshot additions (for the observation + wave-emergence detection)
`src/sim/SimulationSnapshot.ts` + `src/sim/SnapshotSerializer.ts`:

- **`gridLayout: number[][] | undefined` (gated by a data-feed toggle, not per tick).**
  `gridLayout` (`0=terrain, 1=path, 2=base, 3=spawn`, built from `engine.grid.tiles`) is constant
  for a whole run — terrain never changes mid-run (only tower build/sell changes `pathVersion`,
  which must **not** re-send it). Model it as the first of a **commander data-feed** family:
  - Add `gridLayoutEnabled: boolean = true` to `GameEngine` (reset to `true` in `_initMap`,
    alongside the existing `this.lastPostedPathVersion = 0` at GameEngine.ts:169 — same pattern).
  - In `buildSnapshot`, include `gridLayout` while `engine.gridLayoutEnabled` is `true`.
  - Add `gridLayout: number[][] | undefined` to `SimulationSnapshot` (present while enabled,
    `undefined` once toggled off).
  - **Data-feed toggle pattern.** `llm:gridLayoutToggle` (§1.1) flips `gridLayoutEnabled`. The
    *client* decides when to stop receiving: the worker caches `gridLayout` from the first slice
    that carries it and immediately emits one `llm:gridLayoutToggle`, which turns the feed off.
    Because the toggle is a flip (not a one-shot ack), a client can send it **again** to turn the
    feed back on — useful if the worker is restarted mid-run. This establishes the convention for
    future optional feeds (e.g. `llm:towerHealthFeedToggle`): each optional stream gets a sibling
    `llm:<feed>Toggle` command and a corresponding serializer gate; the commander worker toggles
    feeds on/off as it needs them, keeping steady-state per-tick cost at zero.

  **Reliable delivery — the relay owns the cache.** The commander relay polls `getLatestSnapshot()`
  at 4 Hz while the sim posts at up to 60 Hz, so the relay's first read could be a later snapshot.
  Guard against that: the relay captures `gridLayout` from the first slice that contains it and
  caches it in module state; it then includes the cached `gridLayout` on **every** observation it
  forwards to the commander worker. The worker thus always receives `gridLayout` on its first
  observation and reuses the cached `map` forever (it never changes). The worker's one
  `llm:gridLayoutToggle` flips `gridLayoutEnabled` off in the engine so the sim stops sending it.

- **`meta.remainingScheduledSpawns`** = `engine.waveManager.getRemainingScheduledSpawns()` (count of
  enemies still scheduled to spawn this wave, i.e. `queue.length`). This — not the overflow-only
  pending queue — is the correct "entire wave emerged" signal. `pendingEnemyCount` (sum of
  `getPendingCountForSpawn`, shipped in `spawnStates[].pendingCount` at SnapshotSerializer.ts:73-76)
  counts only the overflow queue and is `0` for almost every wave, so it alone cannot detect
  emergence. Stubby rushes when `remainingScheduledSpawns === 0` AND the overflow pending count is
  `0` (every enemy now active on the field, held by Stubby).
- **`meta.tileSize`** = `engine.grid?.tileSize ?? 36` (read from `Grid`, **not** `GameRunState` —
  `tileSize` lives on `Grid` at Grid.ts:33/62). Always included so the worker converts world
  `x/y` → tile coords with the correct constant.
- **`meta.waveActive`** = `engine.waveManager?.active ?? false` (set `true` in `startNextWave` at
  WaveManager.ts:106-118; never reset). Included for future use; **not** a valid rush signal
  (see Stubby below).

## 1.5 Commander client — `src/commanders/` (own Web Worker)
Stubby is a client of the sim, in his own worker. The infrastructure is **brain-agnostic** so
Commander Stubbs (Phase 2) reuses all of it — only the brain differs.

- `src/commanders/protocol.ts`: `MainToCommanderMessage` / `CommanderToMainMessage` (mirrors
  `src/sim/WorkerProtocol.ts`) — `start` (carries `kind: "stubby" | "stubbs"` so the shared worker
  instantiates the matching brain), `stop`, `observation` (snapshot slice), `commands` (array of
  `llm:*` `Command`s). Define the slice type explicitly (the worker's intentional input contract,
  not "the whole snapshot"):
  ```ts
  export interface CommanderSnapshotSlice {
    gridLayout: number[][] | undefined;   // present while the feed is enabled; cached by relay
    enemies: EnemySnapshot[];             // worker converts world x/y → tile via meta.tileSize
    towers: TowerSnapshot[];
    spawnStates: SpawnStateSnapshot[];    // each carries pendingCount
    meta: SnapshotMeta;                   // includes remainingScheduledSpawns, tileSize, waveActive
  }
  ```
- `src/commanders/observation.ts` (shared): `buildObservation(slice): CommanderObservation` — pure
  function turning the throttled slice into the abstracted JSON (`{ map, enemies, towers, wave }`),
  the "semantic view" projection from §4.3. Brain-agnostic. It also **derives** `wave.pendingEnemyCount`
  by summing `slice.spawnStates.map(s => s.pendingCount)` (the overflow count the brain needs for
  its rush guard — Issue note from review: the slice ships `pendingCount` per spawn, the observation
  must sum it). Enemy `x/y` → `tileX/tileY` using `slice.meta.tileSize`. Towers already carry
  `tileX/tileY`. The `wave` block: `{ currentWave, pendingEnemyCount, spawnStates, remainingScheduledSpawns, active }`.
- `src/commanders/brain.ts` (shared): `CommanderBrain` interface — `decide(observation, memory):
  CommanderCommand[]` — the pluggable brain, plus `createBrain(kind)` registry.
  `src/commanders/stubby/brain.ts` (`StubbyBrain`) implements the hold-then-rush strategy;
  `src/commanders/stubbs/brain.ts` (Phase 2) implements the aggressive tower-routing strategy. A
  future `LLMBrain` would assemble a prompt, call the API, parse the response into the same command
  shape. **`commandId` discipline:** brains emit `llm:*` `Command`s with `commandId: 0`; the relay
  forwards them through `dispatchCommand` (commandBus.ts:22-28), which auto-assigns a fresh
  monotonic id (it only reassigns when `commandId <= 0`). Brains must **not** invent their own ids.
- `src/commanders/CommanderWorker.ts` (shared): the worker entry
  (`new Worker(new URL("./CommanderWorker.ts", import.meta.url), { type: "module" })`). On `start`
  it builds the brain via `createBrain(kind)`; holds a small per-run `memory` (cached `gridLayout`,
  seen-enemy-id sets, strategy scratch), and an `onmessage` handler: on `observation` it (1) caches
  `gridLayout` if present and, on the **first** cache, pushes one `llm:gridLayoutToggle` command
  into the returned array, (2) runs `buildObservation` → `brain.decide` → posts `commands` back. No
  rAF, no DOM, no `getLatestSnapshot` — it is fed.
- `src/commanders/relay.ts` (shared): the **main-thread** half. A ~4 Hz loop (`setInterval`, 250 ms,
  per §4.3's 1–5 Hz) reads `getLatestSnapshot()`, builds a throttled slice, posts it to the worker,
  and listens for `commands` which it forwards via `dispatchCommand`. It **never posts
  `snapshotAck`** (passive consumer) and **owns the `gridLayout` cache** (§1.4): it includes the
  cached `gridLayout` on every observation it forwards so the worker always has the map. It is the
  only piece that touches the snapshot module / command bus.
- `src/commanders/index.ts`: `setEnemyCommander(kind: "none" | "stubby" | "stubbs")` /
  `stopEnemyCommander()` — owns the worker + relay lifecycle (create/terminate the worker when
  switching modes), forwarding `kind` in the `start` message.

### Observation JSON built in the worker (`buildObservation`)
```ts
// In CommanderWorker.onmessage(observation): cache gridLayout once, then reuse it.
if (slice.gridLayout) memory.gridLayout = slice.gridLayout;
// The worker also emits llm:gridLayoutToggle the first time it caches gridLayout.

// buildObservation reads the cached gridLayout, not the per-tick slice:
{
  map: memory.gridLayout,                // cached; 0=terrain,1=path,2=base,3=spawn
  enemies: [{ id, tileX, tileY, level, hp, maxHp }],   // world x/y → tile via meta.tileSize
  towers:  [{ tileX, tileY, level, hp, maxHp }],
  wave: { currentWave, pendingEnemyCount, spawnStates, remainingScheduledSpawns, active }
}
```

### Strategy (`StubbyBrain.decide`) — state machine `idle → holding → rushing`, per wave
- **Memory shape:** `phase: "idle" | "holding" | "rushing"`, `seenByWave: Map<number, Set<number>>`
  (enemy ids seen, keyed by wave number), `lastRushWaveNumber: number | null`, and `gridLayout`.
- While spawning (`pendingEnemyCount > 0` or `remainingScheduledSpawns > 0`): issue
  `llm:holdFormation` for **newly-seen** enemy ids in the *current* wave, holding each at its
  **current tile** (≈ near spawn; the brain emits `holdTile = { x: enemy.tileX, y: enemy.tileY }`
  from the observation), tracked in `seenByWave.get(currentWave)` to avoid re-dispatching.
- Once `remainingScheduledSpawns === 0` **and** the overflow pending count is `0` (all enemies have
  emerged and are active on the field): issue one `llm:routeGroup(enemyIds, [])` to release *only
  the current wave's* seen ids (`seenByWave.get(currentWave)`) to rush the base at once; set
  `memory.lastRushWaveNumber = currentWave` and clear that wave's set so it doesn't re-fire.
  (Note: `spawnStates` only transitions to `closed` after the wave is fully cleared — too late for
  this trigger — so use `remainingScheduledSpawns` + overflow pending, not `spawnStates`.
  `wave.active` is included for future use but is **not** a valid rush signal — `WaveManager.active`
  is set `true` at wave start and never reset.)
- On next wave (wave number change / new countdown): reset to `idle` and create a fresh
  `seenByWave` entry for the new wave.

### Hardening: `PRE_EMPTIVE_WAVE_TIMER` race (feedback §8 #5)
`PRE_EMPTIVE_WAVE_TIMER` (90 s, WaveManager.ts:230) may start the next wave while Stubby still holds
the previous wave's enemies alive. The wave-number-keyed `seenByWave` set prevents the rush command
from being diluted: the rush captures **only** `seenByWave.get(currentWave)` at fire time, so
next-wave spillover enemies (different wave number) are never folded into the released set.
Furthermore, `remainingScheduledSpawns` becomes `> 0` the instant the next wave's queue is populated
(`startNextWave` pushes the new queue immediately), so the rush trigger can never fire *after* new-
wave enemies exist — the captured id set is always the held wave's enemies only. No separate "block
re-enter idle" flag is needed; wave-number keying plus the `remainingScheduledSpawns` guard suffices.

## 1.6 UI — pause menu drop-down (`src/stores/ui.ts` + `src/components/PauseMenu.vue`)
- `ui.ts`: add `enemyCommander: "none" | "stubby" | "stubbs"` (default `"none"`) +
  `setEnemyCommander(kind)` action that updates state **and** calls `setEnemyCommander` /
  `stopEnemyCommander` from the commanders module (which creates/terminates the worker + relay).
- `PauseMenu.vue`: add an **"Enemy Commander"** `<select>` with options *No Commander* / *Sergeant
  Stubby* / *Commander Stubbs*, bound to `uiStore.enemyCommander`.
- `SvgGameRoot.vue` (`onUnmounted`, near the existing `setCommandDispatcher(null)` at
  SvgGameRoot.vue:568): call `stopEnemyCommander()` so the worker + relay never leak when leaving
  `/game`.
- **Commander-stop cleanup (prevents frozen enemies):** `stopEnemyCommander()` must release any
  enemies it left in `hold` mode before terminating. On the main thread it has access to both
  `getLatestSnapshot()` and `dispatchCommand`, so immediately before terminating: read the current
  enemy ids from the latest snapshot (`getLatestSnapshot()?.enemies.map(e => e.id)`) and dispatch a
  single `llm:routeGroup(enemyIds, [])` (empty waypoints = "release to default path") so every held
  enemy reverts `routingMode = "default"` and re-anchors to its grid path. Required both when the
  user switches the drop-down back to *No Commander* and on `SvgGameRoot` unmount. Without it, held
  enemies stay frozen forever. This cleanup applies regardless of which commander was active — for
  Commander Stubbs (who never holds) the release is a harmless re-anchor to the default path.

---

# Phase 2 — Commander Stubbs (aggressive tower-routing)

Commander Stubbs is a second stub brain that plugs into the exact same shared transport,
observation, worker, and relay as Stubby (Phase 1). Only `src/commanders/stubbs/brain.ts`
(`StubbsBrain`) is new; the worker selects it via `createBrain("stubbs")`. **No engine, schema,
snapshot, or protocol changes are needed** — Stubbs reuses the `llm:routeGroup` command and
`Grid.computeRoute` machinery (§1.2) already specified.

### Why he's a better test case
Stubby only ever emits `llm:holdFormation` and `llm:routeGroup(enemyIds, [])` — the **empty-waypoint**
("release to default path") form. He therefore never exercises the non-empty-`waypoints` routing
path: `applyCommanderRoute` → `Grid.computeRoute` (§1.2) → the `dijkstraWeakestPath` tower-crossing
fallback. Commander Stubbs's whole strategy is built on non-empty waypoints, so adding him covers
that engine seam end-to-end.

### Strategy (`StubbsBrain.decide`) — aggressive, never holds
- **Memory shape:** `seenByWave: Map<number, Set<number>>` (enemy ids already routed, keyed by
  wave, same anti-re-dispatch pattern as Stubby), `lastRoutedTowerSignature: string` (a stable hash
  of the towers set — tile coords + ids — used to detect when a re-route is warranted), and the
  cached `gridLayout`.
- **On newly-seen enemies** (ids in the current wave not yet in `seenByWave.get(wave)`): immediately
  emit `llm:routeGroup(enemyIds, waypoints)` — **no hold phase at all**. Waypoints steer the group
  **through the strongest tower cluster** so the enemies attack and destroy those towers (reusing
  the existing in-contact approach/attack logic via the target-tile model) on their way to the base.
  Add the ids to `seenByWave.get(wave)`.
- **Target selection:** from the observation `towers` (each has `tileX/tileY/hp/maxHp`), pick the
  highest-value cluster (the tower, or small neighborhood of towers, with the greatest combined
  `hp`) that sits between the enemies and the base. That cluster's location drives the waypoint(s).
- **Re-route trigger:** recompute the tower signature each observation; when it changes (a targeted
  tower died, or a new tower was built), re-emit `llm:routeGroup` for the still-active ids of the
  current wave so the group keeps steering into the remaining defenses. Update
  `lastRoutedTowerSignature`.
- **Per-wave reset:** on wave-number change, create a fresh `seenByWave` entry for the new wave
  (Stubbs has no idle/holding phases to reset).

### Waypoint constraint (key design tension)
Waypoints **must be path tiles** (§1.1): both `bfsShortestPath` and `dijkstraWeakestPath` only visit
`path`/`base`/`spawn` tiles, and a blocking tower occupies a path tile it was built on. So
`StubbsBrain` does **not** emit raw tower coordinates blindly — it selects the **path-tile waypoint
nearest the target tower cluster** (using the cached `gridLayout`) and relies on `computeRoute`'s
dijkstra fallback to actually thread the enemies *through* the blocking towers toward the base.
Because the target-tile model (§1.3) already attacks any tower on the route's forward tile, a
waypoint whose tile holds a live tower is handled automatically: the enemy attacks it, proceeds when
ghosted. (Open point resolved by the §1.3 design — no special "occupy nearest adjacent tile" logic
is required; the engine's existing forward-tower attack does the work.)

---

# Phase 3 — Tests

- `tests/unit/commanders/observation.test.ts`: `buildObservation` over a fake snapshot slice →
  expected JSON shape (map codes from the **cached** `gridLayout` — present on the first slice,
  `undefined` thereafter and reused from memory; tile-coord conversion via `meta.tileSize`; `wave`
  block includes `remainingScheduledSpawns` and `active`; **`pendingEnemyCount` is the sum of
  `spawnStates[].pendingCount`**).
- `tests/unit/commanders/stubby-brain.test.ts`: feed fake observations; assert the hold→rush
  transition (hold while `remainingScheduledSpawns > 0`, single release when
  `remainingScheduledSpawns === 0` and overflow pending is `0`), idempotent re-dispatch, and per-wave
  reset. **Also assert the rush captures only the current wave's seen ids when a wave boundary occurs
  (wave-number-keyed `seenByWave`), and that the rush does not fire when `remainingScheduledSpawns >
  0` (next-wave spillover guard).** Assert the worker emits exactly one `llm:gridLayoutToggle` after
  first receiving `gridLayout`. Pure-function tests, no worker.
- `tests/unit/commanders/stubbs-brain.test.ts`: feed fake observations; assert the aggressive
  tower-routing behavior — enemies are routed **immediately** on being seen (no hold), the emitted
  `llm:routeGroup` waypoints steer toward the strongest tower cluster, a re-route fires when the
  observed `towers` set changes (targeted tower dies or a new tower appears), and dispatch is
  idempotent per wave / resets across waves. Pure-function tests, no worker.
- `tests/unit/sim/enemy-routing.test.ts`: `applyRoute("hold")` freezes advance at the target tile
  (and attacks a tower there); `applyRoute("route")` follows waypoints then defaults back to the
  base on completion; empty-waypoint `releaseToDefault()` reverts to default path / reaches base;
  the `pathVersion` re-anchor is **not** applied while `routingMode !== "default"`.
- `tests/unit/sim/applyCommand.test.ts` (extend): `llm:*` commands no longer no-op and mutate state;
  `llm:gridLayoutToggle` flips `engine.gridLayoutEnabled`; `getEnemiesByIds` maps ids correctly.
- `tests/integration/commander.test.ts`: spin up a real `GameEngine` plus a test-local
  `CommandDispatcher` that forwards to `applyCommand(engine, cmd)`, and drive the **real shared
  commander worker started with `kind: "stubby"`** via the existing mock-`self` import pattern (see
  `tests/integration/worker-roundtrip.test.ts`, which mocks the `DedicatedWorkerGlobalScope` and
  imports `@/commanders/CommanderWorker.ts`). Feed the worker an `observation` message built from
  `getLatestSnapshot()` after a wave has spawned, capture its `commands` posts, and apply them back
  through `applyCommand`. Assert enemies stay put (don't advance) while spawning, then all advance to
  the base together on the rush. `MainThreadCommandDispatcher` no longer exists (confirmed by glob —
  TECHNICAL.md is stale on this point), so do **not** instantiate it.

---

# Cross-cutting notes / risks
- The commander is a **command producer only**; everything stays within the existing spine. The sim
  worker, snapshot ack gate, and `Command` schema (except the `llm:*` swap) are untouched.
- The relay sends an *abstracted, throttled slice* to the worker — not the raw 60 Hz snapshot
  stream — so the single-ack backpressure design is unaffected (TECHNICAL.md "Snapshot Backpressure"
  open point is not engaged; the relay is a passive `getLatestSnapshot()` reader, never an acker).
- The `llm:gridLayoutToggle` data-feed pattern (§1.4) is the first of a family: future optional
  streams add a sibling `llm:<feed>Toggle` command + serializer gate, and the worker toggles them on
  demand, keeping steady-state per-tick cost at zero.
- The drop-down default `none` keeps the game fully playable without the commander
  (ArchitecturePlan §2.2 / §4.3 requirement).
- **LLM-interface closeness:** `CommanderBrain`, `buildObservation`, and the `protocol` messages are
  exactly the seams the real LLM commander will use. Swapping `StubbyBrain` for `LLMBrain`
  (API transport + prompt + parse) is an isolated change with no engine, protocol, or UI impact.
- **The observation carries the full semantic view even though `StubbyBrain` doesn't use all of it.**
  `buildObservation` exposes every enemy (with tile/hp), every tower, the `map`/`gridLayout`,
  `wave.active`, and the `waypoints` field, so a future `LLMBrain` has everything it needs.
  `StubbyBrain`'s deterministic strategy only consumes a subset (hold-at-current-tile + empty-waypoint
  release); the unused fields are present for forward-compat, not dead code.
- **Rush signal is `remainingScheduledSpawns` (wave `queue.length`), not the overflow-only
  `pendingEnemyCount` nor `spawnStates`.** `spawnStates` close only after a wave is fully cleared
  (too late); the overflow pending count is `0` for almost every wave. `remainingScheduledSpawns ===
  0` (plus overflow pending `0`) is the correct "all enemies have emerged" test. `wave.active`
  (`meta.waveActive`) is exposed for future use but is **not** a rush signal.
- **Engine owns all enemy behavior.** Per the target-tile model, the commander emits only "go to
  tile T" (hold or route); `Enemy.update()` keeps its entire movement/blocking/attack implementation.
  The only `Enemy` changes are: a `routingMode` field, `applyRoute` / `releaseToDefault` /
  `currentTile` helpers, gating the `pathVersion` re-anchor to `default`, and making the end-of-path
  branch mode-aware. No walking/collision/attack logic is duplicated or moved into the commander.
- **Commander-stop cleanup (`stopEnemyCommander`, see §1.6):** before terminating the worker + relay
  it dispatches `llm:routeGroup(allCurrentEnemyIds, [])` to release any held enemies back to their
  default path. Without this, disabling the commander (drop-down back to *No Commander*, or leaving
  `/game`) would leave held enemies frozen forever.
- All commander code (`src/commanders/`) depends on the sim only through the public seams:
  `getLatestSnapshot()`, `dispatchCommand`, and the `SimulationSnapshot`/`Command` types.
