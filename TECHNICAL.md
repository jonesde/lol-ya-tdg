# Technical Details

Everything a developer (human or LLM) needs to orient to, navigate, and modify the codebase.

## Rendering Architecture

The entire rendered area of the game uses a single `<svg>` root element where every map tile, tower, enemy, projectile, and visual effect is an SVG element. Sprite definitions are generated from `<symbol>` templates in `<defs>` and instantiated via `<use>` elements with imperatively-set `href` attributes. A single `requestAnimationFrame` loop on the main thread drives imperative DOM writes by reading the latest `SimulationSnapshot` produced by the simulation, which runs in a Web Worker. This eliminates the previous hybrid Canvas + DOM overlay architecture. See the new "Simulation Spine (Worker / Snapshot / Command)" design decision below.

## Directory Structure

```
src/
├── App.vue                      # Root component: <router-view> + global ConfirmDialog
├── main.ts                      # Entry point: createApp, Pinia, Router, persistStore.load()
├── shims-vue.d.ts               # Vue module declarations (*.vue as DefineComponent)
├── router/
│   └── index.ts                 # Route definitions + navigation guards (dispose engine on route change)
├── stores/
│   ├── game.ts                  # Volatile per-run state: lives, gold, wave, game state, selection, camera
│   ├── persist.ts               # Persistent meta-progression: gems, unlocks, difficulty, map progress (localStorage)
│   ├── ui.ts                    # UI overlay state: confirm dialogs, menu/skill-tree/stats/help context, debug panel
│   └── mapTheme.ts              # Map theme state: activeTheme, defaultTheme, availableThemes, preload/load actions
├── composables/
│   └── cameraUtils.ts           # Vue composable: reactive camera CTM transform + world/screen coordinate conversion
├── components/
│   ├── GameScreen.vue           # Root game layout: SvgGameRoot + HUD + shop + tower panel + wave countdown + debug + wave graph + pause menu
│   ├── SvgGameRoot.vue          # Single SVG root: creates the simulation Web Worker, owns SnapshotStore (render loop reads snapshots) and WorkerCommandDispatcher, imperative DOM rendering, SpawnManager
│   ├── GameHud.vue              # Top HUD bar: lives, gold, gems, wave, speed/pause/menu buttons
│   ├── GameShop.vue             # Tower shop bar: build selection with cost display and discount support
│   ├── TowerPanel.vue           # Tower detail panel: stats, targeting, upgrade/sell, specialization
│   ├── WaveCountdown.vue        # Inter-wave countdown overlay shown before each wave spawns
│   ├── WaveGraph.vue            # Per-wave graph overlay: damage, gold, gems, max enemy HP
│   ├── PauseMenu.vue            # Pause menu overlay: resume, skill tree, options, quit
│   ├── HelpDialog.vue           # Help/controls overlay (toggled from in-game menu)
│   ├── MainMenu.vue             # Main menu: new game, resume, skill tree, difficulty slider, profile reset
│   ├── MapSelect.vue            # Map selection grid: unlock status, best waves, region info
│   ├── SkillTree.vue            # Skill tree: tower levels, specializations, add-ons, general upgrades
│   ├── EndScreen.vue            # Game over / victory screen: gem breakdown and navigation
│   ├── ConfirmDialog.vue        # Reusable modal dialog (teleported to body)
│   ├── DebugPanel.vue           # Debug buttons: gold/gems/lives injection, wave skip, map unlock, time scale
│   ├── StatsPanel.vue           # Wave composition, enemy list, and run statistics
│   └── HistoryScreen.vue        # Run history entries with gem breakdown formatting
├── game/
│   ├── GameEngine.ts            # Core game loop: RAF driver, update/render, state transitions, rewards
│   ├── Constants.ts             # Shared game constants: wave config, map levels, regions, boss cadence
│   ├── ConstantsTower.ts        # Tower constants: TowerIds, tower stats, variants, milestone/splash/crit config
│   ├── ConstantsEnemy.ts        # Enemy constants: EnemyType union, ENEMY_TYPES metadata, status effect tuning
│   ├── Input.ts                 # Keyboard input composable (dispatches to Pinia stores + engine)
│   ├── EnemyWalk.ts             # Base shape vertex generation and path-d string conversion
│   ├── ProjectileManager.ts     # Game-side projectile simulation: travel, hits, splash, chain, burn, knockback
│   ├── ParticleSystem.ts        # Game-side particle simulation: spawn, motion, life/expiry
│   └── WaveGraphTracker.ts      # Per-wave graph data tracking: damage, gold, gems, peak enemy HP
├── grid/
│   ├── Grid.ts                  # Grid data structure: path, base, spawn queries, build validation
│   ├── Map.ts                   # Procedural map generation: 36 maps, 3 regions, 6 layout styles
│   └── Pathfinding.ts           # BFS pathfinding with dynamic obstacle avoidance
├── towers/
│   ├── Tower.ts                 # Tower stats, behavior, targeting, upgrades, variants, sell value
│   ├── TowerManager.ts          # Tower placement, upgrade, sell, sell-value refund/discount
│   └── SkillTree.ts             # Gem upgrade costs, unlock logic, variant definitions, general add-ons
├── enemies/
│   ├── Enemy.ts                 # Enemy types, stats, behavior, pathfinding, status effects
│   └── EnemyManager.ts          # Enemy spawning, lifecycle, death handling
├── waves/
│   └── WaveManager.ts           # Wave composition, boss cadence, inter-wave timer
├── sim/
│   ├── Command.ts               # Command discriminated-union types (input/action/lifecycle/llm) for simulation intent
│   ├── CommandDispatcher.ts     # CommandDispatcher interface — the dispatch seam every intent flows through
│   ├── GameRunState.ts          # Per-run plain simulation state interface + pure helper functions (formerly gameStore logic)
│   ├── HostBindings.ts          # HostBindings interface — the only way the sim reaches the outside world (sound/UI/persist/confirm)
│   ├── PersistState.ts          # Plain persist state interface + pure mutation helpers (formerly persistStore logic)
│   ├── SimulationSnapshot.ts    # SimulationSnapshot + entity/meta snapshot types
│   ├── SnapshotSerializer.ts    # buildSnapshot(): serializes the engine into a plain SimulationSnapshot
│   ├── SnapshotStore.ts         # Main-thread store: holds latest snapshot and mirrors meta into gameStore
│   ├── WorkerCommandDispatcher.ts # Main-thread dispatcher: forwards commands to the worker via postMessage
│   ├── WorkerEntry.ts           # Web Worker entry: owns GameEngine, fixed-timestep loop, command-queue drain, snapshot post
│   ├── WorkerHostBindings.ts    # Worker-side HostBindings: posts sound/UI/persist/confirm messages to main thread
│   ├── WorkerProtocol.ts        # Worker↔main thread message protocol types
│   ├── applyCommand.ts          # Maps a Command → GameEngine method (shared by worker and main-thread dispatcher)
│   ├── commandBus.ts            # Module-level dispatch seam (setCommandDispatcher / dispatchCommand)
├── sim-adapters/
│   ├── MainThreadCommandDispatcher.ts # Main-thread CommandDispatcher adapter (engine-direct; legacy/non-worker path)
│   └── MainThreadHostBindings.ts      # Main-thread HostBindings adapter: SoundManager/uiStore/persistStore
├── render/
│   ├── themes/
│   │   ├── index.ts             # Theme registry: MAP_THEME_MANIFEST, lazy loaders, visual meta types
│   │   ├── normalize.ts         # normalizeThemeImages: fetches external SVG refs, inlines them
│   │   ├── MapThemeHowTo.md     # Guide for creating new map themes
│   │   ├── scripts/             # Theme asset generators (Python): apply_enemies.py, gen_enemies_aftermath.py
│   │   └── data/
│   │       ├── default-map-theme.json   # Default theme data: tower/enemy sprites, tile images, base art
│   │       └── the-aftermath.json       # Alternate "Aftermath" theme data
│   └── svg/
│       ├── EnemyManager.ts      # Enemy rendering pool: <use> elements, hit flash, slow filters
│       ├── TowerManager.ts      # Tower rendering pool: <use> elements, barrel rotation, level pips
│       ├── ProjectileManager.ts # Projectile rendering pool: <circle> bullets, <line> beams
│       ├── ParticleManager.ts   # Particle rendering pool: <circle> elements
│       ├── EffectManager.ts     # Lightning, stun aura, build preview, range circle, upgrade button
│       ├── UiOverlayManager.ts  # HP bars, shield bars, boss HP text rendering
│       ├── SpawnManager.ts      # Spawn point rendering pool: <use> elements for spawn indicators
│       ├── useSvgStaticContent.ts # Composable: builds <defs> symbols/filters + grid layer from active theme
│       ├── cameraUtils.ts       # fitToGrid() and screenToWorld()/worldToScreen() helpers (pixel space)
│       └── types.ts             # Shared types for render proxies and managers
└── sound/
    └── SoundManager.ts          # Lightweight WebAudio synth for game sounds
```

