# Vue Rewrite Migration Plan

## Codebase Summary

Tower defense game with ~20 JS files totaling ~3,500 lines. Key architecture:
- **Game loop**: `requestAnimationFrame` loop in `Game.js` driving canvas rendering
- **State**: Callback-based pattern (`onGoldChange`, `onLivesChange`, `onWaveChange`, `onStateChange`, `onTowerSelect`, `onBuildModeChange`, `onGemChange`, `onNeedVariant`) on the `Game` class
- **UI**: Direct DOM manipulation in `UI.js` — manually toggling `.hidden` classes, building HTML strings, managing 8+ overlays
- **Persistence**: `localStorage` via `Storage.js`
- **No build step**: Plain ES modules

---

## Proposed Tech Stack

| Dependency | Purpose |
|---|---|
| `vue` (3.x) | Reactive components, template syntax |
| `vue-router` | Screen navigation (menu, map select, skill tree, game, end screen) |
| `pinia` | State management (replaces callbacks) |
| `vite` | Build tool (fast HMR, tree-shaking, ES modules) |

**No other libraries needed.** The CSS is clean and will work as-is. The canvas game loop is self-contained.

---

## Architecture

```
src/
├── App.vue                    # Root: <router-view> + canvas container
├── main.js                    # Vite entry: createApp, router, stores
├── router/
│   └── index.js               # Route definitions
├── stores/
│   ├── game.js                # Pinia store: lives, gold, wave, state, selectedTower, etc.
│   ├── persist.js             # Pinia store: gems, unlocks, difficulty, map progress (localStorage)
│   └── ui.js                  # Pinia store: overlays, confirm dialogs, debug panel
├── components/
│   ├── GameCanvas.vue         # Canvas wrapper: owns RAF loop, delegates to game engine
│   ├── Hud.vue                # Top HUD bar (lives, gold, gems, wave, controls)
│   ├── Shop.vue               # Tower shop bar
│   ├── TowerPanel.vue         # Tower detail/upgrade panel
│   ├── MainMenu.vue           # Main menu overlay
│   ├── MapSelect.vue          # Map selection screen
│   ├── SkillTree.vue          # Skill tree overlay
│   ├── EndScreen.vue          # Game over / victory
│   ├── ConfirmDialog.vue      # Reusable confirm dialog (sell, refund, reset, end run)
│   └── DebugPanel.vue         # Debug buttons
├── game/                      # Game engine (mostly unchanged)
│   ├── GameEngine.js          # Renamed from Game.js, refactored to use Pinia stores
│   ├── Constants.js           # Unchanged
│   ├── Input.js               # Refactored to dispatch to Pinia actions
│   └── Storage.js             # Simplified — Pinia plugin handles persistence
├── grid/                      # Unchanged (Grid.js, Map.js, Pathfinding.js)
├── towers/                    # Unchanged (Tower.js, TowerManager.js, SkillTree.js)
├── enemies/                   # Unchanged (Enemy.js, EnemyManager.js)
├── waves/                     # Unchanged (WaveManager.js)
├── render/                    # Unchanged (Renderer.js, Shapes.js, Particles.js, ProjectileManager.js)
├── sound/                     # Unchanged (SoundManager.js)
└── assets/
    └── style.css              # Moved from old/css/
```

---

## Key Design Decisions

### 1. Canvas is a Vue component, not managed by Vue

`GameCanvas.vue` will own the `<canvas>` element and the `requestAnimationFrame` loop. Vue will **not** touch the canvas rendering. The component will:
- Initialize `GameEngine` in `onMounted`
- Read reactive state from Pinia stores
- Write state changes back to Pinia stores (which triggers Vue UI updates)
- Clean up in `onUnmounted`

**User decision**: Canvas will **mount/unmount with the `/game` route** — cleaner separation, frees memory during menus, requires re-init on each game start.

### 2. Pinia replaces the callback pattern

