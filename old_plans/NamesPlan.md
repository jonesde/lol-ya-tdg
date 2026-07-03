# Variable Name Improvement Plan

## Scope

223 single-letter variable declarations, ~80 two-letter abbreviations, and ~30 single-letter function parameters across ~45 files in `src/` and `tests/`.

## Search and Replace Workflow

Every rename must follow this exact pattern:

1. **One file at a time** — process all renames for a single file before moving to the next.
2. **Write the regular expression** — define the exact regex pattern for the rename before running any search.
3. **Verify matches** — use the regex to search the file and confirm:
   - Only the intended occurrences are matched.
   - All intended occurrences are included.
4. **Only then run the search and replace** — apply the rename after verification passes.

## Categories of Problematic Names Found

### 1. Single-letter variables (223 instances) — highest priority

Variables using a single character (e.g. `t`, `e`, `s`, `p`) that lack descriptive meaning. Full details by file are in the Recommended Renames table below.

### 2. Two-letter abbreviations (~80 instances)

| Abbreviation | Actual meaning | Example files |
|---|---|---|
| `idx` | index | TowerManager, Shapes, Pathfinding, useAnimation, setup |
| `ctx` | canvas context | SoundManager, Renderer |
| `el` | element | SkillTree (flashElement param) |
| `ev` | event | TowerPanel |
| `e` | enemy (in callbacks) | EnemyManager, Tower.js, GameEngine, tests |
| `dx`/`dy` | delta x/y (distance components) | Tower.js, Enemy.js, ProjectileManager, Renderer, Particles |
| `va`/`vb` | variant A/B info | SkillTree, Tower.js |
| `ga` | general addons | SkillTree, GameEngine |
| `bd` | breakdown | EndScreen, HistoryScreen, GameEngine |
| `gs` | game store | GameEngine |
| `sp` | spawn position / speed | Map.js, Particles |
| `lvl` | level | Tower.js |
| `pad` | padding | Shapes.js |
| `raw` | raw localStorage string | persist.js |
| `sf` | slow factor | EnemySprite |
| `vw`/`vh` | viewport width/height | GameCanvas |
| `gw`/`gh` | grid width/height | Renderer, GameCanvas |
| `nx`/`ny` | neighbor x/y (pathfinding) | Renderer, Map.js, Pathfinding |
| `cx`/`cy` | center x/y | Shapes.js, Renderer |
| `ap` | armor penetration flag | ProjectileManager |
| `kb`/`kbRaw` | knockback / raw knockback | ProjectileManager |
| `to` | target waypoint | Map.js |
| `lx`/`rx` | left/right x bounds | Map.js |
| `st` | selected tower | GameEngine |
| `bh`/`by` | build position x/y | GameEngine |

### 3. Single-letter function parameters

Function parameters using a single character (e.g. `e`, `n`, `t`) that lack descriptive meaning. Full details by file are in the Recommended Renames table below.

## Recommended Renames

### Single-letter → descriptive (priority order)

