# Implementation Plan: Path Blocking, Enemy Attacks & Tower Health

**Scope summary:** This plan adds (1) tower health + ghost state, (2) enemy attack ability with attack animations, (3) path-tile tower blocking with Dijkstra weakest-path fallback, (4) enemy-enemy collision / lane-passing, and (5) two new high-health towers ("Sturdy Wall", "Shotgun Tank"). Enemy attack animations and the two new tower sprites are added to `default-map-theme.json` only; `the-aftermath.json` is out of scope for both the attack animation images and the new tower sprites.

**Conventions used in this plan** (per `AGENTS.md`): all new variables use descriptive full words; lines target ~100 chars. New game-side pure logic should be covered by Vitest unit tests (mirror `tests/unit/{grid,pathfinding,towers,enemies,tower-manager,enemy-manager,skill-tree,map-theme}.test.ts`).

**Architecture note:** The worker/snapshot migration (`plans/ArchitecturePlan.md` §3) is in place. `GameEngine` runs inside the worker (`src/sim/WorkerEntry.ts`); the main thread uses `SnapshotStore` + `WorkerCommandDispatcher`; render managers consume `SimulationSnapshot` (not live `Tower[]`/`Enemy[]`). New/changed simulation state must be exposed through `HostBindings` (sound/UI/confirm/persist) and mirrored into `SimulationSnapshot` (`TowerSnapshot`/`EnemySnapshot`), since the render managers read snapshots. `GameEngine` no longer constructs `SoundManager` or calls Pinia stores directly. All `file:line` references below reflect the current post-migration tree. `SpatialIndex` and SoA typed-array storage are **not** implemented (see the "Fit with ArchitecturePlan" section).

---

## Execution Order (recommended phases)

1. **Phase 0 — Constants & data model** (health, ghost timing, attack stats, new towers).
2. **Phase 1 — Tower health + ghost state** (Tower, Grid, Tower render, GameEngine, particles).
3. **Phase 2 — Path-tile placement + Dijkstra fallback** (Pathfinding, Grid, canPlaceWithoutBlocking, Enemy path-follow).
4. **Phase 3 — Enemy attack ability + attack animation** (Enemy, theme JSON, Enemy render).
5. **Phase 4 — Enemy-enemy collision & lane passing** (Enemy update, spatial-hash queries).
6. **Phase 5 — Two new towers** (Constants, SkillTree, theme SVG, electric-fence/thorn/knockback logic).
7. **Phase 6 — Tests + lint + typecheck.**

---

## Phase 0 — Constants & Data Model

### `src/game/ConstantsTower.ts`
  - `TowerBase` interface (now **line 33**), `TOWER_BASE` (**line 47**), `TOWER_LEVEL_DMG_MULT` (**line 60**).
  - Add `health` to `TowerBase` interface and `TOWER_BASE`. Existing towers get *small* health (proposed defaults, tunable): basic 25, ice 20, sniper 20, cannon 30, lightning 22, railgun 28. Tower `maxHealth` scales with level via `TOWER_LEVEL_DMG_MULT ** (level - 1)` (see Phase 1 constructor) — upgraded towers are tankier, matching the level-dependent ghost-duration formula.
- Add new exported constants:
  - `GHOST_RESTORE_BASE_SECONDS = 50`, `GHOST_RESTORE_PER_LEVEL = 5` → restore time = `GHOST_RESTORE_BASE_SECONDS - level * GHOST_RESTORE_PER_LEVEL` (level 7 → 15s, per draft).
  - `GHOST_PARTICLE_DURATION = 2` (explosion length, seconds).
  - `GHOST_OPACITY = 0.5` (render opacity for ghost state).
- New tower bases (see Phase 5) also get `health` here.

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
- Add `takeDamage(amount: number, attacker?: Enemy): void` → `this.health -= amount`; if `health <= 0 && !isGhost` set `isGhost = true`, `pendingGhostEffect = true`. (Optional `attacker` param supports thorn reflection in Phase 5.)
  - Add `restore(): void` → `isGhost = false`, `health = maxHealth`, `ghostTimer = 0`, and re-register the tile with the grid so it blocks again and paths recompute (`grid.clearTowerGhost(tileX, tileY)` — see Grid section). Call this both from the ghost timer in `update()` (mid-wave auto-restore) **and** from `GameEngine.onWaveStart` (wave-start restore). Both paths must keep the `blocked`/`ghostTowers` sets and `recomputePaths()` consistent.
  - Add `canModify(): boolean { return !this.isGhost; }`. Enumerate every mutation entry point and guard each on `canModify()`, surfacing a "ghosted" reason when blocked: `canUpgrade()` (return `{ ok: false, reason: "Ghosted — cannot upgrade" }` when `isGhost`), `specialize()`, `sellValue()` (block/zero when `isGhost`), and the downgrade (sell-at-level>1) path in `GameEngine`/`TowerPanel`. Ghost towers must be rejected at all of these.
