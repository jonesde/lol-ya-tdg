# Theme System: Design Plan

**Status:** Plan for future implementation
**Date:** 2026-07-03
**Current Architecture:** Pure SVG rendering in `src/render/svg/`

## 0. Scope: Theme Switching is Between-Map Only

Theme switching is **not supported mid-map**. A theme is chosen on `MapSelect.vue` and is
applied once when a map starts; it stays fixed for the duration of that run. This eliminates
the need for any in-game reactivity around theme data:

- `ThemeGetter` is a plain singleton with no Vue reactivity. Its values are read at map load
  and during per-frame rendering, but they only *change* between maps.
- Constants (`TOWER_META`, `ENEMY_TYPES`, `Regions`) do not need to become reactive Vue
  state. They are resolved against the active theme when the map loads, and consumed directly
  afterward. See §3 for the exact mechanism.
- No watcher/subscriber is required to propagate theme changes into the running game. The
  only integration point is a single `themeGetter.setActiveTheme(...)` call during map start
  (see §3 "Wiring").
- Pooled `<use>` elements do not need mid-run href refresh: the `<defs>` are regenerated once
  at map start, and pooled elements resolve their `href` against the freshly-built symbols.

## 1. What Changes vs Stays Same

### What changes
- **Static region colors** → **theme-driven palettes**
  - `src/game/Constants.ts` defines `Regions` (array of 3 region objects with `tileBase`, `tileAlt`, `pathColor`, `heightColors`), lines 20-47
  - `src/game/ConstantsTower.ts` defines `TOWER_META` (line 37) with a `color` per tower type plus per-state `color` values for animation and walking configs (e.g. line 41 base, lines 57/68 animation/walking color)
  - `src/game/ConstantsEnemy.ts` defines `ENEMY_TYPES` with `color` per enemy type (lines 42, 117, 192, 267, 343, 420)
  - These become theme-lookup calls instead of constant references
- **Map visuals** → **theme-aware rendering**
  - `src/render/svg/useSvgStaticContent.ts`: `renderBaseSvg` (line 14) and the `useSvgStaticContent` composable (line 246) render grid tiles and bases with hardcoded colors
  - `src/render/svg/TowerManager.ts`: `<use>` element creation at line 28; `style.color` set at line 138; `href` set at line 164
  - `src/render/svg/EnemyManager.ts`: `<use>` element creation at line 10; href set at lines 112, 130
  - `src/render/svg/EffectManager.ts`: `syncBuildPreview` at line 313 and other effect-sync methods
  - `src/render/svg/UiOverlayManager.ts`: pooled `<rect>` creation starting at line 12
  - `src/render/svg/ProjectileManager.ts`: line 36 sets `fill` from `proj.color` with a `#ffffff` fallback
  - `src/game/ProjectileManager.ts`: line 138 spawns particles with hardcoded `"#ffcf4d"`
  - `src/game/ParticleSystem.ts`: particles carry a `color` set at spawn time (lines 9, 17, 34)
- **No theme persistence** → **theme saved in `persist.ts`**
  - `src/stores/persist.ts` `PersistStateShape` (lines 25-36) currently has no `activeTheme` field (schema: gems, highestUnlockedMap, bestWaves, activeWaves, difficulty, firstTimeMilestones, firstClears, generalAddons, unlocked, runHistory)
  - Existing saves in `localStorage` (key `gempath_save_v1`) predate this field; `load()` must default `activeTheme` to `'default'` when absent (see §5 migration note)

### What stays the same
- **SVG rendering architecture** (no Canvas migration)
  - `src/components/SvgGameRoot.vue` orchestrates layered SVG rendering
  - `requestAnimationFrame` loop drives rendering in `src/render/svg/TowerManager.ts`, `EnemyManager.ts`, etc.
  - All rendering uses `<use>` elements with `<defs>` templates
- **Tower class** (`src/towers/Tower.ts`) keeps its logic; SVG paths and colors change per theme
- **Enemy class** (`src/enemies/Enemy.ts`) keeps its logic; SVG paths and colors change per theme
- **Game engine** (`src/game/GameEngine.ts`) keeps its logic
- **Projectile rendering** (`src/render/svg/ProjectileManager.ts`) stays SVG-based (color source becomes theme-aware, geometry unchanged)
- **Effect rendering** (`src/render/svg/EffectManager.ts`) stays SVG-based but visuals become theme-aware
- **UI overlay** (`src/render/svg/UiOverlayManager.ts`) stays SVG-based but visuals become theme-aware
- **Map data** (`src/grid/Map.ts`) stays the same
- **Wave logic** (`src/waves/WaveManager.ts`) stays the same

## 2. Theme Data Structure

