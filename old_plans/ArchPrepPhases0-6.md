# Architecture Prep — Phases 0–6

**Scope:** implementation notes for the behavior-preserving restructuring described in `plans/ArchitecturePlan.md`. Phases 0–6 leave the simulation on the **main thread** but reshape it so the worker migration (Phases 7–9) becomes a localized swap, not a rewrite. **The app may be broken during intermediate phases; it is fully functional again by the end of Phase 6.**

**Audience:** developer with strong general software background. Game-specific terms (`requestAnimationFrame`, fixed-timestep accumulator, entity component system, sprite, `postMessage`, structured clone, `SharedArrayBuffer`) are used without softening; look them up as needed. Code examples are illustrative of shape and contract, not literal drop-in patches — surrounding imports and existing line context should be respected.

**Reading order:** Phase 0 (`HostBindings`) is the load-bearing prerequisite. Every subsequent phase depends on it. Phases 1–6 are largely independent of each other but follow the listed order for lowest risk.

---

## Design decision: direct plain-state replacement (no parallel mirror)

The original plan maintained parallel Pinia stores and plain-state mirrors through Phase 6, with dual-write helpers (`RunStateSync.ts`), a `persistDirty` flag, and dual-read sites in `WaveGraphTracker`. That machinery existed solely to keep all ~710 tests green at every phase boundary.

This version **replaces Pinia stores with plain state directly in Phase 1.** No parallel mirror, no dual writes, no `RunStateSync.ts`, no `persistDirty`. The cost is that Vue components reading from Pinia's `gameStore` show stale/zero values from Phase 1 through Phase 4. The snapshot → gameStore projection in Phase 5 restores Vue component rendering. This trades ~40% of the plan's mechanical complexity for a temporary broken UI that is fully restored by the end of Phase 6.

---

## Cross-cutting: new module layout

Create a new directory `src/sim/` to hold the new simulation contracts. Anything that will eventually live inside the worker goes here. Existing files in `src/game/`, `src/towers/`, `src/enemies/` are migrated into `sim/`-aware shape over the phases; the directory itself is the build-time boundary that the future worker entry will import from.

```
src/sim/
├── HostBindings.ts             # Phase 0 — the host interface (SoundName, SoundPlayer, HostBindings, ThemeBundle)
├── GameRunState.ts             # Phase 1 — plain run-state interface + pure helpers
├── PersistState.ts             # Phase 1 — plain persist-state interface + pure logic
├── Command.ts                  # Phase 5 — discriminated-union command schema
├── CommandDispatcher.ts        # Phase 6 — the dispatcher interface
├── SimulationSnapshot.ts       # Phase 5 — DTO schema + entity snapshot types
├── SpatialIndex.ts             # Phase 5 (interface only; implementation deferred until pile-up feature)
└── SnapshotSerializer.ts       # Phase 5 — entity → snapshot DTO conversion
```

Adapters that depend on Pinia/DOM live **outside** `src/sim/` (they import from `src/sim/` but are not imported by the worker) — in a sibling directory `src/sim-adapters/`:
- `src/sim-adapters/MainThreadHostBindings.ts` — Phase 0 adapter (imports `SoundManager`, `uiStore`, `persistStore`)
- `src/sim-adapters/MainThreadCommandDispatcher.ts` — Phase 6 adapter (imports `GameEngine`)

The split keeps `src/sim/` itself free of any `src/stores/` import, while the adapters — which the worker never imports — can reach into Pinia freely. Putting the adapters in a separate directory (rather than under `src/sim/`) means the boundary grep on `src/sim/` doesn't need per-file exemptions.