## Key Design Decisions

### Single SVG Root with Imperative DOM Rendering

The game uses a single `<svg>` root element managed by `SvgGameRoot.vue`, replacing the previous two-layer Canvas + DOM overlay architecture. All visual content — grid tiles, towers, enemies, projectiles, particles, and effects — is rendered as SVG elements.

- **Vue (Declarative):** Manages structural changes (map loading, building/selling towers, opening shops). Mounts the root SVG and static layers via `v-html` for the grid.
- **GameEngine (Logic, in Web Worker):** Orchestrates all game logic (enemy movement, tower targeting, projectile updates, wave management). Constructor takes plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle` — no Pinia, no canvas reference. `handleClick()` accepts world coordinates; `setHover` was removed (hover is main-thread-only UI state). The engine runs inside the Web Worker (`src/sim/WorkerEntry.ts`), not on the main thread.
- **Direct DOM (Imperative Rendering):** A main-thread `requestAnimationFrame` loop reads the latest `SimulationSnapshot` from the `SnapshotStore` and writes per-frame properties via `setAttribute` and `style.transform`. It does not call the engine directly — all intent flows in as `Command`s and all state flows out as snapshots. Bypasses Vue's reactivity system for hot paths.

The SVG structure is:

```
<svg class="game-svg" viewBox="0 0 W H">
  <defs>  <!-- <symbol> templates, filters, per-map gradients -->
  <g class="grid-layer" v-html="gridContent"></g>  <!-- Static, Vue-managed -->
  <g ref="worldLayer" class="camera-wrapper">  <!-- Imperative camera transform -->
    <g ref="entityLayer"></g>      <!-- Towers & Enemies as <use> elements -->
    <g ref="uiOverlayLayer"></g>   <!-- HP bars, shield bars, boss text -->
    <g ref="projectileLayer"></g>  <!-- Projectiles as <circle>/<line> -->
    <g ref="effectLayer"></g>     <!-- Particles, lightning, stuns -->
  </g>
