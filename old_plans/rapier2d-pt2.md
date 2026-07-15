# Rapier2d Extensions (pt. 2) — Proximity Queries, Projectile Hits, Area Sensors

Goal: extend the already-merged Rapier2d physics world (`src/sim/physics/PhysicsWorld.ts`)
to own *enemy proximity queries* and *projectile↔enemy hit detection*, retiring the
now-redundant per-frame spatial hash and the manual projectile scan. No renderer,
snapshot, or command changes. This is a follow-up to `plans/rapier2d.md`; it reuses
that plan's foundations (the permanently-on `PhysicsWorld`).

## Reuse (already in place from rapier2d.md)

- `PhysicsWorld` (`src/sim/physics/PhysicsWorld.ts`): one `RAPIER.World`, gravity 0,
  `step()`, plus static tower/base/corridor colliders and dynamic enemy circle bodies.
- `enemy.body: RAPIER.RigidBody | null` back-reference on each `Enemy`. Physics is
  permanently ON — the `RAPIER_PHYSICS` flag and the previously disabled non-physics
  path were removed during the rapier2d merge — so there is **no OFF path to preserve**;
  every caller uses the physics implementation unconditionally.
- All new code routes through `PhysicsWorld` exactly like the existing
  `computeIntent`/`postPhysics` split (which already reads body translations).

### New shared seam
Add a `handle → Enemy` map in `PhysicsWorld`, keyed by `enemy.body.handle`, populated
in `addEnemy` / cleared in `removeEnemy`. This is the single bridge that lets any
Rapier query (proximity or raycast) resolve a returned collider back to an `Enemy`.

## Ordering constraint (verified against current `GameEngine.update`)

Today `projectileManager.update(dt)` runs at `GameEngine.ts:334`, *before*
`physicsWorld.step()` (`:342`); `towerManager.update` (`:367`) runs *after*
`enemyManager.postStep`. In ON mode the spatial hash is rebuilt at the end of
`postStep` (`EnemyManager.ts:240`), so pre-step `computeIntent` consumers
(`isBlockedAhead`, `findLateralOpenSpot`) already read **last-frame resolved**
positions — which is exactly what Rapier body translations hold at pre-step (the step
has not run yet this frame). Therefore:
- Tower / aura / path-relative queries (post-step consumers) need no move.
- `projectileManager.update` must move to **immediately after** `enemyManager.postStep`
  and before `towerManager.update`, so projectile hits use current (post-step)
  positions. This removes the old 1-frame projectile lag and is more accurate; it is
  the only ordering change in this plan.

## A. Unified proximity queries — retire `EnemyManager` spatial hash

- `PhysicsWorld.queryEnemiesInRange(x, y, range): Enemy[]` and
  `forEachEnemyInRange(x, y, range, cb)` implemented with
  `world.intersectionsWithShape(shapePos, shapeRot, shape, callback, filterFlags?, filterGroups?, filterExcludeCollider?, filterExcludeRigidBody?, filterPredicate?)`
  where `shapePos = { x, y }`, `shapeRot = 0` (Rapier2d rotation is a scalar, identity
  `0`; there is no `identityRotation` helper), `shape = new RAPIER.Ball(range)` (NOT
  `RAPIER.ColliderDesc.ball` — that builds a collider, not a query `Shape`), and
  `filterPredicate` restricts to enemy colliders (see Risk 3). Each returned collider's
  parent handle → `Enemy` via the handle map, then apply the same squared-distance
  filter as today (`EnemyManager.ts:324`/`:304`).
- Repoint all callers. Tower (`src/sim/towers/Tower.ts`): targeting at `:900`/`:936`,
  plus the four aura loops that use `forEachEnemyInRange` — `frostAura` (`:843`),
  `staticField` (`:850`), `iceBurst` (`:860`), `electricFence` (`:872`). Projectile
  manager (`src/sim/ProjectileManager.ts`): splash at `:590`, chain/stormcall at `:711`,
  fixed-aim scan at `:441`. Enemy (`src/sim/enemies/Enemy.ts`): `healAura` (`:597`) and
  the contact-probe loops inside `isBlockedAhead` / `findLateralOpenSpot` (`:911`,
  `:998`, `:1140`, `:1274`). The path-relative geometry helpers stay; only the
  proximity filter moves to Rapier.
- Delete `rebuildSpatialHash` / `updateSpatialHash` / `addToSpatialHash` /
  `removeFromSpatialHash` and the `spatialHash` field on `EnemyManager`, plus the
  `lastCellX` / `lastCellY` fields on `Enemy` (used only by the hash). Keep
  `getEnemiesInRange` / `forEachEnemyInRange` on `EnemyManager` as thin delegates
  to `PhysicsWorld` (the spatial hash is deleted entirely). This keeps the wide set of
  callers and the `EnemyManager` / `EnemyManagerRef` / `ProjectileManager.EnemyManager`
  interfaces unchanged, so the deletion is contained to the delegate swap.
