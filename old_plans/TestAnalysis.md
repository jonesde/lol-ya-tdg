# Test Analysis — White-Box Audit Findings

Audit of the current test suite against `plans/WhiteBoxFix.md`. The plan's
classification criteria:

- **(a)** cross-boundary format literals (hand-built `SimulationSnapshot` with
  `schemaVersion` fed into `SnapshotStore.apply` or a render manager from another
  module)
- **(b)** spies on or directly calls a private/internal method (casts like
  `(x as unknown as ...).private()`, `as never`, `vi.spyOn` on a private method)
- **(c)** asserts an internal field no consumer reads

Boundary qualifier: asserting a module's *own* public output (incl. its own
format) is black-box. Only cross-boundary format knowledge and private reach are
white-box. Operational rule: a test is white-box iff it breaks under a
behavior-preserving change to (1) an internal field no consumer reads, (2) the
wire/format, or (3) a private method's name/structure.

Resolution distinction (secondary): **FIX** — rewrite to respect the boundary
when the assertion is genuine consumer-visible behavior; **REMOVE** — delete when
the assertion is only implementation/control-flow detail, provided its behavior is
already covered by a black-box test (or is behavior-free).

---

## Tier 1 — Cross-boundary format literals (highest priority)

| File | Location | Name | What the test does | Category | Tier | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `tests/unit/snapshot-store.test.ts` | `:92-127` | `refreshes mutable fields through the reactive proxy after an upgrade` | Hand-built `SimulationSnapshot` literal with `schemaVersion:1` fed into `SnapshotStore.apply`; asserts `selectedTower` reactivity after an upgrade | (a) | 1 | **FIX** | No black-box coverage; route through `buildSnapshot(engine)` or a shared factory |
| `tests/unit/snapshot-store.test.ts` | `:129-149` | `notifies watchers on selected tower field changes` | Hand-built `SimulationSnapshot` literal fed into `SnapshotStore.apply`; asserts a `watch` on `selectedTower.level` fires | (a) | 1 | **FIX** | No black-box coverage; use sanctioned factory |
| `tests/unit/snapshot-store.test.ts` | `:151-169` | `persists previousWaveDamage across frames, not just the reset frame` | Hand-built `SimulationSnapshot` literal fed into `SnapshotStore.apply`; asserts `previousWaveDamage` mirroring (`TowerPanel` contract) | (a) | 1 | **FIX** | No black-box coverage; use sanctioned factory |
| `tests/unit/components/stats-panel.test.ts` | `:123-151` | `re-reads getLatestSnapshot on each frame via gameStore.frameId` | Hand-built literal that is *stale/wrong* — includes `gemBreakdown`/`milestoneRewardsClaimed` (not in `SimulationSnapshot.ts`), omits `pathsVersion`/`waveGraphDots`/`particleSpawns`; escapes via `as SimulationSnapshot`/`as never`. Asserts rendered DOM ("100"/"250"/"Active Enemies") | (a) | 1 | **FIX** | No black-box coverage; delete bogus fields + use sanctioned factory |
| `tests/unit/components/stats-panel.test.ts` | `:153-175` | `verifies the frameId mirror advances so non-reactive readers can react` | Hand-built `SimulationSnapshot` literal fed into `SnapshotStore.apply`; asserts `gameStore.frameId` advances 0→7→8 and a dependent computed re-evaluates | (a) | 1 | **FIX** | No black-box coverage; use sanctioned factory |
| `tests/unit/components/text-game-root.test.ts` | `:76-84` | `drives a canvas redraw from the latest snapshot via rAF` | `@ts-nocheck` partial `SimulationSnapshot` (partial `EnemySnapshot`/`TowerSnapshot`) fed into `SnapshotStore.apply`; asserts canvas redraw | (a) | 1 | **FIX** | No black-box coverage; route through `buildSnapshot(engine)` |
| `tests/unit/components/text-game-root.test.ts` | `:86-94` | `never posts a snapshotAck (it is a passive second consumer)` | `@ts-nocheck` partial `SimulationSnapshot` fed into `SnapshotStore.apply`; asserts `worker.postMessage` not called | (a) | 1 | **FIX** | No black-box coverage; route through `buildSnapshot(engine)` |