</svg>
```

**Key SVG concepts:**

- `<symbol>`/`<use>`: Sprite definitions are `<symbol>` templates in `<defs>`, instantiated as `<use>` elements. Animation is driven by updating the `href` attribute each frame.
- CSS transforms on SVG: Elements use `transform-box: fill-box; transform-origin: 0 0;` for predictable positioning.
- CTM-based input: Mouse coordinates are converted to world space via `worldLayer.getScreenCTM().inverse()`, which includes the camera transform (unlike `svgRoot.getScreenCTM()` which only accounts for the viewBox).
- Click handling is centralized on the SVG root — no per-element `@click` handlers. `gameEngine.handleClick(worldX, worldY)` determines what was hit programmatically.

`GameScreen.vue` renders `<SvgGameRoot>` as a sibling with HUD/shop/tower panel overlays. Vue does **not** touch per-frame rendering. The component creates the Web Worker, posts `lifecycle:init` (with `persistState` + `themeBundle`), owns `SnapshotStore` and the `WorkerCommandDispatcher`, reads the reactive snapshot mirror from Pinia stores, and cleans up on unmount (posts `lifecycle:dispose`, awaits the worker's `disposed` ack, then terminates). The SVG mounts/unmounts with the `/game` route.

### Four Pinia Stores

- **`gameStore`** — reactive mirror/projection of the simulation `SimulationSnapshot`. The worker is authoritative for simulation state; `gameStore` holds the subset the Vue UI binds to (lives, gold, wave, game state, selection, time scale, dialog visibility) and is updated by snapshot diffs each frame. Main-thread-only state (camera, hover tile, hover-upgrade-button) also lives here. Reset when starting a new map.
- **`persistStore`** — persistent meta-progression (gems, unlocked skills, map progress, difficulty, general add-ons). Auto-saved to `localStorage` via manual `save()` calls.
- **`uiStore`** — UI overlay visibility and confirm dialog state.
- **`mapThemeStore`** — map theme state: `defaultTheme` (preloaded at app init for synchronous access by non-game screens) and `activeTheme` (resolved for the current run), plus `availableThemes` and preload/load actions.

### Confirm Dialogs as a Single Component

`ConfirmDialog.vue` is mounted globally in `App.vue` and uses `<Teleport to="body">` to render above all layers. Driven by `uiStore.confirmDialog` state.

### Simulation Spine (Worker / Snapshot / Command)

The simulation runs in a Web Worker; the main thread renders and produces intent. They communicate only through a **snapshot + command stream** (the "spine"), as detailed in `plans/ArchitecturePlan.md` §3.

- **Worker owns the engine.** `src/sim/WorkerEntry.ts` constructs `GameEngine` (with plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`, not Pinia), runs a `setTimeout` fixed-timestep loop, drains a command queue at the start of each tick, and posts a `SimulationSnapshot` every tick. `requestAnimationFrame` is unavailable in a worker, so a `setTimeout`-driven loop is used instead.
- **Commands in (`src/sim/Command.ts`).** All intent is a typed `Command`: `input:*` (e.g. `input:click`), `action:*` (pause, cycle speed, upgrade, sell, select tower/build type, targeting, …), `lifecycle:*` (`init`/`dispose`), and future `llm:*`. The main thread dispatches via `commandBus.dispatchCommand` → `WorkerCommandDispatcher`, which forwards through `postMessage`. Hover and camera are main-thread-only and never become commands.
- **Snapshots out (`src/sim/SimulationSnapshot.ts`, `SnapshotSerializer.ts`).** Each tick the worker serializes plain-data DTOs — `enemies`, `towers`, `projectiles`, `particles`, `spawnStates`, plus a `meta` scalar block (lives, gold, wave, selection, `lastScaledDt`, etc.) and a `persistDirty` flag. `SnapshotSerializer.buildSnapshot` reads entity fields directly; the render managers' `syncFromGameEngine` signatures now take these snapshot arrays.
- **Reactive mirror (`src/sim/SnapshotStore.ts`).** On the main thread, `SnapshotStore` holds the latest snapshot and diff-mirrors `meta` into `gameStore` (the reactive projection). The rAF render loop reads from the `SnapshotStore`, never from the engine. `gameStore` is a cache; the worker is authoritative, and reconciliation happens within one frame.
- **HostBindings seam (`src/sim/HostBindings.ts`).** The sim reaches the outside world only through `HostBindings`: `playSound`, `notifyUi`, `schedulePersistSave`, `requestConfirm`. Implemented twice — `WorkerHostBindings` (worker → `postMessage`) and `MainThreadHostBindings` in `src/sim-adapters/` (main thread → `SoundManager`/`uiStore`/`persistStore`). This seam is what made the worker migration behavior-preserving at every step.
- **Persistence batching.** The worker sets `persistDirty` on persist mutations and the host flushes `schedulePersistSave` only on significant events (wave change, game-over/victory, new milestone claim, or a 5s fallback), avoiding a `localStorage` write per mutation.

