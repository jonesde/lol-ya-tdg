# Motion Fix Attempts — Issue 2 & Issue 3

Detailed record of the change attempts for Issue 2 (`resolveCollisions`) and
Issue 3 (forward-clearance probe), and the regressions each produced.

- **Issue 2** — enemies pile in a single arrival tile and should overflow into
  the neighbouring base-adjacent tiles (outside the base square), producing a
  multi-tile spread (asserted by `tests/unit/sim/enemy-perimeter.test.ts:74`).
- **Issue 3** — back-row enemies (not yet on the contact line) slide into
  partially-filled lateral corridors because the forward-clearance `probeRadius`
  misses blockers a couple of tiles up the same corridor
  (`src/sim/enemies/Enemy.ts:961`).

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
(lines 1530–1547). Because `resolveCollisions` is invoked once per enemy inside
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
(`thisSign`/`otherSign`, lines 1515–1529) combined with the normal produces
**correct divergent** separation in the `tangent` branch (which orients its
normal `other→this`, lines 1498–1507) but **convergent** separation in the
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

| Change | Target | Behaviour | Regresses enemy-perimeter:74? | Verdict |
|---|---|---|---|---|
| A. Idempotent pair guard | `resolveCollisions` entry | Removes 2nd separation pass → pile collapses | **Yes** (single tile) | Code smell, not a fix — leave as-is; if the redundancy is judged worth removing, raise `COLLISION_ITERATIONS` instead of re-introducing an id-asymmetric guard |
| B. Inter-center normal flip | `resolveCollisions` inter-center axis | Fixes real convergence bug (verified) | **Yes** (single tile) | **The only genuine correctness fix** — land it alongside the `enemy-perimeter.test.ts:74` update below |
| C. Probe-radius widen (global + back-row) | `findLateralOpenSpot` query | Detects deeper-column blockers | **Yes** (single tile) | Weakest of the three — defer until a forward-clearance success metric is re-derived |

**Bottom line:** The three regressions share the same symptom (the pile
collapses to a single tile) but differ sharply in merit, so they must not be
treated as equivalent:

- Change A removes spreading force the pile actually depends on — but that force
  is the *accidental* double application of collision, not the designed lateral
  fill. It is a code smell to neutralize later (by raising `COLLISION_ITERATIONS`)
  rather than a fix; do not apply as written.
- Change B is the *correct* fix for a real latent convergence bug (verified
  against the code), but the preserved test relies on that buggy behaviour, so it
  can only land alongside the `enemy-perimeter.test.ts:74` update below.
- Change C is the lowest-impact in principle yet still collapses the pile even
  when scoped to back-row only; defer it until a forward-clearance success
  metric is re-derived.

The current code (all reverted) is green and the 12-enemy pile does spread across
multiple tiles — but that spread is propped up by the very bugs A/B/C disturb
(the double application and the inter-center convergence), not solely by the
designed lateral fill. It is therefore the wrong baseline to defend once the
real in-game path (`baseTarget` set) is exercised.

**Recommended next step:** update `enemy-perimeter.test.ts:74` to set
`enemyManager.baseTarget = new StubBaseTarget()` before the spawn loop (so it
drives the real hold branch instead of the dead move branch) and then apply
Change B. The concrete sequence and acceptance gate are in **Proposed path
forward (concrete)** below.

---

## Review & Proposed Path Forward

Third-party review of the three attempts above: the verdict first, then a
per-change re-evaluation (the three regressions are **not** equally valid and
must not be lumped together), and the concrete sequence to land a fix.

### Verdict

The record is a solid forensic account and its central conclusion is correct:
the preserved `enemy-perimeter.test.ts:74` currently encodes behaviour that
depends on the **latent bugs** that Changes A/B/C disturb, so it must be
updated before any fix lands. But the three changes differ in merit:

- **Change B is the only genuine correctness fix.** Land it *with* the test
  update.
- **Change A is a code smell, not a fix.** Neutralize the redundancy a
  different way; do not apply as written.
- **Change C is a weak enhancement that needs re-scoping.** Defer it.

### Per-change re-evaluation