- **Benefit:** one source of truth for enemy positions; removes the per-frame hash
  sync; eliminates the pile/pushback desync class the original plan's "attack
  acquisition re-validation" bullet had to special-case.

## B. Projectile↔enemy hits via Rapier swept-shape casts (continuous collision)

> Radius note: an enemy's effective hit shape is a circle of its body radius. A
> zero-radius point ray (`castRay`) would only strike enemies whose *center* lies
> exactly on the travel line and would miss every enemy within
> `projectile.radius + PROJECTILE_HIT_THRESHOLD` but off-axis — strictly worse than
> today's discrete `dist < projectile.radius + PROJECTILE_HIT_THRESHOLD` check. So all
> hits use `world.castShape` sweeping a **ball** of radius
> `projectile.radius + PROJECTILE_HIT_THRESHOLD` (this bakes in the enemy radius + the
> existing graze slack); the sweep covers the per-step travel distance
> (`moveDist + slack`). `castShape` is confirmed available
> (`@dimforge/rapier2d-compat` `world.d.ts:402`) and is broadphase-accelerated.

- Enemies are the only colliders a projectile cast may hit (see Risk 3). Projectiles
  never become bodies — they only sweep a shape.
- **Wiring:** `ProjectileManager` currently only holds an `EnemyManager` *interface*
  (defined locally at `ProjectileManager.ts:87`) and has no `PhysicsWorld` reference, so
  it cannot call `castShape` directly. Expose the casts as methods on `EnemyManager` that
  delegate to `PhysicsWorld` (which owns the handle→Enemy map + enemy predicate), add
  matching signatures to `ProjectileManager`'s `EnemyManager` interface, and have
  `GameEngine` wire `physicsWorld`/`EnemyManager` into `ProjectileManager` (mirror
  `setTowerLookup`, `ProjectileManager.ts:198`). `tests/unit/game-projectile-manager.test.ts`
  must extend its `MockEnemyManager` for the new signatures.
- **Homing** (`ProjectileManager.ts:412`): replace the per-step distance check with a
  swept-shape cast — `world.castShape(origin, 0, { x: (dirX/len)*(moveDist + slack), y: (dirY/len)*(moveDist + slack) }, new RAPIER.Ball(projectile.radius + PROJECTILE_HIT_THRESHOLD), 0, 1, true, undefined, undefined, undefined, undefined, enemyPredicate)`.
  (Rapier2d `castShape` signature: `castShape(shapePos, shapeRot, shapeVel, shape, targetDistance, maxToi, stopAtPenetration, filterFlags?, filterGroups?, filterExcludeCollider?, filterExcludeRigidBody?, filterPredicate?)`. Rotation is the scalar `0`; `shapeVel` is the direction scaled by the swept distance; query `Shape` is `new RAPIER.Ball(...)`, not `ColliderDesc.ball`. There is no `dirScaledBy` helper.) This hits **whichever enemy is encountered first** along the path: the locked target
  when nothing blocks it, or a closer enemy that has stepped into the line. That is the
  desired behavior (target the original enemy, strike whatever is hit first). Call
  `hitCircleProjectile` on the returned enemy. Continuous, so no tunneling past small/fast
  enemies.
- **Fixed-aim / pierce** (`:370`,`:441`): `castShape` returns the first enemy hit; for
  pierce re-cast from the SAME origin up to remaining range. `castShape` accepts only a
  single `filterExcludeCollider`, so a multi-hit pierce must accumulate a `Set` of hit
  colliders and reject them inside the `filterPredicate` (return `false` when the collider
  is in the excluded set) — otherwise a subsequent pass would re-hit an earlier enemy
  (verified bug). Closest-first ordering falls out of repeatedly taking the first hit.
  (Alternative considered: `intersectionsWithShape` + manual sort, or
  `intersectionsWithRay` at `world.d.ts:341`; the re-cast loop is simplest and already
  implemented.)
- **Continuous collision:** a swept ball instead of discrete position checks; the ball
  radius already encodes `projectile.radius + PROJECTILE_HIT_THRESHOLD` so grazes and
  off-axis enemies register — which a point ray would miss. This is the main win for the
  railgun (`projSpeed:60`, `fixedAim`).
- **Tradeoff:** N swept-shape casts/step — see Risk 2 for the perf gate and fallback.

