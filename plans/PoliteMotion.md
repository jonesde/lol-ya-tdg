# Polite Motion: Line-Target Steering with Lateral Redirect

Status: Implementation plan. Captures the root cause of the single-file pile regression
(base and tower), the design for a unified line-target steering model that fixes it,
and the concrete code changes needed. Code references use `file:line` format.

---

## 1. Problem Statement

Enemies pile against the base (and against path-blocking towers) in a single-file column
instead of spreading across the full width of the exposed face. This is the "single-file
conga line" regression.

### Root Cause

The per-frame movement decision is **reactive, not preventive**. The order of operations
in `Enemy.update()` (`src/sim/enemies/Enemy.ts:764-879`) is:

1. **Movement branch executes** (walk at `:785`, approach at `:860`, or hold at `:832`):
   the enemy steps forward **unconditionally** — the walk branch moves toward `nextTile`
   without checking whether another enemy is already in the way.
2. **Collision resolves after** (`:879`, `resolveCollisions`): overlapping pairs are found
   and shoved apart by `overlap/2` each (symmetric, `:1159`).
3. **Keep-out projection** (`:927`): if the front enemy was shoved into the base square,
   it is yanked back to the edge.

Every frame: the back enemy steps forward into the front enemy → collision shoves the
front enemy sideways → keep-out yanks it back. The front enemy is battered by the back
enemy's forward press. The front enemy never gets to hold still; the back enemy never
redirects around the pile. The result is a single-file column — the forward press funnels
everyone into one spot and collision only separates overlapping pairs (it does not spread
them across available width).

### Why Prior Fixes Failed

- **Tangential slide to "own edge point"** (`:851`): `const along = (edge.x - edge.x) * tangentX + (edge.y - edge.y) * tangentY` — a hardcoded zero. The hold branch does nothing; the 2D pile is left entirely to collision, which only separates overlapping pairs and does not spread them.
- **`baseEdgeFillTarget` in the move branch** (`:808-831`, `attackingBase && !attackTarget`): In-game, `baseTarget` is always set (`GameEngine.ts:238`), so once an enemy contacts the base square, `attackTarget = this.baseTarget` (`:737`) and the enemy enters the **hold branch** (`:832`), not the move branch. The fill logic was placed in a branch in-game enemies never execute.
- **Tile-based detour** (`chooseDetourTile`, `:1092`): Coarse, tile-granular, and gated behind `BLOCKED_TIME = 0.15s` of sustained stall. It picks a discrete adjacent tile, not a continuous open point along the edge. It does not produce a smooth lateral fill.
- **Base dock assignment** (`baseSlot`, `:227`): Routes enemies to discrete dock tiles. Funneled everyone to shared points rather than filling continuously.

The common failure: all approaches treated the **target as a point** (dock tile, nearest
edge point, least-occupied candidate) and relied on collision to sort out the 2D layout.
The target should be a **line** — the base edge or tower perimeter — and the enemy should
hold on it, not press into it.

---

## 2. Design: Line-Target Steering

### Core Idea

An enemy attacking the base or a tower wants to reach a **line** (the contact perimeter),
not a point. The goal is to be *on* the line, in contact with the target. Once on the
line, the enemy **holds** — it stops moving. A blocked enemy (another enemy ahead toward
the objective) does not press forward into the blocker; it **redirects laterally** along
the line to find open space.

This gives the desired pile shape as emergent properties:

- **Width-first fill**: each enemy fills the nearest lateral opening before stacking
  behind, because forward is blocked until an opening appears. The first enemy reaches
  the line and holds; the second is blocked forward, slides laterally to the next open
  spot; the third same. No slot assignment needed.
- **First-come-first-serve**: natural — the first enemy to reach the line holds its
  spot; later arrivals go around it.
- **Size-agnostic**: "is this spot open?" is a radius-based overlap check against nearby
  enemies. Works for any mix of enemy sizes (minion 0.29 tiles, runner 0.19, tank 0.49,
  shielded 0.32, boss 0.67). No slot grid, no diameter computation.
- **No pushing**: the front enemy holds because the back enemy stops pressing forward
  when blocked — it redirects lateral instead. Collision overlap drops to near-zero
  because the back enemy never steps into the front enemy in the first place.

### Unified Contact Line

The same mechanism applies to both base and tower attacks:

| | Base | Tower |
|---|---|---|
| Objective | Base center (`grid.getBase()`) | Tower tile center (`grid.tileToWorld(tx, ty)`) |
| Contact distance | `distanceToBaseSquare(...) <= radius` (square geometry) | `tileSize/2 + radius` (tile is a square, same square-distance function) |
| Contact line | `getBaseEdgeSegments()` — axis-aligned 1-tile segments offset by `radius` | Tower tile perimeter offset by `radius` (4 sides, skip terrain-blocked faces) |
| Forward direction | Inward, toward base center | Toward tower center |
| Tangent direction | Along the edge segment | Perpendicular to the radial (angular tangent around the tile) |
| Blocked-ahead check | Enemy between self and base, within touching distance | Enemy between self and tower, within touching distance |

The base uses its existing square-geometry helpers (`getBaseEdgeSegments`,
`baseSquareContact`, `distanceToBaseSquare`). The tower reuses `baseSquareContact` with
`half = tileSize/2` — the tower tile is a 1x1 square, so the same square-distance and
contact-point math applies directly.

### Lateral Redirect Algorithm

When an enemy is blocked forward (another enemy between it and the objective, within
touching distance) OR is already on the contact line, it searches for open space along
the tangent:

```
findLateralOpenSpot(enemyManager, contactPoint, tangentX, tangentY):
  # Start at the enemy's current position projected onto the contact line
  # Probe left and right along the tangent at increments of ~radius
  # At each probe point, query the spatial hash for enemies that would overlap
  # Return the first point where no enemy overlaps
  # If nothing found in the initial range, widen the search and iterate

  probeStep = this.radius * 1.5          # spacing between probe points
  initialReach = this.radius * 3        # search ±this far before widening
  maxReach = tileSize * 3               # hard cap on lateral search range

  for reach in [initialReach, initialReach * 2, maxReach]:
    for offset in [-reach, +reach, ... incrementing by probeStep from center outward]:
      candidate = contactPoint + tangent * offset
      # Clamp candidate to the exposed segment span (base) or valid tile face (tower)
      # so the enemy doesn't drift around a corner into terrain
      candidate = clampToExposedSpan(candidate)
      if no enemy overlaps (candidate, myRadius + theirRadius):
        return candidate
  return null  # no open spot found — hold position
```

The search is **centered on the enemy's current position** (not on a global "least
occupied" point), so it naturally fills the nearest gap first. The widening iterations
are cheap: 2-3 spatial-hash queries per probe point, and most enemies find a spot in the
first iteration. Only a fully-packed line triggers the wider search.

### Polite Yielding

When the contact line is fully packed (no lateral open spot found), higher-priority
enemies (boss, shielded) should be able to reach the line by having lower-priority
enemies yield their spots. This is implemented via **priority-weighted collision
separation** rather than explicit messaging:

In `resolveCollisions` (`:1136`), the current separation is symmetric:
```
separation = (overlap / 2) * COLLISION_STIFFNESS
thisSign = ±1, otherSign = ∓1  (based on speed/id)
```

Change: when both enemies are `attackingBase` (or both are near the same tower contact
line), weight the separation by priority. The higher-priority enemy takes less of the
separation; the lower-priority enemy takes more:

```
priorityWeight = 0.5 + 0.5 * (priorityDelta / maxPriorityDelta)   # clamped to [0, 1]
thisSeparation = overlap * priorityWeight
otherSeparation = overlap * (1 - priorityWeight)
```

Where `priority` is derived from `attackDamage` (boss=20, shielded/tank=10,
minion/healer=3, runner=2). The maximum delta is ~18 (boss vs runner), so a boss
overlapping a minion gets ~95% of the separation pushed onto the minion. The minion
slides aside; the boss takes its spot. This is "polite" — the lower-priority enemy
yields without being shoved through the base square (the keep-out projection at `:927`
still prevents that).

This only kicks in for enemies near the contact line (both `attackingBase` or both
blocked near a tower). For path-following enemies not yet at a contact line, the
existing symmetric separation is preserved so the lane-offset visual spread is unchanged.

---

## 3. Code Changes

All changes are in `src/sim/enemies/Enemy.ts` unless noted. The EnemyManager and Grid
interfaces need minor additions.

### 3.1 New Grid helper: `getTowerEdgeSegments` (Grid.ts)

The base already has `getBaseEdgeSegments()`. Add a parallel method for a tower tile:

