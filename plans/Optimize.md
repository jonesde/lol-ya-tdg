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

**1a. Cache slow-changing tower snapshot fields on the Tower.**
Add a version-tagged cache for the derived fields so they are computed once per
level/variant/totalInvested/health change instead of 60×/s/tower.

**1b. Gate path post by `grid.pathVersion`** (also fixes Finding 2 — see that section).

**1c. Send `gemBreakdown` / `milestoneRewardsClaimed` only when a run-static version bumps** —
they are copied into the snapshot unconditionally at `SnapshotSerializer.ts:63-64`.

### Code sketch — 1a (Tower.vue-tagged cache)
In `Tower.ts`, replace ad-hoc recompute at snapshot time with a versioned cache:
```ts
// new fields on the Tower instance
private _snapVersion = 0;
private _snapCache: {
  sellValue: number; canUpgrade: CanUpgradeResult; milestoneBonus: {...};
  upgradeCostAt5: number; stats: { damage; range; fireRate; splash; chain };
} | null = null;

// bump wherever level/variant/totalInvested/health/maxHealth/isGhost change:
// doUpgrade(:645), specialize(:625), sell (TowerManager), restore(:679), takeDamage ghost
private bumpSnapVersion(): void { this._snapVersion++; this._snapCache = null; }

getSnapshotDerived() {
  if (this._snapCache && this._snapVersion === this._snapCacheVersion) return this._snapCache;
  // ... compute sellValue(), canUpgrade(persist), currentMilestoneBonus(),
  //     upgradeCost(5), and the stats subset once ...
  this._snapCache = { ... }; this._snapCacheVersion = this._snapVersion;
  return this._snapCache;
}
```
`snapshotTower` (`SnapshotSerializer.ts:120`) then reads `t.getSnapshotDerived()` instead of
calling the methods directly. Keep `canCancel()` / `cancelRemainingMs()` out of the per-tower
snapshot entirely (they are time-based and only needed for the **selected** tower) — see note below.

> **Note on cancel fields:** `canCancel` and `cancelRemainingMs` depend on `Date.now() - placedAt`,
> so they legitimately change each frame. Only `TowerPanel` for the *selected* tower needs them.
> Either (a) drop them from `TowerSnapshot` and compute in `TowerPanel` from `tower.placedAt`, or
> (b) keep them but accept the small cost. Option (a) is preferred to remove per-tower/frame work.

### Code sketch — 1c (run-static meta version)
Track a version in the engine that bumps on any `gemBreakdown` / `milestoneRewardsClaimed` change
(centralize in `earnGold`/`onEnemyKill`/`onBossKilled`/`onWaveCleared`/`endGame`). In
`buildSnapshot`, include `gemBreakdown`/`milestoneRewardsClaimed` only when
`engine.runStaticVersion` differs from the last posted one; the worker remembers the last posted
version and the main thread keeps its own copy when the snapshot omits them.

### Risk / Notes
- `getSnapshotDerived` needs the `PersistState` (for `canUpgrade`/`upgradeCost(5`) — already passed
  to `snapshotTower`, keep threading it.
