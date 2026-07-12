# Plan: Delta-Snapshot Serialization with Store Reconciliation

## Motivation
Cut the worker→main `postMessage` structured-clone cost by shipping sparse `updated[]`/`removed[]` entity deltas instead of full arrays every frame, while keeping `SnapshotStore` exposing full `snapshot.enemies`/`snapshot.towers` so no render manager changes. Worker allocation is minimized via allocation-free comparison. Secondary motivation: **prepare the snapshot stream for multiple consumers** — the reconciled store becomes the single place that materializes full state from deltas, so future consumers (e.g. a replay recorder, a network relay, analytics) can subscribe to either the raw delta wire stream or the reconciled full snapshot.

## Wire / type changes — `src/sim/SimulationSnapshot.ts`
- Add a `WireSnapshot` discriminated union (used **only** on the worker→main boundary):
  - `entityMode: "full" | "delta"`.
  - **Full**: `enemies: EnemySnapshot[]`, `towers: TowerSnapshot[]` (as today); delta fields absent.
  - **Delta**: `enemiesUpdated: EnemySnapshot[]`, `enemiesRemoved: number[]`, `towersUpdated: TowerSnapshot[]`, `towersRemoved: string[]`; `enemies`/`towers` absent. Also ship compact **authoritative id-order arrays** `enemyOrder: number[]` / `towerOrder: string[]` (the worker's live `enemies`/`towers` id sequence). The store builds the reconciled arrays directly from these — see the "Explicit order, not store-side reconstruction" note below. This is cheaper and far less fragile than reconstructing order on the main thread.
- Keep the existing in-memory `SimulationSnapshot` (required `enemies`/`towers`) as the reconciled shape the store holds and consumers read.
- `spawnStates` stays full every frame (fixed tiny count); `meta`, `paths`/`pathsVersion`, `particleSpawns`, `lightningEffects`, `stunEffects` unchanged.
- Bump `schemaVersion` to **2** (defensive mismatch guard in the store).

## Protocol — `src/sim/WorkerProtocol.ts`
- `{ type: "snapshot"; snapshot: WireSnapshot }` (only the payload type changes; `snapshotAck`/backpressure gate untouched).

## Serializer — `src/sim/SnapshotSerializer.ts`
- Read last-posted state from the engine: `lastPostedEnemies: Map<number, EnemySnapshot>`, `lastPostedTowers: Map<string, TowerSnapshot>`.
- `buildSnapshot` chooses mode:
  - **full** when the maps are empty (baseline / post-`_initMap`) — seeds the main-thread cache.
  - **delta** otherwise.
  - On a **delta**, also emit `enemyOrder` / `towerOrder` as the live `engine.enemyManager.enemies.map(e => e.id)` / `engine.towerManager.towers.map(t => t.id)` sequences. These are the authoritative order the store rebuilds from (see Store reconciliation note). This is cheap: just id arrays, no snapshot objects.
- **Allocation-free comparison** (the key to cutting worker alloc): walk live entities and compare against the stored last-posted snapshot without building a new object. Only build `snapshotEnemy`/`snapshotTower` when a field differs; otherwise skip (no transfer, no alloc).
  - Add `enemySnapshotEqualsLive(e, prev)` / `towerSnapshotEqualsLive(t, prev)` comparing the primitive fields + `statusEffects` length/kind/remaining/magnitude + theme-ref identity.
  - **Exclude** `hitFlash` and `walkingFrameIndex` from comparison (hardcoded to `0` in `snapshotEnemy`).
  - Short-circuit `statusEffects` on the frozen `EMPTY_STATUS_EFFECTS` reference identity before deep-comparing entries. Note: the equality check must evaluate "does the live enemy have effects?" **without calling `snapshotEnemy`** — i.e. duplicate the `hasEffects` guard (`e.slowFactor < 1 || e.stunTimer > 0 || maxBurnRemaining > 0 || e.shield > 0 || e.markTargetMult > 0`) against the live `Enemy`. This is logic duplication from `SnapshotSerializer.buildEnemyStatusEffects`; keep it localized and commented so a future status-effect kind change updates both sites.
- **Selected tower is always force-included** in `towersUpdated`, bypassing equality: the tower whose `id === runState.selectedTowerId` **and** the previously-selected id when selection changed this post. Rationale: `snapshotTower` computes derived UI fields (`canUpgrade`, `sellValue`, `stats`, `levelCosts`, `upgradeCostAt5`, `milestoneBonus`) only for the selected tower, and several depend on `gold`, which changes without any change to the tower's own primitives — equality alone would leave `TowerPanel` stale. Track `lastPostedSelectedTowerId` on the engine to detect the change.
- `removed` = ids in `lastPosted*` not present in the current live set.
- Update `lastPosted*` maps to the posted state (set updated entries, delete removed) — only when the snapshot is actually built (i.e. right before post; see backpressure note).

## Engine — `src/sim/GameEngine.ts`
- Add `lastPostedEnemies: Map<number, EnemySnapshot>`, `lastPostedTowers: Map<string, TowerSnapshot>`, `lastPostedSelectedTowerId: string | null`.
- Clear all three in `_initMap` (the single funnel for both `loadMap` and `loadRandomMap`), alongside the existing `lastPostedPathVersion = 0` / `lastPostedWaveGraphGeneration = 0` / `gridLayoutEnabled = true` reset at `GameEngine.ts:181-183` — so the next post after a (re)init is a forced **full**.

## Store reconciliation — `src/sim/SnapshotStore.ts`
- `apply(wire: WireSnapshot)`:
  - **schemaVersion guard**: if `wire.schemaVersion !== EXPECTED (2)`, `console.warn` and drop the snapshot (do not throw — must not kill the render loop).
  - **full** → build `current` directly from `enemies`/`towers`; seed `enemyOrder`/`towerOrder` from `enemies.map(e => e.id)` / `towers.map(t => t.id)`.
  - **delta** → merge into `current` from the **explicit `enemyOrder`/`towerOrder` id arrays** the worker shipped (do NOT reconstruct order on the main thread — see note below):
    - Build a lookup `Map<id, updatedSnapshot>` from `*Updated`.
    - Walk `enemyOrder`/`towerOrder`; for each id, take the updated snapshot if present, else keep the prior `current` entry; drop ids present in `*Removed`. This yields the reconciled `enemies`/`towers` arrays in the worker's authoritative order (reuse the array object where possible to avoid per-frame realloc).
  - **Explicit order, not store-side reconstruction.** The earlier design maintained `enemyOrder`/`towerOrder` on the main thread via "upsert by id + append new + splice removed," relying on an invariant that the sim "only appends / removes-in-place, never reorders." That invariant is **false**: `TowerManager.towers` is reordered by `.filter` on sell (`TowerManager.ts:176,185`) and `EnemyManager.enemies` by `.splice` on death (`EnemyManager.ts:123`). The append+remove reconstruction *happens* to reproduce the same id-order as that recompaction only because both are relative-order-preserving on survivors — correct today, but silently fragile to any future reorder (e.g. re-sorting towers on upgrade). Shipping the worker's authoritative id-order in every delta removes the dependency entirely and makes the integration test's "identical to a full rebuild" claim trivially true. Cost is a tiny id array per delta.
  - **Enemy AND tower order stability are both correctness constraints.** EnemyManager + UiOverlayManager reconcile enemies **and tower HP bars** positionally by pool index against the `enemies`/`towers` array order (`UiOverlayManager.ts:205-286` for enemies, `:305-319` for tower HP bars). A divergent reconciled order would draw a damaged tower's HP bar over the wrong tower. Treat `towerOrder` with the same rigor as `enemyOrder` — it is NOT cosmetic.
  - **Defensive**: if a delta arrives with no `current` (shouldn't happen due to baseline), treat `*Updated` as the initial set and build order from the shipped `enemyOrder`/`towerOrder` (fall back to `*Updated` id order if those are absent).
- `mirrorToGameStore`, `resolveSelectedTower`, `getLatestSnapshot` unchanged (read the reconciled full arrays).
- **Add a comment** at `apply` (and/or on the `WireSnapshot` type) documenting that this is the single reconciliation point: **future stream consumers** (replay recorder, network relay, analytics) should subscribe here — either to the raw `WireSnapshot` delta stream (bandwidth-sensitive consumers) or to the reconciled full `SimulationSnapshot` (`getLatestSnapshot`) for full-state consumers. This multi-consumer readiness is part of the motivation.

## Worker — `src/sim/WorkerEntry.ts`
- No structural change; the empty-`lastPosted*` maps force the baseline **full** through the serializer on the first post after `_initMap`. Backpressure/`snapshotAck` logic unchanged. Note the existing invariant that `buildSnapshot` runs only immediately before `postMessage`, so deltas are always computed against the last *posted* state (dropped ticks never mutate `lastPosted*`).

## Tests to update
- `tests/unit/sim/snapshot.test.ts`: first `buildSnapshot` is **full** (assert `entityMode`/`enemies`/`towers`); subsequent calls are **delta**; dead-enemy removal ships only ids; **selected tower is always present in `towersUpdated`** even when its primitives are unchanged but gold changed.
- `tests/unit/sim/snapshot-store.test.ts`: delta-merge cases (upsert, removal, **enemy order stability**, full-reset, schemaVersion mismatch → dropped).
- `tests/integration/worker-roundtrip.test.ts`: baseline full → deltas reconcile to the expected entity set; assert reconciled `enemies`/`towers` arrays are **identical to a full rebuild**, including order, by driving a run that sells a *middle* tower and kills a *middle* enemy (exercises recompaction via `.filter`/`.splice`) — proving the shipped `enemyOrder`/`towerOrder` arrays reproduce full-mode order.
- Render-manager tests (enemy-manager, spawn-manager, svg-*): unaffected (full arrays preserved).

## Type-plumbing touch points
- `WorkerProtocol.snapshot` → `WireSnapshot`.
- `SnapshotStore.apply(...)` param type → `WireSnapshot`.
- `SvgGameRoot.vue:307` `snapshotStore.apply(msg.snapshot)` call site (type flows through).

## Scope notes / non-goals
- Enemy position still ships every post (they move); real savings = static towers dropped + dead-enemy removals as bare ids. **Measure the clone-size reduction post-implementation** to confirm it justifies the reconciliation complexity before ruling the deferred lever back in.
- Typed-array packing / zero-copy transfer for enemies is explicitly **out of scope** here; revisit if transfer cost remains hot.
- No change to commands, `HostBindings`, or the main-thread render loop in `SvgGameRoot.vue` beyond `SnapshotStore.apply` (already called).
