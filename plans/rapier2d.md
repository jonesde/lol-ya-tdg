# Rapier2d Integration Plan — Full Physics Motion

Goal: replace the custom hand-integrated enemy motion + spatial-hash collision
resolution with a Rapier2d (`@dimforge/rapier2d-compat`) physics world running
inside the existing simulation Web Worker, used as a WASM module. Enemies become
dynamic rigid bodies driven by velocity; Rapier owns integration, enemy-enemy,
enemy-tower, and enemy-base separation. The snapshot/command spine, renderer, and
Pinia stores are untouched — they only consume `enemy.x/y` as before.

## Current state (findings — verified against current code)

- **Motion is fully custom and authoritative in the worker.** `WorkerEntry.ts`
  runs a `setTimeout` fixed-timestep loop calling `engine.update(FIXED_DT)`.
  `Enemy.update(dt, enemyManager)` (`src/sim/enemies/Enemy.ts:558`) hand-integrates
  position: it advances a `centerX/centerY` centerline along the grid path, applies
  a turn-invariant `laneOffset` (world-space `laneOffsetX/Y`) for visual spread,
  runs custom `contactLineSteer` (base/tower pile behavior `:1235`), and resolves
  overlaps itself via `resolveCollisions` (`:1492`, spatial-hash + manual
  separation writing to `centerX/centerY`/`laneOffsetX/Y`), then derives `x/y`.
- **Tower/base blocking is geometric, not physical** — `distanceToBaseSquare`
  (`:1732`), `getTowerEdgeSegments`, `findAdjacentLiveTowerInContact` (`:1646`).
  `attackingBase`/`blockedByTower`/`attackTarget` are gameplay flags set by
  distance checks, not collisions.
- **The spatial hash** (`EnemyManager.ts:37`) is also used for *gameplay queries*
  (heal aura, `isBlockedAhead`, lateral open-spot search) — only its *resolution*
  half should be replaced by Rapier.
- **Renderer is decoupled**: `SnapshotSerializer.snapshotEnemy` ships `x/y`
  (`src/sim/SnapshotSerializer.ts:133`); render managers never touch the engine, so
  swapping the motion source doesn't touch rendering.
- **Tests construct `GameEngine` directly** (not via the worker), and
  `worker-roundtrip.test.ts` mocks `self` and imports `WorkerEntry` directly. Both
  paths must be able to `await RAPIER.init()`. Vitest runs in the **jsdom**
  environment (`vitest.config.ts`).
- **Tower build/sell bumps `grid.pathVersion`**: `Grid.ts:138` (`build` →
  `recomputePathsForTile`) and `Grid.ts:159` (`sell` → `recomputePaths`). This is
  the sound trigger for rebuilding tower colliders.

## Approach

Full physics motion (decided scope): enemies are dynamic bodies driven by velocity
toward waypoints/towers/base; most of `Enemy.update`'s position logic is deleted
and re-expressed as physics constraints. Migration is gated behind a `RAPIER_PHYSICS`
flag (default OFF) so the ~1000 existing enemy-motion assertions stay green until
the physics suite passes.

**Decided tradeoffs (review 2026-07-14):**
- **Build/tooling**: use `@dimforge/rapier2d-compat` (wasm inlined as base64,
  instantiates via `WebAssembly.instantiate`). No `vite-plugin-wasm`, no
  `vite-plugin-top-level-await`. Works under the ES-format worker, Vitest jsdom,
  and direct `GameEngine` construction with zero plugin changes.
- **Flip gate**: flip `RAPIER_PHYSICS` default ON only when (a) the new physics
  suite passes **and** (b) the existing `tests/integration/integration.test.ts` and
  `tests/integration/worker-roundtrip.test.ts` still pass under physics.

## Phase 0 — Tooling & async init seam

- `package.json`: add `@dimforge/rapier2d-compat` only. **No** `vite-plugin-wasm`,
  **no** `vite-plugin-top-level-await` (compat build needs neither).
- `vite.config.ts`: **unchanged** (no plugins added).
- New `src/sim/physics/rapierContext.ts`:
  `import RAPIER from "@dimforge/rapier2d-compat";`
  export `initPhysics(): Promise<void>` (cached `await RAPIER.init()`) and
  `getRapier()`.
