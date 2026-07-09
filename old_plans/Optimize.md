# Performance Optimization Plan — `src/`

## Context

The simulation runs in a Web Worker (`src/sim/WorkerEntry.ts`) on a fixed 60 Hz `setTimeout`
loop. Every tick it serializes the entire engine into a `SimulationSnapshot` (`SnapshotSerializer.ts`)
and `postMessage`s it to the main thread, which renders it in a `requestAnimationFrame` loop
(`SvgGameRoot.vue:341`). The *structural* hot paths are already well optimized:

- Spatial hash range queries (`EnemyManager.ts:18`, `getEnemiesInRange` `:218`)
- Per-tower target cache (`Tower.ts:888` `cachedTargetId`) and tower stats cache (`Tower.ts:330`)
- Render proxy pools with attribute-diffing (`render/svg/*Manager.ts`)
- Event-based path recompute + `grid.pathVersion` (`Grid.ts:222`)
- Persist batching, rAF-throttled hover, cached inverse CTM

The remaining waste is **per-tick busy work whose cost scales with frame rate, not entity count**,
plus avoidable per-frame DOM churn on the main thread. This plan addresses the six findings from
the review. Items 1–4 are the high-value, low-risk wins; 5–6 are GC/cleanup polish.

---

## Goal / Non-Goals

**Goal:** reduce per-tick CPU and main-thread DOM work so a full wave (hundreds of enemies, dozens
of towers, heavy lightning/stormcall usage) stays at 60 fps on mid-range hardware.

**Non-Goals:** changing gameplay, the snapshot/command architecture, the simulation algorithms
(spatial hash, BFS/Dijkstra pathing), or render pooling strategy. No new data structures for
hot path logic — we only stop doing unnecessary work.

---

## Finding 1 — Snapshot is built + structured-cloned every tick (highest impact)

### Problem
`WorkerEntry.ts:106`:
```ts
const snapshot = buildSnapshot(engine, lastAppliedCommandId);
postMessage({ type: "snapshot", snapshot });
```
runs every tick. `buildSnapshot` (`SnapshotSerializer.ts:18`) allocates fresh arrays for every
enemy/tower/projectile/particle and, per tower, `snapshotTower` (`:120`) recomputes expensive
derived UI fields that only change on build/upgrade/sell: `sellValue()`, `canUpgrade()`
(→ `upgradeCost` + `maxLevelFor`), `currentMilestoneBonus()`, `upgradeCost(5)`, and a `stats`
read. It also posts `gemBreakdown` / `milestoneRewardsClaimed` references (deep-cloned every
postMessage) and `paths` (full tile arrays, static between builds).

### Approach
Three sub-parts:

**1a. Ship expensive derived tower fields only for the selected tower.**
The derived fields (`sellValue`, `canUpgrade`, `upgradeCostAt5`, `milestoneBonus`, the `stats`
subset, `levelCosts`) are consumed **only** by `TowerPanel` for the *selected* tower — verified
that `render/svg/TowerManager.ts` reads none of them (it only touches visual fields: `angle`,
`fireAnimTime`, `level`, `variant`, …). Compute them once per tick for the single selected tower
instead of for every tower on the map.

**1b. Gate path post by `grid.pathVersion`** (also fixes Finding 2 — see that section).

**1c. Drop `gemBreakdown` / `milestoneRewardsClaimed` from the snapshot entirely.**
Both fields are dead weight on the main thread. Verified consumers:
- `EndScreen.vue:17` reads `gameStore.endScreenData?.gemBreakdown` — a *different* object set on
  `triggerEnd` (`GameEngine.ts:531/545`). It never reads `snapshot.meta.gemBreakdown`.
- `StatsPanel.vue` does not reference either field anywhere; it reads `snapshot.towers[].totalDamageDealt`
  and already-mirrored `gameStore` scalars (`lives`, `runGemsEarned`, `bossesKilledThisRun`, …).
- `SnapshotStore.ts` does **not** mirror `gemBreakdown` or `milestoneRewardsClaimed` into `gameStore`.
- The only reader of `snapshot.meta.milestoneRewardsClaimed` is `WorkerEntry.ts:113`, the persist-flush
  trigger — which can read `engine.runState.milestoneRewardsClaimed` directly.

So: remove both from `buildMeta`, fix the one worker-internal reader, and ship nothing in their place.
No new command, no terminal-snapshot special-case, no on-demand request mechanism.

### Code sketch — 1a (selected-tower-only derived fields)
`snapshotTower` (`SnapshotSerializer.ts:120`) splits into a cheap per-tower path (visual fields only)
and an expensive per-selected-tower path. `TowerSnapshot` becomes a type where the derived fields are
optional:

```ts
function snapshotTower(t: Tower, persistState: PersistState, isSelected: boolean): TowerSnapshot {
  const base: TowerSnapshot = {
    id: t.id, type: t.type, x: t.x, y: t.y, tileX: t.tileX, tileY: t.tileY,
    level: t.level, variant: t.variant, angle: t.angle, cooldown: t.cooldown,
    targeting: t.targeting, totalInvested: t.totalInvested, waveDamage: t.waveDamage,
    totalDamageDealt: t.totalDamageDealt, fireAnimTime: t.fireAnimTime,
    fixedAimDir: t.fixedAimDir, isGhost: t.isGhost, health: t.health, maxHealth: t.maxHealth,
    color: t.color, animation: t.animation,
    base: { fixedAim: t.base.fixedAim ?? false },
    placedAt: t.placedAt,                 // shipped for selected-tower cancel-window math
    // derived fields absent on non-selected towers
  };
  if (!isSelected) return base;
  return {
    ...base,
    sellValue: t.sellValue(),
    canUpgrade: t.canUpgrade(persistState),
    levelCosts: [...t.levelCosts],
    milestoneBonus: t.currentMilestoneBonus(),
    upgradeCostAt5: (() => {
      const lv5Cost = t.upgradeCost(5);
      const ucrTier = persistState.generalAddons.upgradeCostReduction;
      if (ucrTier !== null && ucrTier !== undefined) {
        const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
        return Math.floor(lv5Cost * (1 - reduction));
      }
      return lv5Cost;
    })(),
    stats: {
      damage: t.stats.damage, range: t.stats.range, fireRate: t.stats.fireRate,
      splash: t.stats.splash, chain: t.stats.chain,
    },
  };
}
```
`buildSnapshot` passes `isSelected = tower.id === engine.runState.selectedTowerId`. `TowerPanel`
reads these fields off the selected-tower snapshot as today; `TowerSnapshot`'s derived fields become
`optional` and `TowerPanel` guards with `?? 0` / `?? false` (it already reads via the cached
selected-tower reference in `SnapshotStore`, so non-selected towers never reach it).

