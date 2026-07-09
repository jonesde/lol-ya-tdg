# Plan: Delta-Snapshot Serialization with Store Reconciliation

## Motivation
Cut the worker→main `postMessage` structured-clone cost by shipping sparse `updated[]`/`removed[]` entity deltas instead of full arrays every frame, while keeping `SnapshotStore` exposing full `snapshot.enemies`/`snapshot.towers` so no render manager changes. Worker allocation is minimized via allocation-free comparison. Secondary motivation: **prepare the snapshot stream for multiple consumers** — the reconciled store becomes the single place that materializes full state from deltas, so future consumers (e.g. a replay recorder, a network relay, analytics) can subscribe to either the raw delta wire stream or the reconciled full snapshot.

## Wire / type changes — `src/sim/SimulationSnapshot.ts`
- Add a `WireSnapshot` discriminated union (used **only** on the worker→main boundary):
  - `entityMode: "full" | "delta"`.
  - **Full**: `enemies: EnemySnapshot[]`, `towers: TowerSnapshot[]` (as today); delta fields absent.
  - **Delta**: `enemiesUpdated: EnemySnapshot[]`, `enemiesRemoved: number[]`, `towersUpdated: TowerSnapshot[]`, `towersRemoved: string[]`; `enemies`/`towers` absent.
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
- **Allocation-free comparison** (the key to cutting worker alloc): walk live entities and compare against the stored last-posted snapshot without building a new object. Only build `snapshotEnemy`/`snapshotTower` when a field differs; otherwise skip (no transfer, no alloc).
  - Add `enemySnapshotEqualsLive(e, prev)` / `towerSnapshotEqualsLive(t, prev)` comparing the primitive fields + `statusEffects` length/kind/remaining/magnitude + theme-ref identity.
  - **Exclude** `hitFlash` and `walkingFrameIndex` from comparison (hardcoded to `0` in `snapshotEnemy`).
  - Short-circuit `statusEffects` on the frozen `EMPTY_STATUS_EFFECTS` reference identity before deep-comparing entries.
- **Selected tower is always force-included** in `towersUpdated`, bypassing equality: the tower whose `id === runState.selectedTowerId` **and** the previously-selected id when selection changed this post. Rationale: `snapshotTower` computes derived UI fields (`canUpgrade`, `sellValue`, `stats`, `levelCosts`, `upgradeCostAt5`, `milestoneBonus`) only for the selected tower, and several depend on `gold`, which changes without any change to the tower's own primitives — equality alone would leave `TowerPanel` stale. Track `lastPostedSelectedTowerId` on the engine to detect the change.
- `removed` = ids in `lastPosted*` not present in the current live set.
- Update `lastPosted*` maps to the posted state (set updated entries, delete removed) — only when the snapshot is actually built (i.e. right before post; see backpressure note).

## Engine — `src/game/GameEngine.ts`
- Add `lastPostedEnemies: Map<number, EnemySnapshot>`, `lastPostedTowers: Map<string, TowerSnapshot>`, `lastPostedSelectedTowerId: string | null`.
- Clear all three in `_initMap` (the single funnel for both `loadMap` and `loadRandomMap`), alongside the existing `lastPostedPathVersion = 0` reset — so the next post after a (re)init is a forced **full**.

## Store reconciliation — `src/sim/SnapshotStore.ts`
- `apply(wire: WireSnapshot)`:
  - **schemaVersion guard**: if `wire.schemaVersion !== EXPECTED (2)`, `console.warn` and drop the snapshot (do not throw — must not kill the render loop).
  - **full** → build `current` directly from `enemies`/`towers`; seed `enemyOrder`/`towerOrder`.
  - **delta** → merge into `current` keeping stable order: maintain `enemyOrder: number[]` / `towerOrder: string[]`; upsert `*Updated` by id, splice out `*Removed` by id. Rebuild the `enemies`/`towers` arrays from the ordered maps (reuse the array object where possible to avoid per-frame realloc).
  - **Enemy order stability is a correctness constraint** (EnemyManager + UiOverlayManager reconcile enemies by pool index). Tower order is cosmetic only (TowerManager is id-keyed via `Map`), but `towerOrder` is kept for deterministic arrays/tests.
  - **Defensive**: if a delta arrives with no `current` (shouldn't happen due to baseline), treat `*Updated` as the initial set.
- `mirrorToGameStore`, `resolveSelectedTower`, `getLatestSnapshot` unchanged (read the reconciled full arrays).
- **Add a comment** at `apply` (and/or on the `WireSnapshot` type) documenting that this is the single reconciliation point: **future stream consumers** (replay recorder, network relay, analytics) should subscribe here — either to the raw `WireSnapshot` delta stream (bandwidth-sensitive consumers) or to the reconciled full `SimulationSnapshot` (`getLatestSnapshot`) for full-state consumers. This multi-consumer readiness is part of the motivation.

## Worker — `src/sim/WorkerEntry.ts`
- No structural change; the empty-`lastPosted*` maps force the baseline **full** through the serializer on the first post after `_initMap`. Backpressure/`snapshotAck` logic unchanged. Note the existing invariant that `buildSnapshot` runs only immediately before `postMessage`, so deltas are always computed against the last *posted* state (dropped ticks never mutate `lastPosted*`).

## Tests to update
- `tests/unit/sim/snapshot.test.ts`: first `buildSnapshot` is **full** (assert `entityMode`/`enemies`/`towers`); subsequent calls are **delta**; dead-enemy removal ships only ids; **selected tower is always present in `towersUpdated`** even when its primitives are unchanged but gold changed.
- `tests/unit/sim/snapshot-store.test.ts`: delta-merge cases (upsert, removal, **enemy order stability**, full-reset, schemaVersion mismatch → dropped).
- `tests/integration/worker-roundtrip.test.ts`: baseline full → deltas reconcile to the expected entity set; assert reconciled `enemies` array is **identical to a full rebuild** (documents the "sim only appends / removes-in-place, never reorders" invariant).
- Render-manager tests (enemy-manager, spawn-manager, svg-*): unaffected (full arrays preserved).

## Type-plumbing touch points
- `WorkerProtocol.snapshot` → `WireSnapshot`.
- `SnapshotStore.apply(...)` param type → `WireSnapshot`.
- `SvgGameRoot.vue:304` `snapshotStore.apply(msg.snapshot)` call site (type flows through).

## Scope notes / non-goals
- Enemy position still ships every post (they move); real savings = static towers dropped + dead-enemy removals as bare ids. **Measure the clone-size reduction post-implementation** to confirm it justifies the reconciliation complexity before ruling the deferred lever back in.
- Typed-array packing / zero-copy transfer for enemies is explicitly **out of scope** here; revisit if transfer cost remains hot.
- No change to commands, `HostBindings`, or the main-thread render loop in `SvgGameRoot.vue` beyond `SnapshotStore.apply` (already called).