## C. Area-effect sensors (subset of A — optional, low priority)

For persistent emanations (heal aura, slow/hazard fields) when they exist as standing
entities: attach a fixed **sensor** collider to the source and read
`world.intersectionPairsWith(sensor)` each frame instead of a distance loop. Otherwise
the A query path already covers these. Not started unless such fields are added.

## Out of scope / not recommended (exclusions)

- Projectile↔tower/wall blocking — enemies don't fire; would change established
  "fly-over" behavior (explicitly preserved by Risk 3).
- Joints / character-controllers for special enemies — none exist.
- Physics-driven particles — visual-only main-thread render pool; leave.

## Risks + mitigations / plans

### Risk 1 — Ordering change when moving `projectileManager.update` post-step
Moving the projectile update changes *when* projectile hits see enemy positions
(pre-step lag → post-step current). Must confirm no other system consumed pre-step
projectile state and that `ProjectileManager.update` has no step dependency.
**Mitigation / plan:**
1. Move `projectileManager.update(dt)` to right after `enemyManager.postStep(...)` and
   before `towerManager.update` (`GameEngine.ts:343`→`:367` band).
2. Confirm `ProjectileManager.update` only reads `enemy.x/y` and writes projectile/hit
   state + render-spawn requests (verified by read of `ProjectileManager.ts:360`-`441`);
   it has no pre-step dependency, so the move is safe.
  3. Confirm nothing between the old (`:334`) and new positions reads projectile state —
     `towerManager.update` fires projectiles (writes) but does not read existing
     projectile positions before the move; the only other readers are the snapshot
     serializer (runs after `update` regardless) and the render pool.
  4. Add a characterization test: a projectile fired at a just-stepped enemy hits using
     the post-step position. Update any old spec that asserted the pre-step lag to the
     new post-step behavior (physics is permanently ON, so there is no OFF variant to
     gate).

### Risk 2 — Swept-shape cast cost under huge waves
N projectiles × castShape at 60 Hz. `castShape` (swept ball) uses the broadphase
(~O(log n + k)), not O(N), but is marginally heavier than a point `castRay`; a wave of
hundreds of enemies/projectiles still warrants a guardrail.
**Mitigation / plan:**
1. Collision predicate limits candidates to enemy colliders only (Risk 3).
2. Cache the enemy predicate closure and reuse a single `ball(projectile.radius +
   PROJECTILE_HIT_THRESHOLD)` `Shape` plus a direction vector per step rather than
   allocating per cast. (`world.castShape` / `intersectionsWithShape` take the predicate
   directly as a `filterPredicate` argument — there is no separate reusable `QueryFilter`
   object to hold.)
3. Bound N via the existing projectile lifecycle cap (`MAX_PROJECTILE_AGE = 12`,
   `Constants.ts:98`) and wave scaling.
4. Add a perf guard test: spawn ~200 enemies + ~150 active projectiles, step the engine
   for 1 s, assert average step time stays under a budget measured from a baseline
   (instrument once; pick a conservative bound, e.g. well under the 16.6 ms frame).
5. **Fallback (only if the gate fails):** two-phase — pre-filter candidate enemies with
   the A-range query (cheap ball query), then precise `castShape` only among them.
   Documented; implement only if the guard test fails.

### Risk 3 — Filtering must preserve "projectiles fly over towers/walls/base"
If the raycast filter is wrong, a ray could "hit" a tower/wall/base collider and change
behavior. **Mitigation / plan:**
1. Projectiles never become bodies — they only cast rays.
2. Pass a `filterPredicate` argument
   `(collider) => collider.parent() !== null && enemyByHandle.has(collider.parent()!.handle)`
   derived from the same handle→Enemy map used by A. Walls/towers/base are absent from
   that map → predicate returns false → ignored. This predicate approach is more robust
   than a group bitmask and cannot accidentally collide a projectile with non-enemy
   geometry.
  3. Unit test: a swept cast through a tower returns no hit; a swept cast through an
    enemy returns it; a swept cast through wall+enemy returns only the enemy.