### Folded-in: drop `canCancel` / `cancelRemainingMs`, ship `placedAt`
`canCancel()` and `cancelRemainingMs()` depend on `Date.now() - placedAt` and change every frame, but
only `TowerPanel` for the *selected* tower reads them. Drop both from `TowerSnapshot` and ship
`placedAt` instead (added to the cheap path above). `TowerPanel` computes them locally:
```ts
const canCancel = computed(() =>
  tower.value ? Date.now() - tower.value.placedAt < CANCEL_BUILD_WINDOW_MS && tower.value.level === 1
  : false,
);
const cancelRemainingSeconds = computed(() =>
  Math.ceil(Math.max(0, CANCEL_BUILD_WINDOW_MS - (Date.now() - (tower.value?.placedAt ?? 0))) / 1000),
);
```
`placedAt` is a single number on the cheap path — no per-tower recompute.

### Code sketch — 1c (delete, not relocate)
`SnapshotSerializer.ts` `buildMeta`: remove lines `gemBreakdown: rs.gemBreakdown,` and
`milestoneRewardsClaimed: rs.milestoneRewardsClaimed,` entirely. `SnapshotMeta` drops both fields.

`WorkerEntry.ts:113`:
```ts
const milestoneKeyCount = Object.keys(engine.runState.milestoneRewardsClaimed).length;
```
That is the only change on the worker side.

### Risk / Notes
- `selectedTowerId` is already mirrored on `meta` and is stable across frames unless the user clicks a
  different tower. `buildSnapshot` therefore resolves the selected tower once per tick (O(towers)).
- `render/svg/TowerManager.ts` verified to read none of the derived fields; only visual fields are
  consumed per tower, so omitting derived fields from non-selected towers is render-safe.
- `TowerSnapshot` derived fields become optional in the type; `TowerPanel` already reads them off the
  cached selected-tower reference (which is always the selected tower, so the fields are always present
  for it). Add `?? 0` / `?? false` guards for type-safety; runtime values are unchanged.
- No `StatsPanel` refactor needed (it never read these fields).
- No new command, no new worker→main message, no terminal-snapshot branching.

---

## Finding 2 — Path-highlight `innerHTML` rebuilt every frame

### Problem
`SvgGameRoot.vue:381-396` rebuilds a polyline string and assigns `pathHighlightsGroup.innerHTML`
**every frame**, even though paths only change on tower build/sell/ghost (event-driven, versioned by
`Grid.pathVersion`, `Grid.ts:44`). This is per-frame string construction + SVG re-parse + layout.

### Approach
Combine with Finding 1b: only include `paths` in the snapshot when `grid.pathVersion` changes; the
render loop keeps a cached local paths array and only re-renders highlights when a new `paths` arrives.

### Code sketch
`SnapshotSerializer.ts` — the last-posted version lives on the engine (per Caveat 2, *not* a module-
level mutable), so direct `buildSnapshot` callers in tests start clean:
```ts
// inside buildSnapshot, reading engine.lastPostedPathVersion (new field, reset in loadMap/loadRandomMap):
const grid = engine.grid;
let paths: typeof grid.paths | undefined;
if (grid && grid.pathVersion !== engine.lastPostedPathVersion) {
  paths = grid.paths;
  engine.lastPostedPathVersion = grid.pathVersion;
}
return { /* ...existing fields..., paths, pathsVersion: grid?.pathVersion ?? 0 };
```
`SvgGameRoot.vue` render loop:
```ts
const snapshot = snapshotStore.get();
// ...existing enemy/tower sync...
if (snapshot.paths) {            // only present when pathVersion changed
  cachedPaths = snapshot.paths;
  rebuildPathHighlights(cachedPaths);   // builds + sets innerHTML once
}
```
Move the existing polyline-build block (`:387-395`) into `rebuildPathHighlights`, called only on
change. Falls back to the cached copy on frames where `snapshot.paths` is `undefined`.

### Risk / Notes
- `paths` is consumed elsewhere only by this highlight code (verified: `SpawnManager` and overlays
  use `spawnStates`, not `paths`). Safe to omit when unchanged.
- Keep the `pathsVersion` present in the snapshot so the main thread can detect change even if a
  future refactor re-adds per-tick paths.

---

## Finding 3 — Snapshot posted while paused / terminal (fold into Finding 1)

### Problem
`WorkerEntry.tick` always builds + posts a snapshot. When `state === PAUSED` (initial menu state,
`GameEngine.update` early-returns) or terminal (`VICTORY`/`GAME_OVER`, `GameEngine.ts:275`/`:346`),
the engine state is static, yet a full snapshot is serialized 60×/s forever.

### Approach
Skip the snapshot when nothing can have changed:
- **Terminal state** (`VICTORY`/`GAME_OVER`): post exactly one final snapshot (already happens on
  the transition frame via the existing `endGame` path) then stop the loop — the run is over until
  the route unmounts (`SvgGameRoot.vue:onUnmounted` disposes the worker). Re-enable the loop on a new
  `init` message.
- **Paused** (`scaledDt === 0`): still drain the command queue (so unpause/build commands apply) and
  keep the accumulator, but skip `buildSnapshot` + `postMessage` unless a command mutated visible
  state. The signal must be a real `dirty` flag set by `applyCommand` — *not* `commandQueue.length`,
  which is always 0 by the time the snapshot decision runs (the queue is drained via `shift()` at
  the top of `tick`, `WorkerEntry.ts:75-91`).

### Code sketch (WorkerEntry.tick, after the update loop)
The snapshot is built first, then the decision branches on its `meta.state` and the dirty flag.
This corrects the original sketch, which referenced `snapshot.meta.state` before `snapshot` was in
scope:

```ts
// A dirty flag set by applyCommand whenever a command mutates runState/persistState
// (build, upgrade, sell, select, pause toggle, timeScale change, etc.). Reset per tick.
let stateMutatedThisTick = false;

// (in tick(), the command-drain loop sets stateMutatedThisTick = true on any applied mutation)

// Build the snapshot unconditionally, then decide whether to post / stop.
const snapshot = buildSnapshot(engine, lastAppliedCommandId);
const state = snapshot.meta.state;
const terminal = state === GameState.VICTORY || state === GameState.GAME_OVER;

if (terminal) {
  postMessage({ type: "snapshot", snapshot });   // final frame
  stopLoop();                                    // no more ticks until next init
  return;
}

// Paused (or otherwise idle) and nothing changed this tick → skip the post.
const idle = engine.lastScaledDt === 0 && !stateMutatedThisTick;
if (!idle) {
  postMessage({ type: "snapshot", snapshot });
}
```
`stateMutatedThisTick` is set by `applyCommand` (`applyCommand.ts`) whenever a command changes
runState/persistState (build, upgrade, sell, select, pause toggle, timeScale, etc.). Reset it to
`false` at the top of each `tick()`, before the drain loop.

### Risk / Notes
- `stopLoop()` on terminal: ensure the `dispose` message still works (it calls `stopLoop` + posts
  `disposed`); the loop is already stopped, so `dispose` is a no-op for the loop and proceeds to post
  `disposed`. Safe.
- The main-thread `renderLoop` keeps running and simply re-renders the last snapshot; fine.
- **Harden `init` re-entry.** `stopLoop()` on terminal makes re-`init` a real path (terminal → new
  run on the same worker). Today `startLoop` early-returns if `running` is already true
  (`WorkerEntry.ts:52`), and `init` does not call `stopLoop` first, so a re-`init` while the loop is
  *still running* (non-terminal case) would silently skip the `lastTime`/`accumulator` reset and reuse
  the stale loop. The terminal path is safe (loop was stopped), but to be robust: have `init` call
  `stopLoop()` before constructing the new engine, then `startLoop()` after `loadMap`/`loadRandomMap`.
  This guarantees a clean loop state on every `init` regardless of prior state. The existing
  persist-flush reset block (`:183-186`) is unchanged.
- The `idle` skip must not fire when `endScreenData` was just set on this tick — but that path is
  terminal (covered by the terminal branch above), so a `triggerEnd` in `engine.update` will set
  `state === VICTORY`/`GAME_OVER` and the final snapshot will post before `stopLoop`. Verify
  `stateMutatedThisTick` is *not* required to be `true` for the terminal post to fire (it isn't — the
  terminal branch posts unconditionally).

---

## Finding 4 — `clearStatsCache()` on every hit defeats the stats cache

### Problem
`ProjectileManager.recordDamage` (`ProjectileManager.ts:743`) calls `tower.clearStatsCache()` on
**every** damage event (direct hits and lightning). `Tower.stats` (`Tower.ts:330`) is already keyed
by `_computeCacheKey` (`Tower.ts:345`), which includes the milestone tier derived from
`totalDamageDealt`. So the cache already recomputes exactly when damage crosses a milestone
threshold; the per-hit `clearStatsCache()` forces a redundant `_computeStats` on the very next
`stats` read — which, with Finding 1, happens every frame in the snapshot.

