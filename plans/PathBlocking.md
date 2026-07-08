# Implementation Plan: Path Blocking, Enemy Attacks & Tower Health

**Scope summary:** This plan adds (1) tower health + ghost state, (2) enemy attack ability with attack animations, (3) path-tile tower blocking with Dijkstra weakest-path fallback, (4) enemy-enemy collision / lane-passing, and (5) two new high-health towers ("Sturdy Wall", "Shotgun Tank"). Enemy attack animations and the two new tower sprites are added to `default-map-theme.json` only; `the-aftermath.json` is out of scope for both the attack animation images and the new tower sprites.

**Conventions used in this plan** (per `AGENTS.md`): all new variables use descriptive full words; lines target ~100 chars. New game-side pure logic should be covered by Vitest unit tests (mirror `tests/unit/{grid,pathfinding,towers,enemies,tower-manager,enemy-manager,skill-tree,map-theme}.test.ts`).

**Architecture note:** The worker/snapshot migration (`plans/ArchitecturePlan.md` §3) is in place. `GameEngine` runs inside the worker (`src/sim/WorkerEntry.ts`); the main thread uses `SnapshotStore` + `WorkerCommandDispatcher`; render managers consume `SimulationSnapshot` (not live `Tower[]`/`Enemy[]`). New/changed simulation state must be exposed through `HostBindings` (sound/UI/confirm/persist) and mirrored into `SimulationSnapshot` (`TowerSnapshot`/`EnemySnapshot`), since the render managers read snapshots. `GameEngine` no longer constructs `SoundManager` or calls Pinia stores directly. All `file:line` references below reflect the current post-migration tree. `SpatialIndex` and SoA typed-array storage are **not** implemented (see the "Fit with ArchitecturePlan" section).

---

## Original Functional Plan

**DO NOT MODIFY - FOR REFERENCE ONLY**
```
Path Blocking, Enemy Attack ability (vary damage done by enemy), Tower Health
- Give towers a health attribute and a varying amount of health per tower
	- all existing towers can be used for path blocking but are not meant for that, so give them only small amounts of health meaning they will be destroyed relatively quickly of deployed this way
	- when a tower loses all health turn it into a 'ghost' that looks translucent (use CSS transparency to modify SVG image?) and that no longer blocks the path (as long as the tower is in the ghost state) and run a short (2 second) particle explosion effect with the tower's primary color; the visual effect for the ghost state will be an opacity adjustment (down to ~0.5 opacity)
	- a tower stays in the ghost state for (50 - level x 5) seconds (at tower level 7: 50-35=15s), and is then restored with full health; at the spawn of each enemy wave all ghost towers are restored
	- a tower in the ghost state cannot be sold, upgraded, or downgraded
- Give enemies an attack ability 
	- attack speed and damage done varying by enemy
	- add attack animation support similar to current current hit reaction approach, allow arbitrary number of frames and include 3 frames in map theme data
	- stunned enemies cannot attack and pauses their current attack timer (does not reset, enemies do not have to start their next attack wait over)
	- slowed enemies have attack speed slowed by the same amount as motion speed is slowed
	- add an attack animation support following the same pattern as the hit reaction animation
	- add attack animations (3 frames each like hit reaction) to each enemy in default-map-theme.json (the-aftermath.json out of scope for this plan, to be done seaprately); enemy images are oriented to rightward movement (the right side is the front), have the default theme use simple geometric extensions that emerge from the main shape
- Allow towers to block the path even if no other paths to base/end are available
	- When no 'open' path is available to the base/end, calculate and draw a path that stays only on path tiles and goes through the lowest health towers needed to get to the end/base (ie find weakest/easiest path)
	- Use a Dijkstra search with tower health as edge weight to find optimal path; change current path logic to include this improvement and handle paths through towers by health, in other words:
		- Modify canPlaceWithoutBlocking to allow path-tile placements, and to ignore towers in the ghost state
		- Update Grid.recomputePaths() to fall back to Dijkstra when BFS path is blocked, considering ghost state and live tower remaining health
		- Update Enemy.update() to follow Dijkstra paths instead of setting onPathBlocked = true
- Add collision detection to enemy movement so that two enemies cannot occupy the same space (faster enemies must walk around slower enemies
	- have slower enemies move to the right side of the path and faster enemies to the left side in order to pass instead of colliding)
	- when the path is blocked allow enemies to move to the side but within the boundaries of the path tiles to stack up against the tower blocking the path
	- when enemies are blocked from motion and adjacent to a tower they start attacking that tower
	- if an enemy is blocked from motion and contacting two different towers it will always attack the lower health tower
	- use existing get nearby enemies function with spatial hash already implemented
- Add two high health towers:
	- 'Sturdy Wall' tower that does no damage
		- has one specialization option that does thorn damage (percentage of damage done by enemy is reflected back to enemy, 30%/60%/100% at levels 5/6/7)
		- the other specialization does damage like the lightning tower when enemies touch it (electric fence) and also stuns the enemy for a short time (which stops motion and attacks)
	- 'Shotgun Tank' tower that is like the basic tower but has low range (starting at 1 tile), much higher health (10x), and costs 50% more than a basic tower
		- one specialization increases tower health
		- the other is a knockback effect like the railgun tower that pushes enemies away from the Tank; make initial shotgun tower knockback config value 50% stronger than current railgun knockback, ie SHOTGUN_KNOCKBASE = 0.45 (= RAILGUN_KNOCKBASE * 1.5)
	- For each tower:
		- add to unlock upgrades (skill tree)
		- define/create specializations (data, activation logic, skill tree unlocks)
		- add SVG images to default-map-theme.json (the-aftermath.json not in scope for this, to be done later)
```

---

## Execution Order (recommended phases)

1. **Phase 0 — Constants & data model** (health, ghost timing, attack stats, new towers).
2. **Phase 1 — Tower health + ghost state** (Tower, Grid, Tower render, GameEngine, particles).
3. **Phase 1.5 — TowerManager reachability for enemies** (EnemyManager plumbing; prerequisite for Phases 2–4).
4. **Phase 2 — Path-tile placement + Dijkstra fallback** (Pathfinding, Grid, canPlaceWithoutBlocking, Enemy path-follow).
4. **Phase 3 — Enemy attack ability + attack animation** (Enemy, theme JSON, Enemy render).
5. **Phase 4 — Enemy-enemy collision & lane passing** (Enemy update, spatial-hash queries).
6. **Phase 5 — Two new towers** (Constants, SkillTree, theme SVG, electric-fence/thorn/knockback logic).
7. **Phase 6 — Tests + lint + typecheck.**

---

## Phase 0 — Constants & Data Model

### `src/game/ConstantsTower.ts`
  - `TowerBase` interface (now **line 33**), `TOWER_BASE` (**line 47**), `TOWER_LEVEL_DMG_MULT` (**line 60**).
  - Add `health` to `TowerBase` interface and `TOWER_BASE`. Existing towers get *small* health (proposed defaults, tunable): basic 25, ice 20, sniper 20, cannon 30, lightning 22, railgun 28. Tower `maxHealth` scales with level via `TOWER_LEVEL_DMG_MULT ** (level - 1)` (see Phase 1 constructor) — upgraded towers are tankier, matching the level-dependent ghost-duration formula.
  - Add `knockbackBase?: number; knockbackScale?: number;` to the `TowerBase` interface (Phase 5a needs this so the railgun entry can carry a nonzero default — see the railgun-default nuance in Phase 5a). Defaults are `undefined`/`0` for all towers except railgun.
- Add new exported constants:
  - `GHOST_RESTORE_BASE_SECONDS = 50`, `GHOST_RESTORE_PER_LEVEL = 5` → restore time = `GHOST_RESTORE_BASE_SECONDS - level * GHOST_RESTORE_PER_LEVEL` (level 7 → 15s, per draft).
  - `GHOST_PARTICLE_DURATION = 2` (explosion length, seconds).
  - `GHOST_PARTICLE_COUNT = 14` (particle burst size for the ghost explosion; **constant — NOT scaled by level**).
  - `GHOST_OPACITY = 0.5` (render opacity for ghost state).
