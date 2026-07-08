# Implementation Plan: Path Blocking, Enemy Attacks & Tower Health

**Scope summary:** This plan adds (1) tower health + ghost state, (2) enemy attack ability with attack animations, (3) path-tile tower blocking with Dijkstra weakest-path fallback, (4) enemy-enemy collision / lane-passing, and (5) two new high-health towers ("Sturdy Wall", "Shotgun Tank"). Enemy attack animations and the two new tower sprites are added to `default-map-theme.json` only; `the-aftermath.json` is out of scope for both the attack animation images and the new tower sprites.

**Conventions used in this plan** (per `AGENTS.md`): all new variables use descriptive full words; lines target ~100 chars. New game-side pure logic should be covered by Vitest unit tests (mirror `tests/unit/{grid,pathfinding,towers,enemies,tower-manager,enemy-manager,skill-tree,map-theme}.test.ts`).

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
  - Add `health` to `TowerBase` interface and `TOWER_BASE`. Existing towers get *small* health (proposed defaults, tunable): basic 25, ice 20, sniper 20, cannon 30, lightning 22, railgun 28. Tower `maxHealth` scales with level via `TOWER_LEVEL_DMG_MULT ** (level - 1)` (see Phase 1 constructor) — upgraded towers are tankier, matching the level-dependent ghost-duration formula.
- Add new exported constants:
  - `GHOST_RESTORE_BASE_SECONDS = 50`, `GHOST_RESTORE_PER_LEVEL = 5` → restore time = `GHOST_RESTORE_BASE_SECONDS - level * GHOST_RESTORE_PER_LEVEL` (level 7 → 15s, per draft).
  - `GHOST_PARTICLE_DURATION = 2` (explosion length, seconds).
  - `GHOST_OPACITY = 0.5` (render opacity for ghost state).
- New tower bases (see Phase 5) also get `health` here.

### `src/game/ConstantsEnemy.ts`
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
- **Keep the existing update order: enemies first, then towers.** Do NOT move ghost-resolution before enemy update — if a tower dies during the tower-update phase, enemies that already ran this frame would keep attacking a dead tower for one full frame. After `towerManager.update(dt, ...)`, iterate towers for ghost effects (particles + `setTowerGhost` + `recomputePaths`), then on the next frame enemies see the updated grid.
  - After `towerManager.update(dt, ...)`, iterate `towerManager.towers`:
    - If `tower.pendingGhostEffect`: call `particleManager.spawn(tower.x, tower.y, tower.color, count, { life: GHOST_PARTICLE_DURATION, ... })`; `tower.pendingGhostEffect = false`; call `grid.setTowerGhost(tower.tileX, tower.tileY)` (stops blocking + recomputes path).
- In `onWaveStart(wave)`: restore all ghost towers → `tower.restore()` + `grid.clearTowerGhost(tower.tileX, tower.tileY)`. **Then handle enemies standing on restored tiles:** iterate all enemies; for any enemy whose current tile is now in `grid.blocked` (just restored from ghost), teleport them to the last valid position on their path before that tile. Without this, an enemy physically on the tile will suddenly find its path blocked again.
- Keep the `enemy.onPathBlocked` bounty branch as a safety net only (Phase 2/3 let enemies route through towers instead).

### `src/render/svg/TowerManager.ts`
- In the tower render proxy `sync`, read `tower.isGhost`; if true set `el.style.opacity = String(GHOST_OPACITY)`, else reset to `"1"`. (CSS/SVG opacity per draft — no new symbol needed.)

### `src/game/ParticleSystem.ts`
- Reuse existing `spawn(x, y, color, count, {life, size, speed})`. No change required; call with `tower.color` and a short life.

---

## Phase 2 — Path-Tile Placement + Dijkstra Weakest-Path Fallback

### `src/grid/Pathfinding.ts`
- `canPlaceWithoutBlocking(grid, spawns, base, towerXY, existingBlocked, cachedPathTiles?)`:
  - **Path-tile placement is always permitted.** Because routing now goes *through* towers (Dijkstra weakest-path fallback, below), tower tiles are traversable — placing a tower on a path tile can never disconnect spawns from the base. Remove the reverse-BFS rejection for path tiles entirely.
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