| File | Rename | Details |
|---|---|---|
| `src/towers/TowerManager.js` | `t` → `tower` | Tower instance |
| `src/towers/SkillTree.js` | `u` → `unlocked` | Unlocked state for a tower |
| `src/towers/SkillTree.js` | — | Function params in `getCost`/`unlockCost`: `tier`, `idx`; in `isUnlocked`/`isAvailable`/`tryRefund`/`tryUnlock`: `save`, `towerId`, `tier`, `idx`; in `isGeneralUnlocked`/`isGeneralAvailable`/`tryUnlockGeneral`: `save`, `key`, `idx` |
| `src/towers/Tower.js` | `s` → `stats` | Tower stats (computed) |
| `src/towers/Tower.js` | `u` → `unlocked` | Unlocked state |
| `src/enemies/EnemyManager.js` | `e` → `enemy` | Enemy instance |
| `src/enemies/Enemy.js` | `t` → `worldPos` | World coordinates |
| `src/enemies/Enemy.js` | `d` → `distSq` | Distance squared |
| `src/render/Particles.js` | `p` → `particle` | Particle |
| `src/render/Particles.js` | `t` → `elapsedSec` | Elapsed seconds |
| `src/render/Particles.js` | `sp` → `speed` | Particle speed |
| `src/render/Particles.js` | `a` → `angle` | Angle |
| `src/render/ProjectileManager.js` | `p` → `projectile` | Projectile |
| `src/render/ProjectileManager.js` | `e` → `enemy` | Enemy |
| `src/render/ProjectileManager.js` | `d` → `distSq` | Distance squared |
| `src/render/ProjectileManager.js` | `t` → `timestamp` | Time |
| `src/render/ProjectileManager.js` | `dx`/`dy` → `deltaX`/`deltaY` | Distance components |
| `src/render/ProjectileManager.js` | `ap` → `armorPen` | Armor penetration flag |
| `src/render/ProjectileManager.js` | `kb` → `knockback` | Knockback |
| `src/render/ProjectileManager.js` | `kbRaw` → `knockbackRaw` | Raw knockback |
| `src/render/Renderer.js` | `c` → `ctx` | Canvas context |
| `src/render/Renderer.js` | `r` → `region` | Region |
| `src/render/Renderer.js` | `w` → `worldPos` | World coordinates |
| `src/render/Renderer.js` | `s` → `stats` | Stats |
| `src/render/Renderer.js` | `x` → `tileX` | X coordinate |
| `src/render/Renderer.js` | `y` → `tileY` | Y coordinate |
| `src/render/Renderer.js` | `t` → `time` | Time |
| `src/render/Renderer.js` | `nx`/`ny` → `neighborX`/`neighborY` | Neighbor coordinates |
| `src/render/Renderer.js` | `cx`/`cy` → `centerX`/`centerY` | Center coordinates |
| `src/render/Shapes.js` | `t` → `tile` | Tile |
| `src/render/Shapes.js` | `h` → `height` | Height |
| `src/render/Shapes.js` | `w` → `width` | Width |
| `src/render/Shapes.js` | `a` → `angle` | Angle |
| `src/render/Shapes.js` | `cx`/`cy` → `centerX`/`centerY` | Center coordinates |
| `src/render/Shapes.js` | `ex`/`ey` → `emblemX`/`emblemY` | Emblem coordinates |
| `src/render/Shapes.js` | — | Function params in `drawTile`/`drawBase`: `ctx`, `x`, `y`, `size` |
| `src/grid/Map.js` | `x` → `curX` | Current X coordinate |
| `src/grid/Map.js` | `t` → `hash` | Hash value |
| `src/grid/Map.js` | `h` → `hashVal` | Hash value |
| `src/grid/Map.js` | `sp` → `spawn` | Spawn position |
| `src/grid/Map.js` | `to` → `nextWaypoint` | Target waypoint |
| `src/grid/Map.js` | `lx`/`rx` → `leftX`/`rightX` | Left/right bounds |
| `src/grid/Map.js` | — | Function params in `carveStraight`: `tiles`, `from`, `to`; in `generateRandomMap`: `width`, `height`, `style`, `regionId`, `level`, `seed` |
| `src/grid/Grid.js` | `t` → `tile` | Tile at position |
| `src/grid/Grid.js` | `p` → `path` | Path |
| `src/grid/Pathfinding.js` | `q` → `queue` | BFS queue |
| `src/grid/Pathfinding.js` | `k` → `nodeKey` | Node key |
| `src/grid/Pathfinding.js` | — | Function params in `bfsShortestPath`: `grid`, `start`, `goal`, `blocked`; in `canPlaceWithoutBlocking`: `grid`, `spawns`, `base`, `towerXY`, `existingBlocked` |
| `src/game/GameEngine.js` | `t` → `timestamp` | Time |
| `src/game/GameEngine.js` | `w` → `worldPos` | World coordinates |
| `src/game/GameEngine.js` | `ga` → `generalAddons` | General addons |
| `src/game/GameEngine.js` | `bd` → `breakdown` | Gem breakdown |
| `src/game/GameEngine.js` | `gs` → `gameStore` | Game store |
| `src/game/GameEngine.js` | `st` → `selectedTower` | Selected tower |
| `src/game/GameEngine.js` | `bx`/`by` → `buildX`/`buildY` | Build position |
| `src/game/EnemyWalk.js` | `a` → `angle` | Angle |
| `src/game/EnemyWalk.js` | `r` → `radius` | Radius |
| `src/game/EnemyWalk.js` | `h` → `height` | Height |
| `src/game/EnemyWalk.js` | — | Function params in vertex builders: `shape`, `radius`, `count` |
| `src/components/SpriteLayer.vue` | `r` → `radius` | Enemy radius |
| `src/components/SkillTree.vue` | `t` → `node` | Skill tree node |
| `src/components/SkillTree.vue` | `ga` → `generalAddons` | General addons |
| `src/components/SkillTree.vue` | — | Function params in `handleTowerNodeClick`: `towerId`, `tier`, `idx`, `element`; in `handleGeneralClick`: `key`, `type`, `opt`, `element`; in `showRefundConfirm`: `towerId`, `tier`, `idx`, `gems`; in `getNodeLabel`: `towerId`, `tier`, `idx`; `el` → `element` in `flashElement` |
| `src/components/MainMenu.vue` | `t` → `diffTick` | Difficulty tick value |
| `src/components/MainMenu.vue` | `e` → `event` | DOM event in `onDiffSliderInput` |
| `src/components/EndScreen.vue` | `s` → `sectionBreakdown` | Breakdown section |
| `src/components/EndScreen.vue` | `e` → `event` | DOM event |
| `src/components/EndScreen.vue` | — | Function params in `formatBreakdown`: `entry`, `section`; in `getMapInfo`/`replayRun`: `mapIndex`, `entry` |
| `src/components/TowerSprite.vue` | `a` → `angle` | Tower angle |
| `src/components/TowerPanel.vue` | `t` → `tower` | Tower instance |
| `src/components/TowerPanel.vue` | `u` → `unlocked` | Unlocked state |
| `src/components/TowerPanel.vue` | `e` → `event` | DOM event in `onHeaderMouseDown`/`handleTargetingChange` |
| `src/components/EnemySprite.vue` | `h` → `hexStr` | Hex string |
| `src/components/EnemySprite.vue` | `r` → `red` | Red channel |
| `src/components/EnemySprite.vue` | `g` → `green` | Green channel |
| `src/components/EnemySprite.vue` | `b` → `blue` | Blue channel |
| `src/components/EnemySprite.vue` | `sf` → `slowFactor` | Slow factor |
| `src/components/EnemySprite.vue` | — | Function params in `parseHex`/`blendColor`: `hex`, `base`, `frost`, `intensity` |
| `src/components/GameCanvas.vue` | `r` → `rect` | getBoundingClientRect rect |
| `src/components/GameCanvas.vue` | `vw` → `viewportWidth` | Viewport width |
| `src/components/GameCanvas.vue` | `vh` → `viewportHeight` | Viewport height |
| `src/components/GameCanvas.vue` | `gw` → `gridWidth` | Grid width |
| `src/components/GameCanvas.vue` | `gh` → `gridHeight` | Grid height |
| `src/components/GameCanvas.vue` | `e` → `event` | DOM event |
| `src/stores/game.js` | `i` → `speedIndex` | Index in speeds array |
| `src/composables/useAnimation.js` | `c` → `config` | Animation config |
| `src/composables/useAnimation.js` | `t` → `timeRatio` | Time ratio |
| `src/composables/useAnimation.js` | `idx` → `index` | Index |
| `src/composables/useAnimation.js` | — | Function params in `useAnimation`: `getConfig`; in `play`/`extractPathD`/`interpolatePathD`/`extractCoordinates`/`rebuildPathD`: `name`, `d0`, `d1`, `t`, `d`, `template`, `coords` |
| `src/sound/SoundManager.js` | `o` → `oscillator` | Oscillator |
| `src/sound/SoundManager.js` | `g` → `gainNode` | Gain node |
| `src/sound/SoundManager.js` | `ctx` → `audioContext` | Audio context |
| `src/components/StatsPanel.vue` | — | Function params in `formatNumber`: `n` → `number` |
| `src/components/HistoryScreen.vue` | — | Function params in `formatDate`: `ts` → `timestamp`; in `formatBreakdown`: `entry`, `section`; in `getMapInfo`/`replayRun`: `mapIndex`, `entry` |
| `src/components/MapSelect.vue` | — | Function params in `getFullEntry`/`startMap`: `index` |
| `src/components/GameShop.vue` | — | Function params in `toggleBuild`/`getCost`: `type` |
| `src/services/CameraService.js` | — | Function params in `updateCamera`: `x`, `y`, `zoom` |
| `src/services/SvgLoader.js` | — | Function params in `loadSvgContent`: `file` |