- New tower bases (see Phase 5) also get `health` here.
- **Tile-size constant discipline:** there is **no** `TILE_SIZE` constant in the sim/logic layer. The render-only `GRID_TILE_SIZE = 36` lives in `src/render/svg/types.ts:4` and must **not** be imported from sim code (post-migration boundary). The authoritative runtime value is `Grid.tileSize` (`src/grid/Grid.ts:27`, default 36), already exposed on the `GridRef` interface (`Enemy.ts:37`). All sim-side references below use `this.grid.tileSize` (or `grid.tileSize` where the `Grid` is in scope) — do **not** introduce a new logic-layer `TILE_SIZE` constant.
- **Electric fence range constant:** add `ELECTRIC_FENCE_RANGE_TILES = 0.75` (tunable; captures enemies overlapping/contiguous to the sturdyWall tile — an enemy center can sit as close as `grid.tileSize / 2 + enemyRadius`). Phase 5c converts this to pixels via `this.grid.tileSize * ELECTRIC_FENCE_RANGE_TILES`.

### `src/game/ConstantsEnemy.ts`
  - `EnemyMeta` interface (now **line 4**), `ENEMY_TYPES` (**line 19**), `ENEMY_WAVE_DAMAGE_MULT` (**line 33**), `ENEMY_LEVEL_HP_MULT` (**line 31**).
  - Extend `EnemyMeta` with `attackDamage: number` and `attackSpeed: number` (attacks/sec).
- Add to `ENEMY_TYPES` (proposed defaults, varying by enemy):
  - minion: `attackDamage: 4`, `attackSpeed: 0.5`
  - runner: `attackDamage: 2`, `attackSpeed: 1.0`
  - tank: `attackDamage: 10`, `attackSpeed: 0.4`
  - shielded: `attackDamage: 6`, `attackSpeed: 0.5`
  - healer: `attackDamage: 3`, `attackSpeed: 0.5`
  - boss: `attackDamage: 20`, `attackSpeed: 0.5`
- Enemy attack damage scales with wave **and** level exactly like HP does, reusing `ENEMY_WAVE_DAMAGE_MULT` and `ENEMY_LEVEL_HP_MULT` (no new constant needed). Boss uses the higher `attackDamage`/`attackSpeed` values below; future balance adjustments are applied only to the boss entry.

---

## Phase 1 — Tower Health + Ghost State

### `src/towers/Tower.ts`
- Add fields: `maxHealth: number`, `health: number`, `isGhost: boolean`, `ghostTimer: number` (counts up), `pendingGhostEffect: boolean` (one-shot flag for GameEngine to spawn particles).
  - Constructor: set `maxHealth = this.base.health * TOWER_LEVEL_DMG_MULT ** (this.level - 1)`, `health = maxHealth`, `isGhost = false`, `ghostTimer = 0`, `pendingGhostEffect = false`.
- Add `takeDamage(amount: number, attacker?: Enemy): void` → `this.health -= amount`; if `health <= 0 && !isGhost` set `isGhost = true`, `pendingGhostEffect = true`. (Optional `attacker` param supports thorn reflection in Phase 5.) **Note:** `Tower.takeDamage` does not currently exist — this is a *new* method, so there are no existing callers to reconcile, and it does not collide with `Enemy.takeDamage(amount, armorPiercing: boolean)` at `Enemy.ts:204` (different class; `armorPiercing` is Enemy-only). The `attacker?: Enemy` second parameter is therefore safe to add.
  - Add `restore(): void` → `isGhost = false`, `health = maxHealth`, `ghostTimer = 0`, and re-register the tile with the grid so it blocks again and paths recompute (`grid.clearTowerGhost(tileX, tileY)` — see Grid section). Call this both from the ghost timer in `update()` (mid-wave auto-restore) **and** from `GameEngine.onWaveStart` (wave-start restore). Both paths must keep the `blocked`/`ghostTowers` sets and `recomputePaths()` consistent.
  - Add `canModify(): boolean { return !this.isGhost; }`. Enumerate every mutation entry point and guard each on `canModify()`, surfacing a "ghosted" reason when blocked: `canUpgrade()` (return `{ ok: false, reason: "Ghosted — cannot upgrade" }` when `isGhost`), `specialize(variant: "A" | "B", save: PersistState, actualCost?: number): boolean` (at `Tower.ts:549` — early-return `false` when `isGhost`), `sellValue()` (block/zero when `isGhost`), and the downgrade (sell-at-level>1) path in `GameEngine`/`TowerPanel`. Ghost towers must be rejected at all of these.
- Ghost timer tick: advance `ghostTimer += dt` inside `update()`; when `ghostTimer >= restoreTime` call `restore()`. (restoreTime computed from level.)
- **Important:** ghost towers must NOT fire or target. In `update()`, advance `ghostTimer += dt` and run the `restore()` check **first**, then **early-return before any behavior** when `isGhost` is true (matching the "no longer blocks / cannot act" rule). Explicitly gated (skipped) while `isGhost`:
  - `stats.frostAura` area-slow loop (`Tower.ts:660`)
  - `stats.staticField` area-slow loop (`Tower.ts:668`)
  - `stats.iceBurst` area-stun loop (`Tower.ts:676`)
  - targeting (`selectTarget` at `Tower.ts:590`, the `fixedAim` branch at `Tower.ts:691`, and the `fire()` call at `Tower.ts:760`)
  Only the ghost-timer tick + `restore()` run. (Ghost-explosion particles are already spawned by `GameEngine`, not here — no change to that site.)

### `src/grid/Grid.ts`
- Add `ghostTowers: Set<string>` alongside `blocked`/`terrainTowers`.
- `registerTower`: when a path-tile tower enters ghost, move its key from `blocked` to `ghostTowers` and call `recomputePaths()`. Provide methods:
  - `setTowerGhost(x, y)` → `blocked.delete(key); ghostTowers.add(key); recomputePaths();`
  - `clearTowerGhost(x, y)` → `ghostTowers.delete(key); blocked.add(key); recomputePaths();`
- `canBuild` (path branch): reject if `ghostTowers.has(key)` (a ghost still occupies the tile).
- `buildCachedPathTiles`/`recomputePaths` unchanged structurally; ghost tiles are simply no longer in `blocked`, so BFS routes through them as passable.

