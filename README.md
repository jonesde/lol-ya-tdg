# Lo! Yet Another TDG

A browser-based tower defense game with pure SVG rendering, gem-based meta-progression, and an upgrade unlock system. Built with Vue 3, Pinia, and Vite.

**Human Goals**

1. Explore and refine AI assisted coding workflow and toolset, both AI-specific tools like OpenCode and general coding tools like compilers, linters, formatters, and frameworks that help steer AI toward .
2. Build a burnout game: casual engagement for distraction, felt progress for reward; player in control while game does all the work

**AI Usage**

This application is primarily AI generated with lazy human auditing (no full human audit; human audit as needed). Initial one-shot was done by GLM 5.2, a no-build HTML/CSS/JS app with all canvas rendering. All work since then has been done by Qwen 3.6 27B and Ornith 1.0 35B running local, including the refactorings to use VueJS and compiled TypeScript. See the old_plans directory for some of the more significant changes along the way.

**Rendering Architecture**

The entire rendered area of the game uses a single `<svg>` root element where every map tile, tower, enemy, projectile, and visual effect is an SVG element. Sprite definitions are generated from `<symbol>` templates in `<defs>` and instantiated via `<use>` elements with imperatively-set `href` attributes. A single `requestAnimationFrame` loop drives both game logic (via `GameEngine`) and imperative DOM writes (via per-entity `Manager` classes that read from the engine and write to pooled SVG elements). This eliminates the previous hybrid Canvas + DOM overlay architecture.

## Overview

Defend your base against 100 waves of enemies across 36 procedurally-generated maps spanning 3 regions. Place and upgrade 6 tower types with deep specialization trees, earn gems to unlock permanent upgrades in the skill tree, and adjust difficulty to scale both enemy power and gem rewards.

### Game Features
- **36 maps** across 3 regions (Verdant Marches, Sunscorch Coast, Thornpeak Wilds), each with increasing difficulty and different gem multipliers
- **6 tower types** with 3 specialization variants each (unlock at level 4)
- **6 enemy types** including minions, runners, tanks, shielded, healers, and bosses
- **Gem economy** with milestone rewards, first-time bonuses, and difficulty scaling
- **General add-ons** for starting gold/health, upgrade cost reduction, terrain bonuses, and damage milestones

## Keyboard Controls

| Key | Action |
|---|---|
| `Escape` | Close open dialogs (equivalent to Cancel/Resume/etc button in dialog), or if none then exit build mode if active, or if not then deselect selected tower if one selected, or if none then toggle pause menu dialog |
| `Enter` | If dialog open and has default/active button (like OK) then same as button press |
| `Spacebar` | Toggle pause state (state change only, do not open pause menu dialog; if pause menu dialog open then do same as Escape: close and unpause) |
| `Tab` | If build mode active then cycle tower type (next to the right in the shop menu, from last loop back to first), or if no build mode then select the next tower or select the first tower if no tower was selected (search going right until end of tile row in map, then go to next row), or if no towers have been built do nothing |
| `Right Arrow` | Cycle time scale (1× --> 2× --> 4× --> 8× --> 1×) |
| `Left Arrow` | Reverse cycle time scale (1× --> 8× --> 4× --> 2× --> 1×) |
| `1`–`9` | Build mode for corresponding tower type (use current shop panel order; support up to 9 even though there are only 6 towers now) |
| `u` or `Up Arrow` | Upgrade the selected tower, nothing if no tower selected |
| `s` | Sell the selected tower, nothing if no tower selected |
| Click on empty tile (build mode) | Place selected tower |
| Click on tower | Select tower for upgrade/sell |
| Click upgrade button (on selected tower) | Upgrade tower |

## Tech Stack

| Library | Version | Purpose |
|---|---|---|
| **Vue 3** | ^3.5.0 | Reactive components, `<script setup>` syntax |
| **Vue Router** | ^4.5.0 | Screen navigation (`/`, `/map-select`, `/game`, `/skill-tree`, `/game-over`, `/victory`) |
| **Pinia** | ^3.0.0 | State management (3 stores: `game`, `persist`, `ui`) |
| **Vite** | ^6.0.0 | Build tool with HMR, code splitting, and tree-shaking |