---

## Tier 2 — Private-method spies / casts

| File | Location | Name | What the test does | Category | Tier | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `tests/unit/enemy-attack.test.ts` | `:266` | `separates a slower enemy to the right (+laneOffset) and a faster one to the left (-laneOffset)` | `(slow as unknown as { resolveCollisions }.resolveCollisions(enemyManager)` private call; asserts lateral collision separation (consumer-visible via `x/y`) | (b) | 2 | **FIX** | Plan's canonical fix case; drive via `enemy.update()` + assert `x/y` separation |
| `tests/unit/enemy-attack.test.ts` | `:655` | `in-contact tower attackers reach contactLineSteer (regression guard for the dead branch)` | `vi.spyOn(corridorGrid, "getTowerEdgeSegments")` + `expect(spy).toHaveBeenCalled()` — unique assertion is that a *private method was called* | (b) | 2 | **REMOVE** | Plan's canonical remove case; in-contact steering already asserted black-box at `:476` |
| `tests/unit/input.test.ts` | `:397-404` | `selects tower above when not in build mode` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible (dispatched commands); populate via public snapshot path |
| `tests/unit/input.test.ts` | `:411-419` | `selects topmost tower when no tower selected` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:486-494` | `selects tower below when not in build mode` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:500-508` | `selects bottommost tower when no tower selected` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:561-569` | `selects tower to the right when not in build mode` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:575-583` | `selects rightmost tower when no tower selected` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:590-598` | `prefers same row over diagonal when moving right` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:636-644` | `selects tower to the left when not in build mode` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:650-658` | `selects leftmost tower when no tower selected` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:662-680` | `wraps right from rightmost tower to leftmost tower on same row` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:682-700` | `wraps left from leftmost tower to rightmost tower on same row` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:702-720` | `wraps up from topmost tower to bottommost tower on same column` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:722-740` | `wraps down from bottommost tower to topmost tower on same column` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:742-760` | `finds tower at x+1,y-2 when pressing down from (x,y)` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/input.test.ts` | `:762-780` | `finds tower at x-2,y+1 when pressing left from (x,y)` | `gameStore as unknown as { towerManager }` injects internal store field | (b) | 2 | **FIX** | Consumer-visible; populate via public snapshot path |
| `tests/unit/svg-ui-overlay-manager.test.ts` | `:51` | `shows a bar above a damaged tower with width proportional to health` | `(manager as never as { towerHpBarPool }).towerHpBarPool[2]` reads internal pool array | (b)/(c) | 2 | **FIX** | Assert rendered `<rect>` DOM instead |
| `tests/unit/svg-ui-overlay-manager.test.ts` | `:59` | `colors the bar yellow below 50% and red below 25%` | `(manager as never as { towerHpBarPool }).towerHpBarPool[2]` reads internal pool array | (b)/(c) | 2 | **FIX** | Assert rendered `<rect>` DOM instead |
| `tests/unit/svg-ui-overlay-manager.test.ts` | `:67` | `hides the bar for a full-health tower` | `(manager as never as { towerHpBarPool }).towerHpBarPool[2]` reads internal pool array | (b)/(c) | 2 | **FIX** | Assert rendered `<rect>` DOM instead |
| `tests/unit/svg-ui-overlay-manager.test.ts` | `:78` | `hides leftover bars when fewer towers are damaged` | `(manager as never as { towerHpBarPool }).towerHpBarPool[3]` reads internal pool array | (b)/(c) | 2 | **FIX** | Assert rendered `<rect>` DOM instead |
| `tests/unit/svg-ui-overlay-manager.test.ts` | `:85` | `removes bar elements on dispose` | `(manager as never as { towerHpBarPool }).towerHpBarPool` reads internal pool array | (b)/(c) | 2 | **FIX** | Assert rendered `<rect>` DOM instead |
| `tests/unit/game-projectile-manager.test.ts` | `:163` | `uses the forwarded splash value for cannon instead of a hardcoded radius` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.splashRadius` | (b)/(c) | 2 | **REMOVE** | Splash delivery covered by enemy `takeDamage` assertion |
| `tests/unit/game-projectile-manager.test.ts` | `:536` | `applies burn to target` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.burnDps`/`burnDuration` | (b)/(c) | 2 | **REMOVE** | Apply-burn covered by `applyBurn` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:569` | `applies knockback to target` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.knockback`/`stunDuration` | (b)/(c) | 2 | **REMOVE** | Knockback/stun covered by enemy `x` move + `applyStun` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:720` | `stores slowFactor and slowDuration from spawn opts` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.slowFactor`/`slowDuration` | (b)/(c) | 2 | **REMOVE** | Slow covered by `applySlow` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:870` | `base sniper projectile has stunDuration from TOWER_BASE` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.stunDuration` | (b)/(c) | 2 | **REMOVE** | Stun covered by `applyStun` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:893` | `sniper Marksman variant A has stunDuration` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.stunDuration` | (b)/(c) | 2 | **REMOVE** | Stun covered by `applyStun` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:917` | `sniper Piercer variant B has stunDuration` | `(manager as any).projectiles` reaches `private projectiles`; reads `proj.stunDuration` | (b)/(c) | 2 | **REMOVE** | Stun covered by `applyStun` mock |
| `tests/unit/game-projectile-manager.test.ts` | `:248` | `hits target and removes projectile when close enough` | Cast writes `proj.isCrit` as fixture | (b) | 2 | **FIX** | Control crit via `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:300` | `applies crit damage when isCrit is true` | Cast writes `proj.isCrit` as fixture | (b) | 2 | **FIX** | Control crit via `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:330` | `pierces to next target when maxHitCount > 0` | Cast writes `proj.isCrit`/`maxHitCount` as fixture | (b) | 2 | **FIX** | Pass `pierce` via `spawn()` + `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:360` | `removes after piercing all targets` | Cast writes `proj.isCrit`/`maxHitCount` as fixture | (b) | 2 | **FIX** | Pass `pierce` via `spawn()` + `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:746` | `applies slow to enemy on hit` | Cast writes `proj.isCrit`/`x`/`y` as fixture | (b) | 2 | **FIX** | Spawn projectile at that position + `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:809` | `does not fire lightning flash for railgun stun` | Cast writes `proj.isCrit`/`x`/`y` as fixture | (b) | 2 | **FIX** | Spawn at position + `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:839` | `does not fire lightning flash for sniper stun` | Cast writes `proj.isCrit`/`x`/`y` as fixture | (b) | 2 | **FIX** | Spawn at position + `Math.random` spy |
| `tests/unit/game-projectile-manager.test.ts` | `:1432` | `findNearestEnemy visitor equivalence (Finding 5)` | `(enemyManager as any).updateSpatialHash()` private call inside test helper | (b) | 2 | **FIX** | Call private only via `manager.update()` |
| `tests/integration/integration.test.ts` | `:48-208` | `Integration: Single Wave Simulation / Tower Placement Flow / Economy Flow (12 tests)` | Direct `engine.towerManager`/`waveManager`/`runState` internal access, e.g. `engine.runState.gold -= …` | (b)/(c) | 2/3 | **FIX** | Drive build/upgrade/sell/select via public command interface; observe via snapshot `meta` |
| `tests/integration/commander.test.ts` | `:92-119` | `holds spawned enemies, then rushes them to the base on wave emergence` | `engine.enemyManager!.enemies[0]`, `engine.runState.baseHealth`, `stillHeld.routingMode`/`centerX` internal reads | (b)/(c) | 2/3 | **FIX** | Assert on `runState.baseHealth` reduction + route-group commands |

