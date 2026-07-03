# TypeScript Migration Plan

## Current State

| Category | Count | Extension |
|---|---|---|
| Source JS files | 24 | `.js` |
| Vue SFCs | 17 | `.vue` (all `<script setup>` without `lang="ts"`) |
| Pinia stores | 3 | `.js` (options stores) |
| Test files | 27 | `.test.js` |
| Test helpers | 3 | `.js` |
| Test setup | 1 | `.js` |
| Config files | 3 | `.js` |

**Existing TS infrastructure:** `typescript ^6.0.3` already installed. `tsconfig.json` has `allowJs: true`, `checkJs: true`, `strict: true`, `noEmit: true`. Biome 2.x handles linting/formatting for both JS and TS. Vitest is the test runner. ~490 tests, all passing.

## Migration Strategy: Incremental

Convert files one at a time while keeping `allowJs: true` so JS and TS coexist. Run `npm run typecheck` and `npm run test` after each batch to catch issues immediately. This avoids a fragile big-bang conversion.

---

## Phase 1: Foundation (types + config)

**Goal:** Define the type system that everything else depends on.

### 1. `src/game/Constants.ts` (~919 lines)

Largest file. Convert enum-like objects to TypeScript types:

- `GameState` → `as const` object or string literal union (`"menu" | "playing" | "paused" | "game_over" | "victory" | "map_select" | "skill_tree"`)
- `TowerIds` → `'basic' | 'ice' | 'sniper' | 'cannon' | 'lightning' | 'railgun'`
- `Regions` → typed array of region objects with `id`, `name`, color fields
- `TOWER_META` → `Record<TowerId, TowerMeta>` interface
- `TOWER_BASE` → `Record<TowerId, TowerBase>` interface
- `ENEMY_TYPES` → `Record<EnemyType, EnemyMeta>` interface
- `MAP_DATA` (36 maps) → `MapData[]` interface
- All numeric constants → keep as `const` with inferred types
- `VARIANT_INFO`, `SKILL_TREE`, `GENERAL_ADDON_CATEGORIES`, `GENERAL_ADDON_DEFS` → typed interfaces

### 2. `tsconfig.json`

Update `include` to cover `src/**/*.ts`. Keep `allowJs: true` for gradual migration. Remove `checkJs: true` only after all files are converted.

### 3. `vite.config.js` → `vite.config.ts`

Trivial rename (9 lines). Import types from `vite` and `node:path`.

### 4. `vitest.config.js` → `vitest.config.ts`

Trivial rename (9 lines). Update test `include` pattern to `tests/**/*.test.ts`.

---

## Phase 2: Pure Utilities (zero runtime risk)

**Goal:** Convert stateless functions with no external dependencies.

### 5. `src/grid/Pathfinding.ts` (~62 lines)

Two pure functions. Type `grid` param as intersection of Grid shape. Type `blocked: Set<string>`.

- `bfsShortestPath(grid, start: {x,y}, goal: {x,y}, blocked: Set<string>) => {x,y}[] | null`
- `canPlaceWithoutBlocking(grid, spawns, base, towerXY, existingBlocked)`

### 6. `src/render/Shapes.ts` (~198 lines)

Three pure drawing functions. Type `ctx` as `CanvasRenderingContext2D`.

- `drawTile(ctx, x, y, size, tile, region)`
- `drawBase(ctx, x, y, size, region)`
- `drawProjectile(ctx, p)`

### 7. `src/game/EnemyWalk.ts` (~87 lines)

Two functions. Type vertex arrays as `number[][]`.

- `buildBaseVertices(shape: string, radius: number): number[][]`
- `vertsToPathD(verts: number[][]): string`

### 8. `src/services/SvgLoader.ts` (~13 lines)

Two simple functions. Type cache as `Map<string, string>`.

- `loadSvgContent(file: string): Promise<string>`
- `clearCache(): void`

---

## Phase 3: Stores (well-tested, high confidence)

**Goal:** Type all 3 Pinia stores. All have comprehensive unit tests.

### 9. `src/stores/game.ts` (~204 lines)

Type state shape, getters, actions. Key types needed:

- `GameState` (from Constants)
- `Tower` (forward reference from towers)
- `Grid` (forward reference from grid)
- `MapData` (from grid)
- `CameraState: { x: number; y: number; zoom: number }`
- `GemBreakdown: { bossKills, milestones, waveCompletion }` with nested `{ base, afterDiff, afterRegion, afterFirstTime }`
- `EndScreenData: { victory: boolean; wave: number; gems: number; gemBreakdown: ... }`
- `TowerPanelPos: { x: number; y: number }`

### 10. `src/stores/persist.ts` (~192 lines)

Type nested state matching localStorage schema:

- `TowerUnlocks: { levels: boolean[]; variantA: boolean[]; variantB: boolean[]; addons: boolean[] }`
- `GeneralAddons: { extraHealth: number | null; startingGold: number | null; sellRefundUnlocked: boolean; sellDiscountUnlocked: boolean; sellActive: 'refund' | 'discount' | null; upgradeCostReduction: number | null; terrainHeightBonus: number | null; damageMilestoneBonus: number | null; slowHealing: number | null }`
- `Difficulty: { multiplierTick: number }`
- `RunHistoryEntry: { mapIndex: number; victory: boolean; wave: number; gems: number; bossesKilled: number; gemBreakdown: ...; date: number }`

### 11. `src/stores/ui.ts` (~131 lines)

Type dialog/notification shapes:

- `ConfirmDialog: { title: string; message: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void } | null`
- `Notification: { message: string; expires: number } | null`
- `ConfirmConfig: { title?: string; message: string; onConfirm: () => void; onCancel?: () => void; confirmLabel?: string; cancelLabel?: string }`

---

## Phase 4: Data/Model Classes

**Goal:** Type the core game entities. These define types that managers and engine reference.

### 12. `src/grid/Grid.ts` (~112 lines)

Class with `Set<string>` for blocked/terrainTowers, 2D tile array, path arrays.

- `Tile: { type: 'terrain' | 'path' | 'base' | 'spawn'; height: number }`
- `MapData: { width: number; height: number; tiles: Tile[][]; spawns: {x,y}[]; base: {x,y}; regionId: number; level: number; style: string; gemReward: number; bossCadence: number; name: string }`
- Class: `tileSize`, `paths: {x,y}[][]`, `pathCache: {x,y}[] | null`

### 13. `src/grid/Map.ts` (~284 lines)

Map generation functions. Re-exports `MapData` from Grid. Types for procedural generation params.

### 14. `src/enemies/Enemy.ts` (~197 lines)

Class with HP/shield/heal/stun/slow/burn state.

- `EnemyMeta: { baseHp, bounty, speed, radius, color, shape, shield?, heal?, healRange?, resist?, slowResist? }`
- Properties: `id, type, level, meta, hp, maxHp, shield, maxShield, speed, radius, x, y, path: {x,y}[], pathIdx, bounty, heal, healRange, resist, slowResist, slowFactor, slowStack, stunTimer, reachedBase, removed, burnTimer, burnDps, color, shape, walking, hitAnimTime`

### 15. `src/towers/Tower.ts` (~455 lines)

Largest model class. Type stats, targeting, variants, addons.

- `TargetingMode: 'first' | 'last' | 'closest' | 'strong' | 'furthest'`
- `Variant: 'A' | 'B' | null`
- `Direction: 'N' | 'E' | 'S' | 'W' | null`
- `TowerStats: { damage, fireRate, range, splash?, chain?, slowAmt?, slowDur?, marksman?, pierce?, fixedAim?, fixedAimDir? }`
- `TowerMeta: { name, icon, color, cost, body, bracket, animation? }`
- `TowerBase: { damage, fireRate, range, splash?, chain?, slowAmt?, slowDur? }`
- Properties: `type, tileX, tileY, grid, x, y, worldPos, meta, base, color, icon, animation, level, totalInvested, totalDamageDealt, waveDamage, targeting, cooldown, angle, fireAnimTime, variant, fixedAimDir, placedAt, addons: number[], save, extraPierce, terrainHeight, _statsCache, _statsMilestoneTiers`

### 16. `src/towers/SkillTree.ts` (~430 lines)

Functional pure functions + constants. Type save state subset and skill tree structures.

- `SaveState: { gems: number; unlocked: Record<TowerId, TowerUnlocks>; generalAddons: GeneralAddons }`
- `UnlockResult: { ok: boolean; reason?: string }`
- `UnlockCost: number`
- Constants: `SKILL_TREE`, `VARIANT_INFO`, `GENERAL_ADDON_CATEGORIES`, `GENERAL_ADDON_DEFS`