```
getTowerEdgeSegments(tileX, tileY): Array<{ x1, y1, x2, y2 }>
```

Returns the 1-tile axis-aligned segments for each of the tower tile's 4 sides whose
outward-adjacent tile is traversable (in bounds, not terrain). Same logic as
`getBaseEdgeSegments` (`Grid.ts:332-368`) but for a single tile with `half = tileSize/2`
instead of `1.5 * tileSize`. Add to `GridRef` interface in `Enemy.ts:107-123`.

### 3.2 Generalize `isBlockedAhead` to take an objective (Enemy.ts)

Currently `isBlockedAhead` (`:1046`) always uses `this.objectiveCenter()` (base center).
Generalize to accept an objective point so it works for tower blocking too:

```
private isBlockedAhead(enemyManager, objectiveX, objectiveY): boolean
```

The heading vector and dot-product check (`:1063`) use the passed objective instead of
`this.objectiveCenter()`. The existing base-path callers pass `this.objectiveCenter()`
unchanged. The tower-approach path passes the tower center.

### 3.3 New method: `findLateralOpenSpot` (Enemy.ts)

The continuous-space lateral search described in section 2. Replaces the role of
`baseEdgeFillTarget` for the contact-line case. Signature:

```
private findLateralOpenSpot(
  enemyManager: EnemyManagerRef | null,
  contactX: number, contactY: number,    # nearest point on the contact line
  tangentX: number, tangentY: number,     # along the line
  minT: number, maxT: number,             # exposed span bounds (tangent coords about objective)
  objectiveX: number, objectiveY: number,  # for clamping
  normalX: number, normalY: number,        # outward normal (for clamping to the face)
  half: number,                            # half-extent of the square (1.5*tileSize for base, 0.5*tileSize for tower)
): { x: number; y: number } | null
```

Probes left/right along the tangent at `radius * 1.5` spacing, checks each candidate
against the spatial hash (`forEachEnemyInRange`) for overlapping enemies. Widens the
search if nothing is found in the initial reach. Clamps candidates to the exposed span
so enemies don't drift around corners into terrain. Returns the first open point, or
null if the line is packed.

This replaces `baseEdgeFillTarget` (`:958-1018`) and `countEnemiesNear` (`:1022-1033`)
with a cleaner, widening search. Remove both. Remove the FILL_ constants (`:75-79`).

### 3.4 New method: `contactLineSteer` (Enemy.ts)

The unified steering logic for the contact-line situation. Called from both the base
and tower movement branches. Signature:

```
private contactLineSteer(
  enemyManager: EnemyManagerRef | null,
  objectiveX: number, objectiveY: number,
  half: number,                            # square half-extent
  segments: Array<{ x1, y1, x2, y2 }>,     # exposed edge segments
  dt: number,
): void
```

Logic:
1. Find the enemy's nearest contact point on the segments (`getBaseEdgeNearestPoint` for
   base, or equivalent for tower).
2. Compute the outward normal and tangent at that point (same as existing `:843-847`).
3. Check if blocked ahead (toward objective) using the generalized `isBlockedAhead`.
4. Check if already on the contact line (distance to square <= radius).
5. Decision:
   - **Not on line, not blocked**: step forward toward the contact point (existing
     forward-press behavior, but toward the *line*, not the center).
   - **Blocked ahead OR on the line**: call `findLateralOpenSpot`. If a spot is found,
     slide tangentially toward it (pure tangential move preserves distance to the
     square, so the enemy stays in contact). If no spot found, hold (no movement).
6. Set `this.moveAngle` to the movement direction (or leave it unchanged if holding).

### 3.5 Rewire movement branches (Enemy.ts:764-874)

Replace the current branch structure:

**Current:**
```
if (detourTile) → move to detour tile
else if (walk path && !attackTarget) → walk toward nextTile
else if (attackingBase && !attackTarget) → baseEdgeFillTarget (move branch — dead in-game)
else if (attackingBase && attackTarget === baseTarget) → hold (zero slide — does nothing)
else if (approach tower && !attackTarget) → approach tower center
```