### Approach
Remove the `clearStatsCache()` call from `recordDamage`. The key already covers every field that
damage touches (`totalDamageDealt` → milestone tier). Keep `clearStatsCache()` at the places where
`level` / `variant` / addons / `healthMult` actually change: `doUpgrade` (`Tower.ts:652`),
`specialize` (`Tower.ts:640`), `recomputeMaxHealth` is fine, and `restore`/`takeDamage` (ghost state
doesn't affect stats, so no clear needed there).

### Code sketch (ProjectileManager.ts)
```ts
private recordDamage(towerId: string | undefined, amount: number): void {
  if (!towerId) return;
  const tower = this.towerLookup?.(towerId);
  if (tower) {
    tower.totalDamageDealt += amount;
    tower.waveDamage += amount;
    // DO NOT clearStatsCache here — stats cache key already encodes milestone tiers
  }
}
```

### Risk / Notes
- Confirm no other code path relies on `totalDamageDealt` changes invalidating a field *not* captured
  by the key. The key (`:345`) covers height tier, range tier, milestone tier, level, variant — that
  is the full set of `_computeStats` inputs. Safe.

---

## Finding 5 — `getEnemiesInRange` allocates a fresh array + fresh key strings per call (GC pressure)

### Problem
`getEnemiesInRange` (`EnemyManager.ts:218`) returns a `new Array` on every call. Callers include:
per-tower targeting (`Tower.ts:863`/`:899`), frost aura / static field / ice burst / electric fence
(`Tower.ts:800`/`:808`/`:819`/`:832`), enemy heal (`Enemy.update:432`), enemy collision pass
(`resolveCollisions:582`), projectile splash (`ProjectileManager.ts:574`), and `findNearestEnemy`
which calls it **2–4× per invocation** (`:760` full + 3 subranges). Under heavy waves this is many
array allocations per frame → GC churn. The spatial hash already bounds the element count; only the
allocation itself is wasteful.

A second, overlooked GC source: the spatial hash is keyed by `` `${gx},${gy}` ``
(`EnemyManager.ts:206` and `:227`), so **every bucket probe** of every query allocates a fresh
string. Under heavy lightning usage — `findNearestEnemy` calls `getEnemiesInRange` 2–4×, each
iterating up to `(2·cellRadius+1)²` cells — that is many short-lived string allocations per frame,
all surviving to the next GC. The proposed visitor alone does not fix this; the string churn is
independent of the array allocation and, for the aura/nearest-enemy callers that iterate many
buckets, is arguably the larger GC contribution.

### Approach
Two parts, both in `EnemyManager`:

**5a. Numeric spatial-hash keys.** Replace the `Map<string, Enemy[]>` keyed by `` `${gx},${gy}` ``
with a numeric key. Two viable shapes:
- `Map<number, Enemy[]>` with key `gx * SPATIAL_AXIS_STRIDE + gy + SPATIAL_AXIS_OFFSET` (the offset
  keeps the key positive for negative `gx`/`gy`); or
- `Map<number, Map<number, Enemy[]>>` (two-level; slightly more lookups but no stride bookkeeping).

The flat numeric key is preferred — one map lookup, no string construction, no stride arithmetic
beyond a multiply-add. Update `updateSpatialHash` (`:200`), `getEnemiesInRange` (`:218`), and the
new `forEachEnemyInRange` below to use the same keying helper. `enemy.lastCellX/lastCellY` are
already numbers, so the cell-skip fast path is unaffected.

**5b. Visitor overload.** Add `forEachEnemyInRange` that iterates buckets without allocating an
array, and route the hottest callers through it. Keep `getEnemiesInRange` for callers that need an
array (snapshot-adjacent code, and the `findNearestEnemy` fallback that reduces over results).

### Code sketch — 5a (numeric key helper)
```ts
// Grid coordinates can be negative; offset by a power of two that comfortably exceeds any map.
// Map sizes are bounded (max ~64×64 tiles × tileSize / SpatialCellSize cells), so 1<<16 is ample.
const SPATIAL_AXIS_OFFSET = 1 << 16;
function spatialCellKey(cellX: number, cellY: number): number {
  return (cellX + SPATIAL_AXIS_OFFSET) * (2 * SPATIAL_AXIS_OFFSET) + (cellY + SPATIAL_AXIS_OFFSET);
}
```
`spatialHash: Map<number, Enemy[]>`. `updateSpatialHash`/`getEnemiesInRange`/`forEachEnemyInRange`
all call `spatialCellKey(...)` instead of building a template string.

### Code sketch — 5b (visitor)
```ts
forEachEnemyInRange(
  x: number, y: number, range: number,
  cb: (enemy: Enemy) => void,
): void {
  const rangeSquared = range * range;
  const cellRadius = Math.ceil(range / SpatialCellSize);
  const cx = Math.floor(x / SpatialCellSize);
  const cy = Math.floor(y / SpatialCellSize);
  for (let gx = cx - cellRadius; gx <= cx + cellRadius; gx++) {
    for (let gy = cy - cellRadius; gy <= cy + cellRadius; gy++) {
      const bucket = this.spatialHash.get(spatialCellKey(gx, gy));
      if (!bucket) continue;
      for (const enemy of bucket) {
        if (enemy.removed || enemy.reachedBase) continue;
        const dx = enemy.x - x, dy = enemy.y - y;
        if (dx * dx + dy * dy <= rangeSquared) cb(enemy);
      }
    }
  }
}
```
Convert the tower-side auras (e.g. `Tower.ts:800`):
```ts
if (stats.frostAura) {
  const frostRangePx = ICE_AURA_RANGE * tileSize;
  enemyManager.forEachEnemyInRange(this.x, this.y, frostRangePx, (enemy) =>
    enemy.applySlow(stats.slowAmt * ICE_AURA_SLOW_MULT, ICE_AURA_DURATION));
}
```
Same pattern for static field, ice burst, electric fence, enemy heal, and `resolveCollisions`
(`Enemy.update:582`). **Also convert `findNearestEnemy`** (`ProjectileManager.ts:753`) — it is the
hottest caller (2–4× `getEnemiesInRange` per invocation, called per chain hop and per lightning
bolt). It only needs the single best match, so a visitor that tracks `bestDistanceSquared` /
`bestEnemy` is strictly better than building then reducing an array. Keep `getEnemiesInRange` only
for the array-returning callers (e.g. `selectTarget`, which sorts its input).

### Risk / Notes
- Behavior is identical (same cell iteration, same filter). Pure allocation + string-churn reduction.
- `forEachEnemyInRange` must not be used by callers that mutate the spatial hash during iteration
  (none of the listed callers do — kills are deferred). Verify before switching `resolveCollisions`,
  which *mutates lane offsets* but never the hash.
- The numeric key helper (`spatialCellKey`) is the single source of truth for hashing. `lastCellX`/
  `lastCellY` on `Enemy` stay as raw cell coordinates (the cell-skip fast path in `updateSpatialHash`
  compares them directly, unchanged); the helper is applied only when touching the map.
- `SPATIAL_AXIS_OFFSET` of `1<<16` comfortably exceeds any map's negative-cell range (max map ~64×64
  tiles / `SpatialCellSize`). If map sizes ever grow far larger, raise the offset — the key remains a
  safe positive integer as long as the offset exceeds the maximum |cell coordinate|.
- `findNearestEnemy` conversion: the visitor must faithfully replicate the existing tie-break
  behavior (first-found wins on equal distance in the current `getEnemiesInRange` + reduce path).
  Iterate buckets in the same order and use strict `<` on `bestDistanceSquared` so the first enemy at
  a given distance wins, matching current behavior.

---

## Finding 6 — `ParticleSystem.update` reallocates every frame

### Problem
`ParticleSystem.ts:73`:
```ts
this.particles = this.particles.filter((p) => p.life > 0);
```
allocates a new array every tick (bounded by `MAX_PARTICLES = 400`).

### Approach
In-place compaction (write-index swap). Small, safe win.

### Code sketch (ParticleSystem.ts)
```ts
update(dt: number): void {
  let write = 0;
  for (let read = 0; read < this.particles.length; read++) {
    const p = this.particles[read]!;
    p.ox += p.deltaX * dt;
    p.oy += p.deltaY * dt;
    p.deltaX *= 0.98;
    p.deltaY *= 0.98;
    p.life -= dt;
    if (p.life > 0) this.particles[write++] = p;
  }
  this.particles.length = write;
}
```

### Risk / Notes
- `getRenderData` (`:76`) still allocates a fresh render array — that one is consumed by the snapshot
  (Finding 1) and is acceptable; could be folded into the same visitor pattern later if needed.

---

## Finding 7 — Particles: render-only effect, removed from the snapshot (dominant per-tick clone)

### Problem
`WorkerEntry.tick` builds + `structuredClone`s a full `SimulationSnapshot` every active tick. The
largest remaining per-tick cost at scale is the particle array: `GameEngine` owns a `ParticleSystem`
(`GameEngine.ts:198`), updates it every tick (`GameEngine.ts:303`), and `SnapshotSerializer.ts:50`
serializes the **entire live set** (`engine.particleManager?.getRenderData()`, up to
`MAX_PARTICLES = 400` moving `RenderParticle`s) into the snapshot. Enemies and projectiles must stay in
the worker (the engine mutates them), but particles are purely cosmetic and can be a **main-thread
UI-layer effect** — they do not affect gameplay. Shipping them every tick is the dominant avoidable
serialization, and it is the one entity class the engine does not need.

