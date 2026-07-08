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
- Add `health` to `TowerBase` interface and `TOWER_BASE`. Existing towers get *small* health (proposed defaults, tunable): basic 25, ice 20, sniper 20, cannon 30, lightning 22, railgun 28.
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
- Constructor: set `maxHealth = this.base.health * levelScaleOrConstant`, `health = maxHealth`, `isGhost = false`, `ghostTimer = 0`, `pendingGhostEffect = false`.
- Add `takeDamage(amount: number, attacker?: Enemy): void` → `this.health -= amount`; if `health <= 0 && !isGhost` set `isGhost = true`, `pendingGhostEffect = true`. (Optional `attacker` param supports thorn reflection in Phase 5.)
- Add `restore(): void` → `isGhost = false`, `health = maxHealth`, `ghostTimer = 0`.
- Add `canModify(): boolean { return !this.isGhost; }` and have `TowerManager`/`GameEngine` check it before upgrade/sell/downgrade/specialize — surface a "ghosted" reason.
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
- After `towerManager.update(dt, ...)`, iterate `towerManager.towers`:
  - If `tower.pendingGhostEffect`: call `particleManager.spawn(tower.x, tower.y, tower.color, count, { life: GHOST_PARTICLE_DURATION, ... })`; `tower.pendingGhostEffect = false`; call `grid.setTowerGhost(tower.tileX, tower.tileY)` (stops blocking + recomputes path).
- In `onWaveStart(wave)`: restore all ghost towers → `tower.restore()` + `grid.clearTowerGhost(tower.tileX, tower.tileY)`. (Draft: "at the spawn of each enemy wave all ghost towers are restored".)
- Keep the `enemy.onPathBlocked` bounty branch as a safety net only (Phase 2/3 let enemies route through towers instead).

### `src/render/svg/TowerManager.ts`
- In the tower render proxy `sync`, read `tower.isGhost`; if true set `el.style.opacity = String(GHOST_OPACITY)`, else reset to `"1"`. (CSS/SVG opacity per draft — no new symbol needed.)

### `src/game/ParticleSystem.ts`
- Reuse existing `spawn(x, y, color, count, {life, size, speed})`. No change required; call with `tower.color` and a short life.

---

## Phase 2 — Path-Tile Placement + Dijkstra Weakest-Path Fallback

### `src/grid/Pathfinding.ts`
- `canPlaceWithoutBlocking(grid, spawns, base, towerXY, existingBlocked, cachedPathTiles?)`:
  - Build the `test` set from `existingBlocked` **minus `grid.ghostTowers`** (ghost towers don't block, so placing near/over them can't disconnect).
  - Keep the existing reverse-BFS reachability check against `test`.
- `bfsShortestPath`: unchanged for the "open" case.
- New `dijkstraWeakestPath(grid, start, goal, towerHealthAt)`:
  - Allows stepping onto **path/base/spawn** tiles *and* onto tower-blocked tiles (live towers), with edge weight = `towerHealthAt(neighborX, neighborY)` (remaining health of the tower on that tile, or a small constant for open tiles). Ghost tiles weight 0.
  - Returns the minimum-total-health path from spawn to base — the "go through the weakest towers" path.
- `Grid.recomputePaths()`:
  - For each spawn: compute BFS path first. If non-null, store it (open path).
  - If BFS is null (live towers fully block every open route), compute `dijkstraWeakestPath` and store it. Store a per-spawn flag `pathThroughTowers[i]` so `Enemy` knows it must attack towers en route.

### `src/grid/Grid.ts`
- Track `paths` plus parallel `pathUsesTowers: boolean[]` (or a marker on the path object). `getPathFor` returns the path; `enemy` checks the flag to decide attack-vs-walk behavior.
- `registerTower` / `unregisterTower`: recompute as today; ghost transitions call recompute (see Phase 1).