### Two-letter → descriptive

| Abbrev | Rename to |
|---|---|
| `idx` | `index` |
| `ctx` | `canvasContext` or `audioContext` (context-dependent) |
| `ev` | `event` |
| `dx`/`dy` | `deltaX`/`deltaY` |
| `va`/`vb` | `variantA`/`variantB` |
| `ga` | `generalAddons` |
| `bd` | `breakdown` |
| `gs` | `gameStore` |
| `sp` | `spawn` (when position) or `speed` (when particle speed) |
| `lvl` | `level` |
| `pad` | `padding` |
| `raw` | `rawStorage` |
| `sf` | `slowFactor` |
| `vw`/`vh` | `viewportWidth`/`viewportHeight` |
| `gw`/`gh` | `gridWidth`/`gridHeight` |
| `nx`/`ny` | `neighborX`/`neighborY` |
| `cx`/`cy` | `centerX`/`centerY` |
| `ap` | `armorPen` |
| `kb`/`kbRaw` | `knockback`/`knockbackRaw` |
| `to` | `nextWaypoint` |
| `lx`/`rx` | `leftX`/`rightX` |
| `st` | `selectedTower` |
| `bh`/`by` | `buildX`/`buildY` |
| `dd`/`mm`/`yy`/`hh` | `day`, `month`, `year`, `hour` (in HistoryScreen) |