### `src/game/GameEngine.ts`
- `GameEngine` still lives at this path but runs **inside the worker** (`src/sim/WorkerEntry.ts`); it receives a `HostBindings` instance, no Pinia stores. `particleManager` is still a field (**line 88**). Update order is preserved: `enemyManager.update(dt, ...)` (**line 294**) then `towerManager.update(dt, this.enemyManager)` (**line 319**); the `enemy.onPathBlocked` bounty branch remains a safety net at **line 310**.
- **Keep the existing update order: enemies first, then towers.** Do NOT move ghost-resolution before enemy update — if a tower dies during the tower-update phase, enemies that already ran this frame would keep attacking a dead tower for one full frame. After `towerManager.update(dt, ...)`, iterate towers for ghost effects (particles + `setTowerGhost` + `recomputePaths`), then on the next frame enemies see the updated grid.
  - After `towerManager.update(dt, ...)`, iterate `towerManager.towers`:
    - If `tower.pendingGhostEffect`: call `particleManager.spawn(tower.x, tower.y, tower.color, GHOST_PARTICLE_COUNT, { life: GHOST_PARTICLE_DURATION, ... })` (`ParticleSystem.spawn` signature at `src/game/ParticleSystem.ts:33`); `tower.pendingGhostEffect = false`; call `grid.setTowerGhost(tower.tileX, tower.tileY)` (stops blocking + recomputes path).
     - In `onWaveStart(wave)` (still a method at **line 386**): restore all ghost towers **without** N sequential recomputes. Do **not** call `tower.restore()` + `grid.clearTowerGhost()` per tower (each `clearTowerGhost` triggers `recomputePaths()`, so 5 ghosted towers = 5 full recomputes). Instead:
       - Reset each ghost tower's state directly: `tower.isGhost = false; tower.health = tower.maxHealth; tower.ghostTimer = 0;` (do **not** call `grid.clearTowerGhost` here).
       - Then call **`grid.batchClearGhosts()`** — a new `Grid` method that moves **all** `ghostTowers` keys back into `blocked` and calls `recomputePaths()` **exactly once**. (Keep the per-tile `clearTowerGhost` for the mid-wave timer path in Phase 1, which legitimately needs a single recompute; `batchClearGhosts` is only for the wave-start bulk restore.)
       - **Then handle enemies standing on restored tiles:** iterate all enemies; for any enemy whose current tile (key `${tileX},${tileY}`) is now in `grid.blocked` (just restored from ghost), call `enemy.repositionBeforeBlockedTile()` (new method defined below). Without this, an enemy physically on the tile will suddenly find its path blocked again.
    - **New method `Enemy.repositionBeforeBlockedTile(): void`** (add in Phase 1, `Enemy.ts`): walk `this.path` backward from the current `pathIdx` to find the largest index `k` whose tile is **not** in `this.grid.blocked`; set `pathIdx = k`, then recenter the enemy on that tile: `const w = this.grid.tileToWorld(this.path[k]!.x, this.path[k]!.y); this.x = w.x; this.y = w.y;` and recompute `moveAngle` toward `this.path[k + 1]` if present. This uses only `GridRef.blocked` and `GridRef.tileToWorld`, both already present on the `Enemy` grid interface — **no** centerline/`laneOffset` fields are assumed (those are Phase 4), so this operates purely on the existing `x/y/pathIdx` model. If `k` cannot be found (whole path blocked, should not happen), fall back to `pathIdx = 0`.
- Keep the `enemy.onPathBlocked` bounty branch as a safety net only (Phase 2/3 let enemies route through towers instead).
- **Ghost-reject for sell/downgrade (HostBindings-era signatures):** `sellSelected()` is at **line 624**; `executeSell` at **line 673**; `downgradeSelected` at **line 693**. Guard each on `!tower.isGhost` before mutating. (The old `useUiStore().showConfirm` and `this.persistStore.save()` calls are gone — sound is `this.host.playSound(...)`, persist is `persistDirty = true` + `host.schedulePersistSave`.)
   - **Implementation note (stale narrative):** the above description's `host.requestConfirm({...})` + `sellActive === "discount"` control flow does **not** match the current tree — the real `sellSelected` (line 624) drives `executeSellById(confirmed)` (line 640) and the discount branch lives there. The **line numbers are approximately right but the described flow is stale**: read the actual method when implementing and apply the `!tower.isGhost` guard to the real `executeSellById` / `downgradeSelected` paths (and to `TowerPanel.vue` on the main thread, which also gates sell/downgrade and must reject ghosted towers before posting the command).

### `src/render/svg/TowerManager.ts`
- `syncFromGameEngine(towers: TowerSnapshot[], dt: number)` is at **line 13**; `TowerRenderProxy.sync(tower: TowerSnapshot, dt)` at **line 142**. In `sync`, read `tower.isGhost` from the snapshot; if true set `el.style.opacity = String(GHOST_OPACITY)`, else reset to `"1"`. (CSS/SVG opacity per draft — no new symbol needed. `isGhost` must be added to `TowerSnapshot`.)

### `src/sim/SnapshotSerializer.ts` (edit site — previously unlisted)
- `buildSnapshot()` serializes `Tower` → `TowerSnapshot` (tower fields are copied near **line 112+** of `SimulationSnapshot` / serializer). Add a new `isGhost: boolean` field to `TowerSnapshot` and populate it from `tower.isGhost` here, alongside the other scalar fields (`id`/`type`/`x`/`y`/`tileX`/`tileY`/`level`/...). Note: `TowerSnapshot` currently has **no** `health` field, so the earlier "mirror where `health`/level are copied" wording was imprecise — `isGhost` simply joins the scalar block; the live `health`/`maxHealth` stay server-side and are never needed by the renderer. Without adding `isGhost` to the snapshot the render manager never sees the ghost flag.

### `src/game/ParticleSystem.ts`
- Reuse existing `spawn(x, y, color, count, {life, size, speed})` (signature at **line 33**, `getRenderData` at **line 76**). No change required; call with `tower.color` and a short life.

---

## Phase 1.5 — TowerManager Reachability for Enemies (prerequisite for Phases 2–4)

**Why this is its own phase:** `EnemyManager` is constructed in `GameEngine` (`GameEngine.ts:190`) **before** `TowerManager` (`:198`) and currently holds only `grid` — no tower reference. Enemies in Phases 2–4 must resolve the tower on a tile (`towerAt`), so this plumbing must land first.

**Single home for `towerAt` (resolves the dual-`EnemyManagerRef` ambiguity):** there are TWO local `EnemyManagerRef` interfaces in the tree — `Tower.ts:42‑82` (consumed by `Tower`) and `Enemy.ts:44‑47` (consumed by `Enemy.update`). Both are real consumers, so `towerAt` is added in all three places and the backtrack wording in Phase 2 is dropped:
- **`EnemyManager` class** (`src/enemies/EnemyManager.ts`): add a `towerManager: TowerManagerRef | null = null` field (the `TowerManagerRef` from `TowerManager.ts`), a `setTowerManager(tm: TowerManagerRef | null): void` setter, and the concrete delegating lookup:
  ```ts
  towerAt(tileX: number, tileY: number): Tower | null {
    return this.towerManager?.towerAt(tileX, tileY) ?? null;
  }
  ```
- **`Enemy.ts:44‑47` `EnemyManagerRef`** (the interface `Enemy.update` actually receives): add `towerAt(x: number, y: number): Tower | null` here, since enemy attack/ghost resolution calls `enemyManager.towerAt(...)`. The `Tower` return type is the live `Tower` class; enemies only read `health`/`isGhost`/`x`/`y` off it.
- **`Tower.ts:42‑82` `EnemyManagerRef`** (the interface `Tower` receives): add the same `towerAt(x: number, y: number): Tower | null` signature for symmetry, since this interface is the other real consumer of `EnemyManagerRef`.
- **Return-type bridge (intentional, do not "fix"):** `TowerManager.towerAt` returns `Tower | undefined`, but the enemy-facing `towerAt` is declared `Tower | null`. The `?? null` in `EnemyManager.towerAt` (above) is the **deliberate** bridge between them — keep it. Implementers must preserve `Tower | null` on `EnemyManagerRef`/`EnemyManager.towerAt` and must **never** copy `undefined` through to callers; enemy/attack code branches on `null`, and the ghost-passthrough check (ghost towers still returned, live towers returned, empty → `null`) only stays consistent if the surface type is `null`, not `undefined`.

### `src/game/GameEngine.ts`
- Immediately after `this.towerManager = new TowerManager(...)` (`:198`), call `this.enemyManager.setTowerManager(this.towerManager)`. This is the only wiring site; no other caller needs the ref.

### `src/enemies/Enemy.ts`
- `Enemy` already receives `enemyManager: EnemyManagerRef` in `update()`; it now calls `enemyManager.towerAt(x, y)` for attack-target resolution. **No separate `TowerManager` parameter is needed** — drop the "pass a `TowerManager` ref into `Enemy.update`" wording from the Phase 2 Wiring step; the `EnemyManagerRef` carries `towerAt` already.

---

## Phase 2 — Path-Tile Placement + Dijkstra Weakest-Path Fallback