**Change A — idempotent pair guard: correct diagnosis, wrong fix direction.**
- The double-application claim is mechanically accurate. `resolveCollisions`
  (`src/sim/enemies/Enemy.ts:1426`) is invoked once per enemy from `update`
  (`src/sim/enemies/Enemy.ts:829`), and `forEachEnemyInRange` is centred on
  `this`, so each unordered pair (A,B) is processed twice per
  `COLLISION_ITERATIONS` pass. The `other.id <= this.id` guard would reduce it
  to once.
- Why it collapses to a single tile: reading the sign logic
  (`src/sim/enemies/Enemy.ts:1515-1529`) confirms the two passes apply
  *consistent* magnitudes per enemy, so dropping one pass halves the total
  separation — exactly the observed single-tile collapse.
- **Wrong lever.** The double application is an accidental iteration doubling —
  each pair is separated twice per `COLLISION_ITERATIONS` pass with consistent
  magnitudes — not an intended spreading mechanism. To remove the doubling
  cleanly, raise `COLLISION_ITERATIONS` and keep single application rather than
  reintroducing an id-asymmetric guard. More importantly, the collapse shows the
  spread is propped up by *accidental collision iteration*, not by the designed
  lateral-fill (`findLateralOpenSpot`). That is itself evidence the line-74 test
  is a false positive. **Recommendation: leave A alone; do not apply as written.**

**Change B — inter-center normal flip: genuine bug, fix is correct.**
- The sign analysis was re-verified against the code. The tangent branch
  (`src/sim/enemies/Enemy.ts:1498-1507`) orients its normal to `other→this`
  (it flips `t` until `(this-other)·t ≥ 0`). The inter-center branch
  (`src/sim/enemies/Enemy.ts:1508-1510`) uses raw `deltaX/dist` =
  `this→other` — the *opposite* orientation. With the shared `thisSign/otherSign`
  logic, the tangent branch diverges and the inter-center branch **converges**.
  Flipping to `-deltaX/dist` makes the two branches consistent, matching the
  scratch-test numbers in Change B above. This is a real correctness fix.
- Caveat on scope: for path-following enemies the inter-center separation is
  applied to `laneOffset` only (`src/sim/enemies/Enemy.ts:1536-1537`), not
  `centerX/Y`, so that case is a *visual* overlap bug. The gameplay-relevant
  effect is different-face base/tower attackers being pulled together. So B is
  worth landing — **but only alongside the test update**, per the original
  conclusion.
- **Untested risk (must be closed before landing B):** Change B was only
  validated against the *buggy move-branch* line-74 test. The spread in the
  *hold* branch must be re-confirmed (see gate below); if the current
  hold-branch spread quietly relies on the buggy convergence, landing B could
  collapse it too.

**Change C — probe-radius widen: weakest, defer.**
- Conceptually the lowest-impact, yet it collapsed the pile even when scoped to
  the back-row-only branch. The original write-up never establishes a clear
  success metric for "back enemy avoids a partially-filled corridor," so there
  is no principled way to judge the widen as right vs. merely disturbing the
  balance. The regression suggests the forward-clearance scoring
  (`src/sim/enemies/Enemy.ts:1008-1012`) is more sensitive than the radius
  alone. **Recommendation: defer C**; revisit only after re-deriving what
  back-row forward-clearance should actually gate on.

### Proposed path forward (concrete)

1. **Update `enemy-perimeter.test.ts:74`** to set `enemyManager.baseTarget =
   new StubBaseTarget()` before the spawn loop, keeping the `tiles.size > 1`
   assertion. This drives the real hold branch (the in-game path) instead of the
   dead move branch, eliminating the false positive.
2. **Apply Change B** — flip the inter-center normal to `-deltaX / dist` /
   `-deltaY / dist` at `src/sim/enemies/Enemy.ts:1508-1510`.
3. **Run the hold-branch gate:** `npx vitest run tests/unit/sim/enemy-perimeter.test.ts`
   — all six must pass, with particular attention to `fill` (`lateralPositions.size
   > 1`) and `even spread` (`fillFraction > 0.3`). If green, commit B + the test
   update together. If `fill`/`even spread` collapse, strengthen
   `findLateralOpenSpot` / `contactLineSteer` first (do **not** land B on a
   buggy-convergence-dependent spread).
4. **Leave A and C out of scope** for now. A can be addressed later by raising
   `COLLISION_ITERATIONS` if the redundancy is judged worth removing; C should be
   revisited only with a re-derived forward-clearance success metric.
