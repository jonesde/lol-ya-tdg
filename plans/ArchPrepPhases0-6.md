# Architecture Prep — Phases 0–6

**Scope:** implementation notes for the behavior-preserving restructuring described in `plans/ArchitecturePlan.md`. Phases 0–6 leave the simulation on the **main thread** but reshape it so the worker migration (Phases 7–9) becomes a localized swap, not a rewrite. At every phase boundary the test suite must stay green.

**Audience:** developer with strong general software background. Game-specific terms (`requestAnimationFrame`, fixed-timestep accumulator, entity component system, sprite, `postMessage`, structured clone, `SharedArrayBuffer`) are used without softening; look them up as needed. Code examples are illustrative of shape and contract, not literal drop-in patches — surrounding imports and existing line context should be respected.

**Reading order:** Phase 0 (`HostBindings`) is the load-bearing prerequisite. Every subsequent phase depends on it. Phases 1–6 are largely independent of each other but follow the listed order for lowest risk.

---

## Cross-cutting: new module layout

Create a new directory `src/sim/` to hold the new simulation contracts. Anything that will eventually live inside the worker goes here. Existing files in `src/game/`, `src/towers/`, `src/enemies/` are migrated into `sim/`-aware shape over the phases; the directory itself is the build-time boundary that the future worker entry will import from.

```
src/sim/
├── HostBindings.ts             # Phase 0 — the host interface (SoundName, SoundPlayer, HostBindings, ThemeBundle)
├── GameRunState.ts             # Phase 1 — plain run-state interface + pure helpers
├── PersistState.ts             # Phase 1 — plain persist-state interface + pure logic
├── RunStateSync.ts             # Phase 1 — centralized dual-write helpers (gameStore + runState)
├── Command.ts                  # Phase 5 — discriminated-union command schema
├── CommandDispatcher.ts        # Phase 6 — the dispatcher interface
├── SimulationSnapshot.ts       # Phase 5 — DTO schema + entity snapshot types
├── SpatialIndex.ts             # Phase 5 (interface only; implementation deferred until pile-up feature)
└── SnapshotSerializer.ts       # Phase 5 — entity → snapshot DTO conversion
```

Adapters that depend on Pinia/DOM live **outside** `src/sim/` (they import from `src/sim/` but are not imported by the worker):
- `src/sim/MainThreadHostBindings.ts` — Phase 0 adapter (imports `SoundManager`, `uiStore`, `persistStore`)
- `src/sim/MainThreadCommandDispatcher.ts` — Phase 6 adapter (imports `GameEngine`)

The split keeps `src/sim/` itself free of any `src/stores/` import, while the adapters — which the worker never imports — can reach into Pinia freely.