### `src/grid/Pathfinding.ts`
- Current anchors: `canPlaceWithoutBlocking` (**line 123**), `bfsShortestPath` (**line 17**), and `bfsReverseFromBase` (**line 68**) — the reverse-BFS reachability check used by `canPlaceWithoutBlocking`. `dijkstraWeakestPath` is new.
- **Scope isolation (lives are NOT affected):** `bfsReverseFromBase` is used in **exactly one place** — `canPlaceWithoutBlocking` (the loop at `Pathfinding.ts:137`). It is a placement-validation-only helper and is **never** involved in computing enemy lives (lives come from `GameEngine.startingLives` + healer increments). Removing the path-tile rejection below therefore cannot change lives; the change is fully isolated to build validation.
- `canPlaceWithoutBlocking(grid, spawns, base, towerXY, existingBlocked, cachedPathTiles?)`:
  - **Path-tile placement is always permitted.** Because routing now goes *through* towers (Dijkstra weakest-path fallback, below), tower tiles are traversable — placing a tower on a path tile can never disconnect spawns from the base. The rejection lives **inside `canPlaceWithoutBlocking`**, not in `bfsReverseFromBase`: remove the loop at **lines 138–140** that returns `false` when a spawn becomes unreachable under `test`. `bfsReverseFromBase` (**line 68**) itself only computes a reachable set; it is reused by the Dijkstra fallback and must **not** be edited. So for path tiles, `canPlaceWithoutBlocking` returns `true` directly (move/explicitly early-return before the reachability check). Non-path tiles keep the existing reachability rejection unchanged.
  - Keep the fast path: if the tile is not on any cached path, return `true` (unchanged).
  - For path tiles, still reject only if the tile is already occupied by another tower (handled by `Grid.canBuild`/`registerTower`, since `blocked`/`ghostTowers` already contain it). The reachability BFS must **not** treat live tower tiles as walls; if any reachability check is retained, it must treat all path/base/spawn tiles as passable regardless of `blocked` (Dijkstra makes them traversable).
  - Ghost tiles: `Grid.canBuild` rejects if `ghostTowers.has(key)` (a ghost still occupies the tile), so `canPlaceWithoutBlocking` will not be asked to place on one.
- `bfsShortestPath`: unchanged for the "open" case.
- New `dijkstraWeakestPath(grid, start, goal, towerHealthAt, isGhostAt): Point[] | null`:
  - **Priority queue:** grid graphs are small (~600 tiles), so a binary **min-heap** keyed on `dist` is sufficient (a linear-scan array PQ is also acceptable). Each heap entry is `{ key: string, dist: number }`.
  - **State:** `dist: Map<string, number>` initialized to `Infinity`, `dist[start] = 0`; `prev: Map<string, Point | null>` for path reconstruction (same parent map pattern as `bfsShortestPath` at `Pathfinding.ts:37-43`).
  - **Relaxation:** pop the min-dist node; if its key equals `goal`, break. For each of the 4 neighbors (in-bounds, `isPath`/`isBase`/`isSpawn`, and **not** in `blocked`):
    - `edgeWeight = isGhostAt(nx, ny) ? 0 : (towerHealthAt(nx, ny) ?? 0.1)`
    - `nd = dist[cur] + edgeWeight`; if `nd < dist[neighborKey]`: set `dist[neighborKey] = nd`, `prev[neighborKey] = { x: curX, y: curY }`, push `{ neighborKey, nd }`.
    - A tower tile is reachable from 4 directions but the entry cost is direction-independent (weight depends only on the neighbor tile), so no special handling is needed.
   - **Tie-breaking (heap key, interpretation (a)):** the min-heap entry is a tuple `{ key: string, dist: number, edgeWeight: number }`, ordered by `dist` **primary**, `edgeWeight` **secondary** (then a fixed N→E→S→W order only as a final tertiary determinism tie-break). Because relaxation uses a strict `<` test (`if (nd < dist[neighborKey])`), the entry **popped first** wins the `prev` assignment for that neighbor — so among two equal-`dist` routes the one whose final edge has the **lower `edgeWeight`** (i.e. the weaker tile) is chosen first and becomes the recorded path. **Drop** any "deterministic N→E→S→W order wins the tie" wording: edgeWeight must outrank direction order whenever `dist` is equal. (This is the standard relaxation-time tie-break; it is applied during the heap pop/relax path, **not** as a post-pop filter and **not** as an alternate key only at push time.)
  - **Return:** reconstruct the path by following `prev` (mirror `Pathfinding.ts:37-43`); returns `Point[]` or `null` if `goal` was never reached. `towerHealthAt(x, y)` returns the live tower's `health` (via `towerAt`); `undefined` → `0.1`. `isGhostAt` returns true when a tower exists but `isGhost`.
  - `Grid.recomputePaths()`:
   - For each spawn: compute BFS path first. If non-null, store it (open path).
    - If BFS is null (live towers fully block every open route), compute `dijkstraWeakestPath` and store it. **No per-spawn flag** — the `Enemy` determines attack-vs-walk behavior from `blockedByTower` (see Enemy section below).
    - **Storage contract (explicit):** the chosen result — BFS *or* Dijkstra — is written back into `this.paths[spawnIndex]` (the same array `Grid.getPathFor(spawnIndex)` at **line 161** returns), so `getPathFor` transparently hands enemies whichever path won. The Dijkstra path **includes** tower tiles in its `Point[]` (they are traversable under this plan), so `getPathFor` may return a path whose `path[k]` sits on a live tower. **Enemy keying (the crux):** an enemy attacks — rather than enters — a tower tile iff `this.path[this.pathIdx + 1]` resolves, via `enemyManager.towerAt(...)`, to a **live** (non-ghost) tower. Ghost-tile path entries are ignored by that check (ghost tiles are passable), so the enemy simply walks onto them. This is the single rule that turns a tower-bearing path into "route through and attack," and it must be implemented exactly as described in the Enemy section below.
   - **Weakest-path staleness caveat (accepted):** `dijkstraWeakestPath` weights edges by each live tower's *remaining* health, but `recomputePaths()` is only (re)run on tower add / remove / ghost / restore — not as a tower's health drops each frame. Enemies therefore follow a weakest path that was optimal at placement time and may become suboptimal as towers are whittled down. This is an accepted, documented trade-off: continuously re-running Dijkstra (every frame, or per tower-damage event) would be a costly calculation for no meaningful gameplay benefit, since the path still always reaches the base and enemies re-resolve onto a fresh weakest path at the next recompute. No periodic/threshold recompute is added.
  - **SpatialIndex seam (future):** routing is a near-future simulation feature (ArchitecturePlan §1.4). Once `SpatialIndex` (§3.5) exists, `dijkstraWeakestPath` and the path queries should be implemented against it. The interim here is plain grid-graph Dijkstra with no `SpatialIndex` dependency, structured so the swap is localized.

### `src/grid/Grid.ts`
- Current anchors: `blocked` (**line 31**), `terrainTowers` (**line 32**), `paths` (**line 33**), `recomputePaths` (**line 152**), `registerTower` (**line 108**), `unregisterTower` (**line 125**).
- Track `paths` only; **no `pathUsesTowers` flag.** The `Enemy` determines attack-vs-walk behavior from `blockedByTower` (set when the next path tile holds a live tower). No per-spawn or per-enemy boolean is needed — the tower-on-next-tile check naturally triggers attack behavior.
- `registerTower` / `unregisterTower`: recompute as today; ghost transitions call recompute (see Phase 1).