### 17. `src/waves/WaveManager.ts` (~107 lines)

Type wave composition, spawn queue entries.

- `WaveEntry: { type: string; level: number }`
- `WaveComposition: Record<string, number>`

---

## Phase 5: Manager Classes

**Goal:** Type the collection managers that operate on model classes.

### 18. `src/enemies/EnemyManager.ts` (~42 lines)

- `enemies: Enemy[]`
- `spawn(type, level, spawnIndex, wave): Enemy`
- `update(dt, onEnemyKill: (enemy: Enemy) => void)`
- `getEnemiesInRange(x, y, range): Enemy[]`

### 19. `src/towers/TowerManager.ts` (~48 lines)

- `towers: Tower[]`
- `build(type, tileX, tileY, save, grid): Tower | null`
- `sell(tower, save): number`
- `cancelBuild(tower): number`
- `update(dt, enemyManager)`
- `towerAt(tileX, tileY): Tower | undefined`

### 20. `src/render/Particles.ts` (~55 lines)

- `Particle: { ox, oy, deltaX, deltaY, life, maxLife, color, size, birthTime }`
- `spawn(x, y, color, count?, opts?): void`
- `render(ctx: CanvasRenderingContext2D): void`

### 21. `src/render/ProjectileManager.ts` (~333 lines)

Type projectile shapes, lightning flash data, chain/splash/napalm/railgun variants.

- `Projectile: { x, y, deltaX, deltaY, speed, color, shape, width?, radius?, target?, chain?, splash?, napalm?, pierce?, knock?, burnDps?, burnDuration? }`
- `LightningFlash: { x1, y1, x2, y2, color, path: {x,y}[], life, maxLife, brightness }`

---

## Phase 6: Engine & Rendering

**Goal:** Type the core game loop and canvas rendering.

### 22. `src/game/GameEngine.ts` (~672 lines)

Largest source file. Type constructor params, all manager references, loop state, stats. Forward-reference types from Phases 4-5.

- Constructor: `(canvas: HTMLCanvasElement, gameStore, persistStore)`
- Managers: `grid: Grid | null`, `enemyManager: EnemyManager | null`, `projectiles: ProjectileManager | null`, `towerManager: TowerManager | null`, `waveManager: WaveManager | null`
- Loop state: `_rafId: number | null`, `lastTime: number`, `_accumulator: number`
- Stats: `totalGoldEarned: number`, `totalHealingReceived: number`, `startingLives: number`, `waveTopTowers: ... | null`
- Methods: `loadMap`, `loadRandomMap`, `start`, `loop`, `update`, `render`, `click`, `setHover`, `togglePause`, `cycleSpeed`, `upgradeSelected`, `sellSelected`, `specializeSelected`, etc.

### 23. `src/render/Renderer.ts` (~387 lines)

Type `ctx: CanvasRenderingContext2D`, camera state, all draw methods.

- `camera: { x, y, zoom }`
- `fitToGrid(grid, canvasW, canvasH)`, `applyCamera()`, `restoreCamera()`, `screenToWorld(sx, sy)`
- Draw methods: `drawGrid`, `drawPathsHighlight`, `drawBuildPreview`, `drawTowerRange`, `drawTileHighlight`, `drawUpgradeButton`, `drawWaveTopTowers`, `drawSplashRadius`, `drawProjectiles`, `drawStunEffects`

### 24. `src/sound/SoundManager.ts` (~90 lines)

Type `AudioContext`, sound name union.

- `SoundName: 'shoot_basic' | 'shoot_sniper' | 'shoot_cannon' | 'shoot_ice' | 'shoot_lightning' | 'shoot_railgun' | 'place' | 'base_hit' | 'boss_die'`

---

## Phase 7: Services, Composables & Input

**Goal:** Type Vue-integrated helpers.

### 25. `src/services/CameraService.ts` (~12 lines)

- `cameraTransform: Ref<{ x: number; y: number; zoom: number }>`
- `updateCamera(x, y, zoom): void`
- `getCameraCSS(): string`

### 26. `src/composables/useCameraSync.ts` (~30 lines)

- `getCanvasOffset: () => { x: number; y: number }`
- Returns: `{ layerStyle: ComputedRef<CSSStyleDeclaration> }`