### Router Navigation Guards

`router.beforeEach` disposes the game engine and saves progress when leaving `/game`. Auto-redirects to `/game-over` or `/victory` when the game state transitions.

## Source & Configuration Files

### Configuration

| File | Description |
|---|---|
| `index.html` | Entry HTML with `<div id="app">` mount point |
| `package.json` | Dependencies: Vue 3, Pinia, Vue Router, Vite |
| `vite.config.ts` | Vite config: Vue plugin, `@/` alias for `src/`, dev server on port 3000 |
| `vitest.config.ts` | Vitest config: Vue plugin, `@/` alias, jsdom environment, test glob `tests/**/*.test.ts` |
| `tsconfig.json` | TypeScript config: `strict: true`, `allowJs: false`, `noEmit: true`, `moduleResolution: bundler` |
| `src/render/themes/MapThemeHowTo.md` | Guide for creating new map themes (sprite format, registration, scope) |

### Entry & Routing

| File | Description |
|---|---|
| `src/main.ts` | App bootstrap: createPinia, load persisted state, mount router |
| `src/App.vue` | Root component with `<router-view>` and global `<ConfirmDialog>` |
| `src/router/index.ts` | Route definitions and navigation guards |

### State Management

| File | Description |
|---|---|
| `src/stores/game.ts` | Volatile game state: lives, gold, wave, selection, time scale, camera, end screen data |
| `src/stores/persist.ts` | Persistent state: gems, unlocks, difficulty, map progress, localStorage I/O |
| `src/stores/ui.ts` | UI state: confirm dialog, main menu / skill tree / stats / help overlay flags, debug panel visibility |
| `src/stores/mapTheme.ts` | Map theme state: activeTheme, defaultTheme (preloaded at app init), availableThemes, preload/load actions |

