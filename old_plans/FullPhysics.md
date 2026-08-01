# Full Physics / Navmesh Enhancement Plan

Single cut: physics- and navmesh-authoritative motion, choke/siege first-class, commander on live nav data, force + projectile seams ready for future towers. No migration flags, no “preserve old path” branches. `git` is rollback.

---

## Design locks

| Decision | Choice |
|---|---|
| Choke / full path-block | **Legal.** Enemies siege blocking towers until ghost, then repath. |
| Migration | **None.** Implement the end state; delete leftover dual-path / flag comments as you touch files. |
| Commanders | Live navmesh is source of truth; brains consume precomputed nav fields, not raw grid BFS. |
| New tower types | **Out of scope**, but force/projectile APIs must make push/pull/ricochet towers a thin caller later. |
| Projectiles | Move to Rapier-backed bodies where travel exists; keep query casts for beams/instant. |

---

## Current state (baseline before this plan)

Both Rapier and Recast integrations are **live and complete** (`RECAST_NAV = true`, BFS pathfinding deleted).

| Layer | Owns | Key modules |
|---|---|---|
| **DetourCrowd** | Path follow, local avoidance, move targets | `CrowdManager`, `NavMeshBuilder` |
| **Rapier2d** | Hard collision (towers/base/corridor), proximity queries, projectile sweeps | `PhysicsWorld` |
| **Loop** | `preStep` → `crowd.update` → `setLinvel` → `physics.step` → `postStep` | `GameEngine.ts` |

**Already in use:** tiled navmesh + TileCache tower obstacles; corridor wall chamfers; enemy-enemy collisions off (Crowd owns separation); `castShape`/`castShapePierce` projectiles; range queries via `intersectionsWithShape`; commander hold/route via `requestMoveTarget`; knockback as dual teleport (agent + body); minimap corridor geometry.

**Deliberate design:** full choke is legal. `tower-obstacle.test.ts` documents that a 1-wide choke severs spawn→base; enemies contact-attack the blocking tower. Path-blocking placements are allowed (`GameEngine` comment at build site).

**Friction points this plan removes:**

- Every-frame agent `teleport` + raw `set_vel` wipe (`Enemy.postPhysics`) blocks lasting impulses/forces.
- `requestMoveTarget` every tick in `computeIntent`.
- Knockback is teleport, not impulse.
- Tower attack is incidental geometry, not first-class siege.
- Stubbs BFS-es `gridLayout` ignoring towers.
- No force-field or projectile-body seam for future towers.
- Auras use per-frame sphere queries only; base/tower attack uses geometric distance, not Rapier contacts.

---

## Architecture (end state)

### Ownership

```
computeIntent (gameplay flags, routing mode, siege target)
    ↓
CrowdManager.update  → desired velocity (path + avoidance)
    ↓
ForceFieldSystem.apply  → addForce / velocity bias on enemy bodies
    ↓
ballistic / stun / siege-park overrides
    ↓
PhysicsWorld.step(EventQueue)  → hard collision, projectile contacts, sensors
    ↓
postPhysics  → read body, contact-driven base/tower attack, agent resync if drift
```

| System | Owns |
|---|---|
| **DetourCrowd** | Path follow, local avoidance, move targets, agent corners |
| **Rapier** | Integration, tower/base/corridor hard stop, enemy mass response to impulses/forces, projectile motion + hits, aura sensors, contact events |
| **NavMeshBuilder** | Walkable mesh, TileCache tower obstacles, `findPath`, distance fields, corridor geometry |
| **Game rules** | HP, damage, gold, wave, siege acquisition, when to park vs repath |

Enemy–enemy: still Crowd avoidance (Rapier enemy–enemy off). Enemy–world + projectiles + forces: Rapier.

### Tick order (`GameEngine.update`)

1. Wave / countdown
2. On `pathVersion` change: `rebuildTowers` + `rebuildCorridor` + `navMeshBuilder.syncTowers` + **rebuild nav distance field + path metrics**
3. `enemyManager.preStep` (`computeIntent` only — no per-frame `requestMoveTarget` spam)
4. `crowdManager.update`
5. `forceFieldSystem.apply(dt)` (continuous fields)
6. Compose final linvel / park / ballistic
7. `physicsWorld.step(eventQueue)`
8. Drain contacts → base/tower attack flags, projectile hits
9. `enemyManager.postStep`
10. Projectile age/cull + non-body effects (lightning chain as queries)
11. `towerManager.update` (targeting, fire, aura logic may move to sensors)
12. Ghost resolution → `pathVersion++`