### 27. `src/composables/useAnimation.ts` (~142 lines)

- Type animation config, resolved images, return value shape
- `AnimationConfig: { referenceImages: ReferenceImage[]; duration: number }`
- `ReferenceImage: { id: string; name?: string; svg?: string; svgText?: string; file?: string }`
- Returns: `{ pathData: Ref<string>; currentAnimation: Ref<string>; blend: Ref<number>; imagesReady: Ref<boolean>; play(name): void; stop(): void; restart(): void }`

### 28. `src/game/Input.ts` (~70 lines)

Type composable params: `(gameStore, engine: GameEngine, uiStore): void`

---

## Phase 8: Vue SFCs

**Goal:** Add `lang="ts"` to all `<script setup>` blocks. Type `defineProps`, `defineEmits`, and internal refs.

### 29. `src/main.ts` (~15 lines)

Rename from `.js`. No type changes needed.

### 30. `src/router/index.ts` (~51 lines)

Rename from `.js`. Route config typing with `RouteRecordRaw`.

### 31. `src/App.vue`

Add `lang="ts"` to `<script setup>`. Minimal changes needed.

### 32. Component SFCs (15 files)

Add `lang="ts"` and type props/emits/internal state:

| Component | Key Types |
|---|---|
| `GameCanvas.vue` | `defineProps<{ canvasOffset: { x: number; y: number } }>()`, `defineEmits<{'canvas-offset': [offset: {x,y}]}>()` |
| `GameScreen.vue` | Type `canvasOffset` ref as `Ref<{x,y}>` |
| `TowerSprite.vue` | `defineProps<{ tower: Tower; worldPos: { x: number; y: number } }>()` |
| `EnemySprite.vue` | `defineProps<{ enemy: Enemy; worldPos: { x: number; y: number } }>()` |
| `EndScreen.vue` | `defineProps<{ won: boolean }>()` |
| `SpriteLayer.vue` | Type tower/enemy lists from store, computed keys |
| `TowerPanel.vue` | Type tower stats display, targeting options, upgrade/sell logic |
| `GameHud.vue` | Type HUD stat displays from stores |
| `GameShop.vue` | Type tower meta, discount computed, cost function |
| `MainMenu.vue` | Type difficulty slider, gem multiplier computation |
| `MapSelect.vue` | Type map entries, region grouping, unlock status |
| `SkillTree.vue` | Type skill tree node clicks, refund logic, general addon clicks |
| `ConfirmDialog.vue` | Type dialog display from uiStore |
| `DebugPanel.vue` | Type debug function params |
| `StatsPanel.vue` | Type wave composition, enemy list, run stats |
| `HistoryScreen.vue` | Type run history entries, breakdown formatting |

---

## Phase 9: Tests

**Goal:** Convert all test files to TypeScript.

### 33. `tests/setup.ts` (~136 lines)

Type `mockCtx` as partial `CanvasRenderingContext2D`, `mockCanvas` shape, `MockAudioContext` class.

### 34. `tests/helpers/*.ts` (3 files)

Type mock factory return values:

- `mock-stores.ts`: Type `createTestGameStore()`, `createTestPersistStore()`, `createTestUiStore()`, `createTestStores()` return types
- `mock-grid.ts`: Type `makeMapData()`, `makeBastionMap()`, etc. return `MapData`
- `mock-managers.ts`: Type `makeParticleSystem()`, `makeSoundManager()` returns

### 35. `tests/unit/*.test.ts` (23 files)

Convert imports from `./Foo.js` to `./Foo` (or `./Foo.ts`). Type test fixtures:

- `towers.test.js` → type `makeSave()` helper returning `SaveState`
- `game-engine.test.js` → type test fixture setup
- Others → minimal changes, mostly import path updates

### 36. `tests/integration/integration.test.ts` (1 file)

Same treatment as unit tests.

---

## Post-Migration Cleanup

37. Set `allowJs: false` in `tsconfig.json`
38. Remove `checkJs: true` from `tsconfig.json`
39. Update `biome.json` if needed (Biome 2.x handles `.ts` natively — likely no changes)
40. Update `package.json` scripts: change lint/format `include` patterns from `src/` to cover `.ts` files (Biome already does this by default)
41. Final verification: `npm run typecheck`, `npm run lint`, `npm run test`

---

## Key Type Decisions