### Approach
The worker stops *simulating* particles. All game-side `spawn(...)` calls are redirected to a
**worker-side `ParticleSpawner`** that records sparse spawn *requests*. `buildSnapshot` includes a
`particleSpawns: ParticleSpawnRequest[] | undefined` only when the buffer is non-empty (gated, unlike
`lightningEffects`/`stunEffects` which always send `[]`), then clears it — mirroring
`consumeRenderVisualEffects` (`ProjectileManager.ts:832`). The main thread owns the real `ParticleSystem`,
spawns from the snapshot deltas, and simulates + renders it in its existing rAF loop. The `particles`
field is deleted from `SimulationSnapshot` entirely.

This reuses the **existing** render-only-effect precedent (`lightningEffects`/`stunEffects` →
`effectManager.syncVisualEffectsFromSnapshot`, `SvgGameRoot.vue:358`): particles differ only in that
they need ongoing simulation, so the main thread runs `ParticleSystem.update` each frame.

### Code sketch — shared spawner interface (consolidate 3 dupes)
`TowerManager.ts:69`, `EnemyManager.ts:8`, and the `ParticleSystem` interface in `ProjectileManager.ts:145`
all declare the same `spawn(x, y, color, count, opts)` shape. Replace with one exported interface:
```ts
export interface ParticleSpawnRequest {
  x: number;
  y: number;
  color: string;
  count: number;
  speed: number;
  life: number;
}

export interface ParticleSpawner {
  spawn(x: number, y: number, color: string, count: number, opts: { speed?: number; life?: number; size?: number }): void;
  consumeSpawns?(): ParticleSpawnRequest[] | undefined;
}
```

### Code sketch — worker-side buffering spawner
```ts
class WorkerParticleSpawner implements ParticleSpawner {
  private buffer: ParticleSpawnRequest[] = [];
  spawn(x: number, y: number, color: string, count: number, opts: { speed?: number; life?: number; size?: number }): void {
    this.buffer.push({ x, y, color, count, speed: opts.speed ?? 60, life: opts.life ?? 0.5 });
  }
  // Engine-scoped (not module-scoped) so per-engine buildSnapshot tests stay deterministic,
  // like `lastPostedPathVersion` (Caveat 2). Returns + clears only when non-empty.
  consumeSpawns(): ParticleSpawnRequest[] | undefined {
    if (this.buffer.length === 0) return undefined;
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}
```

### Code sketch — `GameEngine` stops owning a `ParticleSystem`
- Remove `particleManager: ParticleSystem | null` (`GameEngine.ts:88`, set `:133`, created `:198`,
  updated `:303`, ghost-spawn `:339`).
- Add `particleSpawner: ParticleSpawner` (constructor param, default `new NoopParticleSpawner()` so the
  existing `new GameEngine(...)` call sites in tests stay green).
- `_initMap` (`GameEngine.ts:198-214`): pass `this.particleSpawner` into `EnemyManager` /
  `ProjectileManager` / `TowerManager` instead of the `ParticleSystem`.
- `update` (`GameEngine.ts:303`): drop `this.particleManager?.update(dt)`.
- Ghost spawn (`GameEngine.ts:339`): `this.particleSpawner?.spawn(...)`.
- `WorkerEntry.ts:222`: construct + inject `new WorkerParticleSpawner()`.
- Legacy non-worker path (`MainThreadCommandDispatcher` / `MainThreadHostBindings`): inject the shared
  main-thread `ParticleSystem` itself as the spawner (spawns land straight in it; `consumeSpawns` is
  `undefined`, so no deltas are needed).

### Code sketch — `SnapshotSerializer` + `SimulationSnapshot`
`SnapshotSerializer.ts`:
```ts
// replace the `particles: ...` line (was :50) with:
const particleSpawns = engine.particleSpawner?.consumeSpawns?.() ?? undefined;
// ...
// particleSpawns,        // sparse, non-empty only (gated like `paths`)
```
`SimulationSnapshot.ts`: delete `particles: ParticleSnapshot[]` (`:14`) and the `ParticleSnapshot` type
(`:164`); add:
```ts
// Sparse particle spawn requests emitted this tick. Present ONLY when the worker's
// spawn buffer is non-empty, so quiet ticks send nothing — unlike lightning/stun
// effects which always ship `[]`. The main thread spawns each request into its own
// `ParticleSystem` and consumes the array exactly once.
particleSpawns: ParticleSpawnRequest[] | undefined;
```

### Code sketch — main thread owns sim + render (`SvgGameRoot.vue`)
- Add a component-scoped `const mainParticleSystem = new ParticleSystem();` (reuse `src/game/ParticleSystem.ts`).
- `handleWorkerMessage` `case "snapshot"`: after `snapshotStore.apply(msg.snapshot)`, if
  `snapshot.particleSpawns` is present, call
  `mainParticleSystem.spawn(req.x, req.y, req.color, req.count, { speed: req.speed, life: req.life })`
  per request.
- `renderLoop` (`:356`): replace `particleManager.syncFromGameEngine(snapshot.particles)` with a
  main-thread sim step:
  ```ts
  const nowMs = performance.now();
  const particleDt = Math.min(0.05, (nowMs - lastParticleFrame) / 1000) || 0;
  lastParticleFrame = nowMs;
  mainParticleSystem.update(particleDt);
  particleManager.syncFromGameEngine(mainParticleSystem.getRenderData());
  ```
- `onUnmounted`: add `mainParticleSystem.clear();`.
- `ParticleManager.syncFromGameEngine` and the `Particle` render type (`render/svg/types.ts:126`) already
  match `ParticleSystem.getRenderData()` (`{ id, x, y, color, size, opacity }`) — **no change** there.

### Code sketch — `stores/game.ts` (optional cleanup)
`particleManager: ParticleSystem | null` (`stores/game.ts:103,142,238,245,250`) is dead in the worker
path. Remove it + the `particleManager` param of `setManagers` (`:241-251`), or keep it holding
`mainParticleSystem` for the legacy adapter. Confirm at implementation.