- Ghost timer tick: advance `ghostTimer += dt` inside `update()`; when `ghostTimer >= restoreTime` call `restore()`. (restoreTime computed from level.)
- **Important:** ghost towers must NOT fire or target. Early-return in `update()` (after ticking ghost timer) when `isGhost` is true, matching the "no longer blocks / cannot act" rule.

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
    - If `tower.pendingGhostEffect`: call `particleManager.spawn(tower.x, tower.y, tower.color, count, { life: GHOST_PARTICLE_DURATION, ... })` (`ParticleSystem.spawn` signature at `src/game/ParticleSystem.ts:33`); `tower.pendingGhostEffect = false`; call `grid.setTowerGhost(tower.tileX, tower.tileY)` (stops blocking + recomputes path).
- In `onWaveStart(wave)` (still a method at **line 386**): restore all ghost towers → `tower.restore()` + `grid.clearTowerGhost(tower.tileX, tower.tileY)`. **Then handle enemies standing on restored tiles:** iterate all enemies; for any enemy whose current tile is now in `grid.blocked` (just restored from ghost), teleport them to the last valid position on their path before that tile. Without this, an enemy physically on the tile will suddenly find its path blocked again.
- Keep the `enemy.onPathBlocked` bounty branch as a safety net only (Phase 2/3 let enemies route through towers instead).
- **Ghost-reject for sell/downgrade (HostBindings-era signatures):** `sellSelected()` is at **line 624** and now calls `host.requestConfirm({ towerId, towerType, towerLevel, sellValue, isRefund })` (early-return when `sellActive === "discount"` at lines 628–630); `executeSell` at **line 673**; `downgradeSelected` at **line 693**. Guard each on `!tower.isGhost` before mutating. (The old `useUiStore().showConfirm` and `this.persistStore.save()` calls are gone — sound is `this.host.playSound(...)`, persist is `persistDirty = true` + `host.schedulePersistSave`.)

### `src/render/svg/TowerManager.ts`
- `syncFromGameEngine(towers: TowerSnapshot[], dt: number)` is at **line 13**; `TowerRenderProxy.sync(tower: TowerSnapshot, dt)` at **line 142**. In `sync`, read `tower.isGhost` from the snapshot; if true set `el.style.opacity = String(GHOST_OPACITY)`, else reset to `"1"`. (CSS/SVG opacity per draft — no new symbol needed. `isGhost` must be added to `TowerSnapshot`.)

### `src/game/ParticleSystem.ts`
- Reuse existing `spawn(x, y, color, count, {life, size, speed})` (signature at **line 33**, `getRenderData` at **line 76**). No change required; call with `tower.color` and a short life.

---

## Phase 2 — Path-Tile Placement + Dijkstra Weakest-Path Fallback

### `src/grid/Pathfinding.ts`
- Current anchors: `canPlaceWithoutBlocking` (**line 123**), `bfsShortestPath` (**line 17**), and `bfsReverseFromBase` (**line 68**) — the reverse-BFS rejection to remove lives in `bfsReverseFromBase`. `dijkstraWeakestPath` is new.
- `canPlaceWithoutBlocking(grid, spawns, base, towerXY, existingBlocked, cachedPathTiles?)`:
  - **Path-tile placement is always permitted.** Because routing now goes *through* towers (Dijkstra weakest-path fallback, below), tower tiles are traversable — placing a tower on a path tile can never disconnect spawns from the base. Remove the reverse-BFS rejection in `bfsReverseFromBase` (**line 68**) for path tiles entirely.
  - Keep the fast path: if the tile is not on any cached path, return `true` (unchanged).
  - For path tiles, still reject only if the tile is already occupied by another tower (handled by `Grid.canBuild`/`registerTower`, since `blocked`/`ghostTowers` already contain it). The reachability BFS must **not** treat live tower tiles as walls; if any reachability check is retained, it must treat all path/base/spawn tiles as passable regardless of `blocked` (Dijkstra makes them traversable).
  - Ghost tiles: `Grid.canBuild` rejects if `ghostTowers.has(key)` (a ghost still occupies the tile), so `canPlaceWithoutBlocking` will not be asked to place on one.