### File location
- `src/game/themes/{themeKey}.json` (e.g., `src/game/themes/fantasy.json`, `src/game/themes/sci-fi.json`)
- Loaded once at build time via static `import` (see `resolveJsonModule` note below). Because theme switching is between-map only (§0), there is no per-switch async loading — all themes are bundled and selecting one is just a key lookup in the registry.

### tsconfig requirement
`import fantasy from './fantasy.json'` requires `resolveJsonModule: true` in `tsconfig.json`. Verify this is set (the current `tsconfig.json` uses `strict: true` and `moduleResolution: bundler`; `resolveJsonModule` should be added if not already present).

### Schema
Each tower in the source has up to two distinct colors: a **base** color (`TowerMeta.color`, used for the idle sprite and as `currentColor` for styling) and an **active** color (`TowerMeta.animation.color` / `TowerMeta.walking.color`, used for the firing/walking sprite frames). For most towers these are identical; for `lightning` they differ (`#205088` base vs `#40a0ff` active). The schema therefore carries both per tower. Enemy types have a single color each, matching `ENEMY_TYPES[...].color`.

```jsonc
{
  "name": "Fantasy",
  "displayName": "Fantasy",
  "description": "Medieval fantasy theme",
  "regionColors": {
    "0": { "tileBase": "#4a2c0a", "tileAlt": "#2d1a05", "pathColor": "#3a2a1a", "heightColors": ["#4e824e", "#427542", "#366836", "#2a5a2a"] },
    "1": { "tileBase": "#c9a64f", "tileAlt": "#d8b75a", "pathColor": "#b8a56a", "heightColors": ["#1a3a5c", "#a0896a", "#6b5a3e", "#0d0d0d"] },
    "2": { "tileBase": "#2f3b30", "tileAlt": "#384538", "pathColor": "#3a322a", "heightColors": ["#4e443a", "#6a5d52", "#7a6c5e", "#8a7d6a"] }
  },
  "baseColors": {
    "player": "#2d5a27",
    "enemy": "#8b0000"
  },
  "towerColors": {
    "basic":    { "base": "#8fbc8f", "active": "#8fbc8f" },
    "ice":      { "base": "#9be7ff", "active": "#9be7ff" },
    "sniper":   { "base": "#ffd84d", "active": "#ffd84d" },
    "cannon":   { "base": "#ff8a4d", "active": "#ff8a4d" },
    "lightning":{ "base": "#205088", "active": "#40a0ff" },
    "railgun":  { "base": "#c98aff", "active": "#c98aff" }
  },
  "enemyColors": {
    "minion": "#e85a6a",
    "runner": "#ffd84d",
    "tank": "#7a8a9a",
    "shielded": "#5fd0ff",
    "healer": "#5fff8a",
    "boss": "#c98aff"
  },
  "projectileColors": {
    "default": "#ffffff",
    "muzzleFlash": "#ffcf4d"
  },
  "effectColors": {
    "lightning": "#40a0ff",
    "stun": "#40a0ff",
    "buildPreview": "rgba(0,255,0,0.3)",
    "rangeCircle": "rgba(255,255,255,0.4)",
    "buildRangeCircle": "rgba(0,255,0,0.6)",
    "upgradeButtonBg": "#00004a",
    "upgradeButtonBorder": "#40a0ff",
    "selectedTileRect": "rgba(95,208,255,0.8)"
  },
  "uiOverlayColors": {
    "hpBarForeground": "#00ff00",
    "hpBarBackground": "#00004a",
    "shieldBarForeground": "#00ffff",
    "shieldBarBackground": "#00004a",
    "bossTextColor": "#f0e6d2",
    "hpDynamic": {
      "high": "#00ff00",
      "medium": "#ffff00",
      "low": "#ff0000"
    }
  },
  "hudColors": {
    "lives": "#5fff8a",
    "gold": "#ffd84d",
    "gems": "#9be7ff"
  },
  "svgPaths": {
    "gridTile": "<path d='...' fill='...' />",
    "basePlayer": "<g>...</g>",
    "baseEnemy": "<g>...</g>",
    "tower": {
      "basic": "<g>...</g>",
      "ice": "<g>...</g>",
      "sniper": "<g>...</g>",
      "cannon": "<g>...</g>",
      "lightning": "<g>...</g>",
      "railgun": "<g>...</g>"
    },
    "enemy": {
      "minion": "<g>...</g>",
      "runner": "<g>...</g>",
      "tank": "<g>...</g>",
      "shielded": "<g>...</g>",
      "healer": "<g>...</g>",
      "boss": "<g>...</g>"
    },
    "effects": {
      "lightning": "<path d='...' />",
      "stun": "<circle r='...' />",
      "buildPreview": "<path d='...' />"
    },
    "ui": {
      "hpBar": "<rect ... />",
      "shieldBar": "<rect ... />",
      "text": "<text ... />"
    }
  }
}
```