- `src/sim/WorkerEntry.ts:241` (`init` handler): make the handler `async` and
  `await initPhysics()` before `new GameEngine(...)`. `GameEngine` constructor
  calls `getRapier()` — stays **synchronous**, so direct-construct tests stay
  green (their `beforeAll` awaits `initPhysics()`).

## Phase 1 — `PhysicsWorld` wrapper (`src/sim/physics/PhysicsWorld.ts`)

Owns one `RAPIER.World` (`gravity (0,0)`, `timestep = FIXED_DT`), plus
`id ↔ RigidBodyHandle` maps.

- **Enemies**: dynamic circle bodies, `lockRotations()`, `setLinearDamping` high,
  restitution 0. `EnemyManager.spawn` (`src/sim/enemies/EnemyManager.ts:77`) creates
  a body+collider (radius `enemy.radius`) and assigns it to a new field
  `enemy.body: RAPIER.RigidBody | null` (null-safe when flag OFF). `removeDeadEnemy`
  (`:117`) removes them.
- **Base**: one fixed cuboid collider, half-extent `1.5*tileSize`, centered at base
  center.
- **Towers**: fixed cuboid colliders (half-extent `tileSize/2`) rebuilt whenever
  `grid.pathVersion` changes (verified: `Grid.ts:138`/`:159` both bump it). Ghost/sell
  = drop collider. Wire into `GameEngine` alongside the existing `pathVersion`
  handling.
- **Corridor containment**: represent the path corridor / path-tile bounds as
  **static colliders** (or static wall segments) so Rapier owns separation *and*
  containment together. Do **not** write `translation` back every frame (that
  overwrites solver separation and causes pile jitter). The hard clamp is reduced to
  an **out-of-bounds-only** safety net (see Phase 2).
- `step()` = single `world.step()` per fixed step (called once in
  `GameEngine.update`, not per enemy).

## Phase 2 — Split `Enemy.update` into intent + post-physics (flag OFF safe)

- `Enemy.computeIntent(dt, enemyManager)`: keep **all decision/data logic** — status
  timers (`:563`), heal aura, re-anchor (`:634`), base-contact/attack-target
  acquisition (`:652`–`:738`), path-end/hold/route handling (`:610`). Instead of
  integrating `centerX/centerY`, compute a **desired velocity** toward the next
  waypoint / contact point / lateral open spot (the geometry helpers
  `nearestPointOnSegments` (`:887`), `computeExposedSpan` (`:1070`),
  `findLateralOpenSpot` (`:927`), `findLeastBlockedLateral` (`:1023`),
  `isBlockedAhead` (`:1439`), `contactFaceTangent` (`:1195`) stay — they select
  steering targets, not integrate) and call `body.setLinvel(desiredVel)`.
  Stun → zero velocity (`:605`).
- `Enemy.postPhysics(dt, enemyManager)`: read `body.translation()` →
  `x/y/centerX/centerY`; **out-of-bounds-only** clamp (world-bounds escape, never
  normal steering) keeps bodies from leaving the map — corridor containment is owned
  by static colliders, not this clamp; set `attackingBase`/`attackTarget` via the
  existing distance checks; run the **attack tick** (`:801`) and removal.
  `moveAngle` ← `atan2(linvel)` **with a low-speed guard**: if `|linvel| < epsilon`,
  keep the previous `moveAngle` (prevents sprite flicker when piled/stuck).
- `GameEngine.update` (`GameEngine.ts:304`) orchestrates:
  `enemyManager.preStep` (computeIntent, set velocities) → `physicsWorld.step()` →
  `enemyManager.postStep` (read back, out-of-bounds clamp, attack, cull).

## Phase 3 — Delete custom integration