### Map Theme

| File | Description |
|---|---|
| `src/render/themes/index.ts` | Theme registry: `MAP_THEME_MANIFEST` (id/label entries), lazy loaders, `MapThemeData`/`TowerVisualMeta`/`EnemyVisualMeta`/`RegionVisualMeta` types |
| `src/render/themes/normalize.ts` | `normalizeThemeImages(theme)`: walks theme object, fetches external SVG path/URL refs, replaces with inlined SVG text |
| `src/render/themes/data/default-map-theme.json` | Default theme data: tower/enemy SVG sprites, tile images (path + 4 terrain heights per region), base 3×3 SVG per region |

### Vue Components

| File | Description |
|---|---|
| `src/components/GameScreen.vue` | Game layout container: SvgGameRoot, HUD, shop, tower panel, wave countdown, debug panel, wave graph, pause menu overlay |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, GameEngine lifecycle (receives active theme), imperative DOM rendering, CTM-based input, SpawnManager initialization |
| `src/components/GameHud.vue` | Top bar: lives, gold, gems, wave counter, speed/pause/menu controls; uses `getMapDisplayName` for map label |
| `src/components/GameShop.vue` | Bottom bar: tower build selection with cost (from constants) and themed name/color/icon (from active theme) |
| `src/components/TowerPanel.vue` | Right panel: tower stats, targeting mode, upgrade/sell, specialization; themed name/color/icon from active theme |
| `src/components/WaveCountdown.vue` | Inter-wave countdown overlay shown before each wave spawns |
| `src/components/WaveGraph.vue` | Per-wave graph overlay: damage dealt, gold earned, gems earned, max enemy HP across all waves |
| `src/components/PauseMenu.vue` | Pause menu overlay: resume, skill tree, difficulty adjustment, quit to main menu |
| `src/components/HelpDialog.vue` | Help/controls overlay (toggled from the in-game pause menu) |
| `src/components/MainMenu.vue` | Main menu: new game, resume, skill tree, difficulty slider, profile reset |
| `src/components/MapSelect.vue` | Map grid: 36 maps with unlock status, best waves, region info; theme drop-down, responsive grid (`auto-fill`), awaits theme resolution before navigation |
| `src/components/SkillTree.vue` | Skill tree: tower level unlocks, specializations, add-ons, general upgrades; reads default theme (not active theme) |
| `src/components/EndScreen.vue` | Victory/game-over screen: gem breakdown, wave count, navigation buttons; reads default theme for region names |
| `src/components/ConfirmDialog.vue` | Global modal dialog (teleported to body, driven by uiStore) |
| `src/components/DebugPanel.vue` | Debug overlay: gold/gems/lives injection, wave skip, enemy clear, map unlock |
| `src/components/StatsPanel.vue` | Wave composition, enemy list, and run statistics; reads enemy name/color/shape from active theme |
| `src/components/HistoryScreen.vue` | Run history entries with gem breakdown formatting; reads default theme for region names |

### Game Engine