### Color bucket ownership (deduplicated)
The earlier draft carried overlapping `uiColors`, `uiOverlay`, and `effectColors` buckets with no clear owner. The schema above collapses them into two buckets with explicit ownership:

- **`effectColors`** — owned and read by `EffectManager.ts` (lightning paths, stun aura, build preview rect, range circle, upgrade button bg/border, selected-tile rect).
- **`uiOverlayColors`** — owned and read by `UiOverlayManager.ts` (HP/shield bar foreground/background, boss HP text color, dynamic HP thresholds).
- **`hudColors`** — owned and read by `GameHud.vue` (HUD stat colors: lives, gold, gems).
- **`projectileColors`** — owned and read by `src/render/svg/ProjectileManager.ts` (default fill fallback) and `src/game/ProjectileManager.ts` + `src/game/ParticleSystem.ts` (muzzle-flash particle color at spawn).
- **`regionColors`** — owned and read by `useSvgStaticContent.ts` (grid tile + base rendering) and `Constants.ts` `Regions`.
- **`towerColors`** / **`enemyColors`** — owned and read by `ConstantsTower.ts`/`ConstantsEnemy.ts` and the render managers that consume tower/enemy color.

`ThemeGetter` exposes one getter per bucket (see §3). There is no separate `getUiColor` vs `getUiOverlayColor` split.

### Notes
- Region colors: 3 regions matching `Constants.ts` `Regions` array (each region has `tileBase`, `tileAlt`, `pathColor`, `heightColors[]`). The schema mirrors the full `Regions` entry shape, not just a single color, because `useSvgStaticContent` consumes all four fields per region.
- Tower colors: 6 entries keyed by `TowerId` (`basic`, `ice`, `sniper`, `cannon`, `lightning`, `railgun`). Each entry has `base` and `active` to cover both `TowerMeta.color` and `TowerMeta.animation.color`/`walking.color`. Where a tower uses the same color for both (5 of 6), set `base == active`.
- Enemy colors: 6 entries keyed by enemy type name (`minion`, `runner`, `tank`, `shielded`, `healer`, `boss`), matching `ENEMY_TYPES`.
- **SVG paths**: Full creative license to define completely different SVG paths for each theme. These are injected into `<defs>` via `v-html`/`innerHTML` from trusted first-party JSON bundled at build time — no runtime user input. Note that any `fill`/`stroke` attributes embedded in `svgPaths` strings are redundant with the color buckets above and will drift; prefer `currentColor` / `stroke="currentColor"` in path markup and let the render managers set `style.color` from the color buckets, matching the current pattern in `TowerManager.ts:138`.
- Variants (A/B specializations at tower level 4) are stat-only in the current code (`TOWER_VARIANTS` in `ConstantsTower.ts:332`) and carry no distinct colors, so the schema has no per-variant color or SVG entry. If a future theme wants variant-specific visuals, extend `towerColors[t].variants = { A: {...}, B: {...} }` rather than flattening into the top-level tower entry.

## 3. Theme Lookup Architecture

### ThemeGetter
- `src/game/ThemeGetter.ts` (new file)
- Plain singleton (no Vue reactivity) holding the active theme object. Because theme switching is between-map only (§0), `ThemeGetter`'s values are read during map load and per-frame rendering but never change mid-run, so no reactivity system is needed.
- Provides `setActiveTheme(key)`, `getRegionColors(regionId)`, `getTowerColors(towerType)`, `getEnemyColor(enemyType)`, `getProjectileColor(key)`, `getEffectColor(key)`, `getUiOverlayColor(key)`, `getHudColor(key)`, `getBaseColor(side)`.
- Called from `useSvgStaticContent.ts`, `TowerManager.ts`, `EnemyManager.ts`, `EffectManager.ts`, `UiOverlayManager.ts`, `ProjectileManager.ts`, `ParticleSystem.ts`, and from the constants files (`Constants.ts`, `ConstantsTower.ts`, `ConstantsEnemy.ts`) — see "Constants mechanism" below.

### Constants mechanism (no reactivity required)
`TOWER_META`, `ENEMY_TYPES`, and `Regions` are `export const` object literals imported by name across the codebase. They are evaluated once at module load and read directly at many call sites (`GameEngine.ts:34,461,543`, `useSvgStaticContent.ts:2-4`, `TowerManager.ts`, `EnemyManager.ts`, `StatsPanel.vue:90`, `GameShop.vue:38`, `TowerPanel.vue:198`, etc.). Because theme changes happen only between maps, these constants do **not** need to become reactive or be rebuilt on theme switch. Instead:

- The `color` fields on `TowerMeta` / `ENEMY_TYPES[...]` / `Regions[...]` are **removed** and replaced with `themeGetter` lookups at consumption sites. Concretely:
  - `tower.color` → `themeGetter.getTowerColors(tower.type).base`
  - `tower.animation.color` / `tower.walking.color` → `themeGetter.getTowerColors(tower.type).active`
  - `enemy.color` → `themeGetter.getEnemyColor(enemy.type)`
  - `Regions[i].tileBase` etc. → `themeGetter.getRegionColors(i).tileBase`
- The non-color fields (`name`, `cost`, `icon`, `animation.referenceImages`, `animation.duration`, variant `apply` functions, enemy stats) stay as `const`.
- Call sites that currently read `.color` once and cache it (e.g. `TowerManager.ts:138` setting `style.color`) instead call the getter at the same point. For per-frame hot paths this is a single hashmap lookup on a singleton — negligible.

This is a wider change than "constants become dynamic" implies: every `.color` access on a tower/enemy/region across the codebase becomes a `themeGetter` call. The modified-files list in §5 enumerates the affected files.

### Wiring: when is `setActiveTheme` called?
There is exactly one integration point, not a watcher:

1. On app boot, after `persistStore.load()` in `src/main.ts`, call `themeGetter.setActiveTheme(persistStore.activeTheme ?? 'default')`. This covers the very first render before any map is loaded (e.g. `MapSelect` swatches).
2. When the user picks a theme on `MapSelect.vue`, update `persistStore.activeTheme` (and `persistStore.save()`), then call `themeGetter.setActiveTheme(...)`. `MapSelect` is not in-game, so no live pools need refreshing.
3. When a map starts — in `GameEngine` constructor or `SvgGameRoot.vue` `onMounted`, whichever runs first after route enter — call `themeGetter.setActiveTheme(persistStore.activeTheme ?? 'default')` defensively before any rendering/`<defs>` generation reads from the getter. This guarantees the active theme matches the persisted selection even if the user navigated here from a deep link.

Because the theme is fixed for the run after step 3, no further calls are needed and no reactivity is required downstream. `useSvgStaticContent`'s `computed` for `<defs>` will re-run when the map changes (its dependency), which is also when the theme is re-resolved — consistent with between-map-only switching.

### File: ThemeGetter.ts
```ts
// src/game/ThemeGetter.ts
import { themes, type ThemeData } from './themes/index.js'

class ThemeGetter {
  private themeData: ThemeData = themes.default

  setActiveTheme(key: string): void {
    this.themeData = themes[key] || themes.default
  }

  getRegionColors(regionId: number): ThemeData['regionColors'][string] {
    return this.themeData.regionColors[String(regionId)] || this.themeData.regionColors['0']
  }

  getTowerColors(towerType: string): { base: string; active: string } {
    return this.themeData.towerColors[towerType] || this.themeData.towerColors.basic
  }

  getEnemyColor(enemyType: string): string {
    return this.themeData.enemyColors[enemyType] || this.themeData.enemyColors.minion
  }

  getProjectileColor(key: string): string {
    return this.themeData.projectileColors[key] || this.themeData.projectileColors.default
  }

  getEffectColor(key: string): string {
    return this.themeData.effectColors[key] || '#40a0ff'
  }

  getUiOverlayColor(key: string): unknown {
    // Returns string or nested object (hpDynamic); caller narrows.
    return (this.themeData.uiOverlayColors as Record<string, unknown>)[key] ?? '#00ff00'
  }

  getBaseColor(side: 'player' | 'enemy'): string {
    return this.themeData.baseColors[side]
  }

  getHudColor(key: string): string {
    return (this.themeData.hudColors as Record<string, string>)[key] ?? '#5fff8a'
  }
}

export const themeGetter = new ThemeGetter()
```

### File: themes/index.ts
```ts
// src/game/themes/index.ts
import type { ThemeData } from './types.js'
import fantasy from './fantasy.json'
import sciFi from './sci-fi.json'
import defaultTheme from './default.json'

export const themes: Record<string, ThemeData> = {
  default: defaultTheme,
  fantasy: fantasy,
  'sci-fi': sciFi,
}
```

## 4. SVG Shape Strategy

### Current Architecture
- All rendering uses SVG `<use>` elements referencing `<defs>` templates
- `src/render/svg/useSvgStaticContent.ts` generates static SVG content (grid tiles, bases)
- `src/render/svg/TowerManager.ts` manages tower `<use>` elements with href animation
- `src/render/svg/EnemyManager.ts` manages enemy `<use>` elements with frame animation
- `src/components/SvgGameRoot.vue` orchestrates all layers