### `src/enemies/Enemy.ts`
- In `update()`, replace the current "if next tile blocked → recompute BFS and if null set `onPathBlocked`" logic:
  - Look up next tile. If the next tile has a **live** (non-ghost) tower on it (query via `towerManager.towerAt` or a new `grid.towerBlockingAt(x,y)`):
    - Do **not** advance `pathIdx`. Instead, mark `this.blockedByTower = tower` and trigger attack (Phase 3). Movement pauses; when that tower dies (becomes ghost), the tile opens, path recomputes, and the enemy advances.
  - If path-uses-towers flag is set and next tile is a ghost tower tile, treat as passable and advance normally.

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
- In `EnemyRenderProxy.sync`, add an attack-reaction branch mirroring the existing `hitReaction` branch: if `enemy.attackAnimTime > 0 && gameSeconds - attackAnimTime < attack.duration`, render `enemy-${type}-attack-f${idx}`; else fall back to walking frames. Priority vs hit: if in hit reaction show hit, else if attacking show attack.

### `src/render/themes/normalize.ts` & `index.ts`
- Extend `EnemyVisualMeta` type to include `attack?: MapThemeAnimation`. Ensure `normalizeThemeImages` and the theme getter pass `attack` through (follow the existing pattern used for `walking`/`hitReaction`).

---

## Phase 4 — Enemy-Enemy Collision & Lane Passing

- Reuse the existing spatial hash in `src/enemies/EnemyManager.ts` (`getEnemiesInRange`, `rebuildSpatialHash`/`updateSpatialHash`). Add a helper `getNearbyEnemies(x, y, radius)` (or reuse `getEnemiesInRange`) to find colliding enemies each frame.
- Add per-enemy lateral offset `laneOffset: number` (perpendicular to current movement direction).
- In `Enemy.update()`, after computing the forward step:
  - Query neighbors within `this.radius + other.radius` via spatial hash.
  - If overlapping: resolve by pushing apart laterally — **slower** enemy moves to the **right** side of the path, **faster** enemy to the **left** side (compare `this.speed` vs neighbor `speed`). Apply separation to `laneOffset`.
  - Clamp `laneOffset` so the occupied position stays within the current path tile bounds (so enemies "stack up against the tower" rather than leaving the path when blocked).
  - If an enemy is blocked from forward motion by collision AND is adjacent to a tower (touching its tile), set `blockedByTower` to that tower so it attacks (ties Phase 3 + 4 together).
- Apply `laneOffset` to the **actual** enemy `x/y` (and therefore `worldPos`), so collisions are resolved on the true engine location and the visual SVG `<use>` mirrors it exactly. Store `baseX/baseY` as the path centerline position and derive `x/y = baseX + perp*laneOffset` each frame; movement/collision logic operates on the real `x/y`, and the renderer reads `enemy.x/enemy.y` directly, so the visual always matches the simulation.

---

## Phase 5 — Two New High-Health Towers

### `src/game/ConstantsTower.ts`
- Add to `TowerIds`: `STURDY_WALL: "sturdyWall"`, `SHOTGUN_TANK: "shotgunTank"`.
- `TOWER_META`: sturdyWall cost (proposed 40), shotgunTank cost = `basic.cost * 1.5` = 30 (50% more than basic, per draft).
- `TOWER_BASE`:
  - sturdyWall: `range: 0` (no targeting/fire), `damage: 0`, `fireRate: 0`, `health: 200` (high; no damage).
  - shotgunTank: `range: 1`, `damage: 8` (like basic), `fireRate: 1.2`, `projSpeed: 14`, `health: basicHealth * 10` (≈ 250).
