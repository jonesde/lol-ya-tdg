# Theme System: Design Plan

**Status:** Plan for future implementation
**Date:** 2026-07-03
**Current Architecture:** Pure SVG rendering in `src/render/svg/`

## 1. What Changes vs Stays Same

### What changes
- **Static region colors** → **theme-driven palettes**
  - `src/game/Constants.ts` defines `Regions` (array of 3 region objects with `tileBase`, `tileAlt`, `pathColor`, `heightColors`)
  - `src/game/ConstantsTower.ts` defines `TOWER_META` with tower colors per type (e.g., `basic: { color: '#8fbc8f' }`)
  - `src/game/ConstantsEnemy.ts` defines `ENEMY_TYPES` with enemy colors per type (e.g., `minion: { color: '#e85a6a' }`)
  - These become theme-lookup calls instead of constant references
- **Map visuals** → **theme-aware rendering**
  - `src/render/svg/useSvgStaticContent.ts:1-12` renders grid tiles with hardcoded colors
  - `src/render/svg/useSvgStaticContent.ts:13-20` renders bases with hardcoded colors
  - `src/render/svg/TowerManager.ts:1-10` renders towers using SVG `<use>` with href references
  - `src/render/svg/EnemyManager.ts:1-10` renders enemies using SVG `<use>` with frame animation
  - `src/render/svg/EffectManager.ts:1-10` renders effects with hardcoded colors
  - `src/render/svg/UiOverlayManager.ts:1-10` renders HP/shield bars with hardcoded colors
- **No theme persistence** → **theme saved in `persist.ts`**
  - `src/stores/persist.ts` currently has no `activeTheme` field (schema: gems, highestUnlockedMap, bestWaves, activeWaves, difficulty, firstTimeMilestones, firstClears, generalAddons, unlocked, runHistory)

### What stays the same
- **SVG rendering architecture** (no Canvas migration)
  - `src/components/SvgGameRoot.vue` orchestrates layered SVG rendering
  - `requestAnimationFrame` loop drives rendering in `src/render/svg/TowerManager.ts`, `EnemyManager.ts`, etc.
  - All rendering uses `<use>` elements with `<defs>` templates
- **Tower class** (`src/towers/Tower.ts`) keeps its logic; SVG paths and colors change per theme
- **Enemy class** (`src/enemies/Enemy.ts`) keeps its logic; SVG paths and colors change per theme
- **Game engine** (`src/game/GameEngine.ts`) keeps its logic
- **Projectile rendering** (`src/render/svg/ProjectileManager.ts`) stays SVG-based
- **Effect rendering** (`src/render/svg/EffectManager.ts`) stays SVG-based but visuals become theme-aware
- **UI overlay** (`src/render/svg/UiOverlayManager.ts`) stays SVG-based but visuals become theme-aware
  - **Map data** (`src/grid/Map.ts`) stays the same
  - **Wave logic** (`src/waves/WaveManager.ts`) stays the same

## 2. Theme Data Structure

### File location
- `src/game/themes/{themeKey}.json` (e.g., `src/game/themes/fantasy.json`, `src/game/themes/sci-fi.json`)
- Loaded once per theme switch via `import()` or static `require()`