### Risk / Notes
- **Behavior-preserving for gameplay.** Particle *appearance* (spawn positions, colors, counts, sizes)
  is unchanged. Only the motion timing follows the rAF `dt` (variable; pauses when the tab is hidden)
  instead of the fixed 60 Hz sim `dt`. This is acceptable and arguably better (no wasted sim when
  backgrounded) for a purely cosmetic layer.
- `MAX_PARTICLES = 400` cap stays on the main-thread `ParticleSystem`.
- Spawn-request volume is sparse: one request per hit / kill / build / ghost, each bundling up to ~14
  particles. Structured-clone of a tiny array happens only on active ticks, replacing the per-tick clone
  of up to 400 live, moving particles — the dominant cost is eliminated.
- `ParticleManager` render pool (`PARTICLE_POOL_SIZE = 300`, `render/svg/types.ts:22`) is unchanged.

---

## Implementation Caveats (pre-implementation corrections)

Corrections derived from review of the plan against the source. The findings' approach sections
above already incorporate them; this section records why each change was made.

1. **Finding 1a: replace the version-tagged cache with selected-tower-only derived fields.** The
   original versioned-cache sketch (`_snapVersion` / `_snapCache`) was fragile: the invalidation set
   (`level`/`variant`/`totalInvested`/`health`/`maxHealth`/`isGhost`) both included fields that do not
   affect the cached values (`health`/`maxHealth` — bumping on every hit a tower takes defeats the
   optimization in heavy combat) and omitted the `totalDamageDealt` milestone tier that
   `milestoneBonus` and `stats` actually depend on. Rather than split and curate invalidation hooks
   across `doUpgrade`/`specialize`/`sell`/`restore`/ghost-toggle (and risk future drift), the
   corrected approach exploits the fact that *only* `TowerPanel` for the *selected* tower consumes
   the derived fields. Verified `render/svg/TowerManager.ts` reads none of them — it only touches
   visual fields. So `snapshotTower` emits the expensive derived fields only when `isSelected`, the
   `TowerSnapshot` type makes them optional, and the invalidation problem disappears entirely
   (zero per-tower recompute, vs. cache-hit-on-recompute which still builds a cache-key string per
   tower per tick via `_computeCacheKey`).

2. **1b gating must be engine-scoped, not module-scoped.** `lastPathVersion` sketched as a
   worker/module-level mutable will change snapshot *output* based on a stale version from a different
   engine, silently breaking the round-trip assertions in `tests/unit/sim/snapshot.test.ts` and
   `tests/integration/worker-roundtrip.test.ts` (which call `buildSnapshot` directly). Store the
   last-posted version on `GameEngine` (e.g. `engine.lastPostedPathVersion`) and reset it in
   `loadMap`/`loadRandomMap`.

3. **Finding 1c: drop `gemBreakdown`/`milestoneRewardsClaimed` entirely; do not relocate them.** The
   original sketch assumed `EndScreen` and `StatsPanel` read these fields from `snapshot.meta`. They
   do not: `EndScreen.vue:17` reads `gameStore.endScreenData?.gemBreakdown` (a *separate* object set
   on `triggerEnd` at `GameEngine.ts:531/545`), `StatsPanel.vue` references neither field anywhere, and
   `SnapshotStore.ts` does not mirror them into `gameStore`. The only reader of
   `snapshot.meta.milestoneRewardsClaimed` is `WorkerEntry.ts:113` (the persist-flush trigger), which
   can read `engine.runState.milestoneRewardsClaimed` directly. So both fields are dead weight on the
   main thread — remove them from `buildMeta` and fix the one worker-internal reader. No
   `requestRunMeta` command, no terminal-snapshot special-case, no on-demand request mechanism.

---

## Phase 2: Architectural & Follow-ups

### P2-1. Snapshot backpressure — rate-match worker→rAF (VALID, architectural)
The dominant per-tick cost on huge waves is enemy/projectile/particle *entity* serialization, which
Findings 1–6 (and Finding 7) do not fully remove — Finding 7 only removes particles. The next
lever is to have the main thread ack consumption so the worker only posts when the last snapshot was
rendered (rate-match to rAF), avoiding `structuredClone` when the worker outruns rAF (background
tab, 30 Hz display). This requires a **main→worker** ack message and a consumption-tracking field —
an architectural change that violates the stated Non-Goal ("no new data structures for hot path logic").
**Flag as Phase 2, not now.** (Note: after Finding 7, the per-tick entity set is enemies +
projectiles + towers only; if backpressure is ever pursued, particles are already off the snapshot.)

### P2-2. `getRenderData` per-tick array allocations (VALID, known follow-up)
`ParticleSystem.getRenderData()` (`ParticleSystem.ts:82` — the original note cited `:823`, a mis-line)
and `ProjectileManager.getRenderData()` (`ProjectileManager.ts:818`) allocate fresh arrays every
snapshot. Finding 6's risk note (`Optimize.md:446-447`) already acknowledges this ("could be folded
into the same visitor pattern later if needed"). The only safe wins are a reused scratch buffer /
visitor pattern or capping array size. **Nuance:** `postMessage` clones *synchronously at call time*,
so the worker-side source array is free to reuse immediately after the call returns (the main thread
holds a separate cloned object) — a reused outer buffer is technically viable; the inner per-entity
objects still churn. `SharedArrayBuffer` would remove the clone entirely but needs COOP/COEP headers
— out of scope. Low-risk Phase-2 follow-up.

---

## Implementation Order & Verification

1. **Finding 4** (trivial, safe) — confirm no perf regression, no gameplay change.
2. **Finding 6** (trivial) — particle count/behavior unchanged.
3. **Finding 2 + 1b** (path gating, engine-scoped version per Caveat 2) — verify highlights still
   render on build/sell.
4. **Finding 1a + 1c** (selected-tower-only derived fields per Caveat 1; `gemBreakdown`/
   `milestoneRewardsClaimed` dropped from `buildMeta` per Caveat 3; `canCancel`/`cancelRemainingMs`
   dropped with `placedAt` shipped on the cheap path) — verify `TowerPanel` still shows correct sell
   value, upgrade cost, milestone bonus, and cancel-window countdown for the selected tower; verify
   `EndScreen` still renders `endScreenData.gemBreakdown` (unchanged — it never read `meta`); verify
   `StatsPanel` renders unchanged (it never read either dropped field).