### Theme Integration Points
1. **Grid tiles** (`useSvgStaticContent.ts`): Full creative license — SVG paths, colors, patterns can change per theme
2. **Bases** (`useSvgStaticContent.ts`): Full creative license — SVG paths, colors, shapes can change per theme
3. **Tower SVG paths** (`TowerManager.ts`): Full creative license — each theme provides its own SVG paths, colors, and shapes via `svgPaths.tower.*`
4. **Enemy SVG paths** (`EnemyManager.ts`): Full creative license — each theme provides its own SVG paths, colors, and shapes via `svgPaths.enemy.*`
5. **Effects** (`EffectManager.ts`): Full creative license — SVG paths, colors, shapes for lightning, stun, build preview can change per theme
6. **UI overlays** (`UiOverlayManager.ts`): Full creative license — SVG paths, colors, shapes for HP bar, shield bar, text can change per theme

### SVG Path Strategy
- Each theme is self-contained and carries its own complete `svgPaths` definitions. There is no fallback to `referenceImages`, `EnemyWalk.ts` vertex data, or any assets from another theme.
- At map load, `<defs>` is regenerated using only the active theme's `svgPaths` entries. The existing `referenceImages`/vertex pipeline in `ConstantsTower.ts` and `EnemyWalk.ts` is used solely to author the `default.json` theme and is not consulted at runtime.
- Each theme can therefore define completely different SVG paths for towers, enemies, map tiles, bases, effects, and UI overlays.
- `<defs>` regeneration happens once per map load (driven by the existing `currentMap`-keyed `computed` in `useSvgStaticContent`); pooled `<use>` elements re-resolve their `href` against the new `<symbol>` ids at the same time. No mid-run refresh is needed or supported (§0).
- This enables radically different visual styles per theme (e.g., fantasy castles vs sci-fi bases, medieval swords vs laser guns) without touching game logic.

## 5. File Changes

### New Files
- `src/game/themes/{themeKey}.json` (e.g., `fantasy.json`, `sci-fi.json`, `default.json`)
- `src/game/themes/types.ts` (ThemeData interface)
- `src/game/themes/index.ts` (theme registry)
- `src/game/ThemeGetter.ts` (theme lookup singleton)
- `src/components/ThemeCard.vue` (theme card for the MapSelect selector — see §7)

### Modified Files — Constants
- `src/game/Constants.ts` → `Regions` entries lose their `color`/`tileBase`/`tileAlt`/`pathColor`/`heightColors` literal fields; consumers call `themeGetter.getRegionColors(regionId)` instead. (Non-color fields like region name/gemReward stay.)
- `src/game/ConstantsTower.ts` → `TowerMeta.color`, `TowerAnimationConfig.color`, `TowerWalkingConfig.color` are removed; consumers call `themeGetter.getTowerColors(type).base` / `.active`. `TOWER_VARIANTS` (line 332) is stat-only and unchanged.
- `src/game/ConstantsEnemy.ts` → `ENEMY_TYPES[...].color` removed; consumers call `themeGetter.getEnemyColor(type)`. The `color: string` field on the `EnemyType` interface (line 21) is removed.

### Modified Files — Tower class
- `src/towers/Tower.ts` → line 172 `this.color = this.meta.color` becomes `this.color = themeGetter.getTowerColors(this.type).base`, since `TOWER_META[...].color` is removed in step 8.

### Modified Files — Render managers
- `src/render/svg/useSvgStaticContent.ts` → grid tile and base colors/SVG paths read via `themeGetter`. `<defs>` regeneration is driven by the existing `computed` keyed on `currentMap`, which already re-runs on map change (the only time the theme can change).
- `src/render/svg/TowerManager.ts` → `style.color` (line 138) reads `themeGetter.getTowerColors(tower.type).base`; sprite `href` resolution (line 164) resolves against theme-driven `<symbol>` ids built in `useSvgStaticContent`.
- `src/render/svg/EnemyManager.ts` → enemy sprite `href` (lines 112, 130) resolves against theme-driven `<symbol>` ids.
- `src/render/svg/EffectManager.ts` → effect colors read via `themeGetter.getEffectColor(...)` in `syncBuildPreview` (line 313) and the lightning/stun sync methods.
- `src/render/svg/UiOverlayManager.ts` → HP/shield bar and boss text colors read via `themeGetter.getUiOverlayColor(...)` starting at the rect creation block (line 12+).
- `src/render/svg/ProjectileManager.ts` → default `fill` fallback (line 36) reads `themeGetter.getProjectileColor('default')`.
- `src/game/ProjectileManager.ts` → muzzle-flash particle color (line 138) reads `themeGetter.getProjectileColor('muzzleFlash')`.
- `src/game/ParticleSystem.ts` → particles receive their color at spawn time (lines 9, 17, 34); the spawner passes a theme-resolved color rather than a literal.