Currently, `Game.js` uses `onGoldChange`, `onLivesChange`, `onWaveChange`, `onStateChange`, `onTowerSelect`, `onBuildModeChange`, `onGemChange`, `onNeedVariant`. These all become Pinia store mutations:

```js
// Instead of: game.onGoldChange = (g) => { document.getElementById('goldDisplay').textContent = g; }
// The HUD component does: <span>{{ gameStore.gold }}</span>
// The game engine does: gameStore.setGold(newGold)
```

### 3. Two Pinia stores

**User decision**: Two-store split confirmed.

- **`gameStore`** — volatile per-run state: lives, gold, wave, game state, selected tower, hover tile, timeScale, etc. Reset when starting a new map.
- **`persistStore`** — persistent meta-progression: gems, unlocked skills, map progress, difficulty, general addons. Auto-saved to `localStorage` via a Pinia persistence plugin.

This mirrors the existing code's separation between `game.*` properties and `save.*` properties.

### 4. Vue Router for screens

Routes: `/` (main menu), `/map-select`, `/skill-tree`, `/game`, `/game-over`, `/victory`. The game canvas is only active during `/game`. Transitions between menu screens are just route changes.

### 5. Confirm dialogs as a single component

Instead of 5 separate overlay divs (sell, refund, reset, end run), use one `<ConfirmDialog>` component driven by `uiStore.confirmDialog` state.

### 6. CSS Improvements

**User decision**: Open to minor CSS improvements during migration.

- Introduce CSS custom properties (variables) for consistent theming
- Use Vue component-scoped styles (`<style scoped>`) to prevent leakage
- Keep the exact same visual appearance — no design changes, only structural improvements

---

## Migration Steps

### Step 1: Scaffold
- `npm init`, install `vue`, `vue-router`, `pinia`, `vite`
- Create project structure with all directories
- Configure `vite.config.js` with `@/` alias for `src/`
- Create `index.html` (replaces `old/index.html`)
- Create `src/main.js` entry point
- Create `src/App.vue` with `<router-view>`

### Step 2: Pinia Stores
- Create `gameStore` with all volatile game state (lives, gold, wave, state, selectedTower, hoverTile, timeScale, etc.)
- Create `persistStore` with meta-progression state (gems, unlocked skills, map progress, difficulty, addons)
- Create `uiStore` with overlay visibility and confirm dialog state
- Write a Pinia persistence plugin for `localStorage` (or use `pinia-plugin-persistedstate`)

### Step 3: Game Engine Refactor
- Copy `old/js/game/` → `src/game/`
- Refactor `Game.js` → `GameEngine.js` to accept Pinia store references instead of setting callbacks
- Replace all `this.onGoldChange()`, `this.onStateChange()`, etc. with `gameStore.setGold()` etc.
- Refactor `Input.js` to dispatch to Pinia actions

### Step 4: Vue Components
- Start with simpler components: `Hud.vue`, `Shop.vue`, `ConfirmDialog.vue`
- Then overlays: `MainMenu.vue`, `MapSelect.vue`, `SkillTree.vue`, `EndScreen.vue`
- `TowerPanel.vue` for tower detail/upgrade
- `DebugPanel.vue` for debug buttons

### Step 5: GameCanvas Component
- Wrap the canvas + game loop in `GameCanvas.vue`
- Handle mount/unmount lifecycle (canvas only exists on `/game` route)
- Handle resize events
- Forward input events to `Input.js` / Pinia actions

### Step 6: Router + App.vue
- Define all routes in `src/router/index.js`
- Wire up state transitions (start game, game over, victory, return to menu)
- Ensure returning to menu from game saves progress properly

### Step 7: CSS Migration
- Move `old/css/style.css` → `src/assets/style.css`
- Adjust selectors that reference old DOM IDs to use Vue component classes
- Extract reusable variables to `:root` CSS custom properties
- Scope component-specific styles with `<style scoped>`

### Step 8: Cleanup
- Remove old callback wiring from `Input.js`
- Verify autosave works via Pinia plugin
- Test all game flows: menu → map select → game → victory/game over → menu
- Test skill tree purchases and persistence
- Test tower shop, upgrades, and placement