- `bfsShortestPath`: unchanged for the "open" case.
- New `dijkstraWeakestPath(grid, start, goal, towerHealthAt)`:
  - **Standard Dijkstra on the grid graph.** For each popped node, relax all 4 neighbors. Edge weight = `tower.health` if neighbor has a live tower, else a small constant (e.g. 0.1). Ghost tiles weight 0 (free passage). Track `dist[tile]` properly for all incoming edges — a tower tile might be reachable from 4 directions, and the path cost to enter it is the same regardless of direction.
  - Returns the minimum-total-health path from spawn to base — the "go through the weakest towers" path.
  - `Grid.recomputePaths()`:
   - For each spawn: compute BFS path first. If non-null, store it (open path).
   - If BFS is null (live towers fully block every open route), compute `dijkstraWeakestPath` and store it. **No per-spawn flag** — the `Enemy` determines attack-vs-walk behavior from `blockedByTower` (see Enemy section below).
   - **Weakest-path staleness caveat (accepted):** `dijkstraWeakestPath` weights edges by each live tower's *remaining* health, but `recomputePaths()` is only (re)run on tower add / remove / ghost / restore — not as a tower's health drops each frame. Enemies therefore follow a weakest path that was optimal at placement time and may become suboptimal as towers are whittled down. This is an accepted, documented trade-off: continuously re-running Dijkstra (every frame, or per tower-damage event) would be a costly calculation for no meaningful gameplay benefit, since the path still always reaches the base and enemies re-resolve onto a fresh weakest path at the next recompute. No periodic/threshold recompute is added.
  - **SpatialIndex seam (future):** routing is a near-future simulation feature (ArchitecturePlan §1.4). Once `SpatialIndex` (§3.5) exists, `dijkstraWeakestPath` and the path queries should be implemented against it. The interim here is plain grid-graph Dijkstra with no `SpatialIndex` dependency, structured so the swap is localized.

### `src/grid/Grid.ts`
- Current anchors: `blocked` (**line 31**), `terrainTowers` (**line 32**), `paths` (**line 33**), `recomputePaths` (**line 152**), `registerTower` (**line 108**), `unregisterTower` (**line 125**).
- Track `paths` only; **no `pathUsesTowers` flag.** The `Enemy` determines attack-vs-walk behavior from `blockedByTower` (set when the next path tile holds a live tower). No per-spawn or per-enemy boolean is needed — the tower-on-next-tile check naturally triggers attack behavior.
- `registerTower` / `unregisterTower`: recompute as today; ghost transitions call recompute (see Phase 1).

### `src/enemies/Enemy.ts`
- **Wiring (prerequisite for Phases 2–4):** `Enemy` currently only holds a limited `GridRef` (`blocked`, `getPathFor`, `tileToWorld`, `getBase` — interface at **line 36**) and no tower reference. Add a tower lookup so enemies can attack towers and detect ghost/harmless state. Extend `Enemy`'s `grid` ref (or pass a `TowerManager` ref into `Enemy.update`) with `towerAt(x, y): Tower | null` (delegate to `TowerManager.towerAt`, which already exists). Wire it in `GameEngine` (set on the grid/enemy manager) and in `EnemyManager.spawn` so every enemy can resolve the tower on a given tile. `EnemyManagerRef` (`getEnemiesInRange` at **line 46**) is the existing pattern to mirror. All tower interactions below use this lookup.
- In `update()`, replace the current "if next tile blocked → recompute BFS and if null set `onPathBlocked`" logic:
  - **Attack target resolution (reconciles Phase 2 path-driven and Phase 4 collision-driven triggers):**
     - **Primary target** = the tower on the *forward path tile* (the next tile in `this.path`). If that next tile holds a **live** (non-ghost) tower (resolved via the `towerAt` lookup from the Wiring step above), do **not** advance `pathIdx`, set `this.blockedByTower = tower`, and trigger attack (Phase 3). The enemy stops moving when its center reaches the **edge** of the blocking tower's tile — i.e. when the distance to the next waypoint center is `<= tileSize/2 + this.radius` (not the tile center) — so it attacks from the boundary instead of visually overlapping the tower sprite. Movement pauses; when that tower dies (becomes ghost) the tile opens, the path recomputes, and the enemy advances.
    - **Fallback (junctions / stacking):** if the forward path tile has no live tower but the enemy is physically blocked from motion (collision, Phase 4) and is in contact with an adjacent tower, set `blockedByTower` to the **lowest-`health`** adjacent live tower (check the 4 neighbor tiles, not just the path successor). When the contact ends (tower ghosted / enemy moves), clear `blockedByTower` and resume.
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