- New knockback constant: `SHOTGUN_KNOCKBASE = RAILGUN_KNOCKBASE * 1.5` (= 0.45). `SHOTGUN_KNOCK_SCALE` analogous to railgun.
- `TOWER_VARIANTS`:
  - sturdyWall A ("Thorn Wall"): reflects `attackDamage * [0.3, 0.6, 1.0]` at levels 5/6/7 back to the attacking enemy. Store `thornReflectPct` per tier.
  - sturdyWall B ("Electric Fence"): on enemy contact deals touch damage + short stun (stop motion + attacks). Add behavior flags `fenceDamage`, `fenceStun`.
  - shotgunTank A ("Reinforced"): increases tower `health` (e.g., ×1.5/×2/×3 per tier).
  - shotgunTank B ("Repulsor"): knockback like railgun A but using `SHOTGUN_KNOCKBASE` (50% stronger than railgun).

### `src/towers/SkillTree.ts`
- Add `VARIANT_INFO` and `ADDON_INFO` entries for `sturdyWall` and `shotgunTank` (the `for (const id of Object.values(TowerIds))` loop auto-builds `SKILL_TREE` entries). Provide addon descriptions consistent with existing style.
- Add any addon effect wiring in `TOWER_ADDON_EFFECTS` if needed (proposed: leave addons minimal or reuse patterns; fence/stun/thorn handled via variant flags).

### `src/towers/Tower.ts`
- Wire variant behaviors:
  - Thorn (sturdyWall A): when an enemy calls `tower.takeDamage(d, enemy)`, also `enemy.takeDamage(d * thornReflectPct)`. Use the optional `attacker` param added in Phase 1.
  - Electric fence (sturdyWall B): in `update()`, if not ghost, query `enemyManager.getEnemiesInRange(x, y, fenceRangePx)` and apply `enemy.takeDamage(fenceDamage)` + `enemy.applyStun(fenceStun)` (mirror frostAura/staticField pattern).
  - Shotgun Tank B knockback: in `fire()`, set projectile `knockback: true` and pass `SHOTGUN_KNOCKBASE`/`SHOTGUN_KNOCK_SCALE` (extend projectile opts or read tower type in `ProjectileManager`).
  - Shotgun Tank A +health: apply in `constructor`/variant application by scaling `maxHealth`/`health`.

### `src/render/themes/data/default-map-theme.json` (only — `the-aftermath.json` is out of scope)
- Add `sturdyWall` and `shotgunTank` tower entries with `name`, `color`, `icon`, `animation`, `walking` (frames) and generate `tower-sturdyWall-f0`, `tower-shotgunTank-f0` symbols via `useSvgStaticContent.ts`.
- `the-aftermath.json` is **out of scope** for the new tower sprites (leave existing behavior); only `default-map-theme.json` receives them.

### `src/components/GameShop.vue` / shop data
- Confirm shop iterates `TowerIds` (or an ordered tower list) so the two new towers appear for building. Verify no hard-coded 6-tower assumption (README says "up to 9" and `1`–`9` keys). Add `STURDY_WALL`/`SHOTGUN_TANK` to any ordered tower list used by shop/keyboard.

---

## Phase 6 — Tests, Lint, Typecheck

### New / extended tests
- `tests/unit/pathfinding.test.ts`: BFS blocked → Dijkstra fallback returns weakest path; ghost tiles excluded from blocking; `canPlaceWithoutBlocking` ignores ghost towers.
- `tests/unit/grid.test.ts`: `setTowerGhost`/`clearTowerGhost` move keys between `blocked`/`ghostTowers`; `canBuild` rejects ghost tiles.
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
3. **Lane offset**: applied to the actual engine `x/y` (and `worldPos`); collisions use the real engine location and the visual representation mirrors it exactly (see Phase 4).
4. **Bosses**: attack exactly like other enemies (same stun/slow rules) and use higher `attackDamage`/`attackSpeed`; any future tuning touches only the boss entry.
5. **New towers**: available to build immediately (no gem gate), with level 3–7 and variant unlocks gem-unlockable just like the existing six towers.

## Remaining open items (implementation-time only)
- Final tuning of health/attack/knockback numbers after play-testing.
- Exact thorn-reflect / fence-damage / fence-stun magnitudes per tier (proposed in Phase 5, adjust during balance pass).