| File | Description |
|---|---|
| `src/game/GameEngine.ts` | Simulation core: no rendering. Takes plain `GameRunState` + `PersistState` + `HostBindings` + `ThemeBundle`; runs inside the Web Worker (`src/sim/WorkerEntry.ts`) on a `setTimeout` fixed-timestep loop; produces a `SimulationSnapshot` each tick and applies `Command`s via `applyCommand`; passes visual meta to Tower/Enemy constructors |
| `src/game/Constants.ts` | Shared game constants: wave config, map levels, boss cadence, gem rewards; `Regions` slimmed (visual fields moved to theme) |
| `src/game/ConstantsTower.ts` | Tower constants: TowerIds, tower stats/cost, specialization variants, milestone/splash/crit config; visual fields (name, color, icon, animation, walking) moved to theme |
| `src/game/ConstantsEnemy.ts` | Enemy constants: EnemyType union, stats-only ENEMY_TYPES (baseHp, speed, bounty, radius, shield, heal, resist, etc.); visual fields moved to theme |
| `src/game/Input.ts` | Keyboard input composable (1-9 build, Arrow L/R speed, Esc dialogs/cancel, Tab cycle, u/s upgrade/sell) |
| `src/game/EnemyWalk.ts` | Base shape vertex generation and path-d string conversion |
| `src/game/ProjectileManager.ts` | Game-side projectile simulation: travel, hits, splash, chain, burn, knockback |
| `src/game/ParticleSystem.ts` | Game-side particle simulation: spawn, motion, life/expiry |
| `src/game/WaveGraphTracker.ts` | Per-wave graph data: damage dealt, gold earned, gems earned, peak enemy HP per wave |

### Grid & Maps

| File | Description |
|---|---|
| `src/grid/Grid.ts` | Grid data structure: path tiles, base/spawn locations, build validation |
| `src/grid/Map.ts` | Procedural map generation: 36 maps, 3 regions, 6 layout styles (open, canyon, serpentine, split, bastion, battlefield); `name` computed lazily via `getMapDisplayName(map, theme)` |
| `src/grid/Pathfinding.ts` | BFS pathfinding with dynamic tower obstacle avoidance |

### Towers

| File | Description |
|---|---|
| `src/towers/Tower.ts` | Tower entity: stats, targeting modes, level scaling, variants, sell value, milestone bonuses; accepts `visualMeta` param (color, icon, name, animation, walking) from active theme |
| `src/towers/TowerManager.ts` | Tower placement, upgrade, sell with refund/discount modes; receives visual meta from GameEngine |
| `src/towers/SkillTree.ts` | Gem upgrade costs, unlock/refund logic, variant definitions, general add-on config |

### Enemies & Waves

| File | Description |
|---|---|
| `src/enemies/Enemy.ts` | Enemy entity: types, stats, pathfinding, status effects (slow, stun, shield); accepts `visualMeta` param (color, shape, name, walking, hitReaction) from active theme |
| `src/enemies/EnemyManager.ts` | Enemy lifecycle: spawning, movement, death, base reach; receives visual meta from GameEngine |
| `src/waves/WaveManager.ts` | Wave composition, enemy count scaling, boss cadence, inter-wave timer |

### Rendering