### `src/enemies/Enemy.ts`
- **Wiring (prerequisite for Phases 2–4):** `Enemy` currently only holds a limited `GridRef` (`blocked`, `getPathFor`, `tileToWorld`, `getBase` — interface at **line 36**) and the `EnemyManagerRef` at **line 44‑47** (`enemies`, `getEnemiesInRange`), and no tower reference. Phase 1.5 already added `towerAt(x, y): Tower | null` to the `Enemy.ts:44‑47` `EnemyManagerRef` and to the `EnemyManager` class, so `Enemy.update` (which receives `enemyManager` of that type) calls `enemyManager.towerAt(x, y)` directly — **no separate `TowerManager` parameter and no pre-flight check are needed**. The wiring is fully resolved in Phase 1.5; if Phase 1.5 is not yet landed, do NOT start Phase 2.
- In `update()`, replace the current "if next tile blocked → recompute BFS and if null set `onPathBlocked`" logic:
  - **Attack target resolution (reconciles Phase 2 path-driven and Phase 4 collision-driven triggers):**
     - **Primary target** = the tower on the *forward path tile* (the next tile in `this.path`). If that next tile holds a **live** (non-ghost) tower (resolved via `enemyManager.towerAt` from Phase 1.5):
        - **Approach to the edge:** the enemy continues advancing its centerline toward that tower tile's center as normal **until** `dist(enemyCenter, towerTileCenter) <= this.grid.tileSize / 2 + this.radius`. (It attacks from the boundary, not overlapping the tower sprite.)
       - **While attacking:** once at the edge, movement pauses — `step` is not applied and `pathIdx` is **NOT** advanced (the enemy stays on the current segment with the tower tile as `path[pathIdx+1]`). `attackTimer` drives `takeDamage` (Phase 3). When that tower dies and becomes a ghost, `Grid.clearTowerGhost` re-blocks the tile and `recomputePaths()` runs; the enemy re-resolves `path = grid.getPathFor(spawnIndex)` (existing re-anchor logic at `Enemy.ts:285`) and clears `blockedByTower`, then advances onto the now-open tile.
      - **Fallback (junctions / stacking):** only evaluated when the forward path tile has **no** live tower. If the enemy is physically blocked from forward motion (Phase 4 collision — another enemy occupies the space toward its waypoint) **and** is in contact (within `this.grid.tileSize / 2 + this.radius`) with an adjacent live tower, set `blockedByTower` to the **lowest-`health`** adjacent live tower (check the 4 neighbor tiles, not just the path successor). When the contact ends (tower ghosted, or the obstructing enemy moves/dies and the path clears), clear `blockedByTower` and resume. The primary target always wins over the fallback when both could apply.
  - Ghost tower tiles are passable (not in `blocked`), so the enemy advances normally when encountering a ghost — no special flag check needed.

### `src/towers/TowerManager.ts`
- Reuse existing `towerAt(x, y): Tower | undefined` (at **line 207**) for the above lookup. Ensure ghost towers are still returned by `towerAt` (so enemies can confirm they are ghost / harmless).

---

## Phase 3 — Enemy Attack Ability + Attack Animation

### `src/enemies/Enemy.ts`
- Current anchors: `applyStun` (**line 185**), `takeDamage` (**line 204**), `update` (**line 221**). Attack fields are new.
- New fields: `attackDamage: number`, `attackSpeed: number`, `attackTimer: number` (counts down), `attackAnimTime: number`, `blockedByTower: Tower | null`, `attackAnimation: MapThemeAnimation | null` (from `theme.enemies[type].attack`).
- Constructor: read `attackDamage`/`attackSpeed` from `meta` (scaled per Phase 0), set `attackTimer = 0`, `attackAnimation = enemyVisual?.attack || null`.
- Status effect rules (per draft):
  - **Stunned** (`stunTimer > 0`): never attack; **pause** `attackTimer` (do not reset it). Continue counting down stun as today.
  - **Slowed** (`slowFactor < 1`): effective attack interval = `1 / (attackSpeed * slowFactor)` (same factor as motion).
  - **Bosses** attack the same as other enemies (including the stun/slow rules above) and use the higher `attackDamage`/`attackSpeed` defined for boss in `ENEMY_TYPES`. Any tuning is made only to the boss entry, never to the generic attack logic.
- Attack trigger (each frame, when not stunned and `blockedByTower` is a live tower):
  - `attackTimer -= dt`; when `attackTimer <= 0`: call `blockedByTower.takeDamage(attackDamage, this)`, set `attackAnimTime = this._gameSeconds`, reset `attackTimer = 1 / (attackSpeed * slowFactor)`.
  - If two towers are in contact, set `blockedByTower` to the lower-`health` one.
- When `blockedByTower` becomes ghost/absent, clear `blockedByTower` and resume movement.

### `src/render/themes/data/default-map-theme.json`
- Add `"attack"` to each enemy entry: `{ "duration": <sec>, "frames": [ {image:...}, {image:...}, {image:...} ] }` (3 frames, like `hitReaction`). Enemy images face rightward; use simple geometric extensions emerging from the front (right) side. Symbol IDs must follow `enemy-${type}-attack-f${i}` — but the README "Symbol ID contract" currently lists only `walking` and `hitReaction`. **Action:** extend the contract and `useSvgStaticContent.ts` to also generate `enemy-${type}-attack-f0..2` symbols from `enemy.attack.frames` (mirror how `walking`/`hitReaction` symbols are generated).
- `the-aftermath.json` is **out of scope** for attack frames (skip, leave existing behavior).

### `src/render/svg/EnemyManager.ts`
- `syncFromGameEngine(enemies: EnemySnapshot[])` is at **line 17**; `EnemyRenderProxy.sync(enemy: EnemySnapshot)` at **line 70** (read `attackAnimTime`/`hitAnimTime` from the snapshot). In `sync`, add an attack-reaction branch with explicit priority (mirror the existing `hitReaction` branch at **lines 97–119**):
  - `if (hitAnimTime > 0 && gameSeconds - hitAnimTime < hitReaction.duration)` → render hit reaction frames
  - `else if (attackAnimTime > 0 && gameSeconds - attackAnimTime < attack.duration)` → render attack frames (`enemy-${type}-attack-f${idx}`)
  - `else` → fall back to walking frames
- Check both `hitAnimTime` and `attackAnimTime` as distinct fields on the same object. The existing `hitReaction` branch is the template to follow. `attackAnimTime` must be added to `EnemySnapshot`.

### `src/sim/SnapshotSerializer.ts` (edit site — previously unlisted)
- `buildSnapshot()` serializes `Enemy` → `EnemySnapshot` (enemy fields copied near **lines 89–90** of the serializer, alongside `hitAnimTime`). Populate `attackAnimTime` on the `EnemySnapshot` from `enemy.attackAnimTime` here, mirroring how `hitAnimTime` is already serialized. Without this the render manager never sees the attack animation timing.

### `src/render/themes/normalize.ts` & `index.ts`
- `index.ts`: `MapThemeAnimation` (**line 22**), `EnemyVisualMeta` (**line 35**, currently `walking` + `hitReaction: MapThemeAnimation | null`). Extend `EnemyVisualMeta` to include `attack?: MapThemeAnimation`.
- `normalize.ts`: `normalizeAnimation` (**line 47**), `normalizeEnemyVisual` (**line 68**, currently returns `{ name, color, shape, walking, hitReaction }`). Extend `normalizeEnemyVisual` to accept `attack?: { duration: number; frames: { image: string }[] }` and produce `attack` via `normalizeAnimation(raw.attack)` when present (exactly the pattern already used for `hitReaction`); also extend the raw `enemies` record type to allow the optional `attack` field. `Enemy`/`EnemyManager` must tolerate `attack === null` (the-aftermath has none — see strict-scope decision).
- `src/render/svg/useSvgStaticContent.ts` (confirmed present) generates the `walking`/`hitReaction` symbols today; extend it to also emit `enemy-${type}-attack-f0..2` symbols from `enemy.attack.frames`.

---

## Phase 4 — Enemy-Enemy Collision & Lane Passing