**New:**
```
if (detourTile) → move to detour tile                        # unchanged
else if (walk path && !attackTarget && !attackingBase) → walk toward nextTile  # unchanged for path-following
else if (attackingBase) → contactLineSteer(base center, 1.5*tileSize, getBaseEdgeSegments(), dt)
else if (approach tower && this.blockedByTower) → contactLineSteer(tower center, 0.5*tileSize, getTowerEdgeSegments(towerTile), dt)
else if (approach tower && !attackTarget) → approach tower center  # unchanged for unobstructed approach
```

Key changes:
- The `attackingBase` case is unified into one `contactLineSteer` call regardless of
  whether `attackTarget` is set (base or null). This eliminates the dead-branch problem:
  the hold branch and the move branch are now the same call, and `contactLineSteer`
  internally decides forward-press vs lateral-redirect vs hold based on blocked state
  and contact distance.
- The tower-approach case with `this.blockedByTower` set (enemy in contact with tower
  tile but another enemy ahead) enters `contactLineSteer` for the tower. When
  unobstructed, the existing approach-center behavior is preserved.
- Path-following enemies (`walk path && !attackTarget && !attackingBase`) are unchanged —
  they still follow the path normally. The detour tile logic for path-blocked enemies
  is also unchanged.

### 3.6 Priority-weighted collision separation (Enemy.ts:1136-1210)

In `resolveCollisions`, when both enemies are `attackingBase` (or both are near a tower,
detected via both having `this.blockedByTower === other.blockedByTower` with the same
tower), weight the separation by priority instead of the symmetric 50/50 split.

Add a `priority` getter or field to Enemy:
```
private get priority(): number { return this.attackDamage; }
```

In the separation computation (`:1159`), when both enemies are at a contact line:
```
const bothAtLine = thisAttacks && otherAttacks;  // or both blocked by same tower
if (bothAtLine) {
  const totalPriority = this.priority + other.priority;
  const thisFraction = other.priority / totalPriority;  // higher priority → smaller fraction
  const otherFraction = this.priority / totalPriority;
  thisSeparation = overlap * thisFraction * COLLISION_STIFFNESS;
  otherSeparation = overlap * otherFraction * COLLISION_STIFFNESS;
} else {
  // existing symmetric split
  thisSeparation = (overlap / 2) * COLLISION_STIFFNESS;
  otherSeparation = (overlap / 2) * COLLISION_STIFFNESS;
}
```

The `thisSign`/`otherSign` direction logic (`:1177-1189`) stays the same — it determines
*which direction* each enemy moves. The priority weighting changes *how far* each moves.
A boss (priority 20) overlapping a minion (priority 3): minion takes 20/23 ≈ 87% of the
separation, boss takes 3/23 ≈ 13%. The minion slides aside; the boss barely moves.

### 3.7 Cleanup

Remove:
- `baseEdgeFillTarget` (`:958-1018`) — replaced by `findLateralOpenSpot`.
- `countEnemiesNear` (`:1022-1033`) — folded into `findLateralOpenSpot`.
- `FILL_DENSITY_WEIGHT`, `FILL_LOCALITY_WEIGHT`, `FILL_SAMPLE_STEP`, `FILL_SAMPLE_REACH`,
  `FILL_DENSITY_RADIUS_FACTOR` (`:75-79`).
- The zero-slide hold branch code (`:832-859`) — replaced by `contactLineSteer`.
- The `baseEdgeFillTarget` call in the move branch (`:808-831`) — replaced by
  `contactLineSteer`.

Keep:
- `objectiveCenter` (`:1037`) — still used by `isBlockedAhead` for the base path and by
  `updateBlockedState`.
- `updateBlockedState` (`:1075`) and `chooseDetourTile` (`:1092`) — still used for
  path-following enemies (not yet at a contact line). These are the tile-based detour
  for mid-path obstacles, which is a different problem from contact-line fill.
- `resolveCollisions` (`:1136`) — modified, not replaced.
- The existing `COLLISION_STIFFNESS` and `COLLISION_ITERATIONS` constants (`:65-66`).

---

## 4. Test Changes

### 4.1 Fix the false-positive fill test (enemy-perimeter.test.ts:111)

The "fill" test (`tests/unit/sim/enemy-perimeter.test.ts:111`) currently uses
`makeManager()` which sets no `baseTarget`, so enemies traverse the move branch (the dead
path). Fix: set a `baseTarget` before spawning, mirroring the "front line damages the base"
test (`:153`):