- Schema change for `gemBreakdown`/`milestoneRewardsClaimed` omission is backward-compatible with the
  render loop because those fields are only read by `EndScreen`/`StatsPanel` off `getLatestSnapshot()`
  and a missing value means "unchanged, use prior".

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
`SnapshotSerializer.ts` — track last posted path version at module/worker scope:
```ts
let lastPathVersion = -1;
// inside buildSnapshot:
const grid = engine.grid;
const paths = grid && grid.pathVersion !== lastPathVersion ? grid.paths : undefined;
if (paths) lastPathVersion = grid.pathVersion;
return { /* ... , paths */ };
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
  `init` message (already resets state in `WorkerEntry.ts:177`).
- **Paused** (`scaledDt === 0`): still drain the command queue (so unpause/build commands apply) and
  keep the accumulator, but skip `buildSnapshot` + `postMessage` unless a command mutated visible
  state. Simplest correct rule: only skip when `lastScaledDt === 0 AND no command was applied this
  tick` (track via `commandQueue` length or a `dirty` flag set by `applyCommand`).

### Code sketch (WorkerEntry.tick, after the update loop)
```ts
const terminal = snapshot.meta.state === GameState.VICTORY || snapshot.meta.state === GameState.GAME_OVER;
if (terminal) {
  postMessage({ type: "snapshot", snapshot });   // final frame
  stopLoop();                                      // no more ticks until next init
  return;
}
const idle = engine.lastScaledDt === 0 && commandQueue.length === 0 && !stateMutatedThisTick;
if (!idle) {
  const snapshot = buildSnapshot(engine, lastAppliedCommandId);
  postMessage({ type: "snapshot", snapshot });
}
```
`stateMutatedThisTick` is set by `applyCommand` (`applyCommand.ts`) whenever a command changes
runState/persistState (build, upgrade, sell, select, pause toggle, etc.).

### Risk / Notes
- `stopLoop()` on terminal: ensure the `dispose` message still works (it calls `stopLoop` + posts
  `disposed`); the loop is already stopped, so `dispose` is a no-op for the loop and proceeds to post
  `disposed`. Safe.
- The main-thread `renderLoop` keeps running and simply re-renders the last snapshot; fine.

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

## Finding 5 — `getEnemiesInRange` allocates a fresh array per call (GC pressure)

### Problem
`getEnemiesInRange` (`EnemyManager.ts:218`) returns a `new Array` on every call. Callers include:
per-tower targeting (`Tower.ts:863`/`:899`), frost aura / static field / ice burst / electric fence
(`Tower.ts:800`/`:808`/`:819`/`:832`), enemy heal (`Enemy.update:432`), enemy collision pass
(`resolveCollisions:582`), projectile splash (`ProjectileManager.ts:574`), and `findNearestEnemy`
which calls it **2–4× per invocation** (`:760` full + 3 subranges). Under heavy waves this is many
array allocations per frame → GC churn. The spatial hash already bounds the element count; only the
allocation itself is wasteful.

### Approach
Add a callback/visitor overload that iterates buckets without allocating, and route the hottest
callers through it. Keep `getEnemiesInRange` for callers that need an array (snapshot-adjacent code,
`findNearestEnemy`'s fallback).

### Code sketch (EnemyManager.ts)
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
      const bucket = this.spatialHash.get(`${gx},${gy}`);
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
(`Enemy.update:582`). `selectTarget` and `findNearestEnemy` can keep `getEnemiesInRange` (they need
the array for reduce / distance comparisons), or also switch to the visitor where they only need a
single best match.

### Risk / Notes
- Behavior is identical (same cell iteration, same filter). Pure allocation reduction.
- `forEachEnemyInRange` must not be used by callers that mutate the spatial hash during iteration
  (none of the listed callers do — kills are deferred). Verify before switching `resolveCollisions`,
  which *mutates lane offsets* but never the hash.

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

## Implementation Order & Verification

1. **Finding 4** (trivial, safe) — confirm no perf regression, no gameplay change.
2. **Finding 6** (trivial) — particle count/behavior unchanged.
3. **Finding 2 + 1b** (path gating) — verify highlights still render on build/sell.
4. **Finding 1a + 1c** (tower snapshot cache, run-static meta) — verify `TowerPanel`/`EndScreen`
   still show correct sell value, upgrade cost, milestone bonus, gem breakdown.
5. **Finding 3** (pause/terminal gating) — verify build/upgrade still work while paused, and the
   final end-game snapshot reaches `EndScreen`.
6. **Finding 5** (visitor query) — verify targeting/auras/collisions behave identically (add a unit
   test comparing `getEnemiesInRange` output to the visitor callback set).

### Suggested verification
- Existing unit suite (`tests/unit/*`, `tests/integration/*`) must stay green; the snapshot schema is
  the only surface that changes (omitted `paths`/`gemBreakdown`/`milestoneRewardsClaimed` on
  unchanged frames) — verify `SnapshotStore`/`EndScreen`/`TowerPanel` tolerate omission.
- Manual: load a late wave with many lightning towers + stormcall; observe steady ~60 fps and reduced
  GC (Chrome devtools Performance / Memory allocation timeline) before/after.

### Estimated risk
Low across all items: each is "stop doing redundant work" with behavior-preserving guards. Findings
1–4 are the load-bearing ones; 5–6 are polish.