With the flag ON: remove `resolveCollisions` (`:1492`), the `centerX/centerY`/
`laneOffsetX/Y` manual integration. **Rework** `applyEndOfFrameClamps` (`:819`) — its
corner turn-smoothing (perpendicular offset) and final `x/y` derivation are fully
superseded by `postPhysics`; it is not "half-deleted," it is removed. Drop the
`laneOffsetX/Y` fields (renderer doesn't use them). The existing spatial hash is
retained for gameplay *queries* (heal, blocked-ahead, lateral search).

## Phase 4 — Special motions on physics

- **Knockback** (`applyKnockback` `:347`): path-clamped `body.setTranslation` + zero
  velocity (deterministic, stays on corridor).
- **Hold** (`routingMode:"hold"`): velocity = 0. **Route**: velocity toward custom
  waypoints; revert-to-default on base reach (unchanged logic, velocity-driven).

## Phase 5 — Determinism, tests, flip default

- **Characterization test (critical)**: `tests/unit/sim/physics/enemy-update-split.test.ts`
  locks that `computeIntent`+`postPhysics` with flag OFF / `body === null` reproduces
  current `Enemy.update` output exactly — guards the Phase 2 split before any deletion.
- Add `tests/unit/sim/physics/` (world lifecycle, enemy-enemy non-overlap ≤ 2r, tower
  blocks, base penetration prevented) and `tests/integration/physics-motion.test.ts`
  (enemies reach base, piles form, hold/route/knockback behave). Keep the flag OFF so
  the existing enemy-motion assertions stay green during migration; flip default ON
  once the gate passes.
- **Flip gate (decided)**: flip `RAPIER_PHYSICS` default ON only when (a) the new
  physics suite passes **and** (b) `tests/integration/integration.test.ts` and
  `tests/integration/worker-roundtrip.test.ts` still pass under physics. Also re-run
  `tests/integration/commander.test.ts` + `tests/unit/commanders/*` under the flag
  (commander outcomes may shift subtly).
- Determinism risk: Rapier is deterministic per-build with fixed timestep but not
  cross-version/platform guaranteed — acceptable here since the renderer only
  consumes positions and the commander/relay consume the snapshot (already lossy).

## Acceptance criteria at flip

1. Enemies still traverse the path and reach the base.
2. Enemy-enemy, enemy-tower, enemy-base separation holds with no tunneling (bodies
   never penetrate tower/base colliders).
3. Piles form at towers/base without jitter/overlap (no per-frame translation
   overwrite).
4. Hold / route / knockback behaviors preserved.
5. `integration.test.ts` + `worker-roundtrip.test.ts` + `commander.test.ts` green
   under physics.

## Files

New:
- `src/sim/physics/rapierContext.ts`
- `src/sim/physics/PhysicsWorld.ts`
- `tests/unit/sim/physics/physics-world.test.ts`
- `tests/unit/sim/physics/enemy-update-split.test.ts` (characterization)
- `tests/integration/physics-motion.test.ts`

Modify:
- `package.json` (add `@dimforge/rapier2d-compat`; no new dev plugins)
- `vite.config.ts` (no change — unchanged from original)
- `src/sim/WorkerEntry.ts:241` (async `init` awaiting `initPhysics()`)
- `src/sim/GameEngine.ts` (construct + own `PhysicsWorld`; orchestrate
  preStep/step/postStep; rebuild tower/base colliders on `pathVersion` change; remove
  dead bodies on dispose)
- `src/sim/enemies/Enemy.ts` (add `body: RAPIER.RigidBody | null`; split `update` →
  `computeIntent` + `postPhysics`; delete `resolveCollisions`/manual integration and
  rework `applyEndOfFrameClamps`; rewrite `applyKnockback`; add `moveAngle`
  low-speed guard)
- `src/sim/enemies/EnemyManager.ts` (spawn/remove create/destroy physics bodies)
- `src/sim/SnapshotSerializer.ts` (unchanged; ships `x/y`)

## Why this fits

The simulation already lives entirely in the worker (the right place for a WASM
physics step), the snapshot/command "spine" is untouched, and `GameEngine` already
owns all managers + a fixed-timestep — `PhysicsWorld` slots in exactly where
`Enemy.update` currently integrates, with the snapshot serializer and all render
managers needing **zero changes** (still just `x/y`). The compat build removes the
tooling fragility that the wasm-plugin route would have introduced across the
worker, jsdom tests, and direct construction.