### Schema
```jsonc
{
  "name": "Fantasy",
  "displayName": "Fantasy",
  "description": "Medieval fantasy theme",
  "regionColors": {
    "0": "#4a2c0a",
    "1": "#2d1a05",
    "2": "#1a0f03"
  },
  "baseColors": {
    "player": "#2d5a27",
    "enemy": "#8b0000"
  },
  "towerColors": {
    "basic": "#8fbc8f",
    "ice": "#9be7ff",
    "sniper": "#ffd84d",
    "cannon": "#ff8a4d",
    "lightning": "#40a0ff",
    "railgun": "#c98aff"
  },
  "enemyColors": {
    "minion": "#e85a6a",
    "runner": "#ffd84d",
    "tank": "#7a8a9a",
    "shielded": "#5fd0ff",
    "healer": "#5fff8a",
    "boss": "#c98aff"
  },
  "uiColors": {
    "hpBar": "#2d5a27",
    "shieldBar": "#3282B8",
    "text": "#f0e6d2",
    "background": "rgba(0,0,0,0.7)"
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
  "uiOverlay": {
    "hpBarForeground": "#00ff00",
    "hpBarBackground": "#00004a",
    "shieldBarForeground": "#00ffff",
    "shieldBarBackground": "#00004a",
    "hpDynamic": {
      "high": "#00ff00",
      "medium": "#ffff00",
      "low": "#ff0000"
    }
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

### Notes
- Region colors: 3 regions matching `Constants.ts` `Regions` array (each region has `tileBase`, `tileAlt`, `pathColor`, `heightColors[]`)
- Tower colors: 6 variants matching `ConstantsTower.ts` `TOWER_META` (keyed by type name: `basic`, `ice`, `sniper`, `cannon`, `lightning`, `railgun`)
- Enemy colors: 6 variants matching `ConstantsEnemy.ts` `ENEMY_TYPES` (keyed by type name: `minion`, `runner`, `tank`, `shielded`, `healer`, `boss`)
- UI colors: HP bar, shield bar, text, background for overlay rendering
- **SVG paths**: Full creative license to define completely different SVG paths for each theme
  - `gridTile`: Map tile SVG path (can change shape, pattern, colors)
  - `basePlayer`/`baseEnemy`: Base designs (castles, spaceships, etc.)
  - `tower`: All 6 tower variants (different architectural styles)
  - `enemy`: All 6 enemy variants (different creature designs)
  - `effects`: Lightning, stun, build preview visuals
  - `ui`: HP bars, shield bars, text styling

## 3. Theme Lookup Architecture

### ThemeGetter
- `src/game/ThemeGetter.ts` (new file)
- Singleton that holds the active theme object
- Provides `getRegionColor(regionId: number)`, `getTowerColor(towerType: string)`, `getEnemyColor(enemyType: string)`, `getUiColor(key)`, `getEffectColor(key)`, `getUiOverlayColor(key)`
- Called from `useSvgStaticContent.ts`, `TowerManager.ts`, `EnemyManager.ts`, `EffectManager.ts`, `UiOverlayManager.ts`
- Called from `Constants.ts` (region colors), `ConstantsTower.ts` (tower colors), `ConstantsEnemy.ts` (enemy colors) — these become dynamic lookups

### Game Store Integration
- `src/stores/game.ts` adds `activeTheme: string` field (default: `'default'`)
- `src/stores/persist.ts` adds `activeTheme: string` to save schema
- `MapSelect.vue` sets theme on store when user selects

### File: ThemeGetter.ts
```ts
// src/game/ThemeGetter.ts
import { themes } from './themes/index'

class ThemeGetter {
  private activeTheme: string = 'default'
  private themeData: ThemeData = themes.default

  setActiveTheme(key: string): void {
    this.activeTheme = key
    this.themeData = themes[key] || themes.default
  }

  getRegionColor(regionId: number): string {
    return this.themeData.regionColors[String(regionId)] || '#333'
  }

  getTowerColor(towerType: string): string {
    return this.themeData.towerColors[towerType] || '#8fbc8f'
  }

  getEnemyColor(enemyType: string): string {
    return this.themeData.enemyColors[enemyType] || '#e85a6a'
  }

  getUiColor(key: string): string {
    return this.themeData.uiColors[key] || '#f0e6d2'
  }

  getEffectColor(key: string): string {
    return this.themeData.effectColors[key] || '#40a0ff'
  }