No UI component libraries — all styling uses scoped CSS with CSS custom properties for theming.

## Structure

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
│   └── ui.ts                    # UI overlay state: confirm dialogs, menu context, debug panel visibility
├── components/
│   ├── GameScreen.vue           # Root game layout: SvgGameRoot + HUD + shop + tower panel + debug
│   ├── SvgGameRoot.vue          # Single SVG root: owns RAF loop, GameEngine, imperative DOM rendering
│   ├── GameHud.vue              # Top HUD bar: lives, gold, gems, wave, speed/pause/menu buttons
│   ├── GameShop.vue             # Tower shop bar: build selection with cost display and discount support
│   ├── TowerPanel.vue           # Tower detail panel: stats, targeting, upgrade/sell, specialization
│   ├── MainMenu.vue             # Main menu: new game, resume, skill tree, difficulty slider, profile reset
│   ├── MapSelect.vue            # Map selection grid: unlock status, best waves, region info
│   ├── SkillTree.vue            # Skill tree: tower levels, specializations, add-ons, general upgrades
│   ├── EndScreen.vue            # Game over / victory screen: gem breakdown and navigation
│   ├── ConfirmDialog.vue        # Reusable modal dialog (teleported to body)
│   ├── DebugPanel.vue           # Debug buttons: gold/gems/lives injection, wave skip, map unlock, time scale
│   ├── StatsPanel.vue           # Wave composition, enemy list, and run statistics
│   └── HistoryScreen.vue        # Run history entries with gem breakdown formatting
├── services/
│   └── CameraService.ts         # Reactive camera state shared between Vue UI and SVG rendering
├── game/
│   ├── GameEngine.ts            # Core game loop: RAF driver, update/render, state transitions, rewards
│   ├── Constants.ts             # Game constants: tower stats, enemy types, wave config, map levels, variants
│   ├── Input.ts                 # Keyboard input composable (dispatches to Pinia stores)
│   └── EnemyWalk.ts             # Base shape vertex generation and path-d string conversion
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
├── render/
│   └── svg/
│       ├── EnemyManager.ts      # Enemy rendering pool: <use> elements, hit flash, slow filters
│       ├── TowerManager.ts      # Tower rendering pool: <use> elements, barrel rotation, level pips
│       ├── ProjectileManager.ts # Projectile rendering pool: <circle> bullets, <line> beams
│       ├── ParticleManager.ts   # Particle rendering pool: <circle> elements
│       ├── EffectManager.ts     # Lightning, stun aura, build preview, range circle, upgrade button
│       ├── UiOverlayManager.ts  # HP bars, shield bars, boss HP text rendering
│       ├── useSvgStaticContent.ts # Composable: generates <defs> symbols/filters and grid layer SVG strings
│       ├── cameraUtils.ts       # fitToGrid() function for initial camera setup
│       └── types.ts             # Shared types for render proxies and managers
└── sound/
    └── SoundManager.ts          # Lightweight WebAudio synth for game sounds