### `src/grid/Grid.ts`
- Track `paths` only; **no `pathUsesTowers` flag.** The `Enemy` determines attack-vs-walk behavior from `blockedByTower` (set when the next path tile holds a live tower). No per-spawn or per-enemy boolean is needed — the tower-on-next-tile check naturally triggers attack behavior.
- `registerTower` / `unregisterTower`: recompute as today; ghost transitions call recompute (see Phase 1).

### `src/enemies/Enemy.ts`
- **Wiring (prerequisite for Phases 2–4):** `Enemy` currently only holds a limited `GridRef` (`blocked`, `getPathFor`, `tileToWorld`, `getBase`) and no tower reference. Add a tower lookup so enemies can attack towers and detect ghost/harmless state. Extend `Enemy`'s `grid` ref (or pass a `TowerManager` ref into `Enemy.update`) with `towerAt(x, y): Tower | null` (delegate to `TowerManager.towerAt`, which already exists). Wire it in `GameEngine` (set on the grid/enemy manager) and in `EnemyManager.spawn` so every enemy can resolve the tower on a given tile. All tower interactions below use this lookup.
- In `update()`, replace the current "if next tile blocked → recompute BFS and if null set `onPathBlocked`" logic:
  - **Attack target resolution (reconciles Phase 2 path-driven and Phase 4 collision-driven triggers):**
     - **Primary target** = the tower on the *forward path tile* (the next tile in `this.path`). If that next tile holds a **live** (non-ghost) tower (resolved via the `towerAt` lookup from the Wiring step above), do **not** advance `pathIdx`, set `this.blockedByTower = tower`, and trigger attack (Phase 3). The enemy stops moving when its center reaches the **edge** of the blocking tower's tile — i.e. when the distance to the next waypoint center is `<= tileSize/2 + this.radius` (not the tile center) — so it attacks from the boundary instead of visually overlapping the tower sprite. Movement pauses; when that tower dies (becomes ghost) the tile opens, the path recomputes, and the enemy advances.
    - **Fallback (junctions / stacking):** if the forward path tile has no live tower but the enemy is physically blocked from motion (collision, Phase 4) and is in contact with an adjacent tower, set `blockedByTower` to the **lowest-`health`** adjacent live tower (check the 4 neighbor tiles, not just the path successor). When the contact ends (tower ghosted / enemy moves), clear `blockedByTower` and resume.
  - Ghost tower tiles are passable (not in `blocked`), so the enemy advances normally when encountering a ghost — no special flag check needed.

### `src/towers/TowerManager.ts`
- Reuse existing `towerAt(x, y): Tower | undefined` for the above lookup. Ensure ghost towers are still returned by `towerAt` (so enemies can confirm they are ghost / harmless).

---

## Phase 3 — Enemy Attack Ability + Attack Animation

### `src/enemies/Enemy.ts`
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
- In `EnemyRenderProxy.sync`, add an attack-reaction branch with explicit priority (mirror the existing `hitReaction` branch structure):
  - `if (hitAnimTime > 0 && gameSeconds - hitAnimTime < hitReaction.duration)` → render hit reaction frames
  - `else if (attackAnimTime > 0 && gameSeconds - attackAnimTime < attack.duration)` → render attack frames (`enemy-${type}-attack-f${idx}`)
  - `else` → fall back to walking frames
- Check both `hitAnimTime` and `attackAnimTime` as distinct fields on the same object. The existing `hitReaction` branch is the template to follow.

### `src/render/themes/normalize.ts` & `index.ts`
- Extend `EnemyVisualMeta` (index.ts) to include `attack?: MapThemeAnimation` (optional, mirroring `hitReaction`).
- Extend the raw `normalizeEnemyVisual(raw)` signature in `normalize.ts` to accept `attack?: { duration: number; frames: { image: string }[] }` and produce `attack` via `normalizeAnimation(raw.attack)` when present (exactly the pattern already used for `hitReaction`). Also extend the raw `enemies` record type inside `normalizeThemeImages` to allow the optional `attack` field. `Enemy`/`EnemyManager` must tolerate `attack === null` (the-aftermath has none — see strict-scope decision).

---

## Phase 4 — Enemy-Enemy Collision & Lane Passing