```typescript
const { grid, enemyManager } = makeManager();
const baseTarget = new StubBaseTarget();
enemyManager.baseTarget = baseTarget;
const count = 18;
const enemies: Enemy[] = [];
for (let i = 0; i < count; i++) {
  const enemy = enemyManager.spawn("minion", 1, 0, 1);
  enemies.push(enemy!);
}
// ... existing update loop and lateral-spread assertions ...
```

This makes the test drive the hold branch (the real in-game path). The existing assertions
(`lateralPositions.size > 1`) remain valid.

### 4.2 New test: tower pile spreads laterally

Add a test to `tests/unit/enemy-attack.test.ts` that spawns multiple enemies approaching
the same tower-tile and verifies they spread across the tower's exposed face instead of
stacking in a single file. Mirror the base fill test's assertion structure: project front
enemies onto the tower-tile tangent, assert `lateralPositions.size > 1`.

### 4.3 New test: priority-weighted yielding

Add a test that spawns a boss and several minions at the base. Verify that the boss ends
up on the contact line and the minions are pushed to the sides (not the other way around).
Assert: the boss's distance to the base square is <= its radius (it's on the line), and
at least one minion has a larger lateral offset than the boss.

### 4.4 New test: lateral redirect finds open space

Add a test with a row of minions holding on the base edge, then spawn one more. Verify
the new arrival redirects laterally to an open spot rather than stacking directly behind
the first enemy in the column. Assert: the new arrival's lateral position differs from
the front enemy's lateral position.

### 4.5 Preserve existing tests

All 1046 existing tests must remain green. The key behavioral invariants the existing
tests check:
- Enemies never enter the base square (`enemy-perimeter.test.ts:34`, `:74`).
- Two enemies pile in the same arrival tile (`:57`) — this test asserts same-tile
  piling, which the new design satisfies (lateral fill within the tile before
  overflowing).
- Front line damages the base (`:153`) — with `baseTarget` set, the hold branch now
  runs `contactLineSteer` which keeps the enemy in contact.
- Collision separation direction (`enemy-attack.test.ts:214`) — the symmetric
  separation for non-contact-line enemies is unchanged.
- Stun pauses attack (`enemy-attack.test.ts:97`) — stun early-returns before movement
  branches, unchanged.

---

## 5. Verification Checklist

1. `npx tsc --noEmit` — clean (strict mode, no `noUnusedLocals`).
2. `npx vitest run tests/unit/sim/enemy-perimeter.test.ts` — the fill test now runs
   through the hold branch; assert lateral spread > 1.
3. `npx vitest run tests/unit/enemy-attack.test.ts` — all existing tests green; new
   tower-spread and priority-yielding tests pass.
4. `npx vitest run` — full suite green (baseline: 1046 passing).
5. Manual (acceptance criteria):
   - **Level 2** (1-tile-wide entry, terrain both sides): pile should be a multi-abreast
     slab, many deep — not a single-file conga line. The front line fills the 1-tile
     edge width (3-abreast for minions at 0.29 radius), then stacks behind.
   - **Level 1** (2-tile-wide entry): enemies spread evenly across both tiles to fill
     the exposed edge, not bunch at the arrival point.
   - **Tower block**: enemies attacking a path-blocking tower spread around its
     perimeter instead of stacking in one column.
   - **Boss arrival**: a boss reaching a packed base edge should push through to the
     contact line; minions slide aside. No jitter/oscillation.

---

## 6. Tuning Knobs

If the fill still looks uneven after implementation:

- **Lateral probe step** (`radius * 1.5`): smaller = finer-grained spot search (more
  probes, slightly more cost). Larger = coarser but cheaper.
- **Initial reach** (`radius * 3`): how far an enemy searches before widening. Larger =
  enemies wander farther along the face to fill. Smaller = more conservative, stacks
  behind sooner.
- **Max reach** (`tileSize * 3`): hard cap on lateral search. If the edge is wider than
  this, enemies won't fill past it.
- **Priority weight formula**: the `0.5 + 0.5 * (delta / maxDelta)` clamp can be
  adjusted. A steeper curve (e.g. `0.2 + 0.8 * (delta / maxDelta)`) makes priority
  dominance stronger — bosses push harder, minions yield more.

---

## 7. Why This Is Better Than The Alternatives