### `src/render/themes/normalize.ts` & `index.ts`
- `index.ts`: `MapThemeAnimation` (**line 22**), `EnemyVisualMeta` (**line 35**, currently `walking` + `hitReaction: MapThemeAnimation | null`). Extend `EnemyVisualMeta` to include `attack?: MapThemeAnimation`.
- `normalize.ts`: `normalizeAnimation` (**line 47**), `normalizeEnemyVisual` (**line 68**, currently returns `{ name, color, shape, walking, hitReaction }`). Extend `normalizeEnemyVisual` to accept `attack?: { duration: number; frames: { image: string }[] }` and produce `attack` via `normalizeAnimation(raw.attack)` when present (exactly the pattern already used for `hitReaction`); also extend the raw `enemies` record type to allow the optional `attack` field. `Enemy`/`EnemyManager` must tolerate `attack === null` (the-aftermath has none — see strict-scope decision).
- `src/render/svg/useSvgStaticContent.ts` (confirmed present) generates the `walking`/`hitReaction` symbols today; extend it to also emit `enemy-${type}-attack-f0..2` symbols from `enemy.attack.frames`.

---

## Phase 4 — Enemy-Enemy Collision & Lane Passing

- **`SpatialIndex` seam (future, not yet implemented).** `SpatialIndex` (ArchitecturePlan §3.5) is the intended interface for collision queries, but it does **not** exist yet. Until it lands, reuse the existing `EnemyManager` spatial hash as the interim implementation: `spatialHash: Map<string, Enemy[]>` (**line 25**), `updateSpatialHash()` (**line 187**), `getEnemiesInRange(x, y, radius)` (**line 205**). Structure the collision code so the only query site that changes later is the `getEnemiesInRange` call → `SpatialIndex.queryRange`. Enemy–enemy collision is itself a §1.4 near-future feature; when `SpatialIndex` + SoA typed arrays (§3.5) arrive, the per-enemy position data migrates to `Float32Array`s indexed by entity id, but the centerline + `laneOffset` model below is unchanged and independent of that storage choice.
- Reuse the existing spatial hash in `src/enemies/EnemyManager.ts` via `getEnemiesInRange(x, y, radius)` to find colliding enemies each frame.
- **Movement model (centerline + laneOffset):** Refactor `Enemy` so it maintains a *path centerline position* (`centerX/centerY` advanced toward each waypoint as today) plus a signed scalar `laneOffset` (perpendicular to the current facing/`moveAngle`). Each frame:
  - Advance `centerX/centerY` along the path toward the next waypoint by `step` (unchanged forward logic).
  - Resolve collisions against neighbors within `this.radius + other.radius` (spatial hash). If overlapping, separate laterally: the **slower** enemy is pushed to the **right** side of the path, the **faster** enemy to the **left** side. Define the perpendicular consistently relative to `moveAngle` (e.g. right-perpendicular = `(sin a, -cos a)` for `a = moveAngle`); slower gets `+offset`, faster gets `-offset`. Accumulate into `laneOffset`. **Note:** with `moveAngle = atan2(deltaY, deltaX)` and screen coords where Y increases downward, `(0, -1)` = up, `(-1, 0)` = left — easy to sign-flip, so add a comment documenting this convention.
  - **Clamp** `|laneOffset| <= tileSize/2 - this.radius` so the enemy always stays within the current path tile bounds ("stack up against the tower" rather than leaving the path when blocked).
  - Derive the true engine position: `x = centerX + perpX * laneOffset`, `y = centerY + perpY * laneOffset` (perpendicular unit vector from `moveAngle`), then `worldPos = { x, y }`. Collisions and the renderer both read this real `x/y`, so the simulation and the SVG `<use>` always match.
  - If an enemy is blocked from forward motion AND is adjacent to a tower (touching its tile), apply the attack-target resolution from Phase 2 (set `blockedByTower` to the lowest-health adjacent live tower). **"Blocked from forward motion" is defined precisely as:** the enemy cannot advance its centerline toward the next waypoint because (a) the forward path tile itself holds a live tower (the primary target case), **or** (b) another enemy occupies the space between this enemy and the tower/waypoint it is trying to reach, preventing the step from completing. Resolve collisions against neighbors the same as the general rule: within `this.radius + other.radius` (spatial hash). In case (b) the enemy is considered blocked-by-collision; once the obstructing enemy moves away (or is killed) and the path is clear, `blockedByTower` is cleared and movement resumes.