| Decision | Rationale |
|---|---|
| **String literal unions over enums** | Current code uses string constants (`"basic"`, `"playing"`). Unions are more Vite-compatible and avoid enum runtime overhead. |
| **`as const` for frozen objects** | `GameState`, `TowerIds`, `Regions` — use `as const` assertions for compile-time literal types. |
| **Keep options-style Pinia stores** | Converting to setup stores would require rewriting all 3 stores and every test. Options stores type cleanly with generic syntax. |
| **No `interface` for every class** | ES6 classes map naturally to TypeScript classes. Use `class` declarations, not interfaces. |
| **Preserve `allowJs` until Phase 9 complete** | Lets us verify each batch independently. |
| **Test file imports** | After conversion, imports change from `./Foo.js` to `./Foo` (or `./Foo.ts`). Biome handles this. |
| **Forward references** | `GameEngine` references `Tower`, `Enemy`, `Grid`, etc. Define model types in Phases 4-5 before Phase 6. |
| **Pinia store generics** | Use `defineStore<"game", StateShape>(...)` generic syntax for typed stores. |

---

## Risk Assessment

| Phase | Risk | Why |
|---|---|---|
| 1-2 (Foundation + Utilities) | **Low** | Pure types and stateless functions. No framework coupling. |
| 3 (Stores) | **Low** | Well-tested (game-store, persist-store, ui-store tests). Pure state management. |
| 4 (Models) | **Low** | Data classes with clear field shapes. Comprehensive unit tests. |
| 5 (Managers) | **Low** | Thin wrappers around model classes. Tests verify behavior. |
| 6 (Engine + Render) | **Medium** | Cross-file type dependencies. `GameEngine` is 672 lines with many method interactions. |
| 7 (Composables) | **Low** | Thin wrappers around Vue refs. |
| 8 (Vue SFCs) | **Medium** | `lang="ts"` requires careful typing of `defineProps`/`defineEmits`. Biome `noUnusedVariables` is off for `.vue` so this is forgiving. |
| 9 (Tests) | **Low** | Tests verify behavior; types just prevent API drift. |

---

## Estimated Effort

~110 files to convert across 9 phases.

**Largest individual files:**

| File | Lines | Complexity |
|---|---|---|
| `Constants.js` | 919 | High — many nested objects, animation SVG data |
| `GameEngine.js` | 672 | High — RAF loop, state transitions, tower/enemy/wave coordination |
| `Tower.js` | 455 | Medium — stats caching, variant modifications, addon interactions |
| `SkillTree.js` | 430 | Medium — pure functions, nested data structures |
| `Renderer.js` | 387 | Medium — canvas 2D API, camera transforms, many draw methods |
| `ProjectileManager.js` | 333 | Medium — chain/splash/napalm/railgun projectile variants |
| `Map.js` | 284 | Medium — procedural generation, 6 layout styles |
| `Shapes.js` | 198 | Low — canvas drawing helpers |
| `Enemy.js` | 197 | Medium — HP/shield/heal/stun/slow/burn systems |
| `persist.js` | 192 | Medium — localStorage persistence, schema migration |

Most conversions are mechanical: add type annotations, rename extensions, update imports. The highest-effort files are `Constants.ts` (defining all shared types), `GameEngine.ts` (coordinating all subsystems), and `Tower.ts` (complex stats computation).

---

## Execution Order Summary

```
Phase 1:  Constants.ts, tsconfig.json, vite.config.ts, vitest.config.ts
Phase 2:  Pathfinding.ts, Shapes.ts, EnemyWalk.ts, SvgLoader.ts
Phase 3:  game.ts, persist.ts, ui.ts
Phase 4:  Grid.ts, Map.ts, Enemy.ts, Tower.ts, SkillTree.ts, WaveManager.ts
Phase 5:  EnemyManager.ts, TowerManager.ts, Particles.ts, ProjectileManager.ts
Phase 6:  GameEngine.ts, Renderer.ts, SoundManager.ts
Phase 7:  CameraService.ts, useCameraSync.ts, useAnimation.ts, Input.ts
Phase 8:  main.ts, router/index.ts, App.vue, all 15 component SFCs
Phase 9:  tests/setup.ts, tests/helpers/*.ts, tests/unit/*.test.ts, tests/integration/*.test.ts
Cleanup:  allowJs: false, checkJs: false, final verification
```