---

## 1. Motion core

### 1.1 Crowd → body without fighting forces

**Problem today:** every frame Crowd `setLinvel` then postStep `teleport`+raw `set_vel` wipes momentum. Impulses cannot stick.

**End model:**

- Crowd writes **desired** velocity only.
- `CrowdManager.update` does **not** call `setLinvel` when `enemy.ballisticTimer > 0` or `enemy.motionLock === "park"`.
- Final velocity each pre-step:

```text
if park (stun / attackingBase / hold-arrived / siege-contact):
  setLinvel(0)
else if ballisticTimer > 0:
  leave body linvel (optional damping); ballisticTimer -= dt
else:
  v = crowd.velocity()
  v += forceFieldSystem.sampleVelocityBias(enemy)   // optional soft bias
  setLinvel(v)
  // continuous forces also body.addForce(...) so step integrates them within the frame
```

- Agent resync: `teleport` **only if** `|body.translation − agent.position| > ε` (e.g. `0.25 * radius` after wall shove). Restore agent vel from body linvel when resyncing. Drop the every-frame teleport.

### 1.2 Per-type crowd profiles (`CrowdManager.addAgent`)

From `ENEMY_TYPES` (+ optional future fields):

| Type | radius | maxAccel factor | separationWeight | collisionQueryRange | notes |
|---|---|---|---|---|---|
| runner | small | high | low | tight | CCD on body |
| tank / boss | large | low | high | wide | shoulders less |
| minion / default | mid | mid | 1 | default | |
| (future breacher) | — | — | ~0 | — | walks into chokes |

Expose `CrowdAgentProfile` map next to enemy constants so new types are data-only.

### 1.3 Move-target caching

`computeIntent` sets routing mode/targets; **only** calls `requestMoveTarget` when target world point or mode changes (compare to `lastMoveTargetWorld` + mode). Clears cache on `pathVersion` / siege retarget / release.

### 1.4 Impulse knockback

Replace teleport knockback with:

```text
impulse = −moveAngle * amount * massScale(maxHp)
body.applyImpulse(impulse)
ballisticTimer = KNOCKBACK_BALLISTIC_SECONDS  // ~0.15–0.25s
// optional: clamp post-step position to walkable via navmesh nearest poly if off-mesh
```

Keep a walkable clamp fallback using `NavMeshQuery.findNearestPoly` if impulse launches into terrain.

### 1.5 CCD

`RigidBodyDesc.setCcdEnabled(true)` for enemies with `speed >= runner threshold` (and optionally all at high `timeScale`).

---

## 2. Choke + siege (first-class)

### 2.1 Routing modes

```text
routingMode: "default" | "hold" | "route" | "siege"
```

- **default:** move target = base center.
- **hold / route:** as today (cached targets).
- **siege:** move target = tower world center (or nearest path point on tower edge). On Rapier contact with that tower’s collider: park, attack on timer. On tower ghost/sell: `releaseToDefault()` and repath.

### 2.2 Automatic choke siege (no commander required)

When spawn→base `findPath` is empty for an enemy’s spawn (or agent has no progress / stuck against a tower collider for T seconds):

1. Pick lowest-HP live tower in contact (or blocking the last known corridor via contact).
2. Enter `siege` on that tower.
3. On ghost, default to base again.

This upgrades today’s incidental `findAdjacentLiveTowerInContact` into the normal choke loop. Commander siege is the same path with an explicit tower pick.

### 2.3 Contact-driven attack (base + tower)

- Tag colliders: user-data or handle maps for `base` | `tower:{id}` | `enemy:{id}` | `projectile:{id}` | `sensor:{auraId}`.
- `world.step(eventQueue)` with `ActiveEvents.COLLISION_EVENTS` (and intersection for sensors).
- Base attack: contact with base collider → `attackingBase`, park, damage tick.
- Tower attack: contact with live tower → `blockedByTower`, park if siege or path-severed; damage tick.
- Drop pure geometric `distanceToBaseSquare` for acquisition (keep as debug assert if useful).