The directory forms a **build-time boundary**: it must not import anything from `src/stores/`, `src/components/`, `src/router/`, or `src/sound/`. **The project uses Biome (not ESLint) for linting** (see `biome.json` and `package.json`'s `lint` script), and Biome has no `no-restricted-imports`-equivalent rule. The boundary is enforced by a **CI check** wired into `package.json`. **Start with the grep one-liner** (no new dependency) and upgrade to a script only if false negatives appear:

- **Phase 0/1 (start here): grep one-liner.** Add `"check:sim-boundary": "grep -rEn 'from \"@/(stores|components|router|sound)/' src/sim/ && exit 1 || exit 0"` to `package.json`, chained into `lint` (`"lint": "biome check . && npm run check:sim-boundary"`). This fails if any forbidden import is found under `src/sim/`. The grep matches the four forbidden path-aliases; it does **not** exempt the two `MainThread*` adapters (they would fail the check) — to handle them, either (a) move the adapters OUT of `src/sim/` into `src/sim-adapters/` (a sibling directory not covered by the grep), or (b) refine the grep to exclude those two filenames: `grep -rEn --exclude='MainThreadHostBindings.ts' --exclude='MainThreadCommandDispatcher.ts' 'from \"@/(stores|components|router|sound)/' src/sim/`. Option (a) is cleaner — the adapters are not part of the worker boundary, so they shouldn't live under `src/sim/` regardless. Recommend (a): create `src/sim-adapters/` for the two adapter files and grep only `src/sim/`.
- **Upgrade path (only if needed):** if the grep proves too coarse (e.g., it can't exempt by import-kind — `import type` is allowed for non-adapter files through Phase 6), replace it with a small `scripts/check-sim-boundary.ts` script run via `tsx`. `tsx` is NOT currently a dev dependency — adding it is a new dependency, which is why the grep is the preferred starting point. Only add `tsx` and the script if profiling the false-positive rate in practice shows the grep is insufficient.

This is what prevents accidental transitive coupling to Pinia — see Risk §7.5 in `ArchitecturePlan.md`. The rule is in place from Phase 1 onward (Phase 0 only adds `HostBindings.ts`; the check can be added in Phase 0 or Phase 1 — recommend Phase 0 so the boundary is enforced the moment `src/sim/` exists).

### Boundary policy for migration-target directories

`src/game/`, `src/towers/`, `src/enemies/` are the **migration targets** — they will eventually run inside the worker. They do not move into `src/sim/` immediately; they are reshaped in place across Phases 0–6. Their import policy is staged:

- **During Phases 0–2:** these directories may import `src/stores/` *types* (`import type { GameStore }`). **Runtime** calls to `useXxxStore()` must reach zero by end of Phase 2 (Pinia-elimination phase). Phase 1 eliminates all Pinia runtime imports from `GameEngine` and `WaveGraphTracker`; Phase 2 eliminates them from `Enemy`, `Tower`, and `SkillTree`.
- **Phase 3 (deleted):** the original plan's Phase 3 was pure cleanup verifying Phase 0's sound routing — all sound routing is done in Phase 0, and the cleanup is folded into Phase 0's completion checklist.
- **End of Phase 7:** the worker entry imports only from `src/sim/`, `src/game/`, `src/towers/`, `src/enemies/`, `src/grid/`, `src/waves/`, `src/render/themes/` (for theme types). No `src/stores/` imports transitively reachable from the worker entry.

---

## Phase 0 — `HostBindings` interface

### Goal
Replace every direct call from the simulation into UI/sound/persistence modules with a call through an injected interface. Today the interface is implemented by a main-thread adapter that simply forwards to the existing modules. When the worker lands (Phase 7), the same interface is implemented by a thin shim that calls `worker.postMessage` and returns/Promises the result. **No behavior change.**

### The interface

`src/sim/HostBindings.ts`:

```ts
import type { MapThemeData, TowerVisualMeta, EnemyVisualMeta } from "@/render/themes/index.js";
import type { TowerId } from "@/game/ConstantsTower.js";

// A UiEvent is anything the sim needs to ask the host to do that isn't a
// sound, a persistence flush, or a confirm dialog. Today this covers
// useUiStore().initForRun() and any future "show notification" / "open menu".
export type UiEvent =
  | { type: "initForRun"; mapIndex: number }
  | { type: "showNotification"; message: string }
  | { type: "endGame"; payload: EndScreenPayload };
// NOTE: EndScreenPayload (defined in src/stores/game.ts:45-50) already
// includes `victory: boolean`, so the endGame event wraps the full payload
// rather than splitting victory out. The payload shape must match
// gameStore.triggerEnd's `data: Omit<EndScreenPayload, "victory">` plus
// the victory flag — i.e., the full EndScreenPayload. Import the type from
// src/sim/GameRunState.ts (Phase 1 re-declares it there as a plain interface
// matching the one in game.ts) to avoid importing from src/stores/.

// ConfirmPayload is what the sim emits when it needs the user to confirm
// something. The host enriches with display data (themed tower name) and
// shows the dialog. The decision comes back via the returned Promise.
export interface ConfirmPayload {
  towerId: string;
  towerType: string;          // for theme lookup by host
  towerLevel: number;
  sellValue: number;
  isRefund: boolean;          // refund vs sell — affects button labels
}

export interface PersistStateSlice {
  // The subset of PersistState the host needs to write to localStorage.
  // Full PersistState is defined in Phase 1; this is a forward declaration.
  // In Phase 1, PersistState IS this type (the engine holds the full state).
  gems: number;
  bestWaves: Record<string, number>;
  activeWaves: Record<string, number>;
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
  runHistory: unknown[];
}

// The central interface. Every method is fire-and-forget except requestConfirm,
// which returns a Promise because the sim cannot proceed until the user decides.
// HostBindings extends SoundPlayer (below) so a HostBindings instance satisfies
// both — TowerManager/Tower depend on the narrower SoundPlayer, GameEngine
// depends on the full HostBindings. This is Interface Segregation Principle
// applied: TowerManager only needs playSound, so it shouldn't see the other 3.
export interface SoundPlayer {
  playSound(name: SoundName): void;
}

export interface HostBindings extends SoundPlayer {
  notifyUi(event: UiEvent): void;
  schedulePersistSave(state: PersistStateSlice): void;
  requestConfirm(payload: ConfirmPayload): Promise<boolean>;
}

// SoundName is currently MODULE-PRIVATE in src/sound/SoundManager.ts:3-14
// (`type SoundName = ...` — NO `export` keyword). No module outside
// SoundManager.ts imports it today (verified: only SoundManager.ts references
// the name, internally). Phase 0 makes `SoundManager.ts`'s declaration go
// away and defines SoundName canonically HERE in src/sim/HostBindings.ts.
// The change to SoundManager.ts is:
//   - DELETE the local `type SoundName = ...` declaration (lines 3-14).
//   - ADD `import type { SoundName } from "@/sim/HostBindings.js";` at the top.
//   - The `play(name: SoundName)` method signature is unchanged — `SoundName`
//     now resolves via the import instead of a local declaration.
// This is option (b) from the original plan: SoundManager remains the
// implementation; HostBindings owns the contract type that crosses the sim
// boundary. No "re-export" is involved — the type literally moves from
// SoundManager.ts to HostBindings.ts.
//
// SoundName uses a template-literal for tower shoot sounds to give
// compile-time safety against typos (e.g., `shoot_basic` vs `shoot_basc`):
export type ShootSoundName = `shoot_${TowerId}`;
export type SoundName = ShootSoundName | "place" | "base_hit" | "boss_die" | "sell" | "cancel";
// The template-literal improvement means `Tower.ts:808,841` can drop the
// `as SoundName` cast — `host.playSound(`shoot_${this.type}`)` is now
// type-safe when `this.type` is a `TowerId`.
```

### Main-thread adapter

`src/sim-adapters/MainThreadHostBindings.ts` (lives outside the `sim/` boundary since it imports stores — this is fine, it's the *adapter*, not the contract):

```ts
import type { HostBindings, ConfirmPayload, PersistStateSlice, UiEvent, SoundName } from "@/sim/HostBindings.js";
import { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

export class MainThreadHostBindings implements HostBindings {
  private sound: SoundManager;
  // Stores are fetched lazily inside each method — Pinia stores must be
  // accessed after createPinia() has run, which may be later than adapter
  // construction if the adapter is built early.

  constructor(sound: SoundManager) {
    this.sound = sound;
  }

  // NOTE: the method is named `playSound` to match the narrower SoundPlayer
  // interface (TowerManager/Tower depend on SoundPlayer, not HostBindings).
  // SoundManager exposes `play`, so this is a one-line forward.
  playSound(name: SoundName): void {
    this.sound.play(name);
  }

  notifyUi(event: UiEvent): void {
    const uiStore = useUiStore();
    switch (event.type) {
      case "initForRun":
        uiStore.initForRun(null);
        break;
      case "showNotification":
        uiStore.showNotification(event.message);
        break;
      case "endGame": {
        const gameStore = useGameStore();
        const { victory, ...data } = event.payload;
        gameStore.triggerEnd(victory, data);
        break;
      }
    }
  }

  schedulePersistSave(state: PersistStateSlice): void {
    const persistStore = usePersistStore();
    // Phase 1: the engine holds plain PersistState and calls localStorage
    // directly (main-thread only). This method is unused during Phases 0–6
    // but stays in the interface for the worker era (Phase 7+), when the
    // worker sends persistSave messages via postMessage and this adapter
    // writes to the Pinia persistStore + localStorage.
    persistStore.gems = state.gems;
    if (state.bestWaves)      persistStore.bestWaves = { ...state.bestWaves };
    if (state.activeWaves)    persistStore.activeWaves = { ...state.activeWaves };
    if (state.firstTimeMilestones) persistStore.firstTimeMilestones = { ...state.firstTimeMilestones };
    if (state.firstClears)    persistStore.firstClears = { ...state.firstClears };
    if (state.runHistory)     persistStore.runHistory = [...state.runHistory];
    persistStore.save();
  }

  requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    const uiStore = useUiStore();
    const themeStore = useMapThemeStore();
    const visual = themeStore.getDefaultTowerVisual(payload.towerType);
    const towerName = visual?.name ?? payload.towerType;
    return new Promise<boolean>((resolve) => {
      uiStore.showConfirm({
        title: payload.isRefund ? "Full Refund" : "Sell Tower",
        message: `${payload.isRefund ? "Refund" : "Sell"} ${towerName} (Lv ${payload.towerLevel}) for ${payload.sellValue}g?`,
        confirmLabel: payload.isRefund ? "Refund" : "Sell",
        cancelLabel: "Keep",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}
```

### Wiring into `GameEngine`

The constructor at `src/game/GameEngine.ts:82` currently takes `(gameStore, persistStore, theme?)`. Add a fourth parameter and store it. **Phase 0 routes all sound through `HostBindings` immediately** (routing position (b) — see "Routing position" note below): the `SoundManager` field on the engine is deleted, and the two direct `this.sound.play(...)` call sites at `GameEngine.ts:204,267` switch to `this.host.playSound(...)` in Phase 0.

```ts
export class GameEngine {
  // existing fields, EXCEPT `sound: SoundManager` — deleted
  host: HostBindings;

  constructor(
    gameStore: GameStore,
    persistStore: PersistStore,
    theme: MapThemeData | null,
    host: HostBindings,
  ) {
    this.gameStore = gameStore;
    this.persistStore = persistStore;
    this.theme = theme ?? null;
    this.host = host;
    // ... existing init ...
    // `this.sound = new SoundManager()` is DELETED here — the host owns the
    // SoundManager. GameEngine.ts:204 (`this.sound.play("boss_die")`) becomes
    // `this.host.playSound("boss_die")` and :267 (`this.sound.play("base_hit")`)
    // becomes `this.host.playSound("base_hit")` in this same phase.
  }
}
```

`SoundManager` construction moves to `SvgGameRoot.vue` next to where the engine is created (`src/components/SvgGameRoot.vue:235`). `SvgGameRoot.vue` already has an `onUnmounted` hook (`SvgGameRoot.vue:388`) that disposes the engine and the render managers — it **must also dispose the `SoundManager`** in the same hook, since the host now owns it (Phase 0 deletes `GameEngine.dispose()`'s `this.sound.dispose()` call). Concretely, `SvgGameRoot.vue` keeps a ref to the `SoundManager` it constructed and calls `soundManager.dispose()` in `onUnmounted` alongside `engine.value?.dispose()` and the render-manager disposes:

```ts
// src/components/SvgGameRoot.vue (Phase 0 wiring)
const soundManager = new SoundManager();
const host = new MainThreadHostBindings(soundManager);
engine.value = new GameEngine(gameStore, persistStore, themeStore.activeTheme, host);

// ... later, in the existing onUnmounted hook (SvgGameRoot.vue:388):
onUnmounted(() => {
  pendingHoverScheduled = false;
  gameStore.clearEngine();
  engine.value?.dispose();
  soundManager.dispose();   // NEW — host owns disposal now
  resizeObserver.value?.disconnect();
  resizeObserver.value = null;
  enemyManager.dispose();
  // ... existing render-manager disposes ...
});
```

If the `SoundManager` instance is also referenced for any non-engine sound (it isn't today, but defensively), keep the ref at component scope so both the host construction and the unmount hook can reach it.

### Routing position: why Phase 0 routes all sound immediately

Two consistent positions were considered:

- (a) Phase 0 is purely additive — `HostBindings` exists but is unused; Phase 3 does all routing in one pass.
- (b) Phase 0 routes all sound through `HostBindings` immediately; Phase 3 only deletes dead code (the `SoundManagerRef` interface, the `this.sound` field on `TowerManager`/`Tower`).

**Adopted: (b).** A larger Phase 0 diff, but it establishes the "sound is fully decoupled" property at the seam rather than half-routing and leaving the other half for later. With the simplified plan, Phase 3 is eliminated entirely — all cleanup happens in Phase 0.

### Sound propagation through `TowerManager` and `Tower`

This is the part the earlier plan missed. The sound interface flows through three layers. Phase 0 routes all three through `SoundPlayer` (the narrower interface defined above) — not `HostBindings` — so `TowerManager` and `Tower` depend only on `playSound`, not the full 4-method `HostBindings`:

1. `GameEngine.ts:142` constructs `TowerManager(grid, particles, projectiles, this.sound, theme)`. Change the 4th parameter from `this.sound` (a `SoundManager`) to `this.host` (a `HostBindings`, which is also a `SoundPlayer` by interface extension). `TowerManager` stores it as `SoundPlayer`.

2. `TowerManager.ts:110` currently takes `sound: SoundManagerRef`. Change the parameter type to `sound: SoundPlayer`. The current `SoundManagerRef` interface is defined **twice** — once at `TowerManager.ts:78-80` and once identically at `Tower.ts:137-139`. Both are:
   ```ts
   // Old (both files): interface SoundManagerRef { play(name: string): void; }
   //   NOTE: method name is "play" (not "playSound"), param type is "string"
   //   (not SoundName) — the current interface is stringly-typed.
   // New (both files): import type { SoundPlayer } from "@/sim/HostBindings.js";
   //   (SoundPlayer has playSound(name: SoundName), not play(name: string))
   ```
   This is NOT a pure type rename — it changes the method name (`play` → `playSound`) and tightens the parameter type (`string` → `SoundName`). Phase 0 must:
   - **Delete both `SoundManagerRef` interface definitions** (`TowerManager.ts:78-80` and `Tower.ts:137-139`).
   - **Add `import type { SoundPlayer } from "@/sim/HostBindings.js";`** to both `TowerManager.ts` and `Tower.ts`.
   - **Re-type 4 annotations**: `TowerManager.ts:99` (field `sound: SoundManagerRef` → `SoundPlayer`), `:110` (constructor param), `Tower.ts:664` (`soundManager: SoundManagerRef` param → `SoundPlayer`), `:776` (`sound: SoundManagerRef` param → `SoundPlayer`).
   - **Rename the method at 5 call sites**: `TowerManager.ts:136,147,157` (`this.sound.play("place"|"sell"|"cancel")` → `this.sound.playSound(...)`) and `Tower.ts:808,841` (`sound.play(\`shoot_${this.type}\`)` → `sound.playSound(\`shoot_${this.type}\`)`).

3. `TowerManager.ts:184` calls `tower.update(dt, enemyManager, this.projectiles, this.sound)`. The `Tower.update` method has TWO sound parameter declarations — `Tower.ts:664` (`soundManager: SoundManagerRef`) and `:776` (`sound: SoundManagerRef`) — both re-typed to `SoundPlayer` (covered in step 2 above; these are **parameter declarations**, not call sites). The **call sites** that invoke the method are `Tower.ts:808,841` (`if (sound) sound.play(\`shoot_${this.type}\`)`) — these become `if (sound) sound.playSound(\`shoot_${this.type}\`)`.

### Verification checklist (Phase 0 completion)

- [ ] Grep for any remaining `this.sound` references in `GameEngine.ts` — there should be none.
- [ ] Grep for any remaining `SoundManagerRef` references across `src/` — there should be none. If any remain, delete them and switch to `SoundPlayer`.
- [ ] Grep for any remaining `.play(` calls in `TowerManager.ts` and `Tower.ts` — all should be `.playSound(`.
- [ ] `SoundManager.ts`'s local `type SoundName` declaration deleted; `import type { SoundName }` added.

### What stays the same in Phase 0

- `GameEngine.ts:91` (`this.sound = new SoundManager()`) — **deleted** in Phase 0 (the host owns the SoundManager now).
- `GameEngine.ts:204,267` direct `this.sound.play(...)` calls — **routed through `this.host.playSound(...)` in Phase 0**.
- `GameEngine.ts:125` `useUiStore().initForRun(null)` — leave for Phase 2.
- `GameEngine.ts:202,443` `this.persistStore.save()` — leave for Phase 1 (replaced by direct localStorage write).
- `GameEngine.ts:610-623` `useUiStore().showConfirm(...)` + `useMapThemeStore()` — leave for Phase 4.
- `GameEngine.dispose()` at `GameEngine.ts:701` calls `this.sound.dispose()` — **deleted** in Phase 0; the host owns disposal now.

Phase 0 adds the seam and routes all sound through it. UI, persistence, and confirm stay direct until their respective phases.

### Test impact

`tests/helpers/mock-stores.ts` constructs stores via `createPinia()`. The engine constructor signature change requires updating the mock setup to pass a `MockHostBindings`:

```ts
export class MockHostBindings implements HostBindings {
  soundsPlayed: SoundName[] = [];
  uiEvents: UiEvent[] = [];
  persistSaves: PersistStateSlice[] = [];
  confirmPayloads: ConfirmPayload[] = [];
  confirmResult: boolean = true;  // tests can override

  playSound(name) { this.soundsPlayed.push(name); }
  notifyUi(event) { this.uiEvents.push(event); }
  schedulePersistSave(state) { this.persistSaves.push(state); }
  requestConfirm(payload) {
    this.confirmPayloads.push(payload);
    return Promise.resolve(this.confirmResult);
  }
}
```

Existing tests that don't assert on sound/UI/persist behavior pass a `MockHostBindings()` and are unaffected. Tests that do assert (e.g., `game-engine.test.ts` checking sounds) get rewritten to assert on `mockHost.soundsPlayed` instead of mocking `SoundManager`.

---

## Phase 1 — Direct plain-state replacement

### Goal

Replace the Pinia `gameStore` and `persistStore` with plain `GameRunState` and `PersistState` objects directly on `GameEngine`. No parallel mirror, no dual writes. The plain objects ARE the authoritative state. All mutation sites write directly to these plain objects. Vue components reading from Pinia's `gameStore` will show stale/zero values through Phase 4 — this is acceptable; the snapshot → gameStore projection in Phase 5 restores them.

### `GameRunState`

`src/sim/GameRunState.ts`:

```ts
import type { GameState } from "@/game/Constants.js";
import type { TowerId } from "@/game/ConstantsTower.js";
import type { GeneratedMap } from "@/grid/Map.js";
import type { Grid } from "@/grid/Grid.js";

// Authoritative run state for the simulation. Formerly the Pinia gameStore's
// GameStateShape (src/stores/game.ts:76-106). In Phase 1 this replaces
// the Pinia store entirely on the engine — there is no parallel mirror.
// In Phase 7 the worker constructs this object directly; the main-thread
// gameStore becomes a reactive projection of the snapshot's meta.
export interface GameRunState {
  state: GameState;
  mapIndex: number;
  map: GeneratedMap | null;
  grid: Grid | null;
  lives: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  selectedTowerId: string | null;       // id, not Tower ref — Phase 5
  selectedTowerType: TowerId | null;
  hoverTile: { tileX: number; tileY: number } | null;
  hoverUpgradeBtn: boolean;
  upgradeBtnClickAnim: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  milestoneRewardsClaimed: Record<number, boolean>;
  gemBreakdown: GemBreakdown;
  endScreenData: EndScreenPayload | null;
  // NOTE: camera is excluded — it is main-thread-only UI state, never written by the engine.
  randomMapParams: Record<string, unknown> | null;
}

export interface GemBreakdown {
  bossKills: BreakdownEntry;
  milestones: BreakdownEntry;
  waveCompletion: BreakdownEntry;
  firstClearBonus: number;
}

export interface BreakdownEntry {
  base: number;
  afterDiff: number;
  afterRegion: number;
  afterFirstTime: number;
}

export interface EndScreenPayload {
  victory: boolean;
  wave: number;
  gems: number;
  gemBreakdown: GemBreakdown;
}

// Pure helpers — the bodies of the corresponding gameStore actions
// (src/stores/game.ts:153-281), extracted as free functions so the worker
// can call them without a Pinia instance.
export function applyGold(state: GameRunState, amount: number): void {
  state.gold += amount;
}

export function applyLivesLoss(state: GameRunState, amount: number): void {
  state.lives -= amount;
}

export function cycleTimeScale(state: GameRunState, direction: 1 | -1): number {
  const speeds = [1, 2, 4, 8];
  const i = speeds.indexOf(state.timeScale);
  const next = speeds[(i + direction + speeds.length) % speeds.length]!;
  state.timeScale = next;
  return next;
}

export function togglePause(state: GameRunState): void {
  if (state.state === GameState.PLAYING) state.state = GameState.PAUSED;
  else if (state.state === GameState.PAUSED) state.state = GameState.PLAYING;
}

// ... etc for claimMilestone, hasClaimedMilestone, triggerEnd, initRunState
```

### `PersistState`

`src/sim/PersistState.ts`:

```ts
import type { GeneralAddons, TowerUnlocks } from "@/stores/persist.js";
// NOTE: GeneralAddons is already exported (persist.ts:15). TowerUnlocks is
// currently module-private (persist.ts:8 — `interface TowerUnlocks` with no
// `export`). Phase 1 ADDS `export` to that interface so PersistState.ts can
// import it as a type. (Type-only import from src/stores/ is permitted under
// the boundary policy through Phase 6; removed in Phase 7 when TowerUnlocks
// is re-homed into src/sim/ or a shared types module.)

// Authoritative persist state — ALL 16 fields enumerated explicitly (no
// ellipsis). The randomMap* / lastSelectedThemeId fields aren't written by
// the engine, but they MUST be present so the full PersistState round-trips
// through localStorage correctly.
export interface PersistState {
  saveVersion: number;
  gems: number;
  highestUnlockedMap: number;
  bestWaves: Record<string, number>;
  activeWaves: Record<string, number>;
  difficulty: { multiplierTick: number };
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
  generalAddons: GeneralAddons;
  unlocked: Record<string, TowerUnlocks>;
  runHistory: unknown[];
  randomMapRegion: number;
  randomMapLevel: number;
  randomMapStyle: string;
  randomMapSeed: number | null;
  randomMapWidth: number;
  randomMapHeight: number;
  lastSelectedThemeId: string;
}

// Pure functions extracted from persist.ts:191-298. These currently mutate
// `this` on the Pinia store and call this.save(); the pure versions mutate
// the plain state and return a boolean indicating whether a save is needed.
// During Phase 1, the caller calls localStorage.setItem directly.

export function updateBestWave(state: PersistState, mapIndex: number, wave: number): boolean {
  const key = `best_${mapIndex}`;
  const prev = typeof state.bestWaves[key] === "number" ? state.bestWaves[key] : 0;
  if (wave > prev) {
    state.bestWaves[key] = wave;
    return true;
  }
  return false;
}

export function maybeUnlockNextMap(state: PersistState, mapIndex: number): boolean {
  if (mapIndex >= 0 && mapIndex + 1 < 36) {
    state.highestUnlockedMap = Math.max(state.highestUnlockedMap, mapIndex + 1);
    return true;
  }
  return false;
}

export function markFirstTimeMilestone(state: PersistState, mapIndex: number, wave: number): boolean {
  state.firstTimeMilestones[`${mapIndex}_${wave}`] = true;
  return true;
}

export function hasClaimedMilestone(state: PersistState, mapIndex: number, wave: number): boolean {
  return !!state.firstTimeMilestones[`${mapIndex}_${wave}`];
}

export function markFirstClear(state: PersistState, mapIndex: number): boolean {
  state.firstClears[String(mapIndex)] = true;
  return true;
}

export function hasCleared(state: PersistState, mapIndex: number): boolean {
  return !!state.firstClears[String(mapIndex)];
}

export function addRunToHistory(state: PersistState, entry: unknown): boolean {
  state.runHistory.push(entry);
  while (state.runHistory.length > 20) state.runHistory.shift();
  return true;
}

export function clearActiveWave(state: PersistState, mapIndex: number): boolean {
  delete state.activeWaves[String(mapIndex)];
  return true;
}

// difficultyMultiplier getter (currently a Pinia getter at persist.ts:183):
export function difficultyMultiplier(state: PersistState): number {
  const tick = state.difficulty?.multiplierTick ?? 0;
  return tick * 0.25 + 1;
}
```

### `GameEngine` changes

Replace the `gameStore` and `persistStore` fields with `runState` and `persistState` plain objects. The engine no longer imports or references any Pinia store:

```ts
import { STORAGE_KEY } from "@/stores/persist.js";  // type-only re-export; permitted under boundary policy

export class GameEngine {
  runState!: GameRunState;
  persistState!: PersistState;
  host: HostBindings;
  theme: MapThemeData | null;

  // Private helper for saving persist state to localStorage.
  // Engine is on the main thread during Phases 0–6; this is safe.
  // Phase 7+ replaces this with host.schedulePersistSave via postMessage.
  private _savePersistState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.persistState));
    } catch {
      this.host.notifyUi({ type: "showNotification", message: "Save failed." });
    }
  }

  constructor(
    theme: MapThemeData | null,
    host: HostBindings,
  ) {
    this.theme = theme ?? null;
    this.host = host;
    // ... existing defaults for non-store fields ...
    // NO gameStore / persistStore fields
    // NO sound field (Phase 0)
  }

  _initMap(mapIndex: number, mapData: GeneratedMap, persistState: PersistState): void {
    // Construct runState directly — no cloning from Pinia.
    this.runState = {
      state: GameState.PLAYING,
      mapIndex,
      map: mapData,
      grid: null,  // set after Grid construction below
      lives: 20,
      gold: StartingGold[mapData.regionId]!,
      currentWave: 0,
      waveCountdown: null,
      timeScale: 1,
      selectedTowerId: null,
      selectedTowerType: null,
      hoverTile: null,
      hoverUpgradeBtn: false,
      upgradeBtnClickAnim: 0,
      runGemsEarned: 0,
      bossesKilledThisRun: 0,
      bossesReachedBaseThisRun: 0,
      milestoneRewardsClaimed: {},
      gemBreakdown: { /* fresh breakdown */ },
      endScreenData: null,
      randomMapParams: null,
    };
    this.persistState = persistState;

    this.host.notifyUi({ type: "initForRun", mapIndex });
    // ... existing _initMap body (Grid, EnemyManager, etc.) ...
    this.runState.grid = this.grid;
  }

  // ... all mutation methods now write directly to this.runState / this.persistState ...
}
```

**Every existing mutation** switches from `this.gameStore.<field> += x` / `this.persistStore.<field> += x` to `this.runState.<field> += x` / `this.persistState.<field> += x`. Examples:

| Current code | Phase 1 |
|---|---|
| `this.gameStore.lives += STARTING_HEALTH_BONUS[ehTier]` (:172) | `this.runState.lives += STARTING_HEALTH_BONUS[ehTier]` |
| `this.gameStore.gold += STARTING_GOLD_BONUS[sgTier]` (:179) | `this.runState.gold += STARTING_GOLD_BONUS[sgTier]` |
| `this.gameStore.bossesKilledThisRun++` (:184) | `this.runState.bossesKilledThisRun++` |
| `this.persistStore.gems += afterRegion` (:200) | `this.persistState.gems += afterRegion; this._savePersistState()` |
| `this.gameStore.addGold(amount)` (:393) | `applyGold(this.runState, amount)` |
| `this.gameStore.loseLives(amount)` (:260) | `applyLivesLoss(this.runState, amount)` |
| `this.gameStore.cycleSpeed()` (:687) | `cycleTimeScale(this.runState, 1)` |
| `this.persistStore.save()` (:202,443) | `this._savePersistState()` |

**Persist mutation pattern:** every site that mutates `this.persistState` (gems, bestWaves, firstTimeMilestones, etc.) calls `this._savePersistState()` immediately after the mutation. This is the simplest pattern — no dirty flag, no deferred flush. The engine is on the main thread, so the localStorage write is synchronous and cheap. Phase 7 replaces `_savePersistState` with `this.host.schedulePersistSave(...)`.

**New method — `GameEngine.cycleSpeedReverse()`:** `cycleSpeed()` already exists on `GameEngine` (`GameEngine.ts:687-689`) as a thin delegation to `this.gameStore.cycleSpeed()`. `cycleSpeedReverse()` does **not** exist on `GameEngine` today — it exists only on the Pinia `gameStore` (`src/stores/game.ts:170-182`). Phase 1 must add the reverse method to `GameEngine` so Phase 6's `applyCommand` can call it. The method body calls `cycleTimeScale(this.runState, -1)`.

### `WaveGraphTracker`

The current constructor at `src/game/WaveGraphTracker.ts:50-55` is `(gameStore, persistStore, towerManager, enemyManager)` — 4 params. Replace `gameStore` and `persistStore` with `runState` and `persistState`:

```ts
import type { GameRunState } from "@/sim/GameRunState.js";
import type { PersistState } from "@/sim/PersistState.js";

export class WaveGraphTracker {
  private runState: GameRunState;
  private persistState: PersistState;
  private towerManager: TowerManagerRef;
  private enemyManager: EnemyManagerRef;

  constructor(
    runState: GameRunState,
    persistState: PersistState,
    towerManager: TowerManagerRef,
    enemyManager: EnemyManagerRef,
  ) {
    this.runState = runState;
    this.persistState = persistState;
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;

    this._prevGems = persistState.gems;         // was persistStore.gems
    this._intervalMinLives = runState.lives;     // was gameStore.lives
    // ... rest unchanged ...
  }

  update(dt: number): void {
    // ...
    const currentGems = this.persistState.gems;   // was this.persistStore.gems
    // ...
    if (this.runState.lives < this._intervalMinLives) {  // was this.gameStore.lives
      this._intervalMinLives = this.runState.lives;
    }
    // ...
  }

  private _flushInterval(): void {
    // ...
    this._intervalMinLives = this.runState.lives;  // was this.gameStore.lives
    // ...
  }
}
```

All four read sites (`:64, :65, :81, :88-89, :147`) switch from `this.gameStore.<field>` / `this.persistStore.<field>` to `this.runState.<field>` / `this.persistState.<field>`. No dual-reads, no dual fields, no in-code documentation block needed — there is exactly one source of truth.

Update the `new WaveGraphTracker(...)` call at `GameEngine.ts:153-158` to pass `this.runState` and `this.persistState` instead of stores.

### `SvgGameRoot.vue` wiring

The caller (SvgGameRoot.vue) reads persist state from localStorage and passes it to `_initMap`:

```ts
// src/components/SvgGameRoot.vue (Phase 1 wiring)
import { STORAGE_KEY } from "@/stores/persist.js";

const soundManager = new SoundManager();
const host = new MainThreadHostBindings(soundManager);
engine.value = new GameEngine(themeStore.activeTheme, host);

function loadPersistState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistState;
  } catch { /* corrupt save — use defaults */ }
  return defaultPersistState();
}

// When starting a new game:
engine.value._initMap(mapIndex, mapData, loadPersistState());
```

### Deleted machinery

The following constructs from the original plan's Phase 1 are **not created**:

- `src/sim/RunStateSync.ts` — no dual-write helpers needed
- `persistDirty` flag on GameEngine — no divergence to track
- `snapshotPersistState()` method — no cloning from Pinia needed
- Drift-prevention lint check — no parallel fields to drift
- WaveGraphTracker dual-read documentation block — single source of truth

### Test impact

Tests that construct `GameEngine` directly need the new constructor signature (no Pinia stores). `mock-stores.ts` provides a `defaultPersistState()` helper that returns a fresh `PersistState` object initialized to defaults. Tests that previously inspected `gameStore.lives` / `gameStore.gold` now inspect `engine.runState.lives` / `engine.runState.gold`.

The `STORAGE_KEY` constant must be exported from `src/stores/persist.ts` (add `export` to the existing `const STORAGE_KEY = "lol_ya_tdg_save_1";` at persist.ts:5). Both the engine and `SvgGameRoot.vue` import this value. Runtime imports from `src/stores/` are permitted for migration-target directories through Phase 6. Tests that exercise persist save/load use the real localStorage mock (`tests/setup.ts` already provides in-memory localStorage).

---

## Phase 2 — Eliminate Pinia imports from the logic layer

### Goal

Remove direct `useUiStore()` and `useMapThemeStore()` calls from `GameEngine`, `Enemy`, `Tower`, and `SkillTree`. Route through `HostBindings` (for UI) or constructor-injected theme data (for visuals). After this phase, the `src/sim/` boundary has zero imports from `src/stores/`.

### Call site inventory

| Location | Current | After |
|---|---|---|
| `GameEngine.ts:13` | `import { useMapThemeStore }` | delete |
| `GameEngine.ts:15` | `import { useUiStore }` | delete |
| `GameEngine.ts:125` | `useUiStore().initForRun(null)` | `this.host.notifyUi({ type: "initForRun", mapIndex })` |
| `GameEngine.ts:610-623` | `useMapThemeStore().getDefaultTowerVisual(...)` + `useUiStore().showConfirm(...)` | Phase 4 (confirm relocation); the theme lookup moves into `MainThreadHostBindings.requestConfirm` |
| `Enemy.ts:10` | `import { useMapThemeStore }` | delete |
| `Enemy.ts:116` | `useMapThemeStore().getDefaultEnemyVisual(type)` | accept a `defaultVisual: EnemyVisualMeta \| null` parameter (or read from a `themeRegistry` injected into `EnemyManager`) |
| `Tower.ts:33` | `import { useMapThemeStore }` | delete |
| `Tower.ts:255` | `useMapThemeStore().getDefaultTowerVisual(towerId)` | same pattern — `defaultVisual: TowerVisualMeta \| null` parameter |
| `SkillTree.ts:4` | `import { useMapThemeStore }` | delete |
| `SkillTree.ts:122-126` | module-level `useMapThemeStore()` call inside `for` loop | replace with default values; add `populateSkillTreeTheme(theme)` callable post-init (see below) |

### `Enemy` / `Tower` visual parameter

Both constructors already accept a `theme: MapThemeData | null` parameter and read the active theme's visual off it (`Enemy.ts:113`, `Tower.ts:253`). The fallback to `useMapThemeStore()` is for the *default* theme visuals. Inject that as an explicit parameter.

**Note on current constructor signatures** (verified against source):

- `Enemy.ts:100-108` currently takes `(type, level, spawnIndex, grid, wave, difficultyTick, theme)` — **7 parameters** with `spawnIndex` and `difficultyTick` already present as separate parameters. Phase 2 adds `defaultVisual` as the **8th**.
- `Tower.ts:233-241` currently takes `(type, tileX, tileY, save, grid, theme, placedAt)` — **7 parameters**. Both `theme` (6th, `= null`) and `placedAt` (7th, `= Date.now()`) have defaults. Phase 2 adds `defaultVisual` as the **7th** param (after `theme`, **before** `placedAt`), with a default `= null`. Placing it before `placedAt` preserves `placedAt`'s default.

```ts
// Enemy.ts constructor signature change (100-108):
//   (type, level, spawnIndex, grid, wave, difficultyTick, theme)   → 7 params
//   (type, level, spawnIndex, grid, wave, difficultyTick, theme, defaultVisual)  → 8 params
constructor(
  type: string,
  level: number,
  spawnIndex: number,
  grid: GridRef,
  wave: number,
  difficultyTick: number,
  theme: MapThemeData | null,
  defaultVisual: EnemyVisualMeta | null,   // NEW — 8th param
) {
  // ...
  const enemyVisual = (theme?.enemies[type] ?? null) as EnemyVisualMeta | null;
  this.color = enemyVisual?.color || defaultVisual?.color || "#e85a6a";
  this.shape  = enemyVisual?.shape  || defaultVisual?.shape  || "circle";
  // ... etc, dropping the themeStore.getDefaultEnemyVisual call
}

// Tower.ts constructor signature change (233-241):
//   (type, tileX, tileY, save, grid, theme, placedAt)                 → 7 params (theme & placedAt have defaults)
//   (type, tileX, tileY, save, grid, theme, defaultVisual, placedAt)  → 8 params (defaultVisual 7th, before placedAt)
constructor(
  type: string,
  tileX: number,
  tileY: number,
  save: SaveData | undefined,
  grid: GridRef,
  theme: MapThemeData | null = null,
  defaultVisual: TowerVisualMeta | null = null,   // NEW — 7th param (before placedAt)
  placedAt: number = Date.now(),
) {
  // ...
  const towerVisual = (theme?.towers[type] ?? null) as TowerVisualMeta | null;
  this.color = towerVisual?.color || defaultVisual?.color || "#8fbc8f";
  this.icon  = towerVisual?.icon  || defaultVisual?.icon  ?? "";
  this.name  = towerVisual?.name  || defaultVisual?.name  || type;
  // ... etc, dropping the themeStore.getDefaultTowerVisual call
}
```

**Explicit call-site changes for Phase 2:**

| Call site | Current args | Phase 2 args |
|---|---|---|
| `TowerManager.ts:129` (`new Tower(type, tileX, tileY, save, grid, this.theme)`) | 6 args | `new Tower(type, tileX, tileY, save, grid, this.theme, this.defaultTowerVisuals[type] ?? null)` — 7 args (placedAt keeps its default) |
| `EnemyManager.ts:53` (`new Enemy(type, level, spawnIndex, this.grid, wave, this.difficultyTick, this.theme)`) | 7 args | `new Enemy(type, level, spawnIndex, this.grid, wave, this.difficultyTick, this.theme, this.defaultEnemyVisuals[type] ?? null)` — 8 args |
| `GameEngine.ts:136` (`new EnemyManager(this.grid, this.particleManager, diffTick, this.theme)`) | 4 args | `new EnemyManager(this.grid, this.particleManager, diffTick, this.theme, this.themeBundle.defaultEnemyVisuals)` — 5 args |
| `GameEngine.ts:138-144` (`new TowerManager(grid, particles, projectiles, sound, theme)`) | 5 args | `new TowerManager(grid, particles, projectiles, sound, theme, this.themeBundle.defaultTowerVisuals)` — 6 args (NEW 6th param on `TowerManager` constructor) |

`TowerManager` and `EnemyManager` constructors each gain a `defaultVisuals: Record<...>` param as their last parameter (6th for `TowerManager`, 5th for `EnemyManager`), stored as a field and forwarded to each `new Tower(...)` / `new Enemy(...)` call. `TowerManager.build` reads `this.defaultTowerVisuals[type]` to pass the per-type visual into the `Tower` constructor.

`EnemyManager` (`src/enemies/EnemyManager.ts`) currently receives `theme` in its constructor (passed from `GameEngine.ts:136`). Extend it to also receive a `defaultVisuals: EnemyVisualIndex` — a plain `Record<EnemyType, EnemyVisualMeta>` — sourced from `mapThemeStore.defaultTheme`. `GameEngine` looks this up once at construction and passes it through.

To avoid the `GameEngine` itself importing the theme store, the lookup happens in `SvgGameRoot.vue` (which already imports `mapThemeStore`) and is passed into the `GameEngine` constructor as part of a `ThemeBundle`:

```ts
// src/sim/HostBindings.ts (extend)
export interface ThemeBundle {
  active: MapThemeData | null;
  defaultTowerVisuals: Record<string, TowerVisualMeta>;   // keyed by towerId
  defaultEnemyVisuals: Record<string, EnemyVisualMeta>;   // keyed by enemyType
}

// GameEngine constructor becomes:
constructor(
  themeBundle: ThemeBundle,
  host: HostBindings,
)
```

`SvgGameRoot.vue` builds the `ThemeBundle` from `mapThemeStore` once and passes it in. This is the *only* place the theme store is consulted for the simulation; everything downstream receives plain data.

**How `defaultTowerVisuals` / `defaultEnemyVisuals` are sourced:** `mapThemeStore` exposes per-type getters `getDefaultTowerVisual(typeId)` and `getDefaultEnemyVisual(typeId)` (`src/stores/mapTheme.ts:84,88`), not bulk getters. `SvgGameRoot.vue` builds the `Record<string, TowerVisualMeta>` and `Record<string, EnemyVisualMeta>` by iterating the known type ids (`Object.values(TowerIds)` for towers; `Object.keys(ENEMY_TYPES)` for enemies) and calling the per-type getter for each. This is a one-time O(N) loop at engine construction; the result is a plain object passed by reference thereafter.

```ts
// src/components/SvgGameRoot.vue (illustrative — build the ThemeBundle once)
import { TowerIds } from "@/game/ConstantsTower.js";
import { ENEMY_TYPES } from "@/game/ConstantsEnemy.js";

function buildThemeBundle(mapThemeStore: MapThemeStore): ThemeBundle {
  const defaultTowerVisuals: Record<string, TowerVisualMeta> = {};
  for (const id of Object.values(TowerIds)) {
    const visual = mapThemeStore.getDefaultTowerVisual(id);
    if (visual) defaultTowerVisuals[id] = visual;
  }
  const defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {};
  for (const type of Object.keys(ENEMY_TYPES)) {
    const visual = mapThemeStore.getDefaultEnemyVisual(type);
    if (visual) defaultEnemyVisuals[type] = visual;
  }
  return {
    active: mapThemeStore.activeTheme,
    defaultTowerVisuals,
    defaultEnemyVisuals,
  };
}
```

### `SkillTree` module-level population

The tricky one. `src/towers/SkillTree.ts:116-126` runs `useMapThemeStore()` inside a `for` loop at **module load time** to populate `SKILL_TREE[id]` with display fields (name, color, icon). This pattern is incompatible with workers — module load order is not guaranteed to occur after Pinia initialization, and workers will not have Pinia at all.

Restructure as a two-step:

```ts
// src/towers/SkillTree.ts

// Step 1: populate with neutral defaults at module load. No theme store access.
const NEUTRAL_DISPLAY = { name: "", color: "#8fbc8f", icon: "\u2500" };

for (const id of Object.values(TowerIds)) {
  SKILL_TREE[id] = {
    ...NEUTRAL_DISPLAY,
    levels: [/* ... */],
    variantA: [/* ... */],
    // ...
  };
}

// Step 2: provide a function the host calls after theme data is available.
export function populateSkillTreeTheme(
  defaultTowerVisuals: Record<string, TowerVisualMeta>,
): void {
  for (const id of Object.values(TowerIds)) {
    const visual = defaultTowerVisuals[id];
    if (!visual) continue;
    SKILL_TREE[id]!.name  = visual.name;
    SKILL_TREE[id]!.color = visual.color;
    SKILL_TREE[id]!.icon  = visual.icon;
  }
}
```

`main.ts` calls `populateSkillTreeTheme(...)` after the default theme is preloaded:

```ts
// src/main.ts (extend the existing IIFE at lines 15-21)
import { populateSkillTreeTheme } from "@/towers/SkillTree.js";
import { TowerIds } from "@/game/ConstantsTower.js";

// ... existing createApp, pinia, router setup ...

usePersistStore().load();
(async () => {
  try {
    await useMapThemeStore().preloadDefault();   // already present (main.ts:17)
    const mapThemeStore = useMapThemeStore();
    const defaultTowerVisuals: Record<string, TowerVisualMeta> = {};
    for (const id of Object.values(TowerIds)) {
      const visual = mapThemeStore.getDefaultTowerVisual(id);
      if (visual) defaultTowerVisuals[id] = visual;
    }
    populateSkillTreeTheme(defaultTowerVisuals);
  } catch (err) {
    console.error("Failed to preload default map theme:", err);
  }
})();

app.mount("#app");
```

**Ordering mitigation:** `main.ts` already `await`s `mapThemeStore.preloadDefault()` before `app.mount()`. The `populateSkillTreeTheme(...)` call goes immediately after `preloadDefault()` resolves and before `app.mount()`, so the populate runs before any route component can mount. Additionally, add a defensive re-populate in `SkillTree.vue`'s setup that checks whether `SKILL_TREE` is still neutral (e.g., `SKILL_TREE.basic.name === ""`) and calls `populateSkillTreeTheme` again if so.

### Test impact

Tests that construct `Enemy`/`Tower` directly (e.g., `tests/unit/enemies.test.ts`, `tests/unit/towers.test.ts`) need the new `defaultVisual` parameter — pass `null` or the existing `mockDefaultTheme` visual. The `SkillTree` tests should verify both the neutral-default state and the post-populate state.

---

## Phase 4 — Confirm dialog relocation

### Goal

`sellSelected()` on the engine becomes a fire-and-forget request via `HostBindings.requestConfirm`. The host (main thread) shows the dialog; on user confirmation it dispatches an `action:executeSell` command back to the engine. (Phase 4 still calls the engine method directly — the command dispatch is wired in Phase 6. For now, the host calls `engine.executeSell()` directly.)

### The flow

```
User clicks "Sell" on TowerPanel
  → Input.ts posts action:sellSelected (Phase 6)
  → GameEngine.sellSelected() executes:
      - read selected tower, sell value, isRefund flag
      - early-return if sellActive === "discount" (GameEngine.ts:605-607)
      - emit ConfirmPayload via this.host.requestConfirm(payload)
        (this returns a Promise<boolean>; the engine awaits it)
  → MainThreadHostBindings.requestConfirm:
      - look up themed tower name via mapThemeStore
      - call uiStore.showConfirm({...}) with onConfirm/onCancel resolving the Promise
  → User clicks "Sell" in ConfirmDialog
      → Promise resolves true
      → engine.executeSellById(towerId) runs, re-validating that the tower is still
        sellable at execution time (tower existence + sellActive are re-checked)
  → User clicks "Keep" (or hits Escape)
      → Promise resolves false
      → engine does nothing
```

### `GameEngine.sellSelected` rewrite

The tower id is **captured at the time of the confirm request**, not at resolution time — selection could change between dialog-open and confirm. The new `executeSellById(towerId)` method takes the id explicitly.

```ts
async sellSelected(): Promise<void> {
  if (!this.runState.selectedTowerId) return;

  // Preserved early-return: when sell is disabled (discount mode), do nothing.
  if (this.persistState.generalAddons?.sellActive === "discount") {
    return;
  }

  const tower = this.towerManager?.getTowerById(this.runState.selectedTowerId);
  if (!tower) return;

  const towerId = tower.id;  // capture at request time
  const isRefund = this.persistState.generalAddons?.sellActive === "refund";
  const sellValue = isRefund ? tower.totalInvested : tower.sellValue();

  const confirmed = await this.host.requestConfirm({
    towerId,
    towerType: tower.type,
    towerLevel: tower.level,
    sellValue,
    isRefund,
  });

  if (confirmed) {
    this.executeSellById(towerId);
  }
}

executeSellById(towerId: string): void {
  const tower = this.towerManager?.getTowerById(towerId);
  if (!tower) return;

  // Re-validate sellability at execution time.
  if (this.persistState.generalAddons?.sellActive === "discount") return;

  const isRefund = this.persistState.generalAddons?.sellActive === "refund";
  const value = isRefund ? tower.totalInvested : this.towerManager!.sell(tower, this.persistState);

  this.runState.gold += value;
  this.totalGoldEarned += value;
  this.runState.selectedTowerId = null;
}
```

### SaveData → PersistState call-site migration (Phase 4)

Every `this.persistStore.$state` argument currently passed to Tower/TowerManager methods switches to `this.persistState`. Full enumeration:

| Call site | Method | Current arg | Phase 4 arg |
|---|---|---|---|
| `GameEngine.ts:536` | `towerManager.build(type, x, y, save, grid)` | `this.persistStore.$state` | `this.persistState` |
| `GameEngine.ts:552,573` | `tower.canUpgrade(save)` | `this.persistStore.$state` | `this.persistState` |
| `GameEngine.ts:580` | `tower.doUpgrade(save, cost)` | `this.persistStore.$state` | `this.persistState` |
| `GameEngine.ts:598` | `tower.specialize(variant, save, cost)` | `this.persistStore.$state` | `this.persistState` |
| `GameEngine.ts:631-632` | `sellActive` check + `towerManager.sell(tower, save)` | `this.persistStore.$state` | `this.persistState` |
| `GameEngine.ts:665-668` | `sellActive` check + `towerManager.sell(tower, save)` (downgrade) | `this.persistStore.$state` | `this.persistState` |

The method signatures on `Tower` and `TowerManager` change their `SaveData` parameter type to `PersistState` (`src/sim/PersistState.ts`). This is a structural type change — `SaveData` and `PersistState` describe the same shape — so it's a type-rename, not a runtime change. `TowerManager`/`Tower`'s local `SaveData` interface (`TowerManager.ts:82-86`, `Tower.ts` equivalent) is deleted in Phase 4 in favor of `import type { PersistState } from "@/sim/PersistState.js"`.

### Why `async` is safe here

`sellSelected` is currently synchronous and called from `Input.ts` (`engine?.sellSelected?.()` at line 132) and `TowerPanel.vue` (`gameStore.engine?.sellSelected()` at line 125). Both use optional chaining and ignore the return value — making it `async` means callers receive a `Promise<void>` they can ignore. Optional chaining on an async function is fine; the returned promise is simply discarded. The engine's update loop does not call `sellSelected` — it's purely input-driven — so there is no risk of the engine stalling mid-tick waiting for a dialog. The engine's main loop (`GameEngine.loop`) is synchronous and never awaits; only user-initiated action handlers do.

### `downgradeSelected`

Currently synchronous and has no confirm dialog (`GameEngine.ts:652-657`). No change in Phase 4. If a confirm dialog is ever desired for downgrade, the same `requestConfirm` pattern applies.

### Test impact

`game-engine.test.ts` tests covering the sell flow need to `await` the now-async `sellSelected`. The `MockHostBindings.confirmResult` field (Phase 0) controls the resolution — set it before calling `sellSelected()` so the Promise resolves synchronously on the next microtask.

---

## Phase 5 — Snapshot and Command schema

### Goal

Define the `SimulationSnapshot` and `Command` types. The `SnapshotSerializer` maps `Enemy` and `Tower` directly into plain DTOs (no `getRenderData()` method on entity classes — the serializer owns the field-by-field mapping). `ProjectileManager` and `ParticleSystem` already expose `getRenderData()` returning plain DTO arrays; the serializer reuses those. Update render managers' `syncFromGameEngine` signatures to accept snapshot arrays. **Wire the snapshot → gameStore projection** so Vue components (HUD, shop, TowerPanel) render correctly again. The engine still runs on the main thread; snapshots are produced but consumed locally.

### Performance note: Phase 5 serialization overhead

At Phase 5 the engine is still on the main thread, so `buildSnapshot` every frame is pure overhead with no decoupling benefit yet (the decoupling lands in Phase 7 when the worker produces the snapshot). The 60Hz `buildSnapshot` call mapping ~200 entities into new DTOs is a measurable cost.

**Why accept it:** exercising the snapshot path end-to-end *before* the worker migration proves the schema is complete and the render managers consume it correctly.

**If profiling shows jank:** gate the snapshot-build path behind a feature flag during Phase 5 so it can be A/B-tested against the live-object path. Recommend *not* doing this unless profiling surfaces a problem — the temporary overhead disappears in Phase 7 when the snapshot is produced by the worker regardless.

### `Command` schema

`src/sim/Command.ts`:

```ts
import type { TowerId } from "@/game/ConstantsTower.js";
import type { PersistState } from "./PersistState.js";
import type { ThemeBundle } from "./HostBindings.js";

// Discriminated union. Every intent flowing into the simulation is one of
// these. The worker drains a queue of these at the start of each tick.
//
// The commandId is echoed back in the snapshot as lastAppliedCommandId so
// the host can detect confirmation or rejection. It is a monotonic number
// assigned by the host dispatcher.

export type Command =
  // ---- Input events (low-level, from Input.ts and SvgGameRoot click handlers) ----
  | { commandId: number; type: "input:click"; worldX: number; worldY: number }
  | { commandId: number; type: "input:key"; key: string; direction: "down" | "up" }
  // NOTE: hover is NOT a command — it's main-thread-only UI state (see §6.2 of ArchitecturePlan.md)
  // NOTE: selectBuildType is NOT a command — `selectedTowerType` is host-authoritative
  //   (updated directly on gameStore by Input.ts/SvgGameRoot.vue, echoed back in the
  //   snapshot's meta.selectedTowerType unchanged by the worker). See §6.2 of ArchitecturePlan.md.

  // ---- High-level actions (wrapping GameEngine public methods) ----
  | { commandId: number; type: "action:togglePause" }
  | { commandId: number; type: "action:cycleSpeed"; direction: 1 | -1 }
  | { commandId: number; type: "action:upgradeSelected" }
  | { commandId: number; type: "action:sellSelected" }     // triggers confirm via host
  | { commandId: number; type: "action:executeSell"; towerId: string }  // post-confirm
  | { commandId: number; type: "action:downgradeSelected" }
  | { commandId: number; type: "action:specialize"; variant: "A" | "B" }
  | { commandId: number; type: "action:cancelSelected" }
  | { commandId: number; type: "action:setTargeting"; mode: string }
  | { commandId: number; type: "action:setFixedAimDir"; dir: "N" | "E" | "S" | "W" | null }
  | { commandId: number; type: "action:cancelBuildMode" }
  // @tech-debt PHASE 6 STUB — this command variant is DEFINED in the schema
  // here in Phase 5 but is NOT DISPATCHED by Phase 6's applyCommand (it's a
  // no-op `break` there). Phase 7 implements engine.selectTowerById(id) and
  // wires this case. For Phase 6, the existing gameStore.selectTower(tower)
  // calls in Input.ts and SvgGameRoot.vue stay direct (not via the dispatcher).
  | { commandId: number; type: "action:selectTower"; towerId: string | null }

  // ---- Lifecycle ----
  | { commandId: number; type: "lifecycle:init"; persistState: PersistState; themeBundle: ThemeBundle; mapIndex: number; randomMapParams?: unknown }
  | { commandId: number; type: "lifecycle:dispose" }

  // ---- Future LLM commands (stubs — implementations deferred to commander plane) ----
  | { commandId: number; type: "llm:routeGroup"; groupId: string; waypoints: Array<{ x: number; y: number }>; hold?: boolean; holdTile?: { x: number; y: number } }
  | { commandId: number; type: "llm:setTargeting"; enemyIds: string[]; mode: string }
```

### `SimulationSnapshot` schema

`src/sim/SimulationSnapshot.ts`:

```ts
import type { GameRunState } from "./GameRunState.js";
import type { ProjectileManager } from "@/game/ProjectileManager.js";
import type { ParticleSystem } from "@/game/ParticleSystem.js";

export interface SimulationSnapshot {
  schemaVersion: number;       // bump on incompatible schema changes; consumers reject mismatches
  frameId: number;             // monotonic per-tick counter
  lastAppliedCommandId: number; // host uses this to confirm command application
  meta: SnapshotMeta;
  enemies: EnemySnapshot[];
  towers: TowerSnapshot[];
  projectiles: ProjectileSnapshot[];
  particles: ParticleSnapshot[];
  spawnStates: SpawnStateSnapshot[];   // for spawn-queue overlay renderer
}

export interface SnapshotMeta {
  // Scalar state from GameRunState. Subset that the renderer/UI need.
  state: GameRunState["state"];
  mapIndex: number;
  lives: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  selectedTowerId: string | null;
  selectedTowerType: string | null;
  hoverTile: { tileX: number; tileY: number } | null;
  hoverUpgradeBtn: boolean;
  upgradeBtnClickAnim: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  // camera is excluded — main-thread-only UI state, read from gameStore.camera directly
  lastScaledDt: number;       // renderer uses this for animation interpolation
  endScreenData: GameRunState["endScreenData"];
  gemBreakdown: GameRunState["gemBreakdown"];
  milestoneRewardsClaimed: Record<number, boolean>;
}

// Entity snapshots — plain data only, no methods, no closures.
// Field set is the union of everything the render managers currently read
// off the live entity objects. Audit the syncFromGameEngine methods in
// src/render/svg/*.ts to confirm completeness.

export interface EnemySnapshot {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  angle: number;
  level: number;
  reachedBase: boolean;
  onPathBlocked: boolean;
  removed: boolean;
  slowFactor: number;     // 1.0 = not slowed
  slowTimer: number;
  burnTimer: number;
  hitFlash: number;       // 0..1 visual hit-reaction intensity
  walkingFrameIndex: number;
  isBoss: boolean;
  statusEffects: StatusEffectSnapshot[];
}

export interface StatusEffectSnapshot {
  kind: "slow" | "stun" | "burn" | "shield" | "heal" | "mark";
  remaining: number;
  magnitude: number;
}

export interface TowerSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  level: number;
  variant: "A" | "B" | null;
  angle: number;
  cooldown: number;
  targeting: string;
  totalInvested: number;
  waveDamage: number;
  totalDamageDealt: number;
  fireAnimTime: number;
  fixedAimDir: "N" | "E" | "S" | "W" | null;
  sellValue: number;          // pre-computed so TowerPanel doesn't need a live method call
}

// Projectile and Particle snapshots: REUSE the existing DTO types.
//   - ProjectileManager.getRenderData() returns Array<{ id, x, y, radius, color }>
//   - ParticleSystem.getRenderData() returns RenderParticle[]
export type ProjectileSnapshot = ReturnType<ProjectileManager["getRenderData"]>[number];
export type ParticleSnapshot = ReturnType<ParticleSystem["getRenderData"]>[number];

import type { SpawnState } from "@/render/themes/index.js";
export type SpawnStateSnapshot = SpawnState;
```

### `SnapshotSerializer`

`src/sim/SnapshotSerializer.ts`:

```ts
import type { Enemy } from "@/enemies/Enemy.js";
import type { Tower } from "@/towers/Tower.js";
import type { GameEngine } from "@/game/GameEngine.js";
import type {
  SimulationSnapshot, EnemySnapshot, TowerSnapshot, SnapshotMeta,
} from "./SimulationSnapshot.js";

let nextFrameId = 1;

export function buildSnapshot(engine: GameEngine, lastAppliedCommandId: number): SimulationSnapshot {
  const enemies = engine.enemyManager?.enemies ?? [];
  const towers = engine.towerManager?.towers ?? [];

  return {
    schemaVersion: 1,
    frameId: nextFrameId++,
    lastAppliedCommandId,
    meta: buildMeta(engine),
    enemies: enemies.map(snapshotEnemy),
    towers: towers.map(snapshotTower),
    projectiles: engine.projectileManager?.getRenderData() ?? [],
    particles: engine.particleManager?.getRenderData() ?? [],
    spawnStates: engine.waveManager?.spawnStates ?? [],
    // No persistDirty — the engine writes to localStorage directly in
    // _savePersistState(). Phase 7+ will signal persist flushes via
    // HostBindings instead.
  };
}

function buildMeta(engine: GameEngine): SnapshotMeta {
  const rs = engine.runState;
  return {
    state: rs.state,
    mapIndex: rs.mapIndex,
    lives: rs.lives,
    gold: rs.gold,
    currentWave: rs.currentWave,
    waveCountdown: rs.waveCountdown,
    timeScale: rs.timeScale,
    selectedTowerId: rs.selectedTowerId,
    selectedTowerType: rs.selectedTowerType,
    hoverTile: rs.hoverTile,
    hoverUpgradeBtn: rs.hoverUpgradeBtn,
    upgradeBtnClickAnim: rs.upgradeBtnClickAnim,
    runGemsEarned: rs.runGemsEarned,
    bossesKilledThisRun: rs.bossesKilledThisRun,
    bossesReachedBaseThisRun: rs.bossesReachedBaseThisRun,
    lastScaledDt: engine.lastScaledDt,
    endScreenData: rs.endScreenData,
    gemBreakdown: rs.gemBreakdown,
    milestoneRewardsClaimed: rs.milestoneRewardsClaimed,
  };
}

function snapshotEnemy(e: Enemy): EnemySnapshot {
  return {
    id: e.id, type: e.type, x: e.x, y: e.y,
    hp: e.hp, maxHp: e.maxHp, shield: e.shield, maxShield: e.maxShield,
    angle: e.moveAngle ?? 0, level: e.level,
    reachedBase: e.reachedBase, onPathBlocked: e.onPathBlocked, removed: e.removed,
    slowFactor: e.slowFactor ?? 1, slowTimer: e.slowTimer ?? 0, burnTimer: e.burnTimer ?? 0,
    hitFlash: e.hitFlash ?? 0, walkingFrameIndex: e.walkingFrameIndex ?? 0,
    isBoss: e.type === "boss",
    statusEffects: buildEnemyStatusEffects(e),
  };
}

function buildEnemyStatusEffects(e: Enemy): StatusEffectSnapshot[] {
  const effects: StatusEffectSnapshot[] = [];
  if (e.slowFactor < 1) {
    const maxRemaining = e.slowStack?.reduce((max, s) => Math.max(max, s.remaining), 0) ?? 0;
    effects.push({ kind: "slow", remaining: maxRemaining, magnitude: 1 - e.slowFactor });
  }
  if (e.stunTimer > 0) effects.push({ kind: "stun", remaining: e.stunTimer, magnitude: 1 });
  if (e.burnTimer > 0) effects.push({ kind: "burn", remaining: e.burnTimer, magnitude: e.burnDps ?? 0 });
  if (e.shield > 0) effects.push({ kind: "shield", remaining: 0, magnitude: e.shield });
  if (e.markTargetMult > 0) effects.push({ kind: "mark", remaining: e.markTargetTimer, magnitude: e.markTargetMult });
  return effects;
}

// snapshotTower similar — audit Tower.ts for the full field set.
```

### GameStore projection (NEW — restores Vue component rendering)

The Pinia `gameStore` was left stale since Phase 1 (the engine no longer writes to it). Phase 5 wires a one-way projection from the snapshot's `meta` into `gameStore` so Vue components (GameHud, GameShop, TowerPanel, etc.) render correct values again. The projection runs in the render callback after building the snapshot:

```ts
// src/components/SvgGameRoot.vue (Phase 5 render callback)
import { useGameStore } from "@/stores/game.js";

function projectSnapshotMeta(snapshot: SimulationSnapshot, gameStore: GameStore): void {
  const m = snapshot.meta;
  gameStore.state = m.state;
  gameStore.lives = m.lives;
  gameStore.gold = m.gold;
  gameStore.currentWave = m.currentWave;
  gameStore.waveCountdown = m.waveCountdown;
  gameStore.timeScale = m.timeScale;
  gameStore.runGemsEarned = m.runGemsEarned;
  gameStore.bossesKilledThisRun = m.bossesKilledThisRun;
  gameStore.bossesReachedBaseThisRun = m.bossesReachedBaseThisRun;
  gameStore.gemBreakdown = m.gemBreakdown;
  gameStore.endScreenData = m.endScreenData;
  // selectedTowerId: gameStore.selectedTower is a live Tower ref, but
  // the snapshot has an id. Look up the tower by id and assign it:
  if (m.selectedTowerId) {
    const tower = engine.value?.towerManager?.getTowerById(m.selectedTowerId);
    gameStore.selectedTower = tower ?? null;
  } else {
    gameStore.selectedTower = null;
  }
  // selectedTowerType / hoverTile / hoverUpgradeBtn / upgradeBtnClickAnim
  // are host-authoritative (updated directly on gameStore by Input.ts/SvgGameRoot.vue)
  // — they are ECHOED in the snapshot unchanged, not driven by it.
  // The projection reads them from the snapshot so the worker (Phase 7+) can
  // echo them back, but during Phase 5 they're driven locally.
  gameStore.selectedTowerType = m.selectedTowerType;
  gameStore.hoverTile = m.hoverTile;
  gameStore.hoverUpgradeBtn = m.hoverUpgradeBtn;
  gameStore.upgradeBtnClickAnim = m.upgradeBtnClickAnim;
}

// In the render callback:
engine.value!.renderCallback = () => {
  // ... camera transform unchanged ...
  const snapshot = buildSnapshot(engine.value!, lastAppliedCommandId);
  projectSnapshotMeta(snapshot, useGameStore());  // NEW — restore Vue reactivity
  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, snapshot.meta.lastScaledDt);
  // ... etc ...
};
```

This is a one-way projection: `engine.runState` → snapshot → `gameStore`. The simulation writes to `runState`; the projection reads from the snapshot and writes to `gameStore`. Vue components bind to `gameStore` as before and see live values again. In Phase 7+, this projection becomes the "reactive mirror" receiving snapshots from the worker.

### Render manager signature updates

All **six** `syncFromGameEngine` methods in `src/render/svg/*.ts` change their parameter types from live entity arrays to snapshot arrays. Audit each one for the full field set it reads:

| File | Current signature | After | Fields read (audit each) |
|---|---|---|---|
| `EnemyManager.ts:17` | `syncFromGameEngine(enemies: Enemy[])` | `syncFromGameEngine(enemies: EnemySnapshot[])` | position, hp, status effect visuals, walking frame, hit flash, shield, boss flag |
| `TowerManager.ts:13` | `syncFromGameEngine(towers: Tower[], dt: number)` | `syncFromGameEngine(towers: TowerSnapshot[], dt: number)` | position, angle, level, variant, fire anim time, barrel rotation |
| `ProjectileManager.ts:22` | `syncFromGameEngine(projectiles: Projectile[])` | `syncFromGameEngine(projectiles: ProjectileSnapshot[])` | already DTO-based via `getRenderData()`; minimal change |
| `ParticleManager.ts:22` | `syncFromGameEngine(particles: Particle[])` | `syncFromGameEngine(particles: ParticleSnapshot[])` | already DTO-based via `getRenderData()`; minimal change |
| `EffectManager.ts:173` | `syncFromGameEngine(buildPreviewTilePos, selectedTowerType, buildPreviewColor, selectedTower, buildPreviewValid, dt)` | params unchanged (all UI-computed on main thread; no snapshot arrays) | reads `selectedTower` fields — change to `TowerSnapshot \| null` |
| `UiOverlayManager.ts:116` | `syncFromGameEngine(enemies: Enemy[], _selectedTower: Tower \| null)` | `syncFromGameEngine(enemies: EnemySnapshot[], _selectedTower: TowerSnapshot \| null)` | HP bars, shield bars, boss HP text — reads hp, maxHp, shield, maxShield, isBoss |

Additionally, `UiOverlayManager.syncPendingQueueOverlays(grid, enemyManager)` changes to read from the snapshot's `spawnStates` array:

```ts
// Before (src/render/svg/UiOverlayManager.ts:222):
syncPendingQueueOverlays(grid: Grid, enemyManager: EnemyManager): void { ... }

// After:
syncPendingQueueOverlays(grid: Grid, spawnStates: SpawnStateSnapshot[]): void { ... }
```

### `SvgGameRoot.vue` render path

```ts
engine.value.renderCallback = () => {
  // ... camera transform unchanged ...
  const snapshot = buildSnapshot(engine.value!, lastAppliedCommandId);
  projectSnapshotMeta(snapshot, useGameStore());  // restore Vue reactivity
  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, snapshot.meta.lastScaledDt);
  // ... etc ...
};
```

`lastScaledDt` is read from the snapshot (`snapshot.meta.lastScaledDt`) instead of `engine.value.lastScaledDt` (`SvgGameRoot.vue:308`).

### Test impact

New tests in `tests/unit/sim/snapshot.test.ts`:
- Construct an engine with known entities, call `buildSnapshot`, assert every field is populated correctly.
- Round-trip test: build a snapshot, mutate the engine, build another snapshot, assert the diff matches the mutation.
- Schema-version rejection: a consumer given a snapshot with the wrong `schemaVersion` rejects it cleanly.
- Projection test: build a snapshot, run `projectSnapshotMeta` into a gameStore, assert all fields match.

Existing render-manager tests need their `syncFromGameEngine` call sites updated to pass snapshot arrays. The mock data helpers in `tests/helpers/mock-managers.ts` should produce snapshot arrays instead of (or in addition to) live entity arrays.

---

## Phase 6 — Input decoupling

### Goal

`Input.ts` (the Vue composable at `src/game/Input.ts`) and the SVG click/hover handlers in `SvgGameRoot.vue` stop calling `engine.method()` directly. Instead, they post `Command` messages to a local `CommandDispatcher`. In Phase 6 the dispatcher still calls the engine directly (it's the seam that will later forward to the worker). **No behavior change** — every input still reaches the engine synchronously.

### `CommandDispatcher` interface

```ts
// src/sim/CommandDispatcher.ts
import type { Command } from "./Command.js";

export interface CommandDispatcher {
  dispatch(command: Command): void;
  // Phase 6: synchronous, calls engine directly.
  // Phase 7: async, posts to worker via postMessage.
}
```

### Main-thread direct dispatcher (Phase 6)

```ts
// src/sim-adapters/MainThreadCommandDispatcher.ts
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";
import type { GameEngine } from "@/game/GameEngine.js";

export class MainThreadCommandDispatcher implements CommandDispatcher {
  private engine: GameEngine;
  private nextCommandId = 1;

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  dispatch(command: Command): void {
    if (command.commandId === undefined) {
      (command as { commandId: number }).commandId = this.nextCommandId++;
    }
    applyCommand(this.engine, command);
  }
}

function applyCommand(engine: GameEngine, command: Command): void {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      break;
    case "action:togglePause":
      engine.togglePause();
      break;
    case "action:cycleSpeed":
      command.direction === 1 ? engine.cycleSpeed() : engine.cycleSpeedReverse();
      break;
    case "action:upgradeSelected":   engine.upgradeSelected(); break;
    case "action:sellSelected":      void engine.sellSelected(); break;
    case "action:executeSell":       engine.executeSellById(command.towerId); break;
    case "action:downgradeSelected": engine.downgradeSelected(); break;
    case "action:specialize":        engine.specializeSelected(command.variant); break;
    case "action:cancelSelected":    engine.cancelSelected(); break;
    case "action:setTargeting":      engine.setTargeting(command.mode); break;
    case "action:setFixedAimDir":    engine.setFixedAimDir(command.dir); break;
    case "action:cancelBuildMode":   engine.cancelBuildMode(); break;
    // NOTE: action:selectBuildType is intentionally absent — selectedTowerType
    // is host-authoritative.
    case "action:selectTower":
      // PROMINENT TECH DEBT — this case is intentionally a no-op `break` in
      // Phase 6. The command variant exists in the Command schema (Phase 5)
      // so Phase 7 doesn't need to add it. Phase 7 implements
      // engine.selectTowerById(id) and wires this case.
      break;
    default:
      const _exhaustive: never = command;
      void _exhaustive;
  }
}
```

### `Input.ts` changes

The current `useInput(gameStore, engine, uiStore)` signature (`Input.ts:27`) takes an `EngineLike` (the structural interface at `Input.ts:7-15`). Replace `engine: EngineLike` with `dispatcher: CommandDispatcher`:

```ts
export function useInput(
  gameStore: GameStoreLike,
  dispatcher: CommandDispatcher,
  uiStore: UiStoreLike,
): void {
  // ...
  const handle = (event: KeyboardEvent) => {
    // ...
    case " ":
      if (uiStore.showPauseMenu) {
        uiStore.closeAllDialogs();
      } else {
        dispatcher.dispatch({ type: "action:togglePause" });
      }
      break;
    // ...
  };
}
```

Each `engine?.method?.()` call site in `Input.ts` becomes a `dispatcher.dispatch(...)` call. The `KEY_REPEAT_INTERVAL` debounce (`Input.ts:31`) stays in `Input.ts` — input rate-limiting is a main-thread concern.

Hover handling stays unchanged in Phase 6 — `setHover` is still called directly on the engine. (Per §6.2 of `ArchitecturePlan.md`, hover becomes main-thread-only in Phase 7; for Phase 6 it remains an engine method to minimize churn.)

### `SvgGameRoot.vue` click handlers

The click handlers at `SvgGameRoot.vue:175-221` currently call `engine.value.handleClick(...)`. Replace with `dispatcher.dispatch({ type: "input:click", worldX, worldY })`. The hover handler at `SvgGameRoot.vue:176` stays direct for Phase 6.

### Wiring in `SvgGameRoot.vue`

```ts
const soundManager = new SoundManager();
const host = new MainThreadHostBindings(soundManager);
const themeBundle = buildThemeBundle(mapThemeStore);
engine.value = new GameEngine(themeBundle, host);
const dispatcher = new MainThreadCommandDispatcher(engine.value);
useInput(gameStore, dispatcher, uiStore);
```

### Test impact

`tests/unit/input.test.ts` constructs `useInput` with a mock `EngineLike`. Replace with a mock `CommandDispatcher` that records dispatched commands and asserts on them — this is actually a cleaner test surface than the previous optional-methods interface, since you can assert the exact command shape rather than inferring intent from method calls.

---

## Phase 0–6 completion criteria

- [ ] `src/sim/` directory exists (adapters live in sibling `src/sim-adapters/`); the `check:sim-boundary` grep (chained into `npm run lint` alongside Biome) prevents imports from `src/stores/`, `src/components/`, `src/router/`, `src/sound/` inside `src/sim/`.
- [ ] Boundary policy enforced: `src/game/`, `src/towers/`, `src/enemies/` have zero *runtime* `useXxxStore()` calls by end of Phase 2; type-only imports allowed through Phase 6, removed in Phase 7.
- [ ] `GameEngine`, `TowerManager`, `Tower`, `Enemy`, `EnemyManager`, `WaveGraphTracker` have zero runtime calls to `useUiStore()`/`useMapThemeStore()`/`useGameStore()`/`usePersistStore()`.
- [ ] `SoundManager` is owned by the host; `GameEngine` references sound via `HostBindings.playSound`, `TowerManager`/`Tower` via the narrower `SoundPlayer.playSound`.
- [ ] No remaining `SoundManagerRef` interfaces anywhere in `src/`. No remaining `this.sound` references in `GameEngine.ts`.
- [ ] `GameRunState` and `PersistState` plain interfaces exist as the authoritative state on `GameEngine`. No Pinia stores on the engine (no `gameStore`/`persistStore` fields).
- [ ] `WaveGraphTracker` reads from `runState`/`persistState` directly (no Pinia stores).
- [ ] `SimulationSnapshot` and `Command` schemas are defined; `buildSnapshot` produces a complete snapshot; render managers consume snapshots.
- [ ] `projectSnapshotMeta()` wires snapshot scalar state into `gameStore` so Vue components render correct values (HUD, shop, TowerPanel).
- [ ] Input and SVG click handlers dispatch commands through `CommandDispatcher`; no direct `engine.method()` calls outside the dispatcher (except `selectTower`/hover which are documented tech debt until Phase 7).
- [ ] The app is fully functional by the end of Phase 6 — all rendering, input, game logic, and persist save/load work correctly.
- [ ] Any remaining broken tests (mechanical mocks not yet updated) pass by the end of Phase 6.

Once these are met, the codebase is ready for Phases 7–9 (the actual worker migration). See `plans/ArchPrepPhases7-9.md`.