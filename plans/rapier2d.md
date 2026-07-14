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
- New `src/sim/featureFlags.ts` (flag home — no existing flag module):
  `export const RAPIER_PHYSICS = false;` Centralizes the gate so every caller
  imports one symbol; flipping the default lives in exactly one place. (Do **not**
  read it via env/dynamic import — a static const keeps the OFF path dead-code and
  tree-shakeable during migration.)
- New `src/sim/physics/rapierContext.ts`:
  `import RAPIER from "@dimforge/rapier2d-compat";`
  export `initPhysics(): Promise<void>` (cached `await RAPIER.init()`) and
  `getRapier()`. `getRapier()` **throws** if `initPhysics()` has not resolved —
  this is the contract that keeps the synchronous `GameEngine` constructor safe:
  `PhysicsWorld` is only constructed when `RAPIER_PHYSICS` is true, so the throw
  is unreachable in OFF mode and only guards ON-mode misuse.
- `src/sim/WorkerEntry.ts:241` (`init` handler): make the handler `async` and
  `await initPhysics()` before `new GameEngine(...)`. `GameEngine` constructor
  calls `getRapier()` — stays **synchronous**, so direct-construct tests stay
  green (their `beforeAll` awaits `initPhysics()`).
- `tests/setup.ts`: add a shared `beforeAll(await initPhysics())` so **every**
  direct-construct test path is safe at flip, not just the two named integration
  tests. This removes the "forgot to await init" footgun before the flag goes ON.

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
- **Corridor containment (promoted to a real sub-phase — see Phase 1.5).** Free
  rigid bodies pushed by the solver will drift off-corridor into terrain unless
  the corridor is walled. Represent the BFS path corridor as **static segment
  colliders** so Rapier owns separation *and* containment together. Do **not**
  write `translation` back every frame (that overwrites solver separation and
  causes pile jitter). The hard clamp is reduced to an **out-of-bounds-only**
  safety net (see Phase 2).
- `step()` = single `world.step()` per fixed step (called once in
  `GameEngine.update`, not per enemy).

## Phase 1.5 — Corridor containment geometry (highest-risk sub-project)

This is the largest piece of new code and must not be a single one-liner. On
every `grid.pathVersion` change, rebuild static wall colliders from the path:

- For each **path tile**, emit 4 axis-aligned thin wall segments along its edges,
  but **omit** any edge that faces another path tile or a base/spawn tile (those
  are interior to the walkable corridor and stay open). This yields a closed
  boundary around the walkable corridor.
- **Carve buildable non-path tiles:** a tower built on a non-path tile opens a gap
  in the corridor only if the path re-routes around it — the `pathVersion` bump
  already reflects the new BFS path, so rebuilding from the *current* path tiles
  automatically re-walls the new route and leaves the tower tile open. No special
  case needed beyond "rebuild from current path set."
- **Tower tiles that are part of the path** keep their wall gap *and* get a
  separate dynamic tower collider (Phase 1 towers bullet) so enemies pile against
  the tower rather than passing through.
- Wall segments are thin fixed cuboids (half-thickness ~`tileSize*0.05`) placed on
  the tile boundary; reuse a single `RAPIER.ColliderDesc.cuboid` per edge, batched
  into one rebuilding pass keyed by `grid.pathVersion`.
- **Re-validation test:** spawn a packed stream of enemies through a serpentine
  map; assert (a) no enemy's `x/y` ever leaves the union of path-tile bounds by
  more than `tileSize*0.6`, and (b) enemies still reach the base. This is the gate
  that proves containment works before Phase 3 deletion proceeds.

## Phase 2 — Split `Enemy.update` into intent + post-physics (flag OFF safe)

- `Enemy.computeIntent(dt, enemyManager)`: keep **all decision/data logic** — status
  timers (`:563`), heal aura, re-anchor (`:634`), base-contact/attack-target
  acquisition (`:652`–`:738`), path-end/hold/route handling (`:610`). **This is a
  branch, not a pure intent extractor** — it branches on `this.body === null`:
  - **OFF** (`body === null`): inline the *current* `centerX/centerY` integration
    exactly as `Enemy.update` does today (so OFF output is byte-identical; the
    characterization test locks this). No velocity is set.
  - **ON** (`body` set): instead of integrating `centerX/centerY`, compute a
    **desired velocity** toward the next waypoint / contact point / lateral open
    spot (the geometry helpers `nearestPointOnSegments` (`:887`),
    `computeExposedSpan` (`:1070`), `findLateralOpenSpot` (`:927`),
    `findLeastBlockedLateral` (`:1023`), `isBlockedAhead` (`:1439`),
    `contactFaceTangent` (`:1195`) stay — they select steering targets, not
    integrate) and call `body.setLinvel(desiredVel)`. Stun → zero velocity (`:605`).
- `Enemy.postPhysics(dt, enemyManager)`: **also branches on `this.body === null`**:
  - **OFF**: derive `x/y` from `centerX/centerY` exactly as today (no body read).
  - **ON**: read `body.translation()` → `x/y/centerX/centerY`; **out-of-bounds-only**
    clamp (world-bounds escape, never normal steering) keeps bodies from leaving
    the map — corridor containment is owned by static colliders (Phase 1.5), not
    this clamp; set `attackingBase`/`attackTarget`; run the **attack tick** (`:801`)
    and removal. `moveAngle` ← `atan2(linvel)` **with a low-speed guard**: if
    `|linvel| < epsilon`, keep the previous `moveAngle` (prevents sprite flicker
    when piled/stuck).