- **`SpatialIndex` seam (future, not yet implemented).** `SpatialIndex` (ArchitecturePlan §3.5) is the intended interface for collision queries, but it does **not** exist yet. Until it lands, reuse the existing `EnemyManager` spatial hash as the interim implementation: `spatialHash: Map<string, Enemy[]>` (**line 25**), `updateSpatialHash()` (**line 187**), `getEnemiesInRange(x, y, radius)` (**line 205**). Structure the collision code so the only query site that changes later is the `getEnemiesInRange` call → `SpatialIndex.queryRange`. Enemy–enemy collision is itself a §1.4 near-future feature; when `SpatialIndex` + SoA typed arrays (§3.5) arrive, the per-enemy position data migrates to `Float32Array`s indexed by entity id, but the centerline + `laneOffset` model below is unchanged and independent of that storage choice.
- Reuse the existing spatial hash in `src/enemies/EnemyManager.ts` via `getEnemiesInRange(x, y, radius)` to find colliding enemies each frame.
- **Movement model (centerline + laneOffset):** Refactor `Enemy` so it maintains a *path centerline position* (`centerX/centerY` advanced toward each waypoint as today) plus a signed scalar `laneOffset` (perpendicular to the current facing/`moveAngle`). Each frame:
   - **Seam contract (exact cut point — implement before touching `update`):** the existing `Enemy` position model advances `this.x/this.y` directly (Enemy.ts:269–344). Under this refactor, `centerX/centerY` becomes the *only* state advanced by the forward-step logic; `this.x/this.y` are **derived** (`x = centerX + perpX * laneOffset`, `y = centerY + perpY * laneOffset`) and reassigned **once per frame, at the end of `update`**, after collisions resolve. Every existing consumer must therefore read the derived `this.x/this.y` and nothing else: Tower targeting (`selectTarget` reads enemy world positions via `getEnemiesInRange`), `EnemyManager.getEnemiesInRange` (spatial hash is keyed off `this.x/this.y` — keep it keyed off the derived values), projectile collision (`ProjectileManager` reads enemy `x/y`), the `SimulationSnapshot` serializer (copies `e.x/e.y`), and the SVG render proxy (`EnemySnapshot.x/y`). Do **not** introduce a second source of truth: `centerX/centerY` are internal-only and never serialized or read by towers. Initialize `centerX = this.x`, `centerY = this.y`, `laneOffset = 0` in the constructor (and in `repositionBeforeBlockedTile` from Phase 1, recenter `centerX/centerY` too, keeping `laneOffset = 0`).
   - Advance `centerX/centerY` along the path toward the next waypoint by `step` (unchanged forward logic).
  - Resolve collisions against neighbors within `this.radius + other.radius` (spatial hash). For each overlapping neighbor pair (`a`,`b`), compute the real positions using each one's own `moveAngle` perpendicular: `ra = { a.centerX + perpA.x * a.laneOffset, a.centerY + perpA.y * a.laneOffset }` (and `rb` analogously). **Overlap amount** = `overlap = (a.radius + b.radius) - dist(ra, rb)` (positive ⇒ overlapping). If `overlap > 0`, separate laterally by `overlap / 2` each: the **slower** enemy gets `laneOffset += overlap/2` (right, `+offset`), the **faster** enemy gets `laneOffset -= overlap/2` (left, `-offset`). **Per-frame:** a single pairwise pass over all overlapping neighbors (no iteration loop) — sufficient at target map sizes; offsets are clamped and recomputed each frame. **3+ enemies overlapping:** handled by the same pairwise accumulation (each enemy separates from every overlapping neighbor once) with no special-casing; if playtest shows residual jitter, raise to 2 passes (tuning knob, not a code change). Do **not** clamp `laneOffset` mid-loop. **Definitive perpendicular convention (commit to this — no "e.g."):** with `moveAngle = atan2(deltaY, deltaX)` in screen coordinates where **Y increases downward**, the forward unit vector is `(cos a, sin a)`. The right-perpendicular (starboard; visually clockwise = the right-hand side in a top-down Y-down view) is obtained by rotating the forward vector +90°:
    ```
    perpX = -Math.sin(moveAngle)
    perpY =  Math.cos(moveAngle)
    ```
    Slower enemy gets `laneOffset += separation` (right, `+offset`); faster enemy gets `laneOffset -= separation` (left, `-offset`). Accumulate into `laneOffset`. Document this exact formula and the Y-down rationale in a code comment at the derivation site so it cannot be sign-flipped later.
   - **Clamp** `|laneOffset| <= this.grid.tileSize / 2 - this.radius` so the enemy always stays within the current path tile bounds ("stack up against the tower" rather than leaving the path when blocked).
  - Derive the true engine position: `x = centerX + perpX * laneOffset`, `y = centerY + perpY * laneOffset` (perpendicular unit vector from `moveAngle`), then `worldPos = { x, y }`. Collisions and the renderer both read this real `x/y`, so the simulation and the SVG `<use>` always match.
  - If an enemy is blocked from forward motion AND is adjacent to a tower (touching its tile), apply the attack-target resolution from Phase 2 (set `blockedByTower` to the lowest-health adjacent live tower). **"Blocked from forward motion" is defined precisely as:** the enemy cannot advance its centerline toward the next waypoint because (a) the forward path tile itself holds a live tower (the primary target case), **or** (b) another enemy occupies the space between this enemy and the tower/waypoint it is trying to reach, preventing the step from completing. Resolve collisions against neighbors the same as the general rule: within `this.radius + other.radius` (spatial hash). In case (b) the enemy is considered blocked-by-collision; once the obstructing enemy moves away (or is killed) and the path is clear, `blockedByTower` is cleared and movement resumes.
- Never let `laneOffset` change `pathIdx`/waypoint choice — it is purely visual+collision lateral displacement around the centerline.

---

## Phase 5 — Two New High-Health Towers