### 2.4 Path metrics (player-facing)

On each `pathVersion` bump, per spawn:

```text
{ spawnIndex, pathLengthWorld, reachable: boolean, chokeTile?: {x,y} }
```

Ship in snapshot `meta` or `pathMetrics[]`. UI/minimap: open / long maze / severed (red). Placement preview: same query on tentative obstacle (add → update → findPath → remove → update) without committing build — **informational only**, never blocks place.

---

## 3. Force-field seam (no new towers yet)

New module `src/sim/physics/ForceFieldSystem.ts`:

```text
interface ForceField {
  id: string
  origin: { x, y }
  radius: number
  // positive radial = push outward; negative = pull; or use direction vector
  mode: "radial" | "directional"
  strength: number          // force units / sec (continuous)
  direction?: { x, y }      // for directional
  ownerId?: string          // tower id for cleanup
}
```

API:

- `addField` / `removeField` / `clearOwner(ownerId)`
- `apply(dt, enemies)` → for each enemy in range (Rapier query or field sensor): `body.addForce(...)`
- Optional `sampleVelocityBias` for soft steering blend

Wire points (callers later):

- Tower update / variant flags will register fields when push/pull towers exist.
- Knockback stays impulse on hit (not a field).
- Stun = park (zero vel), not a field.

**Mass:** set enemy collider density/mass from type so tanks resist push more than runners (`ColliderDesc.setDensity` or mass props in `addEnemy`).

---

## 4. Projectile physics

### 4.1 Split projectile kinds

| Kind | Implementation |
|---|---|
| **Traveling** (circle homing, fixed-aim, pierce, bounce) | Rapier body (kinematic velocity-driven or dynamic + zero gravity) + ball collider; enemy filter collision groups |
| **Instant / beam** (lightning, chain segments) | Keep query / `castShape` — no body |
| **Splash** | On hit: `queryEnemiesInRange` or short-lived sensor pulse |

### 4.2 Traveling projectile body lifecycle

- Spawn: create body at muzzle, `setLinvel` toward target (homing retargets each tick toward enemy body translation).
- Collision groups: projectiles hit enemies only (not walls/towers unless ricochet type later).
- Hit: contact event or `castShape` backup → existing `hitCircleProjectile` damage pipeline.
- Pierce: sensor-like (no solid resolve) + contact events, or solid with disabled enemy–projectile solver response + event.
- Bounce (existing bounce-shot): on hit, reflect velocity using contact normal **or** retarget next enemy; restitution on collider for true physics bounce later.
- Remove body on despawn (`removeProjectile`).

### 4.3 `ProjectileManager` changes

- Hold `physicsWorld` reference (or body handles on `ProjectileGame`).
- `update`: step is global — projectiles integrate in `physicsWorld.step`; manager reads translations, handles age/range/homing retarget, processes hit queue from PhysicsWorld.
- Snapshot still ships `x,y` from body translation — render unchanged.

### 4.4 Future-ready fields on projectile / tower stats

Already have knockback/splash; add optional:

- `restitution`, `isPhysicsBody`, `collidesWithWalls` (default false)
- So ricochet-off-corridor towers are data + one branch later.

---

## 5. Sensors for auras

Replace per-frame `forEachEnemyInRange` for frost/static/electric (optional keep heal aura as query for simplicity):

- Each aura tower: sensor ball collider, `setSensor(true)`, `ActiveEvents.INTERSECTION_EVENTS`.
- Intersection enter/exit → apply/refresh slow, fence damage tick membership set.
- Rebuild sensors in `rebuildTowers` (radius from stats).

Force fields can be the same sensors with a “on stay → addForce” path, sharing infrastructure.

---

## 6. Navmesh services (single source of truth)

### 6.1 `NavMeshBuilder` expansions

- **Persistent `NavMeshQuery`** (no per-call construct/destroy).
- **`buildDistanceField()`** after `syncTowers`: tile-resolution distance-to-base on walkable tiles **minus blocked tower tiles** (tower-aware). Unreachable = −1. This replaces Stubbs’ ignore-towers BFS.
- **`findPath` / `isReachable(start, goal)`** for path metrics (world polyline length when reachable).
- **`getAgentCorners(enemy)`** via `enemy.agent.corners()` for viz/ETA.
- **`nearestWalkableWorld(point)`** for knockback clamp.