- Reuse the existing spatial hash in `src/enemies/EnemyManager.ts` (`getEnemiesInRange`, `updateSpatialHash`). Use `getEnemiesInRange(x, y, radius)` to find colliding enemies each frame.
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
- Add `VARIANT_INFO` and `ADDON_INFO` entries for `sturdyWall` and `shotgunTank` (the `for (const id of Object.values(TowerIds))` loop auto-builds `SKILL_TREE` entries). Provide addon descriptions consistent with existing style.
- Add any addon effect wiring in `TOWER_ADDON_EFFECTS` if needed (proposed: leave addons minimal or reuse patterns; fence/stun/thorn handled via variant flags).

### `src/stores/persist.ts` (NEW — required, else new towers crash)
- Add `sturdyWall` and `shotgunTank` entries to `defaultUnlocked()` (alongside the existing six), each seeded with `blankTower()`. Without this, `maxLevelFor(save, towerId)` (`save.unlocked[towerId]!`) and `Tower` addon loading throw on the new IDs for both fresh and migrated saves. `migrateToCurrent` already iterates `Object.keys(defaults.unlocked)`, so adding them here is sufficient to seed old saves too.

### `src/towers/Tower.ts`
- Wire variant behaviors:
  - Thorn (sturdyWall A): when an enemy calls `tower.takeDamage(d, enemy)`, also `enemy.takeDamage(d * thornReflectPct)`. Use the optional `attacker` param added in Phase 1.
  - Electric fence (sturdyWall B): in `update()`, if not ghost, query `enemyManager.getEnemiesInRange(x, y, fenceRangePx)` and apply `enemy.takeDamage(fenceDamage)` + `enemy.applyStun(fenceStun)` (mirror frostAura/staticField pattern).
  - Shotgun Tank B knockback: instead of the current `knockback: boolean` flag, **extend the projectile options** with an explicit base/scale pair: `knockbackBase: number` and `knockbackScale: number`. In `fire()`, pass `SHOTGUN_KNOCKBASE`/`SHOTGUN_KNOCK_SCALE` as `knockbackBase`/`knockbackScale`. `ProjectileManager` applies knockback whenever `knockbackBase` is provided (treat as "knockback enabled" when `knockbackBase > 0`), dropping the old boolean. The same extended options are used by railgun variant A (`RAILGUN_KNOCKBASE`/`RAILGUN_KNOCK_SCALE`) so the boolean is removed entirely. **All locations that touch `knockback: boolean`:**
    - `src/game/ConstantsTower.ts:158` — `TowerVariantStats` interface (`knockback: boolean`)
    - `src/game/ConstantsTower.ts:188` — `TOWER_VARIANTS.railgun.A` (`apply: (s, _t) => ({ ...s, knockback: true })`)
    - `src/towers/Tower.ts:101` — `ProjectileManagerRef.spawn` interface (`knockback?: boolean`)
    - `src/towers/Tower.ts:146` — `TowerStats` interface (`knockback: boolean`)
    - `src/towers/Tower.ts:333` — local `let knockback = false` in `_computeStats`
    - `src/towers/Tower.ts:353, 371-372, 393, 411-412` — variant apply calls and destructuring
    - `src/towers/Tower.ts:504` — return object includes `knockback`
    - `src/towers/Tower.ts:812` — `knockback: stats.knockback` in `fire()`
    - `src/game/ProjectileManager.ts:197` — `spawn` opts interface (`knockback?: boolean`)
    - `src/game/ProjectileManager.ts:276` — `applyProjectileEffects` param (`knockback: boolean`)
    - `src/game/ProjectileManager.ts:294-295` — railgun knockback logic gated on `knockback`
  - Shotgun Tank A +health: apply in `constructor`/variant application by scaling `maxHealth`/`health`.

### `src/render/themes/data/default-map-theme.json` (only — `the-aftermath.json` is out of scope)
- Add `sturdyWall` and `shotgunTank` tower entries with `name`, `color`, `icon`, `animation`, `walking` (frames) and generate `tower-sturdyWall-f0`, `tower-shotgunTank-f0` symbols via `useSvgStaticContent.ts`.
- `the-aftermath.json` is **out of scope** for the new tower sprites (leave existing behavior); only `default-map-theme.json` receives them.

### `src/components/GameShop.vue` / shop data
- Confirm shop iterates `TowerIds` (or an ordered tower list) so the two new towers appear for building. Verify no hard-coded 6-tower assumption (README says "up to 9" and `1`–`9` keys). Add `STURDY_WALL`/`SHOTGUN_TANK` to any ordered tower list used by shop/keyboard.

---

## Phase 6 — Tests, Lint, Typecheck

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