```

## Key Design Decisions

### Single SVG Root with Imperative DOM Rendering

The game uses a single `<svg>` root element managed by `SvgGameRoot.vue`, replacing the previous two-layer Canvas + DOM overlay architecture. All visual content — grid tiles, towers, enemies, projectiles, particles, and effects — is rendered as SVG elements.

- **Vue (Declarative):** Manages structural changes (map loading, building/selling towers, opening shops). Mounts the root SVG and static layers via `v-html` for the grid.
- **GameEngine (Logic):** Orchestrates all game logic (enemy movement, tower targeting, projectile updates, wave management). Constructor takes `(gameStore, persistStore)` — no canvas reference. `handleClick()` and `setHover()` accept world coordinates.
- **Direct DOM (Imperative Rendering):** A single `requestAnimationFrame` loop calls `GameEngine.update(dt)` for logic, then reads entity state and writes per-frame properties via `setAttribute` and `style.transform`. Bypasses Vue's reactivity system for hot paths.

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

`GameScreen.vue` renders `<SvgGameRoot>` as a sibling with HUD/shop/tower panel overlays. Vue does **not** touch per-frame rendering. The component initializes `GameEngine` on mount, reads reactive state from Pinia stores, and cleans up on unmount. The SVG mounts/unmounts with the `/game` route.

### Three Pinia Stores
- **`gameStore`** — volatile per-run state (lives, gold, wave, game state, selected tower, hover tile, time scale). Reset when starting a new map.
- **`persistStore`** — persistent meta-progression (gems, unlocked skills, map progress, difficulty, general add-ons). Auto-saved to `localStorage` via manual `save()` calls.
- **`uiStore`** — UI overlay visibility and confirm dialog state.

### Confirm Dialogs as a Single Component
`ConfirmDialog.vue` is mounted globally in `App.vue` and uses `<Teleport to="body">` to render above all layers. Driven by `uiStore.confirmDialog` state.

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

### Entry & Routing
| File | Description |
|---|---|
| `src/main.ts` | App bootstrap: createPinia, load persisted state, mount router |
| `src/App.vue` | Root component with `<router-view>` and global `<ConfirmDialog>` |
| `src/router/index.ts` | Route definitions and navigation guards |

### State Management
| File | Description |
|---|---|
| `src/stores/game.ts` | Volatile game state: lives, gold, wave, selection, time scale, end screen data |
| `src/stores/persist.ts` | Persistent state: gems, unlocks, difficulty, map progress, localStorage I/O |
| `src/stores/ui.ts` | UI state: confirm dialog, menu context, debug panel visibility |

### Vue Components
| File | Description |
|---|---|
| `src/components/GameScreen.vue` | Game layout container: SvgGameRoot, HUD, shop, tower panel, debug panel |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, GameEngine lifecycle, imperative DOM rendering, CTM-based input |
| `src/components/GameHud.vue` | Top bar: lives, gold, gems, wave counter, speed/pause/menu controls |
| `src/components/GameShop.vue` | Bottom bar: tower build selection with cost and discount display |
| `src/components/TowerPanel.vue` | Right panel: tower stats, targeting mode, upgrade/sell, specialization choices |
| `src/components/MainMenu.vue` | Main menu: new game, resume, skill tree, difficulty slider, profile reset |
| `src/components/MapSelect.vue` | Map grid: 36 maps with unlock status, best waves, region info |
| `src/components/SkillTree.vue` | Skill tree: tower level unlocks, specializations, add-ons, general upgrades |
| `src/components/EndScreen.vue` | Victory/game-over screen: gem breakdown, wave count, navigation buttons |
| `src/components/ConfirmDialog.vue` | Global modal dialog (teleported to body, driven by uiStore) |
| `src/components/DebugPanel.vue` | Debug overlay: gold/gems/lives injection, wave skip, enemy clear, map unlock |
| `src/components/StatsPanel.vue` | Wave composition, enemy list, and run statistics display |
| `src/components/HistoryScreen.vue` | Run history entries with gem breakdown formatting |

### Game Engine
| File | Description |
|---|---|
| `src/game/GameEngine.ts` | Core loop: RAF driver, update/render, wave/enemy/tower management, rewards, end game |
| `src/game/Constants.ts` | All game constants: tower stats, enemy types, wave config, map levels, variants, gem costs |
| `src/game/Input.ts` | Keyboard input composable (1-8 keys for speed, Esc for pause, Tab to deselect) |
| `src/game/EnemyWalk.ts` | Base shape vertex generation and path-d string conversion |

### Grid & Maps
| File | Description |
|---|---|
| `src/grid/Grid.ts` | Grid data structure: path tiles, base/spawn locations, build validation |
| `src/grid/Map.ts` | Procedural map generation: 36 maps, 3 regions, 6 layout styles (open, canyon, serpentine, split, bastion, battlefield) |
| `src/grid/Pathfinding.ts` | BFS pathfinding with dynamic tower obstacle avoidance |

### Towers
| File | Description |
|---|---|
| `src/towers/Tower.ts` | Tower entity: stats, targeting modes, level scaling, variants, sell value, milestone bonuses |
| `src/towers/TowerManager.ts` | Tower placement, upgrade, sell with refund/discount modes |
| `src/towers/SkillTree.ts` | Gem upgrade costs, unlock/refund logic, variant definitions, general add-on config |

### Enemies & Waves
| File | Description |
|---|---|
| `src/enemies/Enemy.ts` | Enemy entity: types, stats, pathfinding, status effects (slow, stun, shield) |
| `src/enemies/EnemyManager.ts` | Enemy lifecycle: spawning, movement, death, base reach |
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
| `src/render/svg/useSvgStaticContent.ts` | Composable: generates `<defs>` (symbols from Constants.ts, filters) and grid layer SVG strings |
| `src/render/svg/cameraUtils.ts` | `fitToGrid()` function for initial camera setup |
| `src/render/svg/types.ts` | Shared types for render proxies and managers |
| `src/render/EnemyWalk.ts` | Base shape vertex generation and `vertsToPathD` conversion for lightning/stun paths |
| `src/components/SvgGameRoot.vue` | Single SVG root: RAF loop, imperative DOM writes, CTM-based mouse coordinate conversion, centralized click routing |
| `src/composables/useSvgStaticContent.ts` | Re-export of `src/render/svg/useSvgStaticContent.ts` for Vue composable usage |

### Audio
| File | Description |
|---|---|
| `src/sound/SoundManager.ts` | WebAudio synth: shoot, hit, boss death, base hit, upgrade sounds |

### Services
| File | Description |
|---|---|
| `src/services/CameraService.ts` | Reactive camera state (x, y, zoom) shared between Vue UI and SVG rendering |

## Build & Run

### Prerequisites
- Node.js 18+
- npm

### Development
```bash
npm install
npm run dev
```
Starts Vite dev server at `http://localhost:3000` with HMR.