### 6.2 Engine-facing facade

`GameEngine` or thin `NavServices`:

```text
getPathMetrics(): PathMetric[]
getDistanceToBase(tileX, tileY): number  // −1 unreachable
isSpawnReachable(spawnIndex): boolean
findPath(worldA, worldB): WorldPoint[]
```

Commanders never import Recast; they only see snapshot fields.

---

## 7. Commander client interfaces

### 7.1 Snapshot slice additions (`CommanderSnapshotSlice` / observation)

```text
// Nav truth, refreshed when pathVersion changes (relay can cache like gridLayout)
nav: {
  pathVersion: number
  // distance to base per path/spawn/base tile; −1 = unreachable (tower-blocked)
  // same dims as gridLayout
  distanceToBase: number[][]
  spawnReachable: boolean[]    // per spawn index
  // optional: corridor path polylines spawn→base when reachable (for viz/LLM)
  spawnPaths?: Array<Array<{x,y}>>  // tile waypoints
}
```

Enemy observation extras (from snapshot):

```text
routingMode, attackingBase, blockedByTowerTile?: {x,y},
distanceToBase,  // from nav field at enemy tile
nextCornerTile?: {x,y}  // from agent.corners()[0]
```

### 7.2 Commands

Keep `llm:routeGroup` / `llm:setTargeting`. Extend:

```text
// Explicit siege — waypoints optional; towerTile required
llm:siegeTower { enemyIds, towerTile: {x,y} }

// targetingMode values that engine honors:
// "base" | "nearestTower" | "strongestTowerAhead" | ...
```

`applyCommand`:

- `llm:siegeTower` → `enemy.applySiege(tower)`
- `llm:setTargeting` → engine may auto-pick siege target each intent from mode (Stubbs can stay waypoint-based or switch to siege)

### 7.3 Brain updates

**Stubbs:** delete local `computeDistancesToBase` over raw map. Use `observation.nav.distanceToBase`. “Ahead” = tower distance < enemy distance and tower distance >= 0. Waypoint = tower tile (siege) or nearest path neighbor. Prefer emitting `llm:siegeTower` so engine parks on contact.

**Stubby:** unchanged hold/rush logic; may use `spawnReachable` later.

**LLM schema:** document `nav` block + `llm:siegeTower`; validate in `schema.ts`.

### 7.4 Relay

Cache `nav` by `pathVersion` + `runId` (like `gridLayout`). When `pathVersion` changes, accept new nav from snapshot; if omitted mid-frame, keep cache.

Serializer: include `nav` when `pathVersion` changed or commander feed on (mirror corridor gating).

---

## 8. Debug

`DebugPanel` / snapshot debug channel:

- Navmesh corridor (exists) + obstacle boxes
- Agent corners polylines
- Rapier collider outlines (corridor, towers, enemy balls, projectiles)
- Path metrics text
- Force field radii

Implement as optional snapshot `debugPhysics` only when debug flag on (avoid production payload).

---

## 9. Cleanup

- Remove `RECAST_NAV` branches/comments; constant can die or stay `true` unused.
- TECHNICAL.md: pathfinding section → navmesh + physics; document force/projectile/siege.
- Retire geometric attack helpers once contacts proven.
- Tests: rewrite motion/knockback/commander around contacts, impulses, nav distances.

---

## Files (create / major edit)

**Create**

- `src/sim/physics/ForceFieldSystem.ts`
- `src/sim/physics/ColliderUserData.ts` (tagging + resolve maps)
- `src/sim/physics/ContactProcessor.ts` (event drain → hits/attacks/aura)
- `src/sim/navmesh/NavDistanceField.ts` (tower-aware tile distances + metrics)
- `tests/unit/sim/physics/force-field.test.ts`
- `tests/unit/sim/physics/projectile-body.test.ts`
- `tests/unit/sim/physics/contact-attack.test.ts`
- `tests/unit/sim/navmesh/nav-distance-field.test.ts`
- `tests/unit/commanders/stubbs-nav.test.ts`
- `tests/integration/siege-choke.test.ts`

**Major modify**