5. **Finding 3** (pause/terminal gating with build-then-branch sketch and hardened `init`
   re-entry) — verify build/upgrade still work while paused (a `selectBuildType` or `input:click`
   command sets `stateMutatedThisTick` and forces a snapshot post that frame), and the final
   end-game snapshot reaches `EndScreen`.
6. **Finding 5** (numeric spatial-hash keys per 5a + visitor query per 5b, including
   `findNearestEnemy` conversion) — verify targeting/auras/collisions behave identically. Add a unit
   test comparing `getEnemiesInRange` output to the visitor callback set under a populated hash, and
   a test asserting `findNearestEnemy` returns the same enemy before/after the visitor conversion
   (including the equal-distance tie-break: first-found wins).

7. **Finding 7** (particles → main-thread render-only) — verify no `particles` array remains in the
   snapshot; `particleSpawns` (sparse, non-empty only) appears on spawn ticks and is consumed once;
   the main-thread `ParticleSystem` still simulates + renders identically; the existing manager tests
   (`game-projectile-manager`, `tower-manager`, `enemy-manager`, `enemy-attack`, `waves`) stay
   green (they inject their own mock spawner); replace the `tests/unit/sim/snapshot.test.ts:57`
   `expect(snap.particles).toBeInstanceOf(Array)` assertion with a `particleSpawns` check.

### Suggested verification
- Existing unit suite (`tests/unit/*`, `tests/integration/*`) must stay green. `buildSnapshot` output
  now varies by engine state: `paths` are omitted unless `grid.pathVersion` changed since the last
  posted snapshot (engine-scoped, Caveat 2); `gemBreakdown`/`milestoneRewardsClaimed` are removed
  from `buildMeta` entirely (Caveat 3); and `TowerSnapshot`'s derived fields are present only on the
  selected tower (Caveat 1). Reset the engine-scoped path-version gate in `loadMap`/`loadRandomMap`
  so each test engine starts clean. Update `tests/unit/sim/snapshot.test.ts` to assert derived fields
  are present on the selected tower and absent on non-selected towers, and to no longer expect
  `meta.gemBreakdown`/`meta.milestoneRewardsClaimed`.
- For Finding 3, add a test that drives a paused-then-unpause sequence through the mock-worker
  harness (`tests/integration/worker-roundtrip.test.ts`) and asserts: (a) no snapshot is posted while
  paused *and* idle, (b) a snapshot is posted on the frame a command applies while paused, (c) the
  terminal snapshot posts exactly once before the loop stops, and (d) a subsequent `init` re-enables
  the loop cleanly.
- Manual: load a late wave with many lightning towers + stormcall; observe steady ~60 fps and reduced
  GC (Chrome devtools Performance / Memory allocation timeline) before/after.

### Estimated risk
Low across all items: each is "stop doing redundant work" with behavior-preserving guards. Findings
1–4 are the load-bearing ones; 5–6 are polish. Finding 7 is structural but behavior-preserving
for gameplay — only particle motion timing follows rAF instead of the fixed sim `dt` (cosmetic).

---
---

# Detailed Plan for P2-1

Plan: Worker→rAF Backpressure (gate build + post on ack)
Goal
Stop the worker from running buildSnapshot() + postMessage() on ticks where the main thread has not yet consumed the previous snapshot. The worker keeps simulating at 60 Hz unconditionally; only the snapshot build and post are gated. Net win: no snapshot allocation / structured-clone on ticks the renderer didn't drain (underpowered machines, 30 Hz displays, brief main-thread stalls). The change is behavior-preserving — the renderer only ever shows the latest snapshot, and dropped intermediate frames are automatically replaced by the current state at the next post.
Mechanism
- New worker flag: let awaitingAck = false;
- New MainToWorkerMessage: { type: "snapshotAck" }.
- Main thread: in renderLoop, after snapshotStore.apply(snapshot) and the render-manager sync calls, post worker.postMessage({ type: "snapshotAck" }) once per rendered frame (before rescheduling requestAnimationFrame).
- Gate (WorkerEntry.ts:142-162): when a post is due, only buildSnapshot+postMessage if not blocked by awaitingAck. On a gated post, set awaitingAck = true.
- On snapshotAck, set awaitingAck = false (the next tick posts the now-current snapshot).
- Intermediate frames are dropped automatically (latest state captured at post time).
Decoupling rule
The fixed-timestep accumulator (WorkerEntry.ts:104-114) runs unconditionally every tick. Only buildSnapshot+postMessage reference awaitingAck. The sim never waits on the renderer.
Gating predicate (the core of the change)
Reuses the existing idle = engine.lastScaledDt === 0 && !stateMutatedThisTick. Replace lines 142-162:
if (terminal) {
  const snapshot = buildSnapshot(engine, lastAppliedCommandId);
  postMessage({ type: "snapshot", snapshot });
  hasPostedSnapshot = true;
  if (engine.persistDirty) {
    host.schedulePersistSave(buildPersistSlice(engine));
    engine.persistDirty = false;
  }
  stopLoop();
  return;
}