  getUiOverlayColor(key: string): string {
    return this.themeData.uiOverlay[key] || '#00ff00'
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
3. **Tower SVG paths** (`TowerManager.ts`): Full creative license — SVG paths, colors, shapes can change per theme (via `Tower.ts` meta data)
4. **Enemy SVG paths** (`EnemyManager.ts`): Full creative license — SVG paths, colors, shapes can change per theme (via `Enemy.ts` meta data)
5. **Effects** (`EffectManager.ts`): Full creative license — SVG paths, colors, shapes for lightning, stun, build preview can change per theme
6. **UI overlays** (`UiOverlayManager.ts`): Full creative license — SVG paths, colors, shapes for HP bar, shield bar, text can change per theme

### SVG Path Strategy
- Tower and Enemy SVG paths are stored in `Tower.ts` and `Enemy.ts` meta data (animation configs, walking configs)
- **Themes have full creative license to modify SVG paths** — not just colors
- Each theme can define completely different SVG paths for towers, enemies, map tiles, bases, effects, and UI
- Theme switching requires regenerating SVG `<defs>` and updating `<use>` href references
- This enables radically different visual styles per theme (e.g., fantasy castles vs sci-fi bases, medieval swords vs laser guns)

## 5. File Changes

### New Files
- `src/game/themes/{themeKey}.json` (e.g., `fantasy.json`, `sci-fi.json`, `default.json`)
- `src/game/themes/types.ts` (ThemeData interface)
- `src/game/themes/index.ts` (theme registry)
- `src/game/ThemeGetter.ts` (theme lookup singleton)

### Modified Files
- `src/game/Constants.ts` → region colors become theme-lookup calls
- `src/game/ConstantsTower.ts` → tower colors become theme-lookup calls
- `src/game/ConstantsEnemy.ts` → enemy colors become theme-lookup calls
- `src/render/svg/useSvgStaticContent.ts` → grid tile and base colors become theme-lookup calls
- `src/render/svg/TowerManager.ts` → tower color references become theme-lookup calls
- `src/render/svg/EnemyManager.ts` → enemy color references become theme-lookup calls
- `src/render/svg/EffectManager.ts` → effect colors become theme-lookup calls
- `src/render/svg/UiOverlayManager.ts` → UI overlay colors become theme-lookup calls
- `src/stores/game.ts` → add `activeTheme` field
- `src/stores/persist.ts` → add `activeTheme` to save schema
- `src/components/MapSelect.vue` → add theme selector UI

### Unchanged Files
- `src/components/SvgGameRoot.vue` (orchestrates rendering, no theme logic needed)
- `src/towers/Tower.ts` (logic unchanged, only color references change via ThemeGetter)
- `src/enemies/Enemy.ts` (logic unchanged, only color references change via ThemeGetter)
- `src/game/GameEngine.ts` (logic unchanged)
- `src/grid/Map.ts` (map data unchanged)
- `src/waves/WaveManager.ts` (wave logic unchanged)
- `src/game/ProjectileManager.ts` (game logic unchanged; separate from `src/render/svg/ProjectileManager.ts` which handles SVG rendering pool)
- `src/game/EnemyWalk.ts` (logic unchanged)
- `src/composables/cameraUtils.ts` (camera logic unchanged)

## 6. Theme Lookup Architecture

### Flow Diagram
```
MapSelect.vue (user selects theme)
    ↓
game store (activeTheme = 'fantasy')
    ↓
persist.ts (save activeTheme)
    ↓
ThemeGetter.setActiveTheme('fantasy')
    ↓
ThemeGetter.getRegionColor() / getTowerColor() / getEnemyColor() / getUiColor() / getEffectColor() / getUiOverlayColor()
    ↓
Constants.ts / ConstantsTower.ts / ConstantsEnemy.ts (dynamic lookups)
    ↓
useSvgStaticContent.ts regenerates <defs> with theme SVG paths and colors
    ↓
TowerManager.ts / EnemyManager.ts / EffectManager.ts / UiOverlayManager.ts (theme-aware rendering)
    ↓
SvgGameRoot.vue (renders SVG with theme visuals)
```

### Key Points
- ThemeGetter is a singleton called from all rendering managers
- Constants files become dynamic (no hardcoded colors)
- All SVG visuals (paths, colors, shapes) are theme-driven — theme switching regenerates `<defs>` and updates `<use>` href references
- Theme switching updates ThemeGetter, triggers `<defs>` regeneration, then re-renders via requestAnimationFrame loop

## 7. Map-Select Theme Selector Design

### Current MapSelect.vue
- `src/components/MapSelect.vue` currently shows:
  - Map list with region info and gem rewards
  - Map details panel with region color swatches
  - No theme selector

### Proposed Theme Selector
- Add theme selector UI to `MapSelect.vue` (e.g., horizontal scrollable theme cards)
- Each theme card shows:
  - Theme name
  - Preview swatches (region colors, tower colors, enemy colors)
- Selected theme highlighted with border/accent
- Theme selection updates `gameStore.activeTheme`
- Theme selection persists via `persist.ts`

### Theme Card Component
- New component: `src/components/ThemeCard.vue`
- Props: `themeKey`, `themeData`, `isSelected`
- Emits: `select` event
- Shows theme name, preview swatches, selected state

## 8. Implementation Order

### Phase 1: Theme Data & Lookup
1. Create `src/game/themes/types.ts` (ThemeData interface)
2. Create `src/game/themes/default.json` (current hardcoded colors)
3. Create `src/game/themes/index.ts` (theme registry)
4. Create `src/game/ThemeGetter.ts` (theme lookup singleton)

### Phase 2: Store Integration
5. Add `activeTheme` to `src/stores/game.ts`
6. Add `activeTheme` to `src/stores/persist.ts`

### Phase 3: Constants Dynamic
7. Update `src/game/Constants.ts` to use ThemeGetter for region colors
8. Update `src/game/ConstantsTower.ts` to use ThemeGetter for tower colors
9. Update `src/game/ConstantsEnemy.ts` to use ThemeGetter for enemy colors

### Phase 4: Rendering Integration
10. Update `src/render/svg/useSvgStaticContent.ts` to use ThemeGetter for grid/base SVG paths and colors
11. Update `src/render/svg/TowerManager.ts` to use ThemeGetter for tower SVG paths and colors
12. Update `src/render/svg/EnemyManager.ts` to use ThemeGetter for enemy SVG paths and colors
13. Update `src/render/svg/EffectManager.ts` to use ThemeGetter for effect SVG paths and colors
14. Update `src/render/svg/UiOverlayManager.ts` to use ThemeGetter for UI SVG paths and colors

### Phase 5: Theme Selector UI
15. Create `src/components/ThemeCard.vue`
16. Add theme selector to `src/components/MapSelect.vue`

### Phase 6: Additional Themes
17. Create `src/game/themes/fantasy.json`
18. Create `src/game/themes/sci-fi.json`
19. Test theme switching in game

## 9. Key Considerations

### SVG Shape Strategy
- **Full creative license to modify SVG paths** for each theme
- Tower and Enemy SVG paths are stored in `Tower.ts` and `Enemy.ts` meta data (animation configs, walking configs)
- Each theme can define completely different SVG paths for:
  - Map tiles (grid patterns, colors, shapes)
  - Bases (player and enemy base designs)
  - Towers (all 6 variants — different architectural styles)
  - Enemies (all 6 variants — different creature designs)
  - Effects (lightning, stun, build preview — different visual styles)
  - UI overlays (HP bars, shield bars, text — different UI designs)
- Theme switching requires regenerating SVG `<defs>` and updating `<use>` href references
- This enables radically different visual experiences per theme

### Performance
- ThemeGetter is a singleton — no per-frame instantiation
- Theme switching regenerates SVG `<defs>` once (not per-frame)
- requestAnimationFrame loop handles all rendering updates
- SVG path regeneration is a one-time cost per theme switch

### Backward Compatibility
- `default.json` theme contains current hardcoded colors and SVG paths
- Existing maps and game logic work without theme changes
- Theme is optional — if no theme selected, defaults are used

### Testing
- Test theme switching in game (should update all visuals instantly)
- Test theme persistence (should survive page reload)
- Test that SVG paths change correctly after theme switch
- Test that tower/enemy logic (damage, abilities, movement) is unaffected by visual changes