### Modified Files — Vue components that inline tower/enemy/region colors
These components read tower/enemy/region colors directly for inline styles and must be updated to use `themeGetter`. Because the theme is fixed for the run, calling the getter in a `computed` or directly in the template is fine (no per-frame reactivity needed).
- `src/components/StatsPanel.vue` → `ENEMY_TYPES[type]?.color` (line 90) and `enemy.color` (lines 110, 114) become `themeGetter.getEnemyColor(type)`.
- `src/components/GameShop.vue` → `TOWER_META[id].color` (line 38) becomes `themeGetter.getTowerColors(id).base`.
- `src/components/TowerPanel.vue` → `tower.color` (line 198) becomes `themeGetter.getTowerColors(tower.type).base`.
- `src/components/GameHud.vue` → hardcoded HUD stat colors in the `<style>` block (lines 203-220: lives `#5fff8a`, gold `#ffd84d`, gems `#9be7ff`) become inline `:style` bindings sourced from `themeGetter.getHudColor(...)`.
- `src/components/MapSelect.vue` → region label CSS colors (`.region-0 .region-label { color: #6abf6a }` etc., lines 183-185) and region divider gradients (lines 192-194) become inline styles sourced from `themeGetter.getRegionColors(regionId)`. (Note: the current `MapSelect.vue` shows region labels with hardcoded CSS colors — there are no swatches; the "Proposed Theme Selector" in §7 adds a real swatch UI.)
- `src/components/HistoryScreen.vue` → region color usage (line 12 region names array is fine; any color rendering derived from regionId must go through `themeGetter`).

### Modified Files — Stores
- `src/stores/persist.ts` → add `activeTheme: string` to `PersistStateShape` (lines 25-36), default `'default'` in `defaultState()` (line 72). The `gameStore` does **not** get an `activeTheme` field — the persisted value is the single source of truth and is mirrored into `ThemeGetter` at map load (§3 wiring), so a volatile duplicate in the game store would just drift.
- **Migration:** existing saves under `localStorage` key `gempath_save_v1` predate `activeTheme`. `persistStore.load()` already performs schema migration for other fields; add a default of `'default'` when the loaded blob is missing `activeTheme`. No version bump of the save key is required.

### Modified Files — Boot & navigation
- `src/main.ts` → after `persistStore.load()`, call `themeGetter.setActiveTheme(persistStore.activeTheme ?? 'default')` so the first `MapSelect` render (swatches) is correct.
- `src/components/MapSelect.vue` → add theme selector UI (§7) that updates `persistStore.activeTheme`, calls `persistStore.save()`, and calls `themeGetter.setActiveTheme(...)` immediately so swatches update without a reload.
- `src/game/GameEngine.ts` (or `src/components/SvgGameRoot.vue` `onMounted`, whichever runs first on `/game` enter) → defensively call `themeGetter.setActiveTheme(persistStore.activeTheme ?? 'default')` before any rendering/`<defs>` generation reads from the getter.

### Unchanged Files
- `src/components/SvgGameRoot.vue` (orchestrates rendering; the only change is the one defensive `setActiveTheme` call if placed here rather than in `GameEngine`)

- `src/enemies/Enemy.ts` (logic unchanged; only color references change via ThemeGetter at consumption sites)
- `src/grid/Map.ts` (map data unchanged)
- `src/waves/WaveManager.ts` (wave logic unchanged)
- `src/game/EnemyWalk.ts` (logic unchanged; no longer a runtime rendering dependency — used only to author `default.json` svgPaths)
- `src/services/CameraService.ts` / `src/render/svg/cameraUtils.ts` (camera logic unchanged)
- `src/components/ConfirmDialog.vue`, `src/components/DebugPanel.vue`, `src/components/EndScreen.vue`, `src/components/HelpDialog.vue`, `src/components/MainMenu.vue` (these use only `--color-*` CSS custom properties from `App.vue`, not tower/enemy/region colors; CSS-variable theming is orthogonal to this plan and left as-is)

## 6. Theme Lookup Flow

See §3 for the full mechanism and the `ThemeGetter`/`themes/index.ts` code. The end-to-end flow, given the between-map-only constraint (§0):

```
MapSelect.vue (user picks theme)
    → persistStore.activeTheme = key; persistStore.save()
    → themeGetter.setActiveTheme(key)          (swatches update immediately)
    ↓
[/game route entered]
    → GameEngine / SvgGameRoot.onMounted:
        themeGetter.setActiveTheme(persistStore.activeTheme ?? 'default')   (defensive, §3 step 3)
    → useSvgStaticContent computed re-runs (currentMap changed) → <defs> regenerated with theme SVG paths + colors
    → TowerManager / EnemyManager / EffectManager / UiOverlayManager / ProjectileManager / ParticleManager read themeGetter during per-frame rendering
    → SvgGameRoot renders SVG with theme visuals (fixed for the run)
```

