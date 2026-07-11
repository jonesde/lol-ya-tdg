# Motion Fix Attempts — Issue 2 & Issue 3

Detailed record of the change attempts for Issue 2 (`resolveCollisions`) and
Issue 3 (forward-clearance probe), and the regressions each produced.

**Investigation status:** All three attempted changes were reverted; the working
tree is back at the green baseline (`npx tsc --noEmit` clean, **1058/1058 tests
passing**). The regressions below were all observed against
`tests/unit/sim/enemy-perimeter.test.ts:74` ("Issue 2: enemies pile in the
arrival tile and overflow into neighbouring base-adjacent tiles, all outside the
square"), which asserts `expect(tiles.size).toBeGreaterThan(1)`.

A consistent signature: every change collapsed that pile to a **single tile** —
the scratch reproduction printed `SURVIVORS 12 attackingBase 12 TILES
[["5,12",12]]` (all 12 enemies in one base-adjacent tile) instead of overflowing
into neighbours.

---

## Change A — Issue 2: idempotent pair guard (remove double application)

**Location:** `resolveCollisions`, entry of the `forEachEnemyInRange` callback
that does the per-pair separation.

**Theory of operation:** The callback mutates **both** `this` and `other`
(lines ~1565–1582). Because `resolveCollisions` is invoked once per enemy inside
`update`, every unordered pair (A,B) is processed **twice** per frame — once with
`this=A`, once with `this=B`. My review flagged this as "double application →
~2× effective separation." The fix was to resolve each unordered pair exactly
once by letting only the lower-id enemy drive it.

**Code:**

Before:
```ts
enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.grid.tileSize, (other) => {
  if (other === this) return;
  ...
```
After:
```ts
enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.grid.tileSize, (other) => {
  // Resolve each unordered pair exactly once: skip any other whose id is not
  // greater than this one's. ...
  if (other.id <= this.id) return;
  ...
```

**Regression:** Applied alone (other changes reverted), the 12-enemy pile
collapsed to a single tile → `expected 1 to be greater than 1`. The "second
pass" of the current double application is **not** redundant for dense piles:
after the first pass many pairs are still overlapping, so the second pass
provides the extra separation iterations that actually spread the pile across
tiles. Removing it collapses the spread into one tile — i.e. it reintroduces the
exact single-file behaviour the plan exists to eliminate.

---

## Change B — Issue 2: inter-center normal orientation fix

**Location:** `resolveCollisions`, the `else if (dist > 1e-6)` branch that
computes the inter-center separation axis (used for path-following pairs and
cross-face contact-line pairs).

**Theory of operation:** `deltaX = bx - ax` points `this→other`. The sign logic
(`thisSign`/`otherSign`, ~lines 1550–1564) combined with the normal produces
**correct divergent** separation in the `tangent` branch (which orients its
normal `other→this`, lines ~1536–1542) but **convergent** separation in the
inter-center branch (which uses `this→other`). I confirmed this with a scratch
test of two overlapping path enemies (a at x=100, b at x=108, radii sum ≈10.44):

- **Original:** lane offsets `+1.22` / `-1.22` → rendered x 101.22 / 106.78 →
  **distance 5.56** (they moved *into* each other; overlap increased).
- **Flipped:** lane offsets `-1.22` / `+1.22` → rendered x 98.78 / 109.22 →
  **distance 10.44** (exactly sum of radii; correctly separated).

So flipping to `-deltaX/dist` makes the inter-center branch match the tangent
branch's `other→this` convention — a genuine correctness fix for the latent
convergence bug.

**Code:**

Before:
```ts
} else if (dist > 1e-6) {
  normalX = deltaX / dist;
  normalY = deltaY / dist;
}
```
After:
```ts
} else if (dist > 1e-6) {
  // Inter-center normal, oriented from the other enemy toward this one so it
  // matches the tangent branch's convention (which is already `other→this`). ...
  normalX = -deltaX / dist;
  normalY = -deltaY / dist;
}
```

**Regression:** Applied alone, the 12-enemy pile again collapsed to a single
tile (`tiles.size === 1`, scratch `TILES [["5,12",12]]`). The flipped normal
changes cross-face contact-line dynamics: enemies on different base faces use the
inter-center branch, and the previous (convergent) behaviour was incidentally
contributing to the multi-tile spread. Crucially, **this change is the only one
that is actually behaviourally correct** — its regression indicates the
preserved test encodes behaviour that depends on the buggy convergence. It
cannot be applied standalone without also updating that test.

---

## Change C — Issue 3: forward-clearance probe radius widen

**Location:** `findLateralOpenSpot`, the `probeRadius` used by the spatial-hash
query that evaluates each lateral candidate (both the on-line overlap check and
the back-row `checkForwardClearance` forward check).

**Theory of operation:** The forward-clearance check (active when
`checkForwardClearance === true`, i.e. a back-row enemy not yet on the contact
line) only sees blockers within `probeRadius` of the candidate. With
`radius*2 + tileSize`, a blocker sitting ~1.5+ tiles up the same lateral
corridor is outside the query and is missed, so a back enemy may treat a
partially-filled corridor as "clear" and slide into it. Widening lets it detect
a blocker a couple tiles ahead. I tried two variants:

Global widen:
```ts
const probeRadius = this.radius * 2 + tileSize * 2;   // was: + tileSize
```

Targeted widen (only the back-row branch, to leave the on-line pile search
untouched):
```ts
const queryRadius = checkForwardClearance ? probeRadius + tileSize : probeRadius;
enemyManager.forEachEnemyInRange(candidateX, candidateY, queryRadius, (other) => { ... });
```

**Regression:** **Both** the global widen and the targeted back-row-only widen
collapsed the 12-enemy pile to a single tile (`tiles.size === 1`, scratch
`TILES [["5,12",12]]`). Even restricting the wider radius to back-row
forward-clearance queries disturbed the pile enough to prevent the multi-tile
overflow.

---

## Summary

| Change | Target | Behaviour | Regresses enemy-perimeter:74? |
|---|---|---|---|
| A. Idempotent pair guard | `resolveCollisions` entry | Removes 2nd separation pass → pile collapses | **Yes** (single tile) |
| B. Inter-center normal flip | `resolveCollisions` inter-center axis | Fixes real convergence bug (verified) | **Yes** (single tile) |
| C. Probe-radius widen (global + back-row) | `findLateralOpenSpot` query | Detects deeper-column blockers | **Yes** (single tile) |

**Bottom line:** Every change I attempted disturbs the delicate
collision/lateral-search balance that currently produces the multi-tile spread,
and all three regress the preserved `enemy-perimeter.test.ts:74` assertion.
Notably:
- Change A removes spreading force that the pile actually depends on.
- Change B is the *correct* fix for a real bug, but the preserved test relies on
  the buggy behaviour — so it can only land alongside a test update.
- Change C is the lowest-impact in principle but still collapses the pile even
  when scoped to back-row only.

The current code (all reverted) is green and exhibits the intended multi-tile
spread, so no change is currently applied. Next step is your call: keep as-is,
or update `enemy-perimeter.test.ts:74` (e.g. set `baseTarget` to drive the real
in-game path, per the plan's §4.1 philosophy) so a properly-scoped fix — most
naturally Change B — can land without regression.