- Never let `laneOffset` change `pathIdx`/waypoint choice — it is purely visual+collision lateral displacement around the centerline.

---

## Phase 5 — Two New High-Health Towers

### `src/game/ConstantsTower.ts`
- Current anchors: `TowerIds` (**line 2**), `TOWER_META` (**line 20**), `TowerVariantStats` (a `type` alias at **line 144**, not an `interface`), `knockback: boolean` inside it (**line 158**), `TOWER_VARIANTS` (**line 166**), railgun A `apply: (s, _t) => ({ ...s, knockback: true })` (**line 191**), `RAILGUN_KNOCKBASE` (**line 85**), `RAILGUN_KNOCK_SCALE` (**line 87**).
- Add to `TowerIds`: `STURDY_WALL: "sturdyWall"`, `SHOTGUN_TANK: "shotgunTank"`.
- `TOWER_META`: sturdyWall cost (proposed 40), shotgunTank cost = `basic.cost * 1.5` = 30 (50% more than basic, per draft).
- `TOWER_BASE`:
  - sturdyWall: `range: 0` (no targeting/fire), `damage: 0`, `fireRate: 0`, `health: 200` (high; no damage).
   - shotgunTank: `range: 1`, `damage: 8` (like basic), `fireRate: 1.2`, `projSpeed: 14`, `health: 250` (independent static value like the other towers — the "basicHealth * 10" phrasing in the draft was only a planning reference, not a code dependency).
- New knockback constant: `SHOTGUN_KNOCKBASE = RAILGUN_KNOCKBASE * 1.5` (= 0.45). `SHOTGUN_KNOCK_SCALE` analogous to railgun.
- `TOWER_VARIANTS`:
  - sturdyWall A ("Thorn Wall"): reflects `attackDamage * [0.3, 0.6, 1.0]` at levels 5/6/7 back to the attacking enemy. Store `thornReflectPct` per tier.
  - sturdyWall B ("Electric Fence"): on enemy contact deals touch damage + short stun (stop motion + attacks). Add behavior flags `fenceDamage`, `fenceStun`.
  - shotgunTank A ("Reinforced"): increases tower `health` (e.g., ×1.5/×2/×3 per tier).
  - shotgunTank B ("Repulsor"): knockback like railgun A but using `SHOTGUN_KNOCKBASE` (50% stronger than railgun).

### `src/towers/SkillTree.ts`
- Current anchors: `VARIANT_INFO` (**line 57**), `ADDON_INFO` (**line 84**), the `for (const id of Object.values(TowerIds))` auto-build loop (**line 46**, repeated at **line 117**), and `populateSkillTreeTheme(defaultTowerVisuals)` (**line 45**) — which replaces the old module-level `useMapThemeStore()` call (the ArchitecturePlan noted at old lines 122–123; that call is now gone). Note `maxLevelFor(save, towerId, variant)` is now defined in `SkillTree.ts` at **line 259**, not in `persist.ts`.
- Add `VARIANT_INFO` and `ADDON_INFO` entries for `sturdyWall` and `shotgunTank` (the `for (const id of Object.values(TowerIds))` loop auto-builds `SKILL_TREE` entries). Provide addon descriptions consistent with existing style.
- Add any addon effect wiring in `TOWER_ADDON_EFFECTS` if needed (proposed: leave addons minimal or reuse patterns; fence/stun/thorn handled via variant flags).