### Production Build
```bash
npm run build
```
Outputs optimized, code-split assets to `dist/`.

### Preview Production Build
```bash
npm run preview
```
Serves the `dist/` directory locally.
### Alternative Serve

```bash
bash serve-python.sh
```
Uses Python's built-in HTTP server on port 8423.

### Linting & Formatting

This project uses [Biome](https://biomejs.dev) for linting and formatting.

```bash
# Check for lint and format issues
npm run lint

# Auto-fix lint and format issues
npm run lint:fix

# Check formatting only
npm run format

# Auto-fix formatting only
npm run format:fix
```

### Type Checking

This project uses TypeScript with `tsc` in `--noEmit` mode for full type checking of `.ts` and `.vue` files. The `tsconfig.json` enables `strict: true` and `allowJs: false`, meaning only TypeScript files are type-checked.

```bash
# Type-check all TypeScript and Vue files
npm run typecheck
```

## Persistence

Game progress (gems, unlocks, difficulty, map progress) is saved to `localStorage` under the key `gempath_save_v1`. The `persistStore.load()` call in `main.ts` restores saved state on app startup. Profile reset is available from the main menu.

## Game Routes

| Route | Component | Description |
|---|---|---|
| `/` | `MainMenu.vue` | Main menu with difficulty slider and navigation |
| `/map-select` | `MapSelect.vue` | Map selection grid |
| `/skill-tree` | `SkillTree.vue` | Gem-based upgrade tree |
| `/game` | `GameScreen.vue` | Active gameplay with single SVG root + UI overlays |
| `/game-over` | `EndScreen.vue` | Game over screen (`won: false`) |
| `/victory` | `EndScreen.vue` | Victory screen (`won: true`) |

## CSS Theming

CSS custom properties are defined in `App.vue` for consistent theming:
```css
--color-bg, --color-panel, --color-border, --color-accent,
--color-gold, --color-gem, --color-danger, --color-success,
--color-text, --color-text-dim, --font-main
```

All component styles use `<style scoped>` to prevent leakage.

## Testing

### Run Tests

```bash
npm run test
# or equivalently:
npx vitest run
```

Runs all tests with Vitest (jsdom environment).

### Partial Test Runs

```bash
# Run a single test file
npm run test -- tests/unit/towers.test.ts

# Run all tests in a directory
npm run test -- tests/unit/components/

# Run only component tests
npm run test -- tests/unit/components/game-shop.test.ts tests/unit/components/tower-panel.test.ts

# Watch mode (re-runs on file changes)
npm run test:watch

# Watch mode for a specific file
npm run test:watch -- tests/unit/enemies.test.ts

# Run matching by name
npm run test -- -t "sell value"

# Run with coverage report
npm run test -- --coverage
```

### Structure

| Directory | Description |
|---|---|
| `tests/unit/` | 33 unit test files covering all source modules |
| `tests/unit/components/` | Vue component tests (11 files) |
| `tests/integration/` | End-to-end wave simulation |
| `tests/helpers/` | Shared mocks: `mock-stores.ts`, `mock-grid.ts`, `mock-managers.ts` |
| `tests/setup.ts` | Global test setup: in-memory localStorage, Canvas 2D mock, performance.now |

**~490 tests** across all files.

### What's Covered

| System | Test File(s) | Key Behaviors |
|---|---|---|
| Game Engine | `game-engine.test.ts` | Loop, buy/upgrade/sell, pause, timeScale, gem economy, difficulty scaling |
| Grid & Pathfinding | `grid.test.ts`, `pathfinding.test.ts` | Tile queries, build validation, BFS paths, dynamic obstacle avoidance |
| Maps | `map.test.ts` | All 36 maps have valid spawn-to-base paths, region metadata, gem rewards |
| Towers | `towers.test.ts` | Stats with caching, level/variant/addon/terrain/milestone bonuses, sell value |
| Enemies | `enemies.test.ts` | HP/speed formulas, wave scaling, status effects (slow/stun/burn/shield/heal) |
| Waves | `waves.test.ts` | Composition, boss placement, level calculation, inter-wave timing |
| Tower Manager | `tower-manager.test.ts` | Build, sell, update, towerAt |
| Enemy Manager | `enemy-manager.test.ts` | Spawn, cull, getEnemiesInRange |
| Skill Tree | `skill-tree.test.ts` | Unlock/refund/cost logic for all towers and general addons |
| Projectiles | `projectile-manager.test.ts` | All 6 tower types with 2 variants each (12 projectile behaviors) |
| Particles | `particles.test.ts` | Spawn, update, render, fade, expire, count limits |
| SVG Render Managers | `svg-enemy-manager.test.ts`, `svg-tower-manager.test.ts`, `svg-effect-manager.test.ts`, `svg-ui-overlay.test.ts` | Pool allocation, syncFromGameEngine DOM writes, element recycling, visibility toggling |
| SVG Static Content | `svg-static-content.test.ts` | Symbol generation from Constants.ts, grid content generation, filter definitions |
| Camera Utils | `camera-utils.test.ts` | fitToGrid calculations for various viewport/map size combinations |
| Sound | `sound-manager.test.ts` | WebAudio synth, all sound names, dispose, enabled flag |
| Stores | `game-store.test.ts`, `persist-store.test.ts`, `ui-store.test.ts` | State, getters, actions, save/load, schema migration |
| Router | `router.test.ts` | Navigation guards, block without map, save on leave, redirects |
| Input | `input.test.ts` | Keyboard dispatch, timeScale, pause, upgrade/sell, escape handling |
| Components | 10 files in `tests/unit/components/` | Rendering, user interactions, store bindings |
| Integration | `integration.test.ts` | Single wave simulation: kill enemies, gold economy, boss mechanics, victory |

### Known Gaps

| Area | Status |
|---|---|
| `SvgGameRoot.vue` component tests | Smoke tests only (`expect(true).toBe(true)`) — verify no crash but no real assertions |
| `GameScreen.vue` overlays | Only verifies child components exist in template, not overlay rendering or popstate handler |
| `SkillTree.vue` unlock flow | No test for clicking a node to unlock, refund dialog, or general add-on clicks |
| `TowerPanel.vue` | Dropdown desync bug was found in code review and fixed (now covered by regression test) |
| `SvgGameRoot.vue` SVG rendering | No test for CTM coordinate conversion, symbol instantiation, or pool element visibility |
| `svg-enemy-manager.test.ts` | No test for hit flash timing or slow filter application |
| `svg-tower-manager.test.ts` | No test for barrel rotation or level pip positioning |
| `svg-effect-manager.test.ts` | No test for lightning path generation or glow filter application |
| `DebugPanel.vue` | Only 3 of 8 debug buttons tested |
| `MainMenu.vue` in-game state | No test for Resume/End Run buttons when `isInGame` is true |