---

## Tier 3 — Internal-field pokes (lowest risk)

| File | Location | Name | What the test does | Category | Tier | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `tests/unit/enemy-manager.test.ts` | `:150-151` | `initializes enemy cell tracking on spawn` | `lastCellX`/`lastCellY` spatial-hash bookkeeping reads | (c) | 3 | **REMOVE** | Rehash behavior covered by `getEnemiesInRange` checks |
| `tests/unit/enemy-manager.test.ts` | `:156-160` | `does not rehash enemies that stay in the same cell` | `lastCellX`/`lastCellY` spatial-hash bookkeeping reads | (c) | 3 | **REMOVE** | Rehash behavior covered by `getEnemiesInRange` checks |
| `tests/unit/enemy-manager.test.ts` | `:165-170` | `rehashes enemies that move to a new cell` | `lastCellX`/`lastCellY` spatial-hash bookkeeping reads | (c) | 3 | **REMOVE** | Rehash behavior covered by `getEnemiesInRange` checks |
| `tests/unit/sim/enemy-routing.test.ts` | `:34,37` | `applyRoute('hold') parks the enemy at the target tile and does not advance past it` | `routingMode`/`arrived` internal-state pokes | (c) | 3 | **FIX** | Keep position/path assertions; drop internal-state pokes |
| `tests/unit/sim/enemy-routing.test.ts` | `:54,63` | `applyRoute('route') follows the route then reverts to default pathing on completion` | `routingMode` internal-state pokes | (c) | 3 | **FIX** | Keep position/path assertions |
| `tests/unit/sim/enemy-routing.test.ts` | `:78` | `the pathVersion re-anchor is NOT applied while routingMode !== default` | `routingMode` internal-state pokes | (c) | 3 | **FIX** | Keep path assertions |
| `tests/unit/sim/enemy-routing.test.ts` | `:87` | `applyRoute(null, 'hold') falls back to releaseToDefault` | `routingMode` internal-state pokes | (c) | 3 | **FIX** | Keep position assertions |
| `tests/unit/sim/applyCommand.test.ts` | `:47` | `llm:routeGroup with hold: true sets routingMode to 'hold'` | `routingMode` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | Low-risk; keep, or also assert consumer-visible effect |
| `tests/unit/sim/applyCommand.test.ts` | `:54,63` | `llm:routeGroup with empty waypoints releases to default pathing` | `routingMode` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | Low-risk; keep, or also assert consumer-visible effect |
| `tests/unit/sim/applyCommand.test.ts` | `:78` | `llm:routeGroup with a waypoint sets routingMode to 'route' with a non-null path` | `routingMode` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | `path` assertion provides black-box coverage |
| `tests/unit/sim/applyCommand.test.ts` | `:92` | `llm:setTargeting stores the targeting mode on the enemy` | `targetingMode` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | Low-risk; keep, or also assert consumer-visible effect |
| `tests/unit/sim/applyCommand.test.ts` | `:145` | `llm:routeGroup drops an unreachable waypoint but still routes the enemy to base` | `routingMode`/`path` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | `path` assertion provides black-box coverage |
| `tests/unit/sim/applyCommand.test.ts` | `:183` | `llm:routeGroup drops an unreachable leg but still routes the survivors` | `routingMode`/`path` pokes — documented `llm:*` seam outputs | (c) | 3 | **FIX** (borderline) | `path` assertion provides black-box coverage |
| `tests/unit/game-engine.test.ts` | `:357` | `computes the sell value once across the confirm flow (no cross-function double call)` | `vi.spyOn(tower, "sellValue").toHaveBeenCalledTimes(1)` call-count assertion | (b) borderline | 3 | **REMOVE** | Gold-refund correctness covered at `:367` |
| `tests/unit/game-engine.test.ts` | `:786-788` | `clears cachedTargetId when the targeting mode changes` | `tower.cachedTargetId` pokes (internal targeting cache) | (c) | 3 | **FIX** | Assert re-acquisition on next update |
| `tests/unit/game-engine.test.ts` | `:795-797` | `clears cachedTargetId when the fixed-aim direction changes` | `tower.cachedTargetId` pokes (internal targeting cache) | (c) | 3 | **FIX** | Assert re-acquisition on next update |
| `tests/unit/towers.test.ts` | `:231` | `Variant A (Marksman) sets marksman flag` | `_statsCache = null` to force stats recompute | (c) | 3 | **FIX** | Drive via `doUpgrade`/`specialize` so cache invalidates naturally |
| `tests/unit/towers.test.ts` | `:239` | `Variant B (Piercer) sets pierce to 3` | `_statsCache = null` to force stats recompute | (c) | 3 | **FIX** | Drive via `doUpgrade`/`specialize` |
| `tests/unit/towers.test.ts` | `:248` | `Variant A (Permafrost) multiplies the level-scaled splash by [1, 1.25, 1.5] per tier` | `_statsCache = null` to force stats recompute | (c) | 3 | **FIX** | Drive via `doUpgrade`/`specialize` |
| `tests/unit/towers.test.ts` | `:265,272,279` | `Variant A (Fragment) multiplies the level-scaled splash by CANNON_FRAGMENT_SPLASH_TIERS per tier` | `_statsCache = null` to force stats recompute | (c) | 3 | **FIX** | Drive via `doUpgrade`/`specialize` |
| `tests/unit/towers.test.ts` | `:290` | `Variant A (Overload) increases chain by 2*t and damage by 1.2^t per tier` | `_statsCache = null` to force stats recompute | (c) | 3 | **FIX** | Drive via `doUpgrade`/`specialize` |
| `tests/unit/projectile-manager.test.ts` (render) | `:180-183` | `releases overflow tracking when projectile becomes inactive` | `(pm as unknown as { overflowIds }).overflowIds` private-set read | (c) | 2 | **REMOVE** | Overflow covered by pool-bounds / "does not re-create elements" tests |
| `tests/unit/waves.test.ts` | `:305` | `starts next wave directly after PRE_EMPTIVE_WAVE_TIMER even when enemies remain` | `_waveGameTime` bookkeeping read | (c) | 3 | **REMOVE** | Consumer-visible spawn-state transitions already asserted |
| `tests/unit/waves.test.ts` | `:394-396` | `saveActiveSpawns captures open spawns` | `prevWaveSpawnIndices` bookkeeping read | (c) | 3 | **REMOVE** | Consumer-visible spawn-state transitions already asserted |
| `tests/unit/waves.test.ts` | `:419` | `closeAllSpawns resets tracked spawns to closed` | `prevWaveSpawnIndices` bookkeeping read | (c) | 3 | **REMOVE** | Consumer-visible spawn-state transitions already asserted |
| `tests/unit/game-store.test.ts` | `:286` | `resets selection state` | `upgradeBtnClickAnim` nested-state poke as fixture | (c) | 3 | **FIX** (low priority) | Set via public populate/trigger path |
| `tests/unit/game-store.test.ts` | `:301` | `resets gemBreakdown` | `gemBreakdown.bossKills.base` nested-state poke as fixture | (c) | 3 | **FIX** (low priority) | Set via public populate/trigger path |
| `tests/unit/game-store.test.ts` | `:343` | `clears selection and hover on triggerEnd` | `upgradeBtnClickAnim` nested-state poke as fixture | (c) | 3 | **FIX** (low priority) | Set via public populate/trigger path |
| `tests/unit/game-store.test.ts` | `:373` | `clears selection and hover state` | `upgradeBtnClickAnim` nested-state poke as fixture | (c) | 3 | **FIX** (low priority) | Set via public populate/trigger path |
| `tests/unit/game-store.test.ts` | `:398,409` | `resets all economy fields` | `gemBreakdown.bossKills.base` nested-state pokes as fixtures | (c) | 3 | **FIX** (low priority) | Set via public populate/trigger path |