| File | Description |
|---|---|
| `src/render/svg/EnemyManager.ts` | Enemy rendering pool: `<use>` elements with `<symbol>` href animation, hit flash circles, slow filter application |
| `src/render/svg/TowerManager.ts` | Tower rendering pool: `<use>` elements with barrel rotation, level pip `<circle>` elements |
| `src/render/svg/ProjectileManager.ts` | Projectile rendering pool: `<circle>` bullets, `<line>` beams |
| `src/render/svg/ParticleManager.ts` | Particle rendering pool: `<circle>` elements with fade/expansion |
| `src/render/svg/EffectManager.ts` | Lightning paths, stun aura paths, build preview rect, range circle, upgrade button SVG elements |
| `src/render/svg/UiOverlayManager.ts` | HP bars, shield bars, boss HP text as pooled `<rect>` and `<text>` elements |
| `src/render/svg/SpawnManager.ts` | Spawn point rendering pool: `<use>` elements for spawn location indicators |
| `src/render/svg/useSvgStaticContent.ts` | Composable: builds `<defs>` (symbols from active theme's tower/enemy frames, region gradients, filters) and grid layer SVG strings (tile images + base art from theme) |
| `src/render/svg/cameraUtils.ts` | `fitToGrid()` plus pixel-space `screenToWorld()`/`worldToScreen()` helpers for the SVG camera |
| `src/render/svg/types.ts` | Shared types for render proxies and managers |
| `src/components/SvgGameRoot.vue` | Single SVG root: creates the simulation Web Worker, owns `SnapshotStore` (render loop reads snapshots) and `WorkerCommandDispatcher` (click/key intents → commands); rAF render loop does imperative DOM writes; CTM-based mouse→world coordinate conversion, centralized click routing; passes theme bundle to worker at `lifecycle:init` and to `useSvgStaticContent`; initializes SpawnManager |
| `src/composables/cameraUtils.ts` | Vue composable: reactive camera CTM transform (`useCameraCTM`) and world/screen coordinate conversion backed by `gameStore.camera` |

### Audio

| File | Description |
|---|---|
| `src/sound/SoundManager.ts` | WebAudio synth: shoot, hit, boss death, base hit, upgrade sounds |

### Camera

Camera state (`x`, `y`, `zoom`) lives on `gameStore.camera` and is shared between the Vue UI and SVG rendering. Vue-side reactive transforms/conversions are provided by `src/composables/cameraUtils.ts` (`useCameraCTM`), while pixel-space helpers (`fitToGrid`, `screenToWorld`) live in `src/render/svg/cameraUtils.ts`. There is no longer a separate `services/` directory.

## Map Theme System

A theme swaps the visual identity of towers, enemies, and map tiles on `/game`, while leaving all gameplay stats, effects, overlays, and non-`/game`/`/map-select` screens untouched. The current polygon-based art is the default theme (`id: "default"`).

### How It Works

1. **Theme registry** (`src/render/themes/index.ts`): `MAP_THEME_MANIFEST` lists available themes with `{id, label}`. Lazy loaders resolve theme JSON files on demand.
2. **Theme store** (`src/stores/mapTheme.ts`): `useMapThemeStore` holds `defaultTheme` (preloaded at app init for synchronous access by non-game screens) and `activeTheme` (resolved for the current run).
3. **Theme JSON** (`src/render/themes/data/`): `default-map-theme.json` (default polygon art) and `the-aftermath.json` (alternate theme). Each contains tower frames (SVG `<svg>` strings), enemy walking/hit-reaction frames, per-region tile images (path + 4 terrain heights), and base 3×3 SVG art.
4. **Symbol ID contract**: IDs stay `tower-${type}-f${i}`, `enemy-${type}-f${i}`, `enemy-${type}-hit-f${i}`. Themes swap only the *content* inside `<symbol>`s and the color/name/icon metadata. Render managers need zero changes.
5. **Stats vs visuals split**: `TOWER_BASE`, `TOWER_VARIANTS`, `ENEMY_TYPES` numeric fields, `MAP_LEVELS`, gem multipliers — all stay in constants files. Only visual/displayed fields (name, color, icon, shape, animation frames, tile images) live in the theme JSON.

### Scope

- **In scope** (`/game` only): Tower SVG sprites + color/icon/name, enemy SVG sprites + color/shape/name, per-region tile images + base art + display names.
- **Out of scope**: All gameplay data, all effects/overlays (particles, lightning, HP bars, range circles, etc.), non-`/game`/`/map-select` screens (Skill Tree uses default theme), in-game theme switching, audio.

### UI Integration

- **MapSelect**: Theme drop-down selects active theme; grid uses responsive `auto-fill` layout; `startMap` awaits theme resolution before navigating to `/game`.
- **GameShop / TowerPanel / StatsPanel / GameHud**: Read themed name/color/icon from `mapThemeStore.activeTheme` on `/game`.
- **SkillTree / HistoryScreen / EndScreen**: Read from `mapThemeStore.defaultTheme` (not active theme).
- **SvgGameRoot**: Passes `activeTheme` to `GameEngine` constructor and `useSvgStaticContent` composable.
- **Router guard**: `/game` requires `mapThemeStore.activeTheme` to be non-null.

## Persistence

Game progress (gems, unlocks, difficulty, map progress) is saved to `localStorage` under the key `lol_ya_tdg_save_1` (legacy `gempath_save_v1` data is auto-migrated on load). The `persistStore.load()` call in `main.ts` restores saved state on app startup. The `mapThemeStore.preloadDefault()` call in `main.ts` preloads the default theme synchronously before `app.mount()`. Profile reset is available from the main menu.

## Game Routes

| Route | Component | Description |
|---|---|---|
| `/` | `MainMenu.vue` | Main menu with difficulty slider and navigation |
| `/map-select` | `MapSelect.vue` | Map selection grid with theme drop-down, responsive layout, awaits theme resolution before navigation |
| `/skill-tree` | `SkillTree.vue` | Gem-based upgrade tree |
| `/game` | `GameScreen.vue` | Active gameplay with single SVG root + UI overlays |
| `/game-over` | `EndScreen.vue` | Game over screen (`won: false`) |
| `/victory` | `EndScreen.vue` | Victory screen (`won: true`) |
| `/history` | `HistoryScreen.vue` | Run history with gem breakdown |

## CSS Theming

CSS custom properties are defined in `App.vue` for consistent theming:

```css
--color-bg, --color-panel, --color-border, --color-accent,
--color-gold, --color-gem, --color-danger, --color-success,
--color-text, --color-text-dim, --font-main
```

All component styles use `<style scoped>` to prevent leakage.

## Testing

### Structure

| Directory | Description |
|---|---|
| `tests/unit/` | 25 unit test files covering all source modules (includes `map-theme.test.ts`, `spawn-manager.test.ts`, `enemy-attack.test.ts`, `snapshot-store.test.ts`, `sim/snapshot.test.ts`) |
| `tests/unit/components/` | Vue component tests (13 files, includes `pause-menu.test.ts`) |
| `tests/integration/` | End-to-end wave simulation (`integration.test.ts`) and worker command→snapshot round-trip (`worker-roundtrip.test.ts`) |
| `tests/helpers/` | Shared mocks: `mock-stores.ts`, `mock-grid.ts`, `mock-managers.ts`, `mockDefaultTheme` |
| `tests/setup.ts` | Global test setup: in-memory localStorage, Canvas 2D mock, performance.now |

**~900 tests** across all files.

### What's Covered

| System | Test File(s) | Key Behaviors |
|---|---|---|
| Game Engine | `game-engine.test.ts` | Loop, buy/upgrade/sell, pause, timeScale, gem economy, difficulty scaling; WaveGraphTracker covered indirectly |
| Grid & Pathfinding | `grid.test.ts`, `pathfinding.test.ts` | Tile queries, build validation, BFS paths, dynamic obstacle avoidance |
| Maps | `map.test.ts` | All 36 maps have valid spawn-to-base paths, region metadata, gem rewards |
| Towers | `towers.test.ts` | Stats with caching, level/variant/addon/terrain/milestone bonuses, sell value |
| Enemies | `enemies.test.ts` | HP/speed formulas, wave scaling, status effects (slow/stun/burn/shield/heal) |
| Waves | `waves.test.ts` | Composition, boss placement, level calculation, inter-wave timing |
| Tower Manager | `tower-manager.test.ts` | Build, sell, update, towerAt |
| Enemy Manager | `enemy-manager.test.ts` | Spawn, cull, getEnemiesInRange |
| Enemy Attack | `enemy-attack.test.ts` | Enemy base/tower attack behavior, damage, and cooldowns |
| Skill Tree | `skill-tree.test.ts` | Unlock/refund/cost logic for all towers and general addons |
| Projectiles | `projectile-manager.test.ts`, `game-projectile-manager.test.ts` | Render pool (`<circle>`/`<line>`) and game-side simulation: all 8 tower types × 2 variants (16 projectile behaviors), splash, chain, burn, knockback |
| Particles | `particles.test.ts` | Spawn, update, render, fade, expire, count limits |
| Spawn Manager | `spawn-manager.test.ts` | Spawn element pool initialization, syncFromGameEngine DOM writes, element recycling |
| SVG Render Managers | `svg-effect-manager.test.ts` | Effect pool allocation, syncFromGameEngine DOM writes, element recycling, visibility toggling |
| Sound | `sound-manager.test.ts` | WebAudio synth, all sound names, dispose, enabled flag |
| Stores | `game-store.test.ts`, `persist-store.test.ts`, `ui-store.test.ts`, `map-theme.test.ts` | State, getters, actions, save/load, schema migration; theme registry, loader, normalize, store preload/load/visual getters |
| Snapshot Store | `snapshot-store.test.ts`, `sim/snapshot.test.ts` | Latest-snapshot holding, meta mirroring into gameStore, snapshot serialization/round-trip |
| Router | `router.test.ts` | Navigation guards, block without map, save on leave, redirects, activeTheme requirement |
| Input | `input.test.ts` | Keyboard dispatch, timeScale, pause, upgrade/sell, escape handling |
| Components | 13 files in `tests/unit/components/` | Rendering, user interactions, store bindings (includes PauseMenu) |
| Integration | `integration.test.ts`, `worker-roundtrip.test.ts` | Single wave simulation: kill enemies, gold economy, boss mechanics, victory; command→snapshot worker round-trip |