- **Attack acquisition re-validation (ON only).** Under physics the body center is
  pushed *away* from the tower/base by separation, so the existing
  `radius + ATTACK_CONTACT_EPSILON` test against `centerX/centerY` (`:719`/`:737`)
  can miss a piled enemy. Re-gate acquisition on the **Rapier contact pair** —
  use `world.contactPairsWith(enemyBody)` (or a generous `radius + contactSlack`
  that absorbs typical pile pushback) to set `attackTarget`/`attackingBase`. Add a
  unit test: a 5-enemy pile jammed against a tower still resolves `attackTarget`
  for the contacting enemy(s); a back-row enemy does not attack until it collapses
  forward (preserves the existing front-line layering at `:724`–`:738`).
- `GameEngine.update` (`GameEngine.ts:304`) orchestrates:
  `enemyManager.preStep` (computeIntent, set velocities) → `physicsWorld.step()` →
  `enemyManager.postStep` (read back, out-of-bounds clamp, attack, cull).

## Phase 3 — Delete custom integration

This phase executes **only at/after the flag flip**. It deletes the **OFF branch**
of `computeIntent`/`postPhysics` (the inlined `centerX/centerY` integration) and
the now-dead custom code: remove `resolveCollisions` (`:1492`), the `centerX/centerY`/
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
  blocks, base penetration prevented, corridor containment bounds) and
  `tests/integration/physics-motion.test.ts` (enemies reach base, piles form,
  hold/route/knockback behave). Keep the flag OFF so the existing enemy-motion
  assertions stay green during migration; flip default ON once the gate passes.
- **Position-exact unit tests are gated/skipped under ON (decided).**
  `tests/unit/sim/enemy-routing.test.ts`, `tests/unit/sim/enemies.test.ts`, and
  `tests/unit/sim/enemy-attack.test.ts` assert *exact* hand-integrated
  trajectories/positions. Under Rapier, separation/damping/contact produce
  *different* positions than closed-form path integration, so these assertions will
  not pass under physics. Wrap their position-exact `it`s in a shared
  `describeIfOff`/`itIfOff` helper (imports `RAPIER_PHYSICS` from
  `src/sim/featureFlags.ts`) so they run when the flag is OFF and are **skipped**
  when ON. These specs are retired (deleted) at the flag flip — the physics suite +
  behavioral integration tests become the source of truth. This resolves the earlier
  Phase-0/Phase-5 contradiction: the only tests required to pass *under physics* are
  the behavioral ones below.
- **Flip gate (decided)**: flip `RAPIER_PHYSICS` default ON only when (a) the new
  physics suite passes **and** (b) the behavioral integration tests
  `tests/integration/integration.test.ts` and `tests/integration/worker-roundtrip.test.ts`
  still pass under physics (these assert gold economy / victory / base-reached, not
  exact positions, so they survive the motion-model change). Also re-run
  `tests/integration/commander.test.ts` + `tests/unit/commanders/*` under the flag
  (commander outcomes may shift subtly). At flip, delete the gated position-exact
  specs and the OFF branch (Phase 3).
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
5. Behavioral integration suite (`integration.test.ts` + `worker-roundtrip.test.ts`
   + `commander.test.ts`) green under physics; position-exact unit specs
   (`enemy-routing`/`enemies`/`enemy-attack`) gated off and retired at flip.

## Files

New:
- `src/sim/featureFlags.ts` (the `RAPIER_PHYSICS` gate — single source of truth)
- `src/sim/physics/rapierContext.ts`
- `src/sim/physics/PhysicsWorld.ts` (incl. Phase 1.5 corridor wall rebuild)
- `tests/unit/sim/physics/physics-world.test.ts` (lifecycle, non-overlap ≤ 2r,
  tower blocks, base penetration prevented, **corridor containment bounds**)
- `tests/unit/sim/physics/enemy-update-split.test.ts` (characterization)
- `tests/integration/physics-motion.test.ts`
- Shared `describeIfOff`/`itIfOff` test helper (skips position-exact specs when
  `RAPIER_PHYSICS` is true)

Modify:
- `package.json` (add `@dimforge/rapier2d-compat`; no new dev plugins)
- `vite.config.ts` (no change — unchanged from original)
- `src/sim/WorkerEntry.ts:241` (async `init` awaiting `initPhysics()`)
- `src/sim/GameEngine.ts` (construct + own `PhysicsWorld`; orchestrate
  preStep/step/postStep; rebuild tower/base/corridor colliders on `pathVersion`
  change; remove dead bodies on dispose)
- `src/sim/enemies/Enemy.ts` (add `body: RAPIER.RigidBody | null`; split `update` →
  `computeIntent` + `postPhysics` **with OFF/ON branches**; delete `resolveCollisions`/
  manual integration and rework `applyEndOfFrameClamps`; rewrite `applyKnockback`;
  add `moveAngle` low-speed guard; re-gate attack acquisition on contact pair)
- `src/sim/enemies/EnemyManager.ts` (spawn/remove create/destroy physics bodies)
- `tests/setup.ts` (shared `beforeAll(await initPhysics())`)
- `tests/unit/sim/enemy-routing.test.ts`, `tests/unit/sim/enemies.test.ts`,
  `tests/unit/sim/enemy-attack.test.ts` (wrap position-exact `it`s in `itIfOff`;
  delete at flip)
- `src/sim/SnapshotSerializer.ts` (unchanged; ships `x/y`)

## Why this fits

The simulation already lives entirely in the worker (the right place for a WASM
physics step), the snapshot/command "spine" is untouched, and `GameEngine` already
owns all managers + a fixed-timestep — `PhysicsWorld` slots in exactly where
`Enemy.update` currently integrates, with the snapshot serializer and all render
managers needing **zero changes** (still just `x/y`). The compat build removes the
tooling fragility that the wasm-plugin route would have introduced across the
worker, jsdom tests, and direct construction.