- `PhysicsWorld.ts` — EventQueue step, CCD, mass, projectile bodies, sensors, user-data maps, `applyImpulse` helper
- `CrowdManager.ts` — profiles, no blind setLinvel, park/ballistic respect
- `Enemy.ts` — siege mode, ballistic, impulse knockback, move-target cache, contact attack hooks, sparse agent resync
- `EnemyManager.ts` — wire contacts; spawn profiles
- `ProjectileManager.ts` — body lifecycle + hit queue
- `Tower.ts` / `TowerManager.ts` — aura sensors; future `registerForceField` hook point
- `NavMeshBuilder.ts` — persistent query; metrics helpers
- `GameEngine.ts` — tick order; pathVersion → nav field + metrics
- `SnapshotSerializer.ts` / `SimulationSnapshot.ts` — nav block, pathMetrics, enemy routing/siege fields, optional debug
- `Command.ts` / `applyCommand.ts` — `llm:siegeTower`
- `commanders/protocol.ts`, `observation.ts`, `stubbs/brain.ts`, `llm/schema.ts`, `relay.ts`
- `featureFlags.ts` — strip dead flag
- `TECHNICAL.md`

---

## Acceptance criteria

1. **Choke:** full block on 1-wide corridor → enemies contact-siege tower → tower ghosts → path opens → enemies reach base.
2. **Knockback:** impulse moves body; enemy does not snap-teleport; recovers steering after ballistic window; stays in corridor.
3. **Forces:** unit test registers radial push field → enemies accelerate outward; tanks move less than runners (mass). No tower type required.
4. **Projectiles:** traveling shots are bodies; hits match or beat current cast tests; pierce/homing/fixed-aim green; snapshot positions track bodies.
5. **Contacts:** base/tower damage only while contacting colliders; no geometric false positives off-contact.
6. **Crowd:** no per-frame teleport when unobstructed; runners pass tanks without two-solver jitter; profiles differ by type.
7. **Commander:** Stubbs uses `nav.distanceToBase` (tower-aware); routes/sieges a tower ahead; after maze change, re-routes from new field. Stubby hold/rush still works.
8. **Metrics:** after place/sell, `pathMetrics` / `spawnReachable` update; severed vs open distinguishable in tests.
9. **Suite:** `tsc --noEmit` clean; vitest green; new siege/force/projectile-body/nav-field/commander tests included.
10. **Render:** no required visual change except optional minimap path state; existing SVG/text keep reading `x/y`.

---

## Implementation order (build order, not migration phases)

Work bottoms-up so each layer is testable before the next depends on it:

1. **Physics foundation** — collider tags, EventQueue step, mass, CCD, impulse API, sparse agent resync, ballistic flag
2. **ForceFieldSystem** + tests (no towers)
3. **Contact attack + siege mode** + choke integration test
4. **Projectile bodies** + retarget existing projectile tests
5. **Aura sensors** (migrate frost/static/fence)
6. **Nav distance field + path metrics** + snapshot fields
7. **Commander protocol/observation/Stubbs/LLM schema** + relay cache
8. **Crowd profiles + move-target cache**
9. **Debug overlay + TECHNICAL.md + flag cleanup**

---

## Risks

| Risk | Mitigation |
|---|---|
| Crowd `setLinvel` vs `addForce` same frame | Forces via `addForce` during step; multi-frame forces re-applied each tick; knockback uses ballistic lock |
| Contact events miss thin CCD gaps | Keep `castShape` fallback for projectiles one release; enable enemy CCD |
| Siege forever on immortal edge case | Ghost timer already restores towers; if path severed and no contact, stuck-timer retargets nearest tower |
| Snapshot payload size (`distanceToBase` grid) | Int16/packed; send only on `pathVersion` change; relay caches |
| Perf: many projectile bodies | Pool bodies; cap active projectiles (existing caps) |

---

## Out of scope / non-goals

- Replacing Rapier or Recast (both fit; dual-WASM cost already paid).
- Returning to BFS tile paths for enemy motion.
- Forcing “never wall off the base” — choke + siege is the intended maze rule.
- New push/pull/ricochet **tower types** (APIs only).
- Renderer architecture changes — enhancements stay in sim + snapshot fields existing SVG/text consumers can opt into.