This phase is split into three **ordered** sub-steps. **Do 5a first and get it green (lint + typecheck + existing knockback tests) before starting 5b/5c** — 5a is the largest, riskiest refactor (it changes an *existing* `railgun` variant's wire format) and is fully independent of the new towers, so it should land and be verified on its own.

### 5a — Knockback option refactor (`knockback: boolean` → `knockbackBase`/`knockbackScale`)

Migrates the existing knockback mechanism only; introduces no new towers.

- `src/game/ConstantsTower.ts`: `TowerVariantStats` (type alias at **line 144**) currently has `knockback: boolean` (**line 158**) — replace with `knockbackBase: number` and `knockbackScale: number` (default `0`; `knockbackBase === 0` ⟺ disabled, identical to the old `false`). railgun A `apply: (s, _t) => ({ ...s, knockback: true })` (**line 191**) becomes `apply: (s, _t) => ({ ...s, knockbackBase: RAILGUN_KNOCKBASE * RAILGUN_KNOCKBACK_MULT, knockbackScale: RAILGUN_KNOCK_SCALE })`, reusing `RAILGUN_KNOCKBASE` (**line 85**) / `RAILGUN_KNOCK_SCALE` (**line 87**) — the old `× RAILGUN_KNOCKBACK_MULT` amplification is folded into the variant's `knockbackBase`.
   - **Behavioral nuance (do not drop):** today `applyProjectileEffects` (`ProjectileManager.ts:306-313`) sets `projectile.knockback = RAILGUN_KNOCKBASE + RAILGUN_KNOCK_SCALE * tier` for **every** railgun, and the old `knockback` boolean only multiplied it. So a plain (non-A) railgun already knock-backs. Give railgun a **nonzero default `knockbackBase`** in `TOWER_BASE` (the `knockbackBase?: number` field added to the `TowerBase` interface in Phase 0; `_computeStats` picks it up so `stats.knockbackBase` is nonzero) so the existing test `game-projectile-manager.test.ts:509-527` — which spawns a railgun *without* the flag and asserts `proj.knockback > 0` — still passes. Knockback is "enabled" ⟺ `knockbackBase > 0`.
- `src/towers/Tower.ts`: drop the boolean entirely. **Anchors:** constructor **226**, `update` **653**, `fire` **760**, `ProjectileManagerRef.spawn` opts `knockback?: boolean` **101**, `TowerStats.knockback: boolean` **148**, `_computeStats` **319**, `let knockback = false` **336**, variant apply/destructure sites **356/374/396/414**, return object includes `knockback` **507**, `fire` passes `knockback: stats.knockback` **817**. Replace every `knockback` boolean usage with the `knockbackBase`/`knockbackScale` pair. **`TowerStatsSnapshot` is unaffected:** `TowerStatsSnapshot` (`SimulationSnapshot.ts:104‑110`) is a *separate* subset type (`damage`, `range`, `fireRate`, `splash`, `chain`) that the UI binds to; it currently carries no knockback field, and knockback is never read off the snapshot, so the 5a refactor of `TowerStats.knockback` requires **no** change to `TowerStatsSnapshot`. Only `TowerStats` (live, `Tower.ts:148`) and the `TowerStatsSnapshot` mapping in `SnapshotSerializer` (which copies those five fields) are in scope for 5a; do not add knockback to the snapshot unless a later phase needs the UI to read it.
- `src/game/ProjectileManager.ts`: **Anchors:** `spawn` opts `knockback?: boolean` (**206**), `applyProjectileEffects` param `knockback: boolean` (**288**), railgun knockback gating (**308–310**). `ProjectileManagerRef.spawn` opts become `knockbackBase?: number; knockbackScale?: number`. Knockback is "enabled" when `knockbackBase > 0`; `applyProjectileEffects` reads the pair instead of the boolean; the railgun gate `if (knockback)` (**309**) becomes `if (knockbackBase > 0)`, and `projectile.knockback` is derived from `knockbackBase` (× `RAILGUN_KNOCKBACK_MULT` only when the A-variant flag is set, now folded into the variant's base). No other behavioral change.
- **Verify before proceeding:** the refactor is mechanical (boolean → base/scale pair) **except** the railgun-default nuance above — confirm `TOWER_BASE` railgun gets a nonzero default `knockbackBase`. Then run existing `game-projectile-manager.test.ts` knockback cases (`describe("railgun knockback and stun", …)` asserts `proj.knockback > 0` for a plain railgun spawn) plus `npm run lint && npm run typecheck`. No new-tower code is touched in this sub-step.

### 5b — New tower stats, variants, SkillTree, persist, theme registration

- `src/game/ConstantsTower.ts`:
  - Add to `TowerIds` (**line 2**): `STURDY_WALL: "sturdyWall"`, `SHOTGUN_TANK: "shotgunTank"`.
  - `TOWER_META` (**line 20**): sturdyWall cost (proposed 40), shotgunTank cost = `basic.cost * 1.5` = 30 (50% more than basic, per draft).
  - `TOWER_BASE` (**line 47**):
    - sturdyWall: `range: 0` (no targeting/fire), `damage: 0`, `fireRate: 0`, `health: 200` (high; no damage).
    - shotgunTank: `range: 1`, `damage: 8` (like basic), `fireRate: 1.2`, `projSpeed: 14`, `health: 250` (independent static value like the other towers — the "basicHealth * 10" phrasing in the draft was only a planning reference, not a code dependency).
   - New knockback constant for shotgunTank B (consumed in 5c): `SHOTGUN_KNOCKBASE = RAILGUN_KNOCKBASE * 1.5` (= 0.45). `SHOTGUN_KNOCK_SCALE` analogous to railgun.
   - New electric-fence constant (consumed in 5c): `ELECTRIC_FENCE_RANGE_TILES = 0.75` (added in Phase 0; px radius = `grid.tileSize * ELECTRIC_FENCE_RANGE_TILES`).
  - `TOWER_VARIANTS` (**line 166**):
    - sturdyWall A ("Thorn Wall"): reflects `attackDamage * [0.3, 0.6, 1.0]` at levels 5/6/7 back to the attacking enemy. Store `thornReflectPct` per tier.
    - sturdyWall B ("Electric Fence"): on enemy contact deals touch damage + short stun (stop motion + attacks). Add behavior flags `fenceDamage`, `fenceStun`.
    - shotgunTank A ("Reinforced"): increases tower `health` (e.g., ×1.5/×2/×3 per tier).
    - shotgunTank B ("Repulsor"): knockback via `SHOTGUN_KNOCKBASE`/`SHOTGUN_KNOCK_SCALE` (uses the 5a base/scale pair).
- `src/towers/SkillTree.ts`: Current anchors: `VARIANT_INFO` (**line 57**), `ADDON_INFO` (**line 84**), the `for (const id of Object.values(TowerIds))` auto-build loop (**line 46**, repeated at **line 117**), `populateSkillTreeTheme(defaultTowerVisuals)` (**line 45**) — which replaces the old module-level `useMapThemeStore()` call. Note `maxLevelFor(save, towerId, variant)` is now defined in `SkillTree.ts` at **line 259**, not in `persist.ts`. Add `VARIANT_INFO`/`ADDON_INFO` entries for `sturdyWall`/`shotgunTank` (the auto-build loop creates `SKILL_TREE` entries). Provide addon descriptions consistent with existing style. Add any addon effect wiring in `TOWER_ADDON_EFFECTS` only if needed (proposed: leave addons minimal; fence/stun/thorn handled via variant flags).
- `src/stores/persist.ts` & `src/sim/PersistState.ts` (both required, else new towers crash): `persist.ts` already exists. Add `sturdyWall`/`shotgunTank` to `defaultUnlocked()` (persist at **line 73**; `blankTower()` at **line 50**, `unlocked` field at **line 39**, `migrateToCurrent` at **line 165**) alongside the existing six, each seeded with `blankTower()`. **Also** add the same two entries to the worker-side plain-state `defaultUnlocked()` in `src/sim/PersistState.ts` (**line 40**, invoked by `createDefaultPersistState` at **line 66**) — `migrateToCurrent` in `persist.ts` already iterates `Object.keys(defaults.unlocked)`, so seeding both is sufficient. (The plan's earlier phrasing "persist.ts (NEW)" was wrong — the file exists; the gap is that the worker plain-state copy must be updated in lockstep.)
- `src/render/themes/data/default-map-theme.json` (only — `the-aftermath.json` is out of scope): Add `sturdyWall` and `shotgunTank` tower entries with `name`, `color`, `icon`, `animation`, `walking` (frames) and generate `tower-sturdyWall-f0`, `tower-shotgunTank-f0` symbols via `useSvgStaticContent.ts`. `the-aftermath.json` is **out of scope** for the new tower sprites.
- `src/components/GameShop.vue` / `src/game/Input.ts`: shop already iterates `TowerIds` (`const towerList = Object.values(TowerIds)` at **GameShop.vue:19**, `v-for="id in towerList"` at **208**; `Input.ts` `towerIdList = Object.values(TowerIds)` at **line 11**, digits 1–9 map via `(digit - 1) % towerIdList.length` at **lines 182–184**). Dynamic, no hard-coded 6-tower assumption (README: "up to 9"). Adding `STURDY_WALL`/`SHOTGUN_TANK` to `TowerIds` (5b top) makes them appear automatically.

### 5c — Variant behavior wiring

- `src/towers/Tower.ts`:
  - Thorn (sturdyWall A): when an enemy calls `tower.takeDamage(d, enemy)`, also `enemy.takeDamage(d * thornReflectPct)`. Use the optional `attacker` param added in Phase 1.
  - Electric fence (sturdyWall B): in `update()`, if not ghost, compute `const fenceRangePx = this.grid.tileSize * ELECTRIC_FENCE_RANGE_TILES;` (constant added in Phase 0; `ELECTRIC_FENCE_RANGE_TILES = 0.75`) and query `enemyManager.getEnemiesInRange(this.x, this.y, fenceRangePx)`, applying `enemy.takeDamage(fenceDamage)` + `enemy.applyStun(fenceStun)` (mirror frostAura/staticField pattern).
  - Shotgun Tank A +health: apply in `constructor`/variant application by scaling `maxHealth`/`health`.
  - Shotgun Tank B knockback: in `fire()`, pass `SHOTGUN_KNOCKBASE`/`SHOTGUN_KNOCK_SCALE` as `knockbackBase`/`knockbackScale` (the 5a pair).

---

## Phase 6 — Tests, Lint, Typecheck

### Test setup note (post-migration)
- Test helpers now construct `GameEngine` with plain state objects + a mock `HostBindings` (ArchitecturePlan §6.3), not Pinia mock stores. Assert ghost/attack/knockback behavior against the engine's plain state and the produced `SimulationSnapshot` DTOs (`TowerSnapshot`/`EnemySnapshot`), not live objects. `mock-stores.ts`/`mock-managers.ts` helpers are rewritten accordingly.

### New / extended tests
  - **Update existing `pathfinding.test.ts` / `grid.test.ts` assertions** that expect `canPlaceWithoutBlocking` to return `false` for path-tile placements — the contract changed (path placement is now always allowed; see Phase 2). Revise or remove those cases so the existing ~710 tests stay green.
  - **Audit MORE than the two files above.** The contract flip (path tiles always buildable; enemies route *through* towers instead of being rerouted/stopped) also invalidates assumptions in other suites. Before starting Phase 2, grep and review: `tests/unit/game-engine.test.ts` and `tests/integration/integration.test.ts` (any test that places a tower expecting it to block/funnel/stop enemies, or asserts enemies reroute when a tile becomes blocked), and `tests/unit/tower-manager.test.ts` (placement/blocking expectations). Adjust or rewrite those cases to the new "build anywhere on a path, enemies attack-through" model. Expect this to be a larger test-churn surface than the two named files.
- `tests/unit/pathfinding.test.ts`: BFS blocked → Dijkstra fallback returns weakest path; ghost tiles excluded from blocking; `canPlaceWithoutBlocking` always allows path tiles.
- `tests/unit/grid.test.ts`: `setTowerGhost`/`clearTowerGhost` move keys between `blocked`/`ghostTowers`; `canBuild` rejects ghost tiles; mid-wave `restore()` re-blocks via `clearTowerGhost` and `recomputePaths`.
- `tests/unit/towers.test.ts`: new towers have expected `health`, cost, variant effects (thorn %, fence, knockback, +health); ghost towers can't upgrade/sell; `restore()` resets health.
- `tests/unit/enemies.test.ts`: attack timer respects stun (pause, no reset) and slow; attacks lower tower health; attacks lower-health of two towers; collision lane offset direction by speed.
- `tests/unit/skill-tree.test.ts`: `sturdyWall`/`shotgunTank` appear in `SKILL_TREE` with 2 variants + addons; unlock/refund works.
- `tests/unit/map-theme.test.ts`: default theme includes `attack` frames for all enemies and the new `sturdyWall`/`shotgunTank` tower sprites; `the-aftermath.json` is unaffected.

### Quality gates (run from repo root)
- `npm run lint` then `npm run lint:fix` if needed.
- `npm run typecheck` (strict TS, `noEmit`).
- `npm run test` (Vitest, jsdom) — target green; expect ~710+ existing tests to remain passing.

---

## How this plan fits the ArchitecturePlan

This plan was written before the worker/snapshot migration (`plans/ArchitecturePlan.md` §3) was implemented. It remains valid as a feature plan, but its relationship to the architecture is now explicit:

- **Independent of the worker/snapshot migration.** Ghost state, tower health, enemy attack, and path-blocking operate on plain `Tower`/`Enemy`/grid state and are added as fields mirrored into `SimulationSnapshot` (`TowerSnapshot.isGhost`, `EnemySnapshot.attackAnimTime`). They do not touch the sim↔main boundary and can be built now on the logic layer. The render managers already consume snapshots (`EnemyManager.syncFromGameEngine`, `TowerManager.syncFromGameEngine`), so the new visual fields are read off the snapshot, not off live objects. **Note:** `blockedByTower` is a *live* `Tower` reference used only by sim-side attack logic and is **not** serialized into `EnemySnapshot` — the renderer determines which attack frame to show solely from `attackAnimTime` + `gameSeconds`, so no tower reference is needed in the snapshot.

- **Collision & routing plug into the `SpatialIndex` seam (§3.5), not into Phases 0–9.** `SpatialIndex` and SoA typed-array storage are **not implemented**; they are enumerated as near-future simulation features in §1.4 (enemy–enemy collision, enemy–map collision, per-enemy non-linear routing, pile-up). Phase 2's Dijkstra weakest-path and Phase 4's enemy–enemy collision/lane-passing are exactly those features. They are implemented here against the existing `EnemyManager` spatial hash (Phase 4) and plain grid-graph Dijkstra (Phase 2) as **interim** implementations, structured so the only swap point later is the query call → `SpatialIndex.queryRange` and the position source → SoA `Float32Array`s. This keeps collision/routing from smearing across `Enemy`/`EnemyManager`/`WaveManager`/`Pathfinding` (the exact risk §3.5 warns about). The `SpatialIndex` interface is the single most important seam to establish early, and this plan's collision/routing work is the feature that will consume it.

- **No new runtime dependencies; no COOP/COEP needed.** This plan adds no WASM/SAB requirement (those are §4.1/§4.2 triggers, still future). All new logic is plain TypeScript.

- **Determinism preserved (§2.5).** Dijkstra weights use remaining tower health at recompute time (the documented staleness trade-off in Phase 2); no per-frame RNG is introduced, so runs stay reproducible for debugging and future LLM evaluation harnesses.

- **HostBindings discipline.** Any sound (ghost explosion, attack), UI notification, confirm dialog (sell/downgrade of ghosted towers), or persistence triggered by these features must flow through the injected `HostBindings` interface, matching the migration. No Pinia store or `SoundManager` construction is added to the logic layer.

---

## Resolved Decisions (confirmed with user)
1. **Exact health numbers**: the proposed defaults (Phase 0) are a fine starting point; further balancing will happen later. No change needed now.
2. **Enemy attack scaling**: wave×level, identical to the existing HP scaling (`ENEMY_WAVE_DAMAGE_MULT` × `ENEMY_LEVEL_HP_MULT`).
3. **Lane offset**: implemented as a **centerline + signed `laneOffset`** model — `Enemy` keeps a path centerline position and resolves collisions by adjusting a clamped lateral offset (`|laneOffset| <= grid.tileSize / 2 - radius`); the real engine `x/y` is derived from centerline + perpendicular offset, so collisions use the real location and the SVG `<use>` mirrors it exactly (see Phase 4).
4. **Bosses**: attack exactly like other enemies (same stun/slow rules) and use higher `attackDamage`/`attackSpeed`; any future tuning touches only the boss entry.
5. **New towers**: available to build immediately (no gem gate), with level 3–7 and variant unlocks gem-unlockable just like the existing six towers.
6. **Tower health scales with level**: `maxHealth = base.health * TOWER_LEVEL_DMG_MULT ** (level - 1)` (upgraded towers are tankier; consistent with the level-driven ghost duration). Across all towers, not just the two new ones.
7. **`the-aftermath.json` strict scope (accepted broken state)**: the two new towers and enemy attack frames are added ONLY to `default-map-theme.json`. Under the "the-aftermath" theme the new towers will render broken/missing (no symbols) and enemies will have no attack animation. This is an accepted consequence of the strict out-of-scope decision; no fallback is added there. (See also Phase 3 / Phase 5 scope statements.)

## Remaining open items (implementation-time only)
- Final tuning of health/attack/knockback numbers after play-testing.
- Exact thorn-reflect / fence-damage / fence-stun magnitudes per tier (proposed in Phase 5, adjust during balance pass).