---

## Fix vs Remove summary (secondary distinction)

| Verdict | Approx. occurrences | Where | Rationale |
|---|---|---|---|
| **REMOVE** | ~22 | enemy-attack:655; enemy-manager `lastCellX/Y`; game-projectile-manager internal-field reads; render projectile-manager `overflowIds`; waves `_waveGameTime`/`prevWaveSpawnIndices`; game-engine `sellValue` spy | Each assertion has a black-box companion already; removing loses no real coverage |
| **FIX** | ~50+ | All Tier 1 (3 files); enemy-attack:266; input; svg-ui-overlay-manager; game-projectile-manager fixture writes + `updateSpatialHash`; integration/commander engine access; enemy-routing/applyCommand internal-state pokes; game-engine `cachedTargetId`; towers `_statsCache`; game-store nested pokes | Genuine consumer-visible behavior preserved at the stable boundary |

No white-box test needs deletion for lack of coverage — every REMOVE target has a
black-box companion; every FIX target protects real consumer-visible behavior.

---

## Fully black-box files (no action)

| File | Note |
|---|---|
| `tests/unit/enemies.test.ts` | Entity public state only |
| `tests/unit/sim/enemy-perimeter.test.ts` | Public state / `getBaseEdgeSegments` results |
| `tests/unit/tower-manager.test.ts` | Own public API |
| `tests/unit/particles.test.ts` | Legitimate `Particle[]` input + DOM |
| `tests/unit/sim/snapshot.test.ts` | Asserts serializer's own output; stale `snap.particles` assertion at `:59` to delete (not white-box) |
| `tests/unit/snapshot-merge.test.ts` | Asserts `mergeWaveGraphDots` own `WaveGraphDot` contract |
| `tests/unit/persist-store.test.ts` | Own storage format contract |
| `tests/unit/ui-store.test.ts` | Public store state/getters |
| `tests/unit/map-theme.test.ts` | Own input types + DOM/SVG-string |
| `tests/unit/skill-tree.test.ts` | Pure functions, own `SaveFixture` |
| `tests/unit/router.test.ts` | Public store state |
| `tests/unit/commanders/observation.test.ts` | Own `CommanderSnapshotSlice` input |
| `tests/unit/commanders/stubby-brain.test.ts` | Own `CommanderObservation` |
| `tests/unit/commanders/stubbs-brain.test.ts` | Own `CommanderObservation` |
| `tests/unit/components/game-screen.test.ts` | Rendered DOM / public store |
| `tests/unit/components/tower-panel.test.ts` | Rendered DOM / public store |
| `tests/unit/components/main-menu.test.ts` | Rendered DOM / public store |
| `tests/unit/components/pause-menu.test.ts` | Rendered DOM / public store |
| `tests/unit/components/end-screen.test.ts` | Rendered DOM / public store |
| `tests/unit/components/game-shop.test.ts` | Rendered DOM / public store |
| `tests/unit/components/debug-panel.test.ts` | Rendered DOM / public store |
| `tests/unit/components/confirm-dialog.test.ts` | Rendered DOM / public store |
| `tests/unit/components/minimap-panel.test.ts` | Rendered DOM / public store |
| `tests/unit/components/game-hud.test.ts` | Rendered DOM / public store |
| `tests/unit/components/skill-tree.test.ts` | Rendered DOM / public store |
| `tests/unit/components/map-select.test.ts` | Rendered DOM / public store |
| `tests/unit/components/help-dialog.test.ts` | Rendered DOM / public store |
| `tests/unit/spawn-manager.test.ts` | Public `init`/`sync`/`getElements` + DOM |
| `tests/unit/svg-effect-manager.test.ts` | Public effects + DOM |
| `tests/unit/text-render.test.ts` | Own render-input types + `mockCtx` |
| `tests/unit/text-grid-builder.test.ts` | Own grid-input types |
| `tests/integration/worker-roundtrip.test.ts` | Builds snapshot via real `GameEngine` round-trip; asserts worker's produced output |

---

## Recommended execution order

1. **Tier 1 first** — extract one shared snapshot-factory helper (or use
   `buildSnapshot(engine)`) and rewrite `snapshot-store.test.ts`,
   `stats-panel.test.ts`, `text-game-root.test.ts`. Highest design-debiasing value.
2. **Tier 2** — `enemy-attack:266` (FIX) + `:655` (REMOVE), then `input` /
   `svg-ui-overlay-manager` / `game-projectile-manager` casts.
3. **Tier 3** — REMOVE the internal-field pokes that already have black-box
   coverage; FIX the rest opportunistically.