if (!idle || !hasPostedSnapshot) {
  const isBaseline = !hasPostedSnapshot;
  // Paused AND a command mutated visible state this tick (distinct from `idle`,
  // which is the non-mutated paused case). The only force path while paused.
  const pausedMutation = engine.lastScaledDt === 0 && stateMutatedThisTick;
  // Force-posts bypass backpressure: baseline, AND any tick where a command
  // applied (paused OR running) so player input is reflected promptly.
  const forced = isBaseline || stateMutatedThisTick;
  if (awaitingAck && !forced) {
    // Running (no command, not baseline) but main hasn't acked the last
    // snapshot → drop build+post. awaitingAck stays true; next tick re-checks.
    // Persist-flush is skipped too (still fires on forced posts / 5s fallback).
  } else {
    const snapshot = buildSnapshot(engine, lastAppliedCommandId);
    postMessage({ type: "snapshot", snapshot });
    hasPostedSnapshot = true;
    // baseline       → true  (establish gate from first frame)
    // pausedMutation → false (so a *next* forced post isn't swallowed)
    // running/normal → true  (resume throttle; next running tick waits for ack)
    awaitingAck = !pausedMutation;
    // …existing persist-flush block…
    const milestoneKeyCount = Object.keys(engine.runState.milestoneRewardsClaimed).length;
    const waveChanged = engine.runState.currentWave !== lastFlushWave;
    const milestoneGained = milestoneKeyCount > lastFlushMilestoneKeys;
    const fallbackElapsed = now - lastFlushTime >= PERSIST_FLUSH_FALLBACK_MS;
    if (engine.persistDirty && (waveChanged || milestoneGained || fallbackElapsed)) {
      host.schedulePersistSave(buildPersistSlice(engine));
      engine.persistDirty = false;
      lastFlushTime = now;
    }
    lastFlushWave = engine.runState.currentWave;
    lastFlushMilestoneKeys = milestoneKeyCount;
  }
}
Why forced = isBaseline || stateMutatedThisTick (and not !idle): !idle is true on every running tick, so force-posting on !idle would stream every running frame and erase the entire win (and break test (b)). The gate must throttle running-idle frames; only baseline and command-applied frames (paused or running) bypass it. awaitingAck = !pausedMutation then separates the reset behavior: a running-command post sets awaitingAck = true so the next running tick resumes throttling, while a paused-command post sets awaitingAck = false so a subsequent forced post isn't swallowed.
Edge cases (must hold)
1. Baseline: !hasPostedSnapshot bypasses the gate; awaitingAck = true set on it (no ack → no further posts).
2. Idle / paused (Finding 3): pausedMutation force-posts even if awaitingAck set, then awaitingAck = false. Plain idle (paused, no command) posts nothing — unaffected.
3. Command-applied while running: stateMutatedThisTick (scaledDt ≠ 0) force-posts even if awaitingAck set, then awaitingAck = true so the next running tick resumes throttling. Player input is reflected promptly without permanently disabling backpressure.
4. Terminal: terminal branch is unconditional and returns before the gate; final post + stopLoop() always go out even if awaitingAck was set.
5. dispose / re-init: startLoop() resets awaitingAck = false (with hasPostedSnapshot = false) so a fresh run starts unblocked.
Files to change
- src/sim/WorkerProtocol.ts — add | { type: "snapshotAck" } to MainToWorkerMessage.
- src/sim/WorkerEntry.ts
- add let awaitingAck = false; near hasPostedSnapshot (line 38).
- reset awaitingAck = false; in startLoop() (line 57-62).
- replace the post block (lines 142-162) with the gated logic above.
- handle case "snapshotAck": awaitingAck = false; break; in self.onmessage switch (line 213).
- src/components/SvgGameRoot.vue — in renderLoop, after the render-manager syncFromGameEngine calls and before renderFrameHandle = requestAnimationFrame(renderLoop) (line 424), post worker?.postMessage({ type: "snapshotAck" }) once per rendered frame. The early return at line 363 (no snapshot yet) naturally defers acking until the baseline arrives.
Tests (extend tests/integration/worker-roundtrip.test.ts)
The harness drives the worker via a mock self; "main thread" is simulated by sending messages. For rate-matched cases, drive a fake main-thread rAF (setInterval ~16 ms) that posts snapshotAck and count both acks and snapshots.
- (a) No ack → only baseline + command-induced frames; running-idle ticks produce nothing. sendInit() (paused → baseline, awaitingAck = true), then sendCommand(togglePause) to running without any ack. Assert exactly 2 snapshots (baseline + the togglePause force-post) and that the count does not grow after a further wait (every subsequent running-idle tick is blocked). This proves the gate holds.
- (b) With ack each frame → rate-matched, with the running-command caveat below. Start running (sendCommand(togglePause)); drive a fake rAF posting one snapshotAck per ~16 ms with no further commands. Assert snapshotCount() tracks the ack count (within a small tolerance, e.g. ±1–2 for timer jitter). Separately, while paused, send a selectBuildType command and assert exactly one snapshot is posted on that frame (pausedMutation).
- Interaction with running commands (important): because stateMutatedThisTick force-posts even while running, a command sent during the rate-matched segment adds exactly one extra snapshot beyond the ack count (the command's own force-post), and it sets awaitingAck = true so the next running tick resumes throttling. So test (b)'s rate-match assertion must either (i) send no commands during the running+ack segment (cleanest), or (ii) if a command is sent mid-segment, add +1 to the expected upper bound and assert snapshotCount() <= ackCount + 1 (plus jitter tolerance). Do not assert strict equality while a command is in flight. This is the explicit contract for running-command frames and must be encoded so the test documents it rather than accidentally passing/failing.
- (c) Terminal → exactly one final post, loop stops, regardless of awaitingAck. Set awaitingAck = true (post baseline, send no ack, drive to victory), then action:debugEndRun. Assert exactly one terminal snapshot and no further posts after a long wait. Extends 3c.
- (d) init re-entry → loop re-enables cleanly; awaitingAck reset. Drive to terminal (sets the gate), re-init, run; assert the fresh baseline posts and subsequent running frames post again once acks flow. Extends 3d.
All four pre-existing Finding-3 tests (3a–3d) must continue to pass unchanged (their pause-toggle / selectBuildType posts are forced, so the gate does not affect them).
Risks
- Input latency: ≤1 frame (ack returns next rAF). Negligible; already effectively present.
- Background tabs: setTimeout + rAF both throttle to ~1 Hz together; the benefit is mostly the 30 Hz / underpowered-display mismatch — calibrate expectations.
- Over-acking: if main renders a stale snapshot twice (main 60 Hz / worker 30 Hz), it acks twice and the worker may post one extra redundant snapshot. Harmless, behavior-preserving.
- Persist flush on throttled ticks: skipped while blocked; still fires on forced posts, the 5 s fallback, and dispose. No persistence regression.
- SharedArrayBuffer (true clone elimination) remains a separate stretch requiring COOP/COEP headers — out of scope; P2-1 (this plan) bounds frequency, P2-2 (pooling) bounds per-call cost.
Implementation order
1. WorkerProtocol.ts — add snapshotAck.
2. WorkerEntry.ts — add flag, reset in startLoop, replace post block, handle snapshotAck case.
3. SvgGameRoot.vue — post ack once per rendered frame in renderLoop.
4. Tests (a)–(d) as above; run the suite; confirm 3a–3d still pass.