---

## What Stays Unchanged

The following files are **pure game logic** with no UI coupling and will be moved largely as-is:

| File | Purpose |
|---|---|
| `Constants.js` | Game constants (tile sizes, colors, etc.) |
| `Grid.js` | Grid data structure and path/base/spawn queries |
| `Map.js` | Procedural map generation (36 maps across 3 regions) |
| `Pathfinding.js` | BFS pathfinding with dynamic obstacle avoidance |
| `Tower.js` | Tower stats, behavior, targeting, upgrades |
| `TowerManager.js` | Tower placement and management |
| `SkillTree.js` | Gem upgrade costs, unlock logic, meta-progression |
| `Enemy.js` | Enemy types, stats, behavior |
| `EnemyManager.js` | Enemy spawning and lifecycle |
| `WaveManager.js` | Wave composition and progression |
| `Renderer.js` | Canvas drawing, camera system, grid/enemy/tower rendering |
| `Shapes.js` | SVG-style vector drawing helpers for tiles, towers, enemies |
| `Particles.js` | Particle system for visual effects |
| `ProjectileManager.js` | Projectile tracking and collision |
| `SoundManager.js` | Lightweight WebAudio synth |

---

## Library Evaluation (Not Recommended — For Reference)

| Library | Why Not Now | When It Might Help |
|---|---|---|
| `element-plus` / `naive-ui` | Adds 50kb+; current CSS is clean and sufficient | If UI complexity grows significantly |
| `axios` | No HTTP calls needed | If adding multiplayer or cloud saves |
| `howler.js` | WebAudio synth is lightweight and works | If adding real sound assets |
| `zustand` | Pinia is the Vue-native choice | N/A |

---

## Critical Context

- `Game.js` acts as the central controller, managing the `requestAnimationFrame` loop, state transitions, and dispatching callbacks to `UI.js`
- `UI.js` directly manipulates the DOM for overlays, shop, tower panels, and skill tree — this must be replaced by Vue components
- `Storage.js` uses `localStorage` with a flat `save` object — needs to be integrated into Pinia for reactive persistence
- Rendering relies on a custom `Renderer` class with camera transforms, `ParticleSystem`, and `ProjectileManager` — canvas updates must remain outside Vue's reactivity to avoid performance overhead
- 36 procedural maps across 3 regions, 6 tower types with deep upgrade trees, 6 enemy types, wave/boss systems, and a gem-based meta-progression skill tree

## Relevant Files (Legacy)

| File | Description |
|---|---|
| `old/js/game/Game.js` | Core game loop, state machine, and callback dispatcher |
| `old/js/ui/UI.js` | DOM manipulation for all overlays, HUD, shop, and skill tree |
| `old/js/game/Storage.js` | LocalStorage persistence and save schema |
| `old/js/towers/SkillTree.js` | Gem upgrade costs, unlock logic, and meta-progression |
| `old/js/render/Renderer.js` | Canvas drawing, camera system, and grid/enemy/tower rendering |
| `old/js/main.js` | Entry point initializing Game, UI, Input, and Storage |
| `old/css/style.css` | Global styles and overlay panel styling |
| `old/index.html` | Base HTML structure with canvas and overlay containers |
| `old/js/grid/Map.js` & `old/js/grid/Grid.js` | Procedural map generation and grid/pathfinding logic |
| `old/js/waves/WaveManager.js` & `old/js/enemies/EnemyManager.js` | Wave composition and entity management |
| `old/js/towers/TowerManager.js` & `old/js/towers/Tower.js` | Tower placement, stats, upgrades, and targeting |
| `old/js/render/Shapes.js` | Vector drawing helpers for tiles, towers, enemies |
| `old/js/grid/Pathfinding.js` | BFS shortest path with dynamic tower obstacles |
| `old/js/sound/SoundManager.js` | Lightweight WebAudio synth |