### Key Points
- `ThemeGetter` is a plain singleton (no Vue reactivity) read by all rendering managers and the constants-removal call sites.
- Constants files no longer carry literal colors; `.color` accesses are replaced by `themeGetter` calls at consumption sites (§3 "Constants mechanism").
- `<defs>` regeneration happens once per map load (driven by the existing `currentMap`-keyed `computed`), not per frame and not on theme *switch* while in-game (theme can't switch while in-game).
- No pooled-element mid-run href refresh is required: pools are rebuilt when the map (and thus `<defs>`) rebuilds.

## 7. Map-Select Theme Selector Design

### Current MapSelect.vue
- `src/components/MapSelect.vue` currently shows:
  - Map list grouped by region with region labels and gem rewards
  - Region labels styled with hardcoded CSS colors per region (`.region-0 .region-label { color: #6abf6a }` etc., lines 183-185) — these are **labels**, not swatches
  - Region divider gradients (lines 192-194)
  - No theme selector and no color swatches

### Proposed Theme Selector
- Add theme selector UI to `MapSelect.vue` (e.g., horizontal scrollable theme cards using the new `ThemeCard.vue`)
- Each theme card shows:
  - Theme name (`displayName`)
  - Preview swatches sourced from `themeGetter` (region `tileBase` colors ×3, tower `base` colors ×6, enemy colors ×6)
- Selected theme highlighted with border/accent
- Theme selection updates `persistStore.activeTheme`, calls `persistStore.save()`, and calls `themeGetter.setActiveTheme(...)` so the card swatches and the existing region label colors (once migrated to `themeGetter`, §5) update without a page reload

### Theme Card Component
- New component: `src/components/ThemeCard.vue`
- Props: `themeKey`, `themeData`, `isSelected`
- Emits: `select` event
- Shows theme name, preview swatches, selected state

## 8. Implementation Order

### Phase 1: Theme Data & Lookup
1. Create `src/game/themes/types.ts` (`ThemeData` interface matching §2 schema, including the `{ base, active }` shape for `towerColors` and the full region-color object shape)
2. Create `src/game/themes/default.json` (current hardcoded colors and SVG paths; lightning uses `{ base: "#205088", active: "#40a0ff" }`)
3. Create `src/game/themes/index.ts` (theme registry; verify `resolveJsonModule` in `tsconfig.json` — §2)
4. Create `src/game/ThemeGetter.ts` (theme lookup singleton, per §3)

### Phase 2: Store Integration
5. Add `activeTheme: string` to `src/stores/persist.ts` `PersistStateShape` (default `'default'`); add the migration default for missing field in `load()`
6. Wire `themeGetter.setActiveTheme(...)` in `src/main.ts` (post-`load()`) and in `GameEngine`/`SvgGameRoot` map-start (§3 wiring step 3). Do **not** add `activeTheme` to `gameStore` — persisted value is the single source of truth.

### Phase 3: Constants Color Removal
7. Update `src/game/Constants.ts` — remove `tileBase`/`tileAlt`/`pathColor`/`heightColors` literal fields from `Regions`; update consumers (notably `useSvgStaticContent.ts:2`) to call `themeGetter.getRegionColors(i)`.
8. Update `src/game/ConstantsTower.ts` — remove `color` from `TowerMeta`/`TowerAnimationConfig`/`TowerWalkingConfig`; update consumers (`GameEngine.ts:34,461,543`, `TowerManager.ts:138`, `GameShop.vue:38`, `TowerPanel.vue:198`) to call `themeGetter.getTowerColors(type).base`/`.active`.
9. Update `src/game/ConstantsEnemy.ts` — remove `color` from the `EnemyType` interface (line 21) and all 6 type entries; update consumers (`StatsPanel.vue:90,110,114`, `EnemyManager.ts`) to call `themeGetter.getEnemyColor(type)`.

### Phase 4: Rendering Integration
10. Update `src/render/svg/useSvgStaticContent.ts` — grid/base SVG paths and colors via `themeGetter`; `<defs>` regenerates on map change via existing `computed`.
11. Update `src/render/svg/TowerManager.ts` — `style.color` and sprite `href` resolution via `themeGetter` and theme-driven `<symbol>` ids.
12. Update `src/render/svg/EnemyManager.ts` — enemy sprite `href` resolution via theme-driven `<symbol>` ids.
13. Update `src/render/svg/EffectManager.ts` — effect colors via `themeGetter.getEffectColor(...)`.
14. Update `src/render/svg/UiOverlayManager.ts` — HP/shield/boss-text colors via `themeGetter.getUiOverlayColor(...)`.
15. Update `src/render/svg/ProjectileManager.ts` — default `fill` fallback via `themeGetter.getProjectileColor('default')`.
16. Update `src/game/ProjectileManager.ts` — muzzle-flash particle color via `themeGetter.getProjectileColor('muzzleFlash')`.
17. Update `src/game/ParticleSystem.ts` — spawn-time color passed through from `themeGetter`.
18. Update `src/components/GameHud.vue` — replace hardcoded HUD stat colors (lines 203-220) with inline `:style` from `themeGetter.getHudColor(...)`.
19. Update `src/components/MapSelect.vue` — region label/divider colors (lines 183-194) via `themeGetter.getRegionColors(...)`.

### Phase 5: Theme Selector UI
20. Create `src/components/ThemeCard.vue`
21. Add theme selector to `src/components/MapSelect.vue` (updates `persistStore.activeTheme`, saves, calls `themeGetter.setActiveTheme(...)`)

### Phase 6: Additional Themes
22. Create `src/game/themes/fantasy.json`
23. Create `src/game/themes/sci-fi.json`
24. Test theme switching on `MapSelect` (swatches update) and after entering a map (`<defs>` regenerated, sprites correct). Mid-map switching is out of scope (§0).

## 9. Key Considerations

### SVG Shape Strategy
- **Full creative license to modify SVG paths** for each theme (see §4 for the integration points).
- Tower and Enemy sprite geometry is defined entirely by the active theme's `svgPaths.tower.*` / `svgPaths.enemy.*` entries. Themes are self-contained — no theme references or falls back to another theme's data or to the ConstantsTower referenceImages/EnemyWalk vertex pipeline at runtime.
- Theme switching regenerates `<defs>` once at map load (driven by the existing `currentMap`-keyed `computed` in `useSvgStaticContent`); pooled `<use>` elements re-resolve their `href` against the new `<symbol>` ids at the same time. No mid-run refresh is needed or supported (§0).
- Prefer `currentColor` / `stroke="currentColor"` in `svgPaths` markup and let render managers set `style.color` from the color buckets (matching the existing pattern at `TowerManager.ts:138`), so that `fill`/`stroke` literals embedded in `svgPaths` don't drift from the color buckets.

### ThemeGetter fallbacks
The earlier draft had every getter return a hardcoded fallback (`'#8fbc8f'`, `'#e85a6a'`, etc.) on missing keys. With multiple sources of truth (theme JSON, `ThemeGetter` defaults, and residual hardcoded CSS) a typo would silently render the wrong color. The §3 `ThemeGetter` instead falls back to a *known-good entry within the same theme* (e.g. `towerColors.basic`, `enemyColors.minion`, `regionColors['0']`). Consider additionally asserting in dev mode (a `import.meta.env.DEV` guard that `console.error`s on a missing key) so incomplete theme JSON is caught during authoring rather than silently masked.

### Performance
- `ThemeGetter` is a singleton — no per-frame instantiation.
- `<defs>` regeneration is a one-time cost per map load, not per frame and not on in-game theme switch (none exists).
- `requestAnimationFrame` loop reads `themeGetter` via hashmap lookup per pooled element per frame — negligible.

### Backward Compatibility
- `default.json` contains current hardcoded colors (with lightning corrected to `{ base: "#205088", active: "#40a0ff" }`) and the current sprite geometry as `svgPaths`, ported from the existing `referenceImages` and `EnemyWalk.ts` vertex pipeline.
- Existing maps and game logic work without theme changes.
- Theme is optional — `persistStore.activeTheme` defaults to `'default'` on new profiles and on load of pre-existing saves (§5 migration).
- CSS-variable theming (`--color-bg`, `--color-panel`, etc. in `App.vue`) is orthogonal to this plan and unchanged; components that use only those variables (`ConfirmDialog`, `DebugPanel`, `EndScreen`, `HelpDialog`, `MainMenu`) need no edits.

### Testing
- Test theme switching on `MapSelect` (swatches and region labels update immediately).
- Test theme persistence (survives page reload — `persistStore.activeTheme` restored in `main.ts`).
- Test that entering a map after switching theme regenerates `<defs>` with the new sprites/colors.
- Test that tower/enemy/projectile/effect/UI-overlay colors all reflect the active theme in-game.
- Test that tower/enemy logic (damage, abilities, movement) is unaffected by visual changes — the constants-removal only touches color fields, not stat fields.
- Test migration: load a pre-existing `gempath_save_v1` blob lacking `activeTheme` and confirm it defaults to `'default'` without error.