### `src/stores/persist.ts` & `src/sim/PersistState.ts` (both required, else new towers crash)
- `persist.ts` already exists (not new). Add `sturdyWall` and `shotgunTank` entries to `defaultUnlocked()` (at **line 73**; `blankTower()` at **line 50**, `unlocked` field at **line 39**, `migrateToCurrent` at **line 165**) alongside the existing six, each seeded with `blankTower()`. Without this, `maxLevelFor(save, towerId)` (`save.unlocked[towerId]!`) and `Tower` addon loading throw on the new IDs for both fresh and migrated saves.
- **Also** add the same two entries to the worker-side plain-state `defaultUnlocked()` in `src/sim/PersistState.ts` (**line 40**, invoked by `createDefaultPersistState` at **line 66**). `migrateToCurrent` in `persist.ts` already iterates `Object.keys(defaults.unlocked)`, so seeding both here is sufficient to seed old saves too. (The plan's earlier phrasing "persist.ts (NEW)" was wrong — the file exists; the gap is that the worker plain-state copy must be updated in lockstep.)

### `src/towers/Tower.ts`
- Wire variant behaviors:
  - Thorn (sturdyWall A): when an enemy calls `tower.takeDamage(d, enemy)`, also `enemy.takeDamage(d * thornReflectPct)`. Use the optional `attacker` param added in Phase 1.
  - Electric fence (sturdyWall B): in `update()`, if not ghost, query `enemyManager.getEnemiesInRange(x, y, fenceRangePx)` and apply `enemy.takeDamage(fenceDamage)` + `enemy.applyStun(fenceStun)` (mirror frostAura/staticField pattern).
  - Shotgun Tank B knockback: instead of the current `knockback: boolean` flag, **extend the projectile options** with an explicit base/scale pair: `knockbackBase: number` and `knockbackScale: number`. In `fire()`, pass `SHOTGUN_KNOCKBASE`/`SHOTGUN_KNOCK_SCALE` as `knockbackBase`/`knockbackScale`. `ProjectileManager` applies knockback whenever `knockbackBase` is provided (treat as "knockback enabled" when `knockbackBase > 0`), dropping the old boolean. The same extended options are used by railgun variant A (`RAILGUN_KNOCKBASE`/`RAILGUN_KNOCK_SCALE`) so the boolean is removed entirely. **Current `Tower.ts` anchors** (constructor **226**, `update` **653**, `fire` **760**, `ProjectileManagerRef.spawn` opts `knockback?: boolean` **101**, `TowerStats` `knockback: boolean` **148**, `_computeStats` **319**, `let knockback = false` **336**, variant apply/destructure sites **356/374/396/414**, return object includes `knockback` **507**, `fire` passes `knockback: stats.knockback` **817**). **Current `ProjectileManager.ts` anchors** (`spawn` opts `knockback?: boolean` **206**, `applyProjectileEffects` param `knockback: boolean` **288**, railgun knockback gating **308–310**). All `knockback: boolean` references at these sites move to the `knockbackBase`/`knockbackScale` pair.
  - Shotgun Tank A +health: apply in `constructor`/variant application by scaling `maxHealth`/`health`.

### `src/render/themes/data/default-map-theme.json` (only — `the-aftermath.json` is out of scope)
- Add `sturdyWall` and `shotgunTank` tower entries with `name`, `color`, `icon`, `animation`, `walking` (frames) and generate `tower-sturdyWall-f0`, `tower-shotgunTank-f0` symbols via `useSvgStaticContent.ts`.
- `the-aftermath.json` is **out of scope** for the new tower sprites (leave existing behavior); only `default-map-theme.json` receives them.

### `src/components/GameShop.vue` / shop data
- Confirm shop iterates `TowerIds` (or an ordered tower list) so the two new towers appear for building. `GameShop.vue` already does this: `const towerList = Object.values(TowerIds)` (**line 19**) and `v-for="id in towerList"` (**line 208**) — dynamic, no hard-coded 6-tower assumption (README says "up to 9" and `1`–`9` keys). Add `STURDY_WALL`/`SHOTGUN_TANK` to `TowerIds` (Phase 5 top) and they appear automatically. Keyboard input is likewise dynamic: `src/game/Input.ts` `towerIdList = Object.values(TowerIds)` (**line 11**), digits 1–9 map via `(digit - 1) % towerIdList.length` (**lines 182–184**).

---

## Phase 6 — Tests, Lint, Typecheck

### Test setup note (post-migration)
- Test helpers now construct `GameEngine` with plain state objects + a mock `HostBindings` (ArchitecturePlan §6.3), not Pinia mock stores. Assert ghost/attack/knockback behavior against the engine's plain state and the produced `SimulationSnapshot` DTOs (`TowerSnapshot`/`EnemySnapshot`), not live objects. `mock-stores.ts`/`mock-managers.ts` helpers are rewritten accordingly.

### New / extended tests
- **Update existing `pathfinding.test.ts` / `grid.test.ts` assertions** that expect `canPlaceWithoutBlocking` to return `false` for path-tile placements — the contract changed (path placement is now always allowed; see Phase 2). Revise or remove those cases so the existing ~710 tests stay green.
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

- **Independent of the worker/snapshot migration.** Ghost state, tower health, enemy attack, and path-blocking operate on plain `Tower`/`Enemy`/grid state and are added as fields mirrored into `SimulationSnapshot` (`TowerSnapshot.isGhost`, `EnemySnapshot.attackAnimTime`/`blockedByTower`, etc.). They do not touch the sim↔main boundary and can be built now on the logic layer. The render managers already consume snapshots (`EnemyManager.syncFromGameEngine`, `TowerManager.syncFromGameEngine`), so the new visual fields are read off the snapshot, not off live objects.

- **Collision & routing plug into the `SpatialIndex` seam (§3.5), not into Phases 0–9.** `SpatialIndex` and SoA typed-array storage are **not implemented**; they are enumerated as near-future simulation features in §1.4 (enemy–enemy collision, enemy–map collision, per-enemy non-linear routing, pile-up). Phase 2's Dijkstra weakest-path and Phase 4's enemy–enemy collision/lane-passing are exactly those features. They are implemented here against the existing `EnemyManager` spatial hash (Phase 4) and plain grid-graph Dijkstra (Phase 2) as **interim** implementations, structured so the only swap point later is the query call → `SpatialIndex.queryRange` and the position source → SoA `Float32Array`s. This keeps collision/routing from smearing across `Enemy`/`EnemyManager`/`WaveManager`/`Pathfinding` (the exact risk §3.5 warns about). The `SpatialIndex` interface is the single most important seam to establish early, and this plan's collision/routing work is the feature that will consume it.

- **No new runtime dependencies; no COOP/COEP needed.** This plan adds no WASM/SAB requirement (those are §4.1/§4.2 triggers, still future). All new logic is plain TypeScript.

- **Determinism preserved (§2.5).** Dijkstra weights use remaining tower health at recompute time (the documented staleness trade-off in Phase 2); no per-frame RNG is introduced, so runs stay reproducible for debugging and future LLM evaluation harnesses.

- **HostBindings discipline.** Any sound (ghost explosion, attack), UI notification, confirm dialog (sell/downgrade of ghosted towers), or persistence triggered by these features must flow through the injected `HostBindings` interface, matching the migration. No Pinia store or `SoundManager` construction is added to the logic layer.

---

## Resolved Decisions (confirmed with user)
1. **Exact health numbers**: the proposed defaults (Phase 0) are a fine starting point; further balancing will happen later. No change needed now.
2. **Enemy attack scaling**: wave×level, identical to the existing HP scaling (`ENEMY_WAVE_DAMAGE_MULT` × `ENEMY_LEVEL_HP_MULT`).
3. **Lane offset**: implemented as a **centerline + signed `laneOffset`** model — `Enemy` keeps a path centerline position and resolves collisions by adjusting a clamped lateral offset (`|laneOffset| <= tileSize/2 - radius`); the real engine `x/y` is derived from centerline + perpendicular offset, so collisions use the real location and the SVG `<use>` mirrors it exactly (see Phase 4).
4. **Bosses**: attack exactly like other enemies (same stun/slow rules) and use higher `attackDamage`/`attackSpeed`; any future tuning touches only the boss entry.
5. **New towers**: available to build immediately (no gem gate), with level 3–7 and variant unlocks gem-unlockable just like the existing six towers.
6. **Tower health scales with level**: `maxHealth = base.health * TOWER_LEVEL_DMG_MULT ** (level - 1)` (upgraded towers are tankier; consistent with the level-driven ghost duration). Across all towers, not just the two new ones.
7. **`the-aftermath.json` strict scope (accepted broken state)**: the two new towers and enemy attack frames are added ONLY to `default-map-theme.json`. Under the "the-aftermath" theme the new towers will render broken/missing (no symbols) and enemies will have no attack animation. This is an accepted consequence of the strict out-of-scope decision; no fallback is added there. (See also Phase 3 / Phase 5 scope statements.)

## Remaining open items (implementation-time only)
- Final tuning of health/attack/knockback numbers after play-testing.
- Exact thorn-reflect / fence-damage / fence-stun magnitudes per tier (proposed in Phase 5, adjust during balance pass).