The directory forms a **build-time boundary**: it must not import anything from `src/stores/`, `src/components/`, `src/router/`, or `src/sound/`. **The project uses Biome (not ESLint) for linting** (see `biome.json` and `package.json`'s `lint` script), and Biome has no `no-restricted-imports`-equivalent rule. The boundary is therefore enforced by a **small custom script** wired into `package.json`:

- Add `scripts/check-sim-boundary.ts` (run via `tsx` or compiled) that walks every `.ts` file under `src/sim/` and fails if any `import ... from "@/stores/..."`, `import ... from "@/components/..."`, `import ... from "@/router/..."`, or `import ... from "@/sound/..."` is found. The two `MainThread*` adapter files (`src/sim/MainThreadHostBindings.ts`, `src/sim/MainThreadCommandDispatcher.ts`) are the **only** files exempted — they live under `src/sim/` but explicitly import stores; the script's exemption list is exactly those two filenames (do **not** exempt by directory glob, or a future file would silently bypass the rule).
- Add `"check:sim-boundary": "tsx scripts/check-sim-boundary.ts"` to `package.json` and chain it into the existing `lint` script (`"lint": "biome check . && npm run check:sim-boundary"`) so it runs in CI and on every `npm run lint`.
- A grep-only fallback (one-liner in CI) is acceptable as a stopgap if `tsx` isn't already a dev dependency — but prefer the script so the failure message can name the offending file and import line.

This is what prevents accidental transitive coupling to Pinia — see Risk §7.5 in `ArchitecturePlan.md`. The rule is in place from Phase 1 onward (Phase 0 only adds `HostBindings.ts` and `MainThreadHostBindings.ts`; the script can be added in Phase 0 or Phase 1 — recommend Phase 0 so the boundary is enforced the moment `src/sim/` exists).

### Boundary policy for migration-target directories

`src/game/`, `src/towers/`, `src/enemies/` are the **migration targets** — they will eventually run inside the worker. They do not move into `src/sim/` immediately; they are reshaped in place across Phases 0–6. Their import policy is staged:

- **During Phases 0–6:** these directories may import `src/stores/` *types* (`import type { GameStore }`) for the parallel-mirror period (Phase 1) and for remaining constructor parameters that haven't yet been swapped. **Runtime** calls to `useXxxStore()` must reach zero by end of Phase 2 (Pinia-elimination phase). Type-only imports are permitted through Phase 6 and removed in Phase 7 when the constructor signatures drop the Pinia args entirely.
- **`src/game/WaveGraphTracker.ts`** is in `src/game/` and follows the `src/game/` policy — it is not part of the `src/sim/` strict boundary during Phases 0–6, but its Pinia store imports become type-only in Phase 1 and are removed in Phase 7.
- **End of Phase 7:** the worker entry imports only from `src/sim/`, `src/game/`, `src/towers/`, `src/enemies/`, `src/grid/`, `src/waves/`, `src/render/themes/` (for theme types). No `src/stores/` imports transitively reachable from the worker entry.

---

## Phase 0 — `HostBindings` interface

### Goal
Replace every direct call from the simulation into UI/sound/persistence modules with a call through an injected interface. Today the interface is implemented by a main-thread adapter that simply forwards to the existing modules. When the worker lands (Phase 7), the same interface is implemented by a thin shim that calls `worker.postMessage` and returns/Promises the result. **No behavior change.**

### The interface

`src/sim/HostBindings.ts`:

```ts
import type { MapThemeData } from "@/render/themes/index.js";

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
  // Phase 1 defines the full PersistState; this is a view of it.
  gems: number;
  bestWaves: Record<string, number>;
  activeWaves: Record<string, number>;
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
  runHistory: unknown[];
  // ... (full slice enumerated in Phase 1)
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
export type SoundName =
  | "shoot_basic" | "shoot_sniper" | "shoot_cannon"
  | "shoot_ice" | "shoot_lightning" | "shoot_railgun"
  | "place" | "base_hit" | "boss_die" | "sell" | "cancel";
```

### Main-thread adapter

`src/sim/MainThreadHostBindings.ts` (lives outside the `sim/` boundary since it imports stores — this is fine, it's the *adapter*, not the contract):

```ts
import type { HostBindings, ConfirmPayload, PersistStateSlice, UiEvent } from "./HostBindings.js";
import { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

export class MainThreadHostBindings implements HostBindings {
  private sound: SoundManager;
  // Stores are fetched lazily inside each method — Pinia stores must be
  // accessed after createPinia() has run, which may be later than adapter
  // construction if the adapter is built early. This mirrors the current
  // pattern in GameEngine.ts where useUiStore() is called inside methods.

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
        // Route to gameStore.triggerEnd. The payload is the full
        // EndScreenPayload (includes victory, wave, gems, gemBreakdown).
        // gameStore.triggerEnd signature is (victoryFlag, data: Omit<EndScreenPayload, "victory">),
        // so split the payload: pass victory as the flag, rest as data.
        const gameStore = useGameStore();
        const { victory, ...data } = event.payload;
        gameStore.triggerEnd(victory, data);
        break;
      }
    }
  }

  schedulePersistSave(state: PersistStateSlice): void {
    const persistStore = usePersistStore();
    // Field-by-field assignment (not Object.assign on $state) to preserve
    // Pinia's fine-grained reactivity — Object.assign on $state can bypass
    // reactivity tracking in some Pinia versions. Phase 7+ will replace
    // the body with a worker → main postMessage handler that does the same
    // field-by-field write. Phase 9 enumerates the full field set; this
    // Phase 0 version covers the slice fields defined so far.
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

**Adopted: (b).** A larger Phase 0 diff, but it establishes the "sound is fully decoupled" property at the seam rather than half-routing and leaving the other half for later. Phase 3 becomes a trivial cleanup phase. The "no behavior change" claim still holds — `MainThreadHostBindings.playSound` just forwards to `SoundManager.play`, which is what the direct calls did.

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
   - **Rename the method at 5 call sites**: `TowerManager.ts:136,147,157` (`this.sound.play("place"|"sell"|"cancel")` → `this.sound.playSound(...)`) and `Tower.ts:808,841` (`sound.play(\`shoot_${this.type}\`)` → `sound.playSound(\`shoot_${this.type}\` as SoundName)`).

3. `TowerManager.ts:184` calls `tower.update(dt, enemyManager, this.projectiles, this.sound)`. The `sound` parameter on `Tower.update` (`Tower.ts:664,776`) is re-typed from `SoundManagerRef` to `SoundPlayer` (covered in step 2 above). The call sites at `Tower.ts:808,841` (`if (sound) sound.play(\`shoot_${this.type}\`)`) become `if (sound) sound.playSound(\`shoot_${this.type}\` as SoundName)`. (The cast is because template-literal types don't narrow to the union; see Phase 3's implementation note about making `SoundName` a template-literal type.)

### What stays the same in Phase 0

- `GameEngine.ts:91` (`this.sound = new SoundManager()`) — **deleted** in Phase 0 (the host owns the SoundManager now).
- `GameEngine.ts:204,267` direct `this.sound.play(...)` calls — **routed through `this.host.playSound(...)` in Phase 0** (not deferred to Phase 3).
- `GameEngine.ts:125` `useUiStore().initForRun(null)` — leave for Phase 2.
- `GameEngine.ts:202,443` `this.persistStore.save()` — leave for Phase 7.
- `GameEngine.ts:610-623` `useUiStore().showConfirm(...)` + `useMapThemeStore()` — leave for Phase 4.
- `GameEngine.dispose()` at `GameEngine.ts:701` calls `this.sound.dispose()` — **deleted** in Phase 0; the host owns disposal now.

Phase 0 adds the seam and routes all sound through it. UI, persistence, and confirm stay direct until their respective phases. This keeps the sound-decoupling property established at the seam while leaving the other couplings for their dedicated phases.

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

## Phase 1 — Plain state objects

### Goal
Introduce `GameRunState` and `PersistState` as plain TypeScript interfaces. `GameEngine` (and `WaveGraphTracker`) hold references to these *in addition to* (not yet *instead of*) the Pinia stores during this phase. Each method that currently writes `this.gameStore.gold += x` adds a parallel write to `this.runState.gold`. The Pinia store remains the source of truth for Vue reactivity; the plain state is a parallel mirror that becomes authoritative in Phase 7.

The phase is behavior-preserving because nothing reads from the plain state yet. We are only establishing the data structure and proving that every mutation site is reachable.

### `GameRunState`

`src/sim/GameRunState.ts`:

```ts
import type { GameState } from "@/game/Constants.js";
import type { TowerId } from "@/game/ConstantsTower.js";
import type { GeneratedMap } from "@/grid/Map.js";
import type { Grid } from "@/grid/Grid.js";

// Mirrors GameStateShape in src/stores/game.ts:76-106. The Pinia store
// remains the source of truth in Phase 1; this is a parallel plain mirror.
// In Phase 7, this becomes authoritative and the Pinia store becomes a
// projection of the snapshot produced from it.
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
  selectedTowerId: string | null;       // NOTE: id, not Tower ref — Phase 5
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
  camera: { x: number; y: number; zoom: number };
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

// Pure helpers — these are the bodies of the corresponding gameStore actions
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
import type { GeneralAddons } from "@/stores/persist.js";  // re-export the existing interface

// Mirrors PersistStateShape in src/stores/persist.ts:28-47. Same caveat as
// GameRunState: parallel mirror in Phase 1, authoritative in Phase 7.
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
  // ... (copy PersistStateShape field-by-field)
}

// Pure functions extracted from persist.ts:191-298. These currently mutate
// `this` on the Pinia store and call this.save(); the pure versions mutate
// the plain state and return a "dirty" flag the caller uses to decide
// whether to schedule a persist save via HostBindings.

export function updateBestWave(state: PersistState, mapIndex: number, wave: number): boolean {
  const key = `best_${mapIndex}`;
  const prev = typeof state.bestWaves[key] === "number" ? state.bestWaves[key] : 0;
  if (wave > prev) {
    state.bestWaves[key] = wave;
    return true;  // dirty
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

Add two fields, construct them at init, and pair every `gameStore`/`persistStore` write with a plain-state write:

```ts
export class GameEngine {
  runState!: GameRunState;
  persistState!: PersistState;
  // Set to true whenever a persist-state mutation occurs (gems, bestWaves,
  // firstTimeMilestones, firstClears, runHistory, activeWaves, highestUnlockedMap).
  // The SnapshotSerializer (Phase 5) reads this; the host (Phase 7+) flushes
  // localStorage when the snapshot's persistDirty is true. Reset to false
  // after each snapshot is built (Phase 5) or after the host flushes (Phase 7+).
  // Phase 1 adds the field and sets it true at every persist mutation site
  // (onBossKilled, onWaveCleared, endGame, etc.) — concretely, in the same
  // lines that call syncAddPersistGems or other persist-mutating sync helpers.
  persistDirty: boolean = false;
  // ... existing fields ...

  _initMap(mapIndex: number, mapData: GeneratedMap): void {
    // Build the plain-state mirrors alongside the existing Pinia writes.
    this.runState = {
      state: GameState.PLAYING,
      mapIndex,
      map: mapData,
      grid: null,  // set after Grid construction below
      lives: 20,
      gold: StartingGold[mapData.regionId]!,
      // ... initialize all fields per gameStore.initMap at game.ts:209-238
    };
    this.persistState = this.snapshotPersistState();  // copy from persistStore.$state

    this.host.notifyUi({ type: "initForRun", mapIndex });   // still also call useUiStore().initForRun() for now
    this.gameStore.initMap(mapIndex, mapData, null);
    // ... existing _initMap body ...
    this.runState.grid = this.grid;
  }

   // Helper: deep-copy the persistStore.$state into a plain PersistState.
   // Used at init and at any point the persist state is known to have been
   // mutated externally (rare; mainly for safety).
   // structuredClone is available in all target environments (Node 18+,
   // Chrome 98+, Firefox 94+, Safari 15.4+) — no polyfill needed.
   //
   // Test compatibility: persistStore.$state is a Pinia reactive proxy.
   // structuredClone on a Pinia proxy works (Pinia proxies are plain objects
   // under the hood), but test fixtures that mock persistStore with partial
   // objects (not full Pinia stores created via createPinia() + usePersistStore())
   // may have missing fields. Verify all test fixtures in tests/helpers/mock-stores.ts
   // construct a complete persist store state — either via the real Pinia store
   // or via a complete plain object matching PersistStateShape (persist.ts:28-47).
   private snapshotPersistState(): PersistState {
     return structuredClone(this.persistStore.$state) as PersistState;
   }
}
```

Then, for each existing mutation, add the parallel write. Examples:

| Current code | Add |
|---|---|
| `this.gameStore.lives += STARTING_HEALTH_BONUS[ehTier]` (`GameEngine.ts:172`) | `this.runState.lives += STARTING_HEALTH_BONUS[ehTier]` |
| `this.gameStore.gold += STARTING_GOLD_BONUS[sgTier]` (`GameEngine.ts:179`) | `this.runState.gold += STARTING_GOLD_BONUS[sgTier]` |
| `this.gameStore.bossesKilledThisRun++` (`GameEngine.ts:184`) | `this.runState.bossesKilledThisRun++` |
| `this.persistStore.gems += afterRegion` (`GameEngine.ts:200`) | `this.persistState.gems += afterRegion` |
| `this.gameStore.addGold(amount)` (`GameEngine.ts:393`, via `earnGold`) | `applyGold(this.runState, amount)` |

**Do not yet remove the Pinia writes.** Phase 1 is additive. The plain-state mirror is unused on the read path; it exists only to prove the mutation surface is fully covered.

### Drift prevention

The parallel-mirror pattern is fragile: a developer adding a new gold mutation might write `this.gameStore.gold += x` and forget the paired `this.runState.gold += x`, causing the plain state to drift from the Pinia state. Phase 7's cutover would then surface the drift as a regression (the plain state becomes authoritative; missed mutations show as missing gold/lives/etc.).

**Recommended mitigation:** centralize the dual-write in a helper and lint against direct field writes outside it.

```ts
// src/sim/RunStateSync.ts
import type { GameRunState, GemBreakdown, EndScreenPayload } from "./GameRunState.js";
import type { GameStore } from "@/stores/game.js";
import type { PersistState } from "./PersistState.js";
import type { PersistStore } from "@/stores/persist.js";
import type { Tower } from "@/towers/Tower.js";  // for syncSelectTower below

// Every dual-write goes through one of these. A custom check (either a
// small script similar to the sim-boundary check, or a Biome-specific
// approach) flags `this.gameStore.<field> =` or
// `this.runState.<field> =` outside this module.
//
// Full enumeration of dual-written fields, derived from auditing every
// mutation site in GameEngine (_initMap, _applyStartingBonuses, onBossKilled,
// onWaveCleared, onWaveStart, onEnemyKill, earnGold, endGame, loop, handleClick,
// upgradeSelected, specializeSelected, executeSellById, cancelSelected,
// downgradeSelected, setHover, togglePause, cycleSpeed, etc.):

// --- Gold (mutation sites: _applyStartingBonuses, earnGold, handleClick,
//     upgradeSelected, specializeSelected, executeSellById, cancelSelected,
//     downgradeSelected) ---
export function syncAddGold(gs: GameStore, rs: GameRunState, amount: number): void {
  gs.gold += amount; rs.gold += amount;
}
export function syncSetGold(gs: GameStore, rs: GameRunState, value: number): void {
  gs.gold = value; rs.gold = value;
}

// --- Lives (mutation sites: _applyStartingBonuses, loop via loseLives,
//     onWaveStart slow healing) ---
export function syncAddLives(gs: GameStore, rs: GameRunState, delta: number): void {
  gs.lives += delta; rs.lives += delta;
}
export function syncSetLives(gs: GameStore, rs: GameRunState, value: number): void {
  gs.lives = value; rs.lives = value;
}

// --- Bosses killed/reached (mutation sites: onBossKilled, loop) ---
export function syncIncBossesKilled(gs: GameStore, rs: GameRunState): void {
  gs.bossesKilledThisRun++; rs.bossesKilledThisRun++;
}
export function syncIncBossesReached(gs: GameStore, rs: GameRunState): void {
  gs.bossesReachedBaseThisRun++; rs.bossesReachedBaseThisRun++;
}

// --- Run gems earned (mutation sites: onBossKilled, onWaveCleared, endGame) ---
export function syncAddRunGems(gs: GameStore, rs: GameRunState, amount: number): void {
  gs.runGemsEarned += amount; rs.runGemsEarned += amount;
}

// --- Persist gems (mutation sites: onBossKilled, onWaveCleared, endGame) ---
// NOTE: every call site that calls this helper MUST also set
// `this.persistDirty = true` on the engine (the helper itself has no engine
// reference). Same for any other persist-mutating sync helper. The engine's
// persistDirty field (added in Phase 1 — see GameEngine changes below) is
// read by the Phase 5 SnapshotSerializer and reset to false after each
// snapshot build.
export function syncAddPersistGems(ps: PersistStore, pstate: PersistState, amount: number): void {
  ps.gems += amount; pstate.gems += amount;
}

// --- Wave (mutation sites: onWaveCleared, onWaveStart, _initMap) ---
export function syncSetWave(gs: GameStore, rs: GameRunState, wave: number): void {
  gs.currentWave = wave; rs.currentWave = wave;
}

// --- Time scale (mutation sites: cycleSpeed, cycleSpeedReverse) ---
export function syncSetTimeScale(gs: GameStore, rs: GameRunState, value: number): void {
  gs.timeScale = value; rs.timeScale = value;
}

// --- Game state (mutation sites: togglePause, stop, endGame) ---
export function syncSetState(gs: GameStore, rs: GameRunState, value: GameState): void {
  gs.setState(value); rs.state = value;
}

// --- Selection (mutation sites: handleClick, selectTower, executeSellById,
//     cancelSelected, endGame, cancelBuildMode) ---
// The helper takes a live `Tower | null` reference (the same value the
// existing gameStore.selectTower(tower) call sites pass today) and derives
// the id from it internally — the sim side stores the id, not the ref. No
// call site needs to pass (ref, id) together; the id is read off the ref.
// When `tower` is null, both sides clear selection.
export function syncSelectTower(gs: GameStore, rs: GameRunState, tower: Tower | null): void {
  gs.selectedTower = tower;                       // Pinia side keeps the live ref
  rs.selectedTowerId = tower ? tower.id : null;   // plain mirror keeps the id only
}

// --- Milestone rewards claimed (mutation sites: onWaveCleared) ---
export function syncClaimMilestone(gs: GameStore, rs: GameRunState, wave: number): void {
  gs.claimMilestone(wave); rs.milestoneRewardsClaimed[wave] = true;
}

// --- Gem breakdown (mutation sites: onBossKilled, onWaveCleared, endGame) ---
export function syncGemBreakdown(gs: GameStore, rs: GameRunState, breakdown: GemBreakdown): void {
  gs.gemBreakdown = breakdown; rs.gemBreakdown = breakdown;
}

// --- End screen data (mutation sites: endGame) ---
export function syncTriggerEnd(gs: GameStore, rs: GameRunState, payload: EndScreenPayload): void {
  gs.triggerEnd(payload.victory, { wave: payload.wave, gems: payload.gems, gemBreakdown: payload.gemBreakdown });
  rs.endScreenData = payload;
}

// --- Wave countdown (mutation sites: loop) ---
export function syncSetWaveCountdown(gs: GameStore, rs: GameRunState, value: { remaining: number; nextWave: number } | null): void {
  gs.waveCountdown = value; rs.waveCountdown = value;
}

// --- Hover (mutation sites: setHover) ---
export function syncSetHoverTile(gs: GameStore, rs: GameRunState, tile: { tileX: number; tileY: number } | null): void {
  gs.setHoverTile(tile); rs.hoverTile = tile;
}

// --- Upgrade btn click anim (mutation sites: handleClick) ---
export function syncSetUpgradeBtnAnim(gs: GameStore, rs: GameRunState, value: number): void {
  gs.upgradeBtnClickAnim = value; rs.upgradeBtnClickAnim = value;
}

// Fields NOT needing helpers (single mutation site, or pure UI):
//   camera — main-thread-authoritative, never written by the engine
//   mapIndex, map, grid — set once at _initMap, can be a direct dual-write there
//   randomMapParams — set once at init
```

Engine call sites become `syncGold(this.gameStore, this.runState, amount)` instead of two separate writes. The drift-detection check makes drift a lint-time error rather than a runtime regression. If the check is too much investment for Phase 1, the fallback is a code-review checklist item and the knowledge that Phase 7's cutover will surface any drift immediately — but recommend the helper approach for any field with more than two mutation sites.

### `WaveGraphTracker`

The current constructor at `src/game/WaveGraphTracker.ts:50-55` is `(gameStore, persistStore, towerManager, enemyManager)` — 4 params. Add `runState` and `persistState` as the **5th and 6th params** (at the end) to avoid breaking the existing call site at `GameEngine.ts:153-158`:

```ts
constructor(
  gameStore: GameStore,
  persistStore: PersistStore,
  towerManager: TowerManagerRef,
  enemyManager: EnemyManagerRef,
  runState: GameRunState,        // NEW — 5th param
  persistState: PersistState,    // NEW — 6th param
) { ... }
```

Update the `new WaveGraphTracker(...)` call at `GameEngine.ts:153-158` to pass `this.runState` and `this.persistState` as the 5th and 6th args. The same additive pattern applies to every read. **Full read inventory** (audit of `src/game/WaveGraphTracker.ts` — every `this.gameStore.<field>` and `this.persistStore.<field>` read must get a paired `this.runState.<field>` / `this.persistState.<field>` read):

| Line | Current read | Add paired plain-state read |
|---|---|---|
| `:64-65` (constructor) | `persistStore.gems` → `_prevGems`; `gameStore.lives` → `_intervalMinLives` | `persistState.gems` → `_prevGemsPlain`; `runState.lives` → `_intervalMinLivesPlain` |
| `:81` | `this.persistStore.gems` (current gems snapshot) | `this.persistState.gems` |
| `:88` | `this.gameStore.lives` (interval min check) | `this.runState.lives` |
| `:89,147` | `this.gameStore.lives` (write to internal `_intervalMinLives`) | `this.runState.lives` (paired read) |

The plan stores both the Pinia value and the plain-mirror value in separate internal fields during Phase 1 (e.g., `_prevGems` and `_prevGemsPlain`) and reads both at each site. Phase 7 drops the Pinia fields; the `_plain` fields become the only ones. If a future read site is added, the same dual-read pattern applies — the boundary script does not catch reads (it catches imports only), so this is a code-review checklist item for `WaveGraphTracker` specifically.

### Test impact

No test bodies change. `mock-stores.ts` adds construction of the plain-state objects (a fresh `GameRunState` initialized to defaults; a deep clone of the mock persist state). Tests that construct `GameEngine` directly need the plain-state arguments added — mechanical, low risk.

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

**Note on current constructor signatures** (to avoid confusion — verify against the source when implementing):

- `Enemy.ts:100-108` currently takes `(type, level, spawnIndex, grid, wave, difficultyTick, theme)` — **7 parameters** with `spawnIndex` and `difficultyTick` already present as separate parameters. Phase 2 adds `defaultVisual` as the **8th**. No other parameter changes.
- `Tower.ts:232-241` currently takes `(type, tileX, tileY, save, grid, theme, placedAt)` — **7 parameters**, no sound parameter (sound is passed to `Tower.update`, not the constructor). Phase 2 adds `defaultVisual` as the **8th** (after `placedAt`). Phase 3 does **not** change the Tower constructor — it changes the `Tower.update` method signature (`Tower.ts:664,776`) from `update(dt, enemyManager, projectileManager, soundManager)` to `update(dt, enemyManager, projectileManager, soundPlayer)` where `soundPlayer: SoundPlayer`. The constructor is unaffected by Phase 3.

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
```

`EnemyManager` (`src/enemies/EnemyManager.ts`) currently receives `theme` in its constructor (passed from `GameEngine.ts:136`). Extend it to also receive a `defaultVisuals: EnemyVisualIndex` — a plain `Record<EnemyType, EnemyVisualMeta>` — sourced from `mapThemeStore.defaultTheme`. `GameEngine` looks this up once at construction and passes it through. Same shape for `TowerManager` and `Tower`.

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
  gameStore: GameStore,
  persistStore: PersistStore,
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

**Why `ThemeBundle` instead of three separate constructor params:** `ThemeBundle` groups the active theme and the two default-visual indexes because they are sourced together from `mapThemeStore` and passed together into the engine and managers. Passing them as three separate constructor params achieves the same decoupling but spreads related data across the signature; the bundle keeps the grouping explicit and makes the "these travel together" invariant visible at the type level.

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

`main.ts` calls `populateSkillTreeTheme(...)` after the default theme is preloaded. The existing `try { useMapThemeStore() } catch {}` pattern (`SkillTree.ts:121-126`) goes away — the neutral defaults handle the pre-theme case, and the populate function handles the post-theme case deterministically. The current `main.ts` has no such call — it must be added explicitly:

```ts
// src/main.ts (add the populate call after preloadDefault, before app.mount)
import { populateSkillTreeTheme } from "@/towers/SkillTree.js";
import { TowerIds } from "@/game/ConstantsTower.js";

// ... existing createApp, pinia, router setup ...

usePersistStore().load();
try {
  await useMapThemeStore().preloadDefault();
  // NEW: populate SKILL_TREE display fields from the now-loaded default theme.
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

app.mount("#app");
```

**Ordering mitigation:** `main.ts` already calls `mapThemeStore.preloadDefault()` synchronously before `app.mount()` (per `README.md` line 365). The `populateSkillTreeTheme(...)` call goes immediately after `preloadDefault()` and before `app.mount()`, so the populate runs before any route component (including `/skill-tree`) can mount. Additionally, add a defensive re-populate in `SkillTree.vue`'s setup that checks whether `SKILL_TREE` is still neutral (e.g., `SKILL_TREE.basic.name === ""`) and calls `populateSkillTreeTheme` again if so — this makes the ordering deterministic regardless of which route the user enters on first, and guards against any future change to `main.ts`'s init sequence.

### Test impact

Tests that construct `Enemy`/`Tower` directly (e.g., `tests/unit/enemies.test.ts`, `tests/unit/towers.test.ts`) need the new `defaultVisual` parameter — pass `null` or the existing `mockDefaultTheme` visual. The `SkillTree` tests should verify both the neutral-default state and the post-populate state.

---

## Phase 3 — Sound decoupling (cleanup)

### Goal
Phase 0 already routed all sound through `HostBindings` (and `SoundPlayer` for `TowerManager`/`Tower`). Phase 3 is now a **trivial cleanup phase**: delete the now-dead `SoundManagerRef` interface, verify no remaining `this.sound` references, and apply the `SoundName` template-literal improvement. No behavior change — the routing is already done.

### Changes

1. **Verify deletion of `this.sound` field on `GameEngine`** (already done in Phase 0). Grep for any remaining `this.sound` references in `GameEngine.ts` — there should be none.

2. **Verify deletion of both `SoundManagerRef` interfaces** (already done in Phase 0). Phase 0 deleted the interface at `TowerManager.ts:78-80` **and** the identical one at `Tower.ts:137-139`, replacing both with `import type { SoundPlayer }`. Grep for any remaining `SoundManagerRef` references across `src/` — there should be none. If any remain, delete them and switch to `SoundPlayer`. This step is a verification gate, not new work.

3. **Apply the `SoundName` template-literal improvement** (recommended, low effort — eliminates the `as SoundName` cast at `Tower.ts:808,841` and gives compile-time safety against typos in shoot sound names):
   ```ts
   export type ShootSoundName = `shoot_${TowerId}`;
   export type SoundName = ShootSoundName | "place" | "base_hit" | "boss_die" | "sell" | "cancel";
   ```
   This lets `Tower.ts:808` drop the `as SoundName` cast (`host.playSound(\`shoot_${this.type}\`)` is now type-safe when `this.type` is a `TowerId`). Compile-time safety against typos in shoot sound names.

### Test impact

`tests/unit/sound-manager.test.ts` continues to test `SoundManager` directly — no change. Engine/tower/enemy tests that previously asserted on `mockSound.play` calls now assert on `mockHost.soundsPlayed` (the `MockHostBindings` from Phase 0 already collects this).

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
      → engine.executeSellById(towerId) runs  (towerId captured at request time)
  → User clicks "Keep" (or hits Escape)
      → Promise resolves false
      → engine does nothing
```

### `GameEngine.sellSelected` rewrite

The tower id is **captured at the time of the confirm request**, not at resolution time — selection could change between dialog-open and confirm. The new `executeSellById(towerId)` method (defined below) takes the id explicitly, matching the `Command` schema's `action:executeSell` which carries `towerId` (see §6.2 of `ArchitecturePlan.md`).

```ts
async sellSelected(): Promise<void> {
  const gameStore = this.gameStore;
  if (!gameStore.selectedTower) return;

  // Preserved early-return: when sell is disabled (discount mode), do nothing.
  // This gate stays in the engine so the UI never sees a confirm request
  // when selling is disabled.
  if (this.persistStore.generalAddons.sellActive === "discount") {
    return;
  }

  const tower = gameStore.selectedTower;
  const towerId = tower.id;  // capture at request time
  const isRefund = this.persistStore.generalAddons.sellActive === "refund";
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

// New method — added in Phase 4, not Phase 7. Phase 7's WorkerEntry.applyCommand
// references this method for the action:executeSell command.
//
// By Phase 4, the engine holds both this.persistStore (Pinia) and this.persistState
// (plain mirror from Phase 1). This method reads from this.persistState (the plain
// mirror) to stay consistent with the Phase 1 parallel-mirror pattern and to
// prepare for Phase 7 where persistStore is dropped entirely. The persistStore.$state
// argument to towerManager.sell() is replaced with this.persistState.
executeSellById(towerId: string): void {
  const tower = this.towerManager?.getTowerById(towerId);
  if (!tower) return;

  const isRefund = this.persistState.generalAddons?.sellActive === "refund";
  const value = isRefund ? tower.totalInvested : this.towerManager!.sell(tower, this.persistState);

  this.gameStore.setGold(this.gameStore.gold + value);
  this.runState.gold += value;  // Phase 1 parallel-mirror write
  this.totalGoldEarned += value;
  this.gameStore.selectTower(null);
  this.runState.selectedTowerId = null;  // Phase 1 parallel-mirror write
}
```

### Why `async` is safe here

`sellSelected` is currently synchronous and called from `Input.ts` (`engine?.sellSelected?.()` at line 132) and `TowerPanel.vue` (`gameStore.engine?.sellSelected()` at line 125). Both use optional chaining and ignore the return value — making it `async` means callers receive a `Promise<void>` they can ignore. Optional chaining on an async function is fine; the returned promise is simply discarded. The engine's update loop does not call `sellSelected` — it's purely input-driven — so there is no risk of the engine stalling mid-tick waiting for a dialog. The engine's main loop (`GameEngine.loop`) is synchronous and never awaits; only user-initiated action handlers do.

### `downgradeSelected`

Currently synchronous and has no confirm dialog (`GameEngine.ts:652-657`). No change in Phase 4. If a confirm dialog is ever desired for downgrade, the same `requestConfirm` pattern applies.

### Test impact

`game-engine.test.ts` tests covering the sell flow need to `await` the now-async `sellSelected`. The `MockHostBindings.confirmResult` field (Phase 0) controls the resolution — set it before calling `sellSelected()` so the Promise resolves synchronously on the next microtask. Tests that previously inspected `uiStore.confirmDialog` directly can still do so — `MainThreadHostBindings` calls `uiStore.showConfirm`, so the same state transitions occur. Any test that asserts on post-sell state (gold, selection) must `await sellSelected()` before asserting, or the assertions will run before the Promise resolves.

---

## Phase 5 — Snapshot and Command schema

### Goal
Define the `SimulationSnapshot` and `Command` types. The `SnapshotSerializer` maps `Enemy` and `Tower` directly into plain `EnemySnapshot` / `TowerSnapshot` DTOs (no `getRenderData()` method is added to those entity classes — the serializer owns the field-by-field mapping, which keeps the entity classes free of rendering concerns and avoids an extra method per entity). `ProjectileManager` and `ParticleSystem` already expose `getRenderData()` returning plain DTO arrays (`src/game/ProjectileManager.ts:774`, `src/game/ParticleSystem.ts:70`); the serializer **reuses** those existing methods and their existing return types (see the ProjectileSnapshot / ParticleSnapshot reuse note below). Update render managers' `syncFromGameEngine` signatures to accept snapshot arrays. The engine still runs on the main thread; snapshots are produced but consumed locally. **No behavior change** — the render path is exercised end-to-end via the new DTO path, proving the schema is complete before the worker migration.

### Performance note: Phase 5 serialization overhead

At Phase 5 the engine is still on the main thread, so `buildSnapshot` every frame is pure overhead with no decoupling benefit yet (the decoupling lands in Phase 7 when the worker produces the snapshot). The 60Hz `buildSnapshot` call mapping ~200 enemies + towers into new DTOs is a measurable cost.

**Why accept it:** exercising the snapshot path end-to-end *before* the worker migration proves the schema is complete and the render managers consume it correctly. A bug discovered in Phase 5 (main thread, easy to debug) is far cheaper than a bug discovered in Phase 7 (worker round-trip, harder to debug).

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
  // @tech-debt PHASE 6 STUB — PROMINENT: this command variant is DEFINED in
  // the schema here in Phase 5 but is NOT DISPATCHED by Phase 6's applyCommand
  // (it's a no-op `break` there). Phase 7 implements engine.selectTowerById(id)
  // and wires this case. The command exists in the schema now so Phase 7
  // doesn't need to add a new variant. For Phases 5–6, the existing
  // gameStore.selectTower(tower) calls in Input.ts and SvgGameRoot.vue stay
  // direct (not via the dispatcher). See Phase 6 "Known tech debt" callout.
  | { commandId: number; type: "action:selectTower"; towerId: string | null }

  // ---- Lifecycle ----
  | { commandId: number; type: "lifecycle:init"; persistState: PersistState; themeBundle: ThemeBundle; mapIndex: number; randomMapParams?: unknown }
  | { commandId: number; type: "lifecycle:dispose" }
  // NOTE: lifecycle:setTheme is omitted — mid-run theme switching is out of scope per README.md.
  //   If it ever becomes in-scope, add a `lifecycle:setTheme` command then.

  // ---- Future LLM commands (stubs — implementations deferred to commander plane) ----
  | { commandId: number; type: "llm:routeGroup"; groupId: string; waypoints: Array<{ x: number; y: number }> }
  | { commandId: number; type: "llm:setTargeting"; enemyIds: string[]; mode: string }
  | { commandId: number; type: "llm:holdFormation"; groupId: string; chokepointId: string; untilWave: number }
```

### `SimulationSnapshot` schema

`src/sim/SimulationSnapshot.ts`:

```ts
import type { GameRunState } from "./GameRunState.js";
import type { PersistState } from "./PersistState.js";
import type { ProjectileManager } from "@/game/ProjectileManager.js";
import type { ParticleSystem } from "@/game/ParticleSystem.js";

export interface SimulationSnapshot {
  schemaVersion: number;       // bump on incompatible schema changes; consumers reject mismatches
  frameId: number;             // monotonic per-tick counter
  lastAppliedCommandId: number; // host uses this to confirm command application (see §6.2 of ArchitecturePlan.md)
  meta: SnapshotMeta;
  enemies: EnemySnapshot[];
  towers: TowerSnapshot[];
  projectiles: ProjectileSnapshot[];
  particles: ParticleSnapshot[];
  spawnStates: SpawnStateSnapshot[];   // for spawn-queue overlay renderer
  persistDirty: boolean;                // host flushes to localStorage when true
}

export interface SnapshotMeta {
  // Scalar state mirrored from GameRunState. Subset that the renderer/UI need.
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
  camera: { x: number; y: number; zoom: number };
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
  // Status effect list — fixed-cap encoding for SAB-friendliness (see §6.1 of ArchitecturePlan.md).
  // Phase 5: ship as a plain array; Phase 7+ can switch to fixed-cap typed arrays.
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
}

// Projectile and Particle snapshots: REUSE the existing DTO types, do NOT
// define new ones. The existing methods already return plain arrays:
//   - ProjectileManager.getRenderData() at src/game/ProjectileManager.ts:774
//     returns Array<{ id: number; x: number; y: number; radius: number; color: string }>
//   - ParticleSystem.getRenderData() at src/game/ParticleSystem.ts:70
//     returns RenderParticle[] (defined inline in ParticleSystem.ts)
// The SimulationSnapshot's `projectiles` and `particles` fields are typed as
// the existing return types (import them as type-only aliases), not new
// interfaces. If a render manager later needs a field the existing DTO lacks,
// extend the existing DTO at its definition site — do not introduce a parallel
// ProjectileSnapshot/ParticleSnapshot type that requires mapping. The two
// alias lines below express this: they re-export the existing types under
// the snapshot-consistent names so the snapshot schema reads cleanly.
export type ProjectileSnapshot = ReturnType<ProjectileManager["getRenderData"]>[number];
export type ParticleSnapshot = ReturnType<ParticleSystem["getRenderData"]>[number];

// If during the Phase 5 render-manager audit a field is found missing from
// the existing DTO, the fix is: add the field to the inline DTO type in
// ProjectileManager.ts / ParticleSystem.ts, populate it in getRenderData(),
// and it flows through here automatically. Do NOT define a parallel type.

// Mirrors SpawnState from src/render/themes/index.ts:71-74 — plain data,
// no methods. The render manager at SvgGameRoot.vue:329-330 reads spawnStates
// directly via SpawnManager.sync (src/render/svg/SpawnManager.ts), which
// reads only `spawnState.visualState`. The closeTransitionTimer field is
// included for completeness and matches the source shape.
export interface SpawnStateSnapshot {
  visualState: "closed" | "transition" | "open";
  closeTransitionTimer: number;
}
```

### `SnapshotSerializer`

`src/sim/SnapshotSerializer.ts`:

```ts
import type { Enemy } from "@/enemies/Enemy.js";
import type { Tower } from "@/towers/Tower.js";
import type { GameEngine } from "@/game/GameEngine.js";
import type { GameRunState } from "./GameRunState.js";
import type {
  SimulationSnapshot, EnemySnapshot, TowerSnapshot,
  ProjectileSnapshot, ParticleSnapshot, SnapshotMeta,
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
    persistDirty: engine.persistDirty,  // added in Phase 1; set true by every persist mutation site
  };
  // After building the snapshot, reset the dirty flag so the next frame only
  // signals a flush when a new persist mutation occurred. (Phase 5 does this
  // in the serializer; Phase 7+ does it in the host after flushing.)
  engine.persistDirty = false;
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
    // Enemy has no `activeEffects` field. Status effects are stored as
    // individual fields on Enemy (src/enemies/Enemy.ts:79-95):
    //   slowStack: SlowEntry[]   — array of { eff, remaining }
    //   stunTimer: number         — remaining stun time
    //   burnTimer: number         — remaining burn time
    //   burnDps: number           — burn damage per second
    //   markTargetMult: number    — mark multiplier (0 = not marked)
    //   markTargetTimer: number   — remaining mark time
    //   shield: number            — current shield
    //   slowFactor: number        — aggregate slow factor (1.0 = not slowed)
    // Build the statusEffects array from these individual fields:
    statusEffects: buildEnemyStatusEffects(e),
  };
}

function buildEnemyStatusEffects(e: Enemy): StatusEffectSnapshot[] {
  const effects: StatusEffectSnapshot[] = [];
  if (e.slowFactor < 1) {
    // Aggregate slow — magnitude is (1 - slowFactor) so the renderer can
    // show "50% slowed" etc. remaining is the max of slowStack entries.
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
// buildMeta extracts scalar fields from engine.runState (Phase 1) or
// engine.gameStore (Phase 5 fallback if runState isn't fully populated yet).
```

The exact field set for `snapshotEnemy` and `snapshotTower` must be derived by auditing the render managers' `syncFromGameEngine` methods. The audit is mechanical but must be complete — a missing field is a silent render regression.

### Render manager signature updates

All **six** `syncFromGameEngine` methods in `src/render/svg/*.ts` change their parameter types from live entity arrays to snapshot arrays. Audit each one for the full field set it reads:

| File | Current signature | After | Fields read (audit each) |
|---|---|---|---|
| `EnemyManager.ts:17` | `syncFromGameEngine(enemies: Enemy[])` | `syncFromGameEngine(enemies: EnemySnapshot[])` | position, hp, status effect visuals (slow color, stun, burn), walking frame, hit flash, shield, boss flag |
| `TowerManager.ts:13` | `syncFromGameEngine(towers: Tower[], dt: number)` | `syncFromGameEngine(towers: TowerSnapshot[], dt: number)` | position, angle, level, variant, fire anim time, barrel rotation |
| `ProjectileManager.ts:22` | `syncFromGameEngine(projectiles: Projectile[])` | `syncFromGameEngine(projectiles: ProjectileSnapshot[])` | already DTO-based via `getRenderData()`; minimal change |
| `ParticleManager.ts:22` | `syncFromGameEngine(particles: Particle[])` | `syncFromGameEngine(particles: ParticleSnapshot[])` | already DTO-based via `getRenderData()`; minimal change |
| `EffectManager.ts:173` | `syncFromGameEngine(buildPreviewTilePos, selectedTowerType, buildPreviewColor, selectedTower, buildPreviewValid, dt)` | params unchanged (all UI-computed on main thread; no snapshot arrays) | reads `selectedTower` fields — change to `TowerSnapshot \| null` |
| `UiOverlayManager.ts:116` | `syncFromGameEngine(enemies: Enemy[], _selectedTower: Tower \| null)` | `syncFromGameEngine(enemies: EnemySnapshot[], _selectedTower: TowerSnapshot \| null)` | HP bars, shield bars, boss HP text — reads hp, maxHp, shield, maxShield, isBoss |

Additionally, `UiOverlayManager.syncPendingQueueOverlays(grid, enemyManager)` (`src/render/svg/UiOverlayManager.ts:222`, called at `SvgGameRoot.vue:327`) currently reads the spawn queue from the live `enemyManager`. In Phase 5 it changes to read from the snapshot's `spawnStates` array. The new signature drops the `enemyManager` parameter and takes the plain `SpawnStateSnapshot[]` instead (the `grid` parameter stays — it's still needed for tile→pixel conversion):

```ts
// Before (src/render/svg/UiOverlayManager.ts:222):
syncPendingQueueOverlays(grid: Grid, enemyManager: EnemyManager): void { ... }

// After:
syncPendingQueueOverlays(grid: Grid, spawnStates: SpawnStateSnapshot[]): void { ... }
```

Internally, every `enemyManager.<field>` read in the current method body becomes a read off the `spawnStates` array entries (each entry is a plain `SpawnStateSnapshot` with `visualState` and `closeTransitionTimer` — the only two fields the current method reads, verified against `src/render/themes/index.ts:71-74`). The call site at `SvgGameRoot.vue:327` changes from `uiOverlayManager.syncPendingQueueOverlays(grid, engine.value.enemyManager)` to `uiOverlayManager.syncPendingQueueOverlays(grid, snapshot.spawnStates)`.

```ts
// Example: src/render/svg/EnemyManager.ts:17
// Before:
syncFromGameEngine(enemies: Enemy[]): void { ... }
// After:
syncFromGameEngine(enemies: EnemySnapshot[]): void { ... }
```

Internally, each method reads the same fields off the snapshot objects that it previously read off the live entities. If a render manager reads a field not present on the snapshot, add the field to the snapshot interface and populate it in the serializer. **This audit step — covering all six managers — is what proves the schema is complete.**

### `SvgGameRoot.vue` render path

The render callback at `SvgGameRoot.vue:302-353` currently calls `enemyManager.syncFromGameEngine(enemies)` with live `Enemy[]` read from `gameStore.enemyManager`. In Phase 5 it instead builds a snapshot and passes the snapshot arrays:

```ts
engine.value.renderCallback = () => {
  // ... camera transform unchanged ...
  const snapshot = buildSnapshot(engine.value!, lastAppliedCommandId);
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

Existing render-manager tests (`tests/unit/svg-effect-manager.test.ts` and any in `tests/unit/components/`) need their `syncFromGameEngine` call sites updated to pass snapshot arrays. The mock data helpers in `tests/helpers/mock-managers.ts` should produce snapshot arrays instead of (or in addition to) live entity arrays.

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
// src/sim/MainThreadCommandDispatcher.ts
import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";
import type { GameEngine } from "@/game/GameEngine.js";

export class MainThreadCommandDispatcher implements CommandDispatcher {
  private engine: GameEngine;
  private nextCommandId = 1;
  // lastAppliedCommandId is read back from the snapshot in Phase 7.
  // Phase 6: unused — commands apply synchronously.

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  dispatch(command: Command): void {
    // Assign a commandId if the caller didn't (most input paths don't).
    if (command.commandId === undefined) {
      (command as { commandId: number }).commandId = this.nextCommandId++;
    }
    applyCommand(this.engine, command);
  }
}

// The apply function is the single switch that maps Command → engine method.
// In Phase 7 this function moves into the worker; the dispatcher just posts.
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
    case "action:sellSelected":      void engine.sellSelected(); break;  // fire-and-forget
    case "action:executeSell":       engine.executeSellById(command.towerId); break;  // defined in Phase 4
    case "action:downgradeSelected": engine.downgradeSelected(); break;
    case "action:specialize":        engine.specializeSelected(command.variant); break;
    case "action:cancelSelected":    engine.cancelSelected(); break;
    case "action:setTargeting":      engine.setTargeting(command.mode); break;
    case "action:setFixedAimDir":    engine.setFixedAimDir(command.dir); break;
    case "action:cancelBuildMode":   engine.cancelBuildMode(); break;
    // NOTE: action:selectBuildType is intentionally absent — selectedTowerType
    // is host-authoritative (updated directly on gameStore by Input.ts /
    // SvgGameRoot.vue, echoed back in the snapshot's meta.selectedTowerType
    // unchanged by the worker). See §6.2 of ArchitecturePlan.md.
    case "action:selectTower":
      // PROMINENT TECH DEBT — DEFINED IN PHASE 5, NOT DISPATCHED IN PHASE 6.
      // This case is intentionally a no-op `break` in Phase 6. The command
      // variant exists in the Command schema (Phase 5) so Phase 7 doesn't need
      // to add it. selectTower by id requires a lookup; engine.selectTower
      // currently takes a live Tower ref, not an id, and the worker era's
      // id-based lookup (engine.selectTowerById(id)) isn't needed while the
      // engine is still on the main thread. Phase 7 implements
      // engine.selectTowerById(id) and wires this case. For Phase 6, the
      // existing gameStore.selectTower(tower) calls in Input.ts and
      // SvgGameRoot.vue stay direct (not via dispatcher).
      break;
    // Lifecycle and LLM commands are no-ops in Phase 6 (engine is constructed
    // directly; LLM doesn't exist yet).
    default:
      // exhaustive check — TypeScript will complain if a Command variant is missing
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
engine.value = new GameEngine(gameStore, persistStore, themeBundle, host);
const dispatcher = new MainThreadCommandDispatcher(engine.value);
useInput(gameStore, dispatcher, uiStore);
```

### Test impact

`tests/unit/input.test.ts` constructs `useInput` with a mock `EngineLike`. Replace with a mock `CommandDispatcher` that records dispatched commands and asserts on them — this is actually a cleaner test surface than the previous optional-methods interface, since you can assert the exact command shape rather than inferring intent from method calls.

---

## Phase 0–6 completion criteria

- [ ] `src/sim/` directory exists; the custom `check:sim-boundary` script (chained into `npm run lint` alongside Biome) prevents imports from `src/stores/`, `src/components/`, `src/router/`, `src/sound/` inside it (the two `MainThread*` adapter files are the only exempted filenames).
- [ ] Boundary policy enforced: `src/game/`, `src/towers/`, `src/enemies/` have zero *runtime* `useXxxStore()` calls by end of Phase 2; type-only imports allowed through Phase 6, removed in Phase 7.
- [ ] `GameEngine`, `TowerManager`, `Tower`, `Enemy`, `EnemyManager`, `WaveGraphTracker` have zero runtime calls to `useUiStore()`/`useMapThemeStore()`/`useGameStore()`/`usePersistStore()`.
- [ ] `SoundManager` is owned by the host; `GameEngine` references sound via `HostBindings.playSound`, `TowerManager`/`Tower` via the narrower `SoundPlayer.playSound`.
- [ ] `GameRunState` and `PersistState` plain interfaces exist; every mutation site on the engine has a paired plain-state write (centralized via `RunStateSync` helpers where the field has >2 mutation sites).
- [ ] `SimulationSnapshot` and `Command` schemas are defined (with `lifecycle:setTheme` and `action:selectBuildType` omitted per §6.2 of `ArchitecturePlan.md`); `buildSnapshot` produces a complete snapshot; render managers consume snapshots.
- [ ] Input and SVG click handlers dispatch commands through `CommandDispatcher`; no direct `engine.method()` calls outside the dispatcher (except `selectTower` which is documented tech debt until Phase 7).
- [ ] All ~710 existing tests pass (with mechanical updates to mocks and call sites as noted per phase).
- [ ] No behavior change observable to a player.

Once these are met, the codebase is ready for Phases 7–9 (the actual worker migration). See `plans/ArchPrepPhases7-9.md`.