| Property | Sampling (prior plan) | Slot reservation | Line-target + lateral redirect (this plan) |
|---|---|---|---|
| Full-width fill | Probabilistic (tuning-dependent) | Structural but rigid | Emergent (local density search) |
| FCFS order | None (later arrivals can steal slots) | Enforced by assignment | Natural (first to reach line holds; later go around) |
| Enemy size mix | Ignores size | Breaks (fixed slots) | Handles naturally (radius-based probes) |
| Pushing | Still happens (walk branch presses) | Reduced (slot target) | Eliminated (yield before overlap) |
| Tower + base unified | No (base-only) | Possible but complex | Yes (same `contactLineSteer`) |
| Polite yielding | Not addressed | Not addressed | Priority-weighted collision |
| Complexity | 5 tuning constants + sampling loop | Slot manager + reassignment | 3 tuning knobs + 1 search method |
| Per-frame cost | O(n × candidates × neighbors) | O(n) + O(n) reassignment on death | O(n × probes) — most enemies find spot in 1st iteration |

# ADDENDUM FOR CURRENT

What matches the plan
- Core design: line-target steering, contactLineSteer, lateral redirect, priority-weighted collision — all implemented as designed.
- §3.1: getTowerEdgeSegments — done (plus the shared getSquareEdgeSegments refactor).
- §3.2: isBlockedAhead generalized — done.
- §3.5: Movement branches rewired — done (detour → walk → attackingBase → approach tower).
- §3.6: Priority-weighted collision — done (with tower contact extension beyond the plan).
- §3.7: Cleanup of baseEdgeFillTarget, countEnemiesNear, FILL_ constants — done.
- §4.1-4.4: All four test changes — done (1049 passing).
What diverged
Area	Plan	Implementation	Why
findLateralOpenSpot signature	8 params (contactX/Y, tangent, minT/maxT, objective, normal, half)	10 params — added objectiveX/Y and checkForwardClearance	Back-row enemies need a different "open" check (forward path clear, not overlap-free). Plan didn't anticipate this.
isBlockedAhead blocking check	"within touching distance" (total distance)	Lateral distance check + priority exception	Plan's "within touching distance" meant total distance, which let back enemies walk into blockers before redirecting. Changed to lateral-only so the back enemy redirects before overlap. Added priority exception so bosses press through minions.
findLeastBlockedLateral	Not in plan	Added as fallback when line is packed	Plan said "hold position (no movement)" when findLateralOpenSpot returns null. This caused the T-formation — back enemies held in a single column. Added least-blocked fallback so they align with gaps.
On-line hold check	Not in plan	Added overlap check before lateral search for on-line enemies	Plan had on-line enemies search laterally every frame, causing oscillation/bunching. Added early-return if not overlapping anyone.
Span clamping	clampToExposedSpan	computeExposedSpan with face-filtering (normal match) + spanPad	Plan didn't specify face filtering; without it enemies drifted onto terrain (5-wide on 1-tile corridor).
Probe depth	"probe at contact point"	On-line probes at contact; back-row probes at enemy's own depth	Plan probed at the contact line for everyone. Back enemies found it packed (front row is there) and held in a column. Changed to probe at the enemy's actual depth.
resolveCollisions centerline/laneOffset	thisAttacks for position space	thisUsesCenter = attackingBase || blockedByTower !== null	Plan only moved centerline for attackingBase. Tower attackers steered centerline but collided in laneOffset — jitter. Extended to tower contact.
Walk branch guard	!attackingBase (plan §3.5 line 264)	Reverted to !attackTarget	Plan's !attackingBase broke route-mode enemies that set attackingBase but still need to walk after releaseToDefault().
Priority formula	0.5 + 0.5 * (delta / maxDelta)	other.attackDamage / totalPriority clamped to [PRIORITY_YIELD_MIN, PRIORITY_YIELD_MAX]	Simpler and uses actual values rather than a normalized delta. Functionally equivalent.
Tuning knobs	initialReach, maxReach as separate widening iterations	Single expanding sweep, no initialReach	Simplified; the 3-iteration reaches were redundant (re-scanned smaller offsets).
Bottom line
The architecture matches — contactLineSteer, findLateralOpenSpot, priority-weighted collision, unified base/tower steering. The divergences are all bug fixes from manual testing that the plan didn't anticipate: face-filtering for span clamping, probe-at-own-depth for back-row enemies, forward-clearance checks, least-blocked fallback, and the centerline/laneOffset unification for tower attackers. The core design is sound; the details needed iteration.