4. Enemy↔enemy and enemy↔tower/wall/base *solver* separation is independent of the query
   predicate (it uses the bodies' own collision groups), so it is unaffected.

### Risk 4 — Deleting the spatial hash breaks pre-step path-relative consumers
`isBlockedAhead` / `findLateralOpenSpot` run in `computeIntent` (pre-step) and currently
read the spatial hash rebuilt at the end of the previous `postStep` (last-frame resolved
positions). Rapier bodies at pre-step hold the *same* last-frame resolved positions (the
step has not run yet this frame), so semantics are preserved — but this must be verified
and the handle→Enemy map must be populated for all live enemies.
**Mitigation / plan:**
1. Route those callers through `PhysicsWorld.queryEnemiesInRange`.
  2. Retain `getEnemiesInRange` / `forEachEnemyInRange` as always-on delegates to
     `PhysicsWorld` so the swap is contained and the deletion risk is isolated to the
     delegate (callers + interfaces stay unchanged).
3. Add a test asserting `isBlockedAhead` / `findLateralOpenSpot` selection is
   identical between ON (Rapier) and OFF (hash) for a representative pile scenario.
4. The handle→Enemy map is guaranteed populated for all live enemies because `addEnemy`
   is the only spawn path (see Risk 5).

### Risk 5 — handle→Enemy map drift on spawn/despawn
If `addEnemy` / `removeEnemy` don't keep the map in sync, queries return dead enemies or
miss live ones — a correctness bug distinct from perf.
**Mitigation / plan:**
1. Centralize registration inside `PhysicsWorld.addEnemy` (insert `body.handle → enemy`)
   and `removeEnemy` (delete). Verify no other code path creates enemy bodies (only
   `EnemyManager.spawn` → `physicsWorld.addEnemy`).
2. Unit test: after spawn + kill, map size equals live enemy count and queries never
   return a removed enemy; a mid-pile spawn is immediately queryable.

### Risk 6 — Determinism (no action)
Rapier `castRay` / `intersectionsWithShape` are deterministic per-build with a fixed
timestep, consistent with the original plan's determinism note. The renderer consumes
positions only, so cross-version drift is acceptable. No mitigation required.

## Tests

- `tests/unit/sim/physics/proximity-query.test.ts`: `queryEnemiesInRange` matches the
  hash for a known layout; a pile returns only genuinely-in-range bodies; removed
  enemies never returned (Risk 5).
- `tests/unit/sim/physics/projectile-cast.test.ts`: fast projectile hits a thin enemy it
  would tunnel past under discrete checks (swept ball via `castShape`); pierce hits
  multiple along a line; a cast through a tower/wall returns no hit (Risk 3).
- `tests/unit/sim/physics/pre-step-queries.test.ts`: `isBlockedAhead` /
  `findLateralOpenSpot` selection matches the pre-migration (spatial-hash) result for a
  pile (Risk 4) — i.e. Rapier queries return the same blockers.
- `tests/perf/projectile-raycast-perf.test.ts`: ~200 enemies + ~150 projectiles stepped
  1 s under a time budget (Risk 2).
- Write direct behavior specs (no gate helper needed — physics is permanently ON).

## Files

New:
- `tests/unit/sim/physics/proximity-query.test.ts`
- `tests/unit/sim/physics/projectile-cast.test.ts`
- `tests/unit/sim/physics/pre-step-queries.test.ts`
- `tests/perf/projectile-raycast-perf.test.ts` (or fold into physics suite)

Modify:
- `src/sim/physics/PhysicsWorld.ts` (handle→Enemy map; `addEnemy`/`removeEnemy`
  registration; `queryEnemiesInRange` / `forEachEnemyInRange`; raycast helper)
- `src/sim/enemies/EnemyManager.ts` (delete spatial-hash methods + `lastCellX/Y` on
  `Enemy`; keep `getEnemiesInRange` / `forEachEnemyInRange` as always-on delegates to
  `PhysicsWorld`; add `castShapePierce` delegating to `PhysicsWorld`)
- `src/sim/towers/Tower.ts` (targeting + four aura callers → delegate, unchanged signatures)
- `src/sim/ProjectileManager.ts` (homing/fixed-aim/pierce → `EnemyManager` raycast
  delegates; add `PhysicsWorld`/`EnemyManager` wiring to constructor or a setter)
- `src/sim/GameEngine.ts` (wire `physicsWorld` into `ProjectileManager`; move
  `projectileManager.update` post-step)
- `tests/unit/game-projectile-manager.test.ts` (extend `MockEnemyManager` for the new
  `castShapePierce` signature)

## Acceptance criteria at flip

1. All `getEnemiesInRange` / `forEachEnemyInRange` callers behave correctly after the
   migration (proximity, splash, chain, the four tower auras, heal aura, blocked-ahead,
   lateral search) — positions resolved via Rapier with no spatial-hash sync.
2. Projectile homing/fixed-aim/pierce hits are correct with zero tunneling; projectiles
   still fly over towers/walls/base.
3. Spatial hash fully deleted; no per-frame hash sync remains.
4. Perf guard test passes under a heavy wave (Risk 2 budget met, or fallback applied).
5. Behavioral integration suite (`integration.test.ts` + `worker-roundtrip.test.ts`)
   green under physics.