## Execution Order

1. **`src/towers/`** — TowerManager.js, SkillTree.js, Tower.js (most single-letter `t`, `u`, `s` usage)
2. **`src/enemies/`** — Enemy.js, EnemyManager.js (single-letter `e`, `t`)
3. **`src/render/`** — Particles.js, ProjectileManager.js, Renderer.js, Shapes.js (lots of `t`, `p`, `e`, `d`, `x`, `y`)
4. **`src/game/`** — GameEngine.js, EnemyWalk.js (single-letter `t`, `w`, `ga`, `bd`, `gs`)
5. **`src/grid/`** — Grid.js, Map.js, Pathfinding.js (single-letter `t`, `x`, `q`, `k`)
6. **`src/components/`** — All Vue components (single-letter `t`, `u`, `s`, `r`, `a`, `e`)
7. **`src/composables/`** — useAnimation.js, useCameraSync.js
8. **`src/services/`** — SoundManager.js (single-letter `o`, `g`)
9. **`src/stores/`** — game.js, persist.js
10. **`tests/`** — All test files (mirror the src renames)

## Verification

- Run `npm run lint` after all changes to ensure Biome passes
- Run `npm run test` to confirm all ~490 tests still pass
- Run `npm run build` to confirm production build succeeds

## Notes

- For the `e` parameter in callbacks (filter, map, forEach), rename to `enemy` in enemy contexts and `event` in DOM event contexts — these are the most common and impactful changes
- In `src/towers/Tower.js`'s targeting logic (lines 302–329), `a` and `b` in `reduce()` callbacks should become `prevA`/`prevB` or similar to indicate accumulator vs current
- For `ctx` in `SoundManager.js`, rename to `audioContext` to distinguish from canvas context
- For `ctx` in `Shapes.js`/`Renderer.js`, rename to `canvasContext` or keep as `ctx` if it's the established convention for canvas drawing (check if there are other references)
