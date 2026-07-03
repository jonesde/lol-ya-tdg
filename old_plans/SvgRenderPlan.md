# Updated SVG Migration Plan: `<symbol>`/`<use>` + Imperative DOM (v3)

## Goal & Architecture Shift

Eliminate the `<canvas>` and `<div class="sprite-layer">` elements, replacing them with a single `<svg>` root. All visual game content (tiles, towers, enemies, projectiles, effects) will be drawn as SVG elements.

**The core architectural shift from the previous plan:** We are moving away from "nested SVG Vue components" towards a **Hybrid Declarative/Imperative** model.
- **Vue (Declarative):** Manages structural changes (map loading, building/selling towers, opening shops). Mounts the root SVG and static layers.
- **GameEngine (Logic):** Continues to orchestrate all game logic (enemy movement, tower targeting, projectile updates, wave management). Unchanged in responsibility, except the constructor no longer receives a canvas reference.
- **Direct DOM (Imperative Rendering):** A single `requestAnimationFrame` (RAF) loop calls `GameEngine.update(dt)` for logic, then reads the resulting entity state and writes per-frame properties (position, animation frame, HP bar width) directly via `setAttribute` and `style.transform`. This bypasses Vue's reactivity system for hot paths, eliminating `frameTick` hacks and `v-html` injections.

## Core SVG Concepts for this Implementation

Before diving into the code, here are the specific SVG mechanics that make this architecture work:

### 1. `<symbol>` and `<use>`
A `<symbol>` defines a reusable graphic template. It is **not rendered** until it is instantiated by a `<use>` element.
- **Why this matters:** You can define all enemy/tower animation frames as `<symbol>`s in `<defs>`. An enemy on screen is just a `<use href="#enemy-frame-1" />`. To animate, you simply update the `href` attribute of the `<use>` element. This is vastly faster than re-rendering nested SVG trees.

### 2. CSS Transforms in SVG (`transform-box`)
Modern browsers support CSS transforms on SVG elements, which can be GPU-composited. However, by default, CSS transform origins in SVG can be confusing.
- **The Fix:** Always set `transform-box: fill-box; transform-origin: 0 0;` on SVG elements you intend to move via CSS `transform`. This makes the element's local coordinate space (0,0) the origin, matching standard screen graphics expectations.

### 3. Coordinate Transformation Matrix (CTM)
When you have an SVG with a `viewBox`, a camera `<g>` transform, and CSS scaling, converting a mouse click (screen pixels) to world coordinates (tile units) is mathematically complex.
- **The Fix:** The SVG API provides `getScreenCTM()`, which returns a matrix representing all active transforms. You must call this on the **world layer** (the `<g>` with the camera transform), not the root `<svg>`. The root `<svg>`'s CTM only accounts for the viewBox, ignoring the camera. The world layer's CTM includes the full chain: world space → camera `<g>` transform → viewBox → CSS scaling → screen pixels.

### 4. Symbol ViewBox and Coordinate Origins
When converting existing SVG sprite strings (defined inline in `Constants.ts` under `ENEMY_TYPES` and `TOWER_META`) into `<symbol>` definitions, coordinate alignment is critical:
- Each `<symbol>` must declare a `viewBox` that matches the sprite's coordinate space.
- **Enemy sprites** use `viewBox="-1 -1 2 2"` — a 2x2 unit coordinate space centered at origin. At render time, sprites are scaled by `enemy.meta.radius * 2 * grid.tileSize`. With `viewBox="-1 -1 2 2"`, a `translate(x, y)` on the `<use>` element places the sprite's center at world coordinate `(x, y)` — which is correct.
- **Tower sprites** use `viewBox="-16 -16 32 32"` (centered at origin). Content is centered at `(0,0)`, so `translate(x, y)` places the center of the sprite at world coordinate `(x, y)`.
- If any sprites use a top-left origin, either:
  - Wrap them in a `<g transform="translate(16, 16)">` inside the symbol to re-center, OR
  - Adjust the positioning calculation in the entity's `update()` method to `translate(x - radius, y - radius)`.

---

## Target Architecture

```
<svg class="game-svg" viewBox="0 0 W H">
  <defs>
    <!-- Static defs (symbols, filters) — generated once, not per-map -->
    <symbol id="tower-archer-f0" viewBox="-16 -16 32 32">...</symbol>
    <symbol id="enemy-minion-f0" viewBox="-1 -1 2 2">...</symbol>
    <filter id="glow">...</filter>
    
    <!-- Map-specific defs (gradients) — regenerated per-map -->
    <linearGradient id="base-grad">...</linearGradient>
  </defs>

  <!-- Static layers (Managed by Vue, updated on map change) -->
  <g class="grid-layer" v-html="gridContent"></g>
  
  <!-- Camera wrapper (Managed by Direct DOM, updated every frame) -->
  <g ref="worldLayer" transform="translate(0,0) scale(1)">
    
    <!-- Dynamic layers (Direct DOM via element pools) -->
    <g ref="entityLayer"></g>      <!-- Towers & Enemies as <use> elements -->
    <g ref="uiOverlayLayer"></g>   <!-- HP bars, shield bars, boss text (separate pool) -->
    <g ref="projectileLayer"></g>  <!-- Projectiles as <circle>/<line> -->
    <g ref="effectLayer"></g>     <!-- Particles, lightning, stuns -->
    
  </g>
</svg>
```

**Key architectural notes:**
- HP bars, shield bars, and boss HP text are **not** children of `<use>` elements. They are separate pooled elements in a dedicated `uiOverlayLayer`. This avoids browser compatibility issues with `<use>` shadow tree modification and keeps the per-frame DOM writes clean.
- **Click handling remains centralized.** The SVG root captures all clicks and routes them through `gameEngine.handleClick(worldX, worldY)`. No SVG element gets its own `@click` handler — the engine determines what was hit (tower, upgrade button, empty tile) programmatically using world coordinates.

---

## Implementation Details

### 1. The Root Component: `SvgGameRoot.vue`

This component replaces `GameCanvas.vue` and `SpriteLayer.vue`. It owns the single RAF loop, calls GameEngine for logic updates, and writes rendering state directly to the DOM.

```vue
<template>
  <svg 
    ref="svgRoot" 
    class="game-svg" 
    :viewBox="`0 0 ${viewSize.w} ${viewSize.h}`"
    @mousemove="onMouseMove"
    @click="onClick"
  >
    <!-- 1. Defs: Symbols, Filters, Gradients (imperatively constructed in onMounted) -->
    <defs ref="defsLayer"></defs>

    <!-- 2. Static Grid Layer (Vue-managed) -->
    <g class="grid-layer" v-html="gridContent"></g>

    <!-- 3. Dynamic World Layer (Imperative DOM) -->
    <!-- NOTE: transform is set imperatively; no Vue binding here -->
    <g ref="worldLayer" class="camera-wrapper">
      <g ref="entityLayer" class="entity-layer"></g>
      <g ref="uiOverlayLayer" class="ui-overlay-layer"></g>
      <g ref="projectileLayer" class="projectile-layer"></g>
      <g ref="effectLayer" class="effect-layer"></g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { usePersistStore } from '@/stores/persist'
import { GameEngine } from '@/game/GameEngine'
import { EnemyManager } from '@/render/svg/EnemyManager'
import { TowerManager } from '@/render/svg/TowerManager'
import { ProjectileManager } from '@/render/svg/ProjectileManager'
import { ParticleManager } from '@/render/svg/ParticleManager'
import { EffectManager } from '@/render/svg/EffectManager'
import { UiOverlayManager } from '@/render/svg/UiOverlayManager'
import { useSvgStaticContent } from '@/render/svg/useSvgStaticContent'
import { fitToGrid } from '@/render/svg/cameraUtils'

const svgRoot = ref<SVGSVGElement | null>(null)
const defsLayer = ref<SVGDefsElement | null>(null)
const worldLayer = ref<SVGGElement | null>(null)
const entityLayer = ref<SVGGElement | null>(null)
const uiOverlayLayer = ref<SVGGElement | null>(null)
const projectileLayer = ref<SVGGElement | null>(null)
const effectLayer = ref<SVGGElement | null>(null)

const gameStore = useGameStore()
const persistStore = usePersistStore()

const mouseWorldPos = ref<{ x: number; y: number } | null>(null)

// GameEngine constructor no longer takes canvas — only gameStore and persistStore
const gameEngine = new GameEngine(gameStore, persistStore)

// Static content (defs + grid)
const { staticDefsContent, mapDefsContent, gridContent } = useSvgStaticContent(
  computed(() => gameStore.map),
  computed(() => gameStore.grid)
)

// View size for viewBox
const viewSize = ref({ w: 800, h: 600 })

let rafId = 0
let lastTime = 0

// Managers
const enemyManager = new EnemyManager()
const towerManager = new TowerManager()
const projectileManager = new ProjectileManager()
const particleManager = new ParticleManager()
const effectManager = new EffectManager()
const uiOverlayManager = new UiOverlayManager()

// Initialize camera transform once (not reactive — RAF loop owns it)
let cameraTransformString = 'translate(0,0) scale(1)'

const loop = (time: number) => {
  const dt = time - lastTime
  lastTime = time

  // --- STEP 1: Game Logic (unchanged from current architecture) ---
  // GameEngine.update() handles enemy movement, tower targeting, 
  // projectile creation, wave management, etc.
  gameEngine.update(dt)

  // --- STEP 2: Camera Transform (single DOM write) ---
  const cam = gameStore.camera
  cameraTransformString = `translate(${cam.x}, ${cam.y}) scale(${cam.zoom})`
  worldLayer.value?.setAttribute('transform', cameraTransformString)

  // --- STEP 3: Imperative DOM Rendering (read entity state, write to DOM) ---
  // Each manager reads from GameEngine's entity arrays and updates pooled DOM elements
  enemyManager.syncFromGameEngine(gameEngine.enemies)
  towerManager.syncFromGameEngine(gameEngine.towers)
  projectileManager.syncFromGameEngine(gameEngine.projectiles)
  particleManager.syncFromGameEngine(gameEngine.particles)
  effectManager.syncFromGameEngine(mouseWorldPos.value, gameStore.selectedTowerType)
  uiOverlayManager.syncFromGameEngine(gameEngine.enemies, gameStore.selectedTower)

  rafId = requestAnimationFrame(loop)
}

onMounted(async () => {
  // Build <defs> imperatively (avoids Vue v-html on <defs> compiler issues)
  await buildDefsImperative(staticDefsContent.value, mapDefsContent.value)

  // Initialize managers with their layer elements
  // Note: EnemyManager requires hitFlashLayer for hit flash circles
  enemyManager.init(entityLayer.value!, uiOverlayLayer.value!)
  towerManager.init(entityLayer.value!)
  uiOverlayManager.init(uiOverlayLayer.value!)
  projectileManager.init(projectileLayer.value!)
  particleManager.init(effectLayer.value!)
  effectManager.init(effectLayer.value!)

  // Set initial camera transform using fitToGrid logic ported from Renderer.ts
  // GeneratedMap has width and height properties (in tile units); multiply by tileSize (36)
  const map = gameStore.map
  if (map) {
    const mapWidth = map.width * 36
    const mapHeight = map.height * 36
    const initialCam = fitToGrid(mapWidth, mapHeight, viewSize.value.w, viewSize.value.h)
    cameraTransformString = `translate(${initialCam.x}, ${initialCam.y}) scale(${initialCam.zoom})`
    worldLayer.value?.setAttribute('transform', cameraTransformString)
  }

  // Resize observer
  resizeObserver.observe(svgRoot.value!)

  lastTime = performance.now()
  rafId = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  resizeObserver.disconnect()
})

// Build <defs> content imperatively — creates a <defs> element and sets innerHTML directly.
// This avoids Vue template compiler issues with v-html on <defs>.
async function buildDefsImperative(staticContent: string, mapContent: string) {
  if (!defsLayer.value) return
  // Clear existing content
  while (defsLayer.value.firstChild) {
    defsLayer.value.removeChild(defsLayer.value.firstChild)
  }
  // Set combined content via innerHTML on the <defs> element
  defsLayer.value.innerHTML = staticContent + mapContent
}

// Input handling using CTM on worldLayer (NOT svgRoot)
const onMouseMove = (e: MouseEvent) => {
  if (!svgRoot.value || !worldLayer.value) return
  
  const pt = svgRoot.value.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  
  // CRITICAL: Use worldLayer.getScreenCTM(), not svgRoot.getScreenCTM()
  // worldLayer includes the camera transform; svgRoot only includes viewBox
  const ctm = worldLayer.value.getScreenCTM().inverse()
  const worldPos = pt.matrixTransform(ctm)
  
  mouseWorldPos.value = worldPos
  
  // Pass world coordinates to engine for hover tracking
  // Note: GameEngine.setHover() has been updated from (screenX, screenY) to (worldX, worldY)
  gameEngine.setHover(worldPos.x, worldPos.y)
}

// Click handling remains centralized — no per-element @click handlers
const onClick = (e: MouseEvent) => {
  if (!svgRoot.value || !worldLayer.value) return
  
  const pt = svgRoot.value.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  
  const ctm = worldLayer.value.getScreenCTM().inverse()
  const worldPos = pt.matrixTransform(ctm)
  
  // GameEngine.handleClick determines what was hit:
  // - Upgrade button (checks against selected tower's button hit area)
  // - Tower body (checks against all tower positions)
  // - Empty tile (build placement)
  // All routing logic stays in GameEngine, using world coordinates
  // GameEngine.handleClick() has been updated from click(screenX, screenY) to handleClick(worldX, worldY)
  // to match the CTM-based coordinate conversion in this component.
  // Note: GameEngine.setHover(screenX, screenY) also needs the same conversion;
  // the SvgGameRoot.vue onMouseMove passes world coordinates, so setHover()
  // must also be updated to accept world coordinates.
  gameEngine.handleClick(worldPos.x, worldPos.y)
}

// Resize handling
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect
    viewSize.value = { w: width, h: height }
  }
})
</script>

<style scoped>
.game-svg {
  width: 100%;
  height: 100%;
  cursor: crosshair;
  display: block;
}

/* Crucial for CSS transforms on SVG elements to behave predictably */
.entity-layer :deep(use),
.ui-overlay-layer :deep(rect),
.projectile-layer :deep(circle),
.projectile-layer :deep(line),
.effect-layer :deep(path),
.effect-layer :deep(circle) {
  transform-box: fill-box;
  transform-origin: 0 0;
}
</style>
```

**Key clarifications:**
- `GameEngine` constructor takes `(gameStore, persistStore)` — **no canvas, no Renderer**. The canvas parameter is removed entirely.
- The `worldLayer` `<g>` element has **no Vue `:transform` binding**. Its `transform` attribute is set imperatively in `onMounted` (initial fit) and then every frame by the RAF loop.
- `GameEngine.update(dt)` is still the authoritative game logic orchestrator. The managers do **not** absorb game logic — they are pure rendering adapters that read from GameEngine's state and write to the DOM.
- **Click routing is centralized.** The SVG root has a single `@click` handler. No SVG element gets its own `@click`. `gameEngine.handleClick(worldX, worldY)` determines what was hit using world coordinates. **The engine's `handleClick()` method has been updated from the previous `click(screenX, screenY)` signature** to accept world coordinates directly, matching the CTM-based conversion in this component. Similarly, `setHover()` has been updated to accept world coordinates.
- **`<defs>` is built imperatively** in `onMounted` via `buildDefsImperative()`, not via `v-html`. This avoids Vue template compiler issues with `v-html` on `<defs>`.
- There is a single `onMounted` hook (merged for readability).
- **Sprites are read from `Constants.ts`** (inline SVG strings in `ENEMY_TYPES` and `TOWER_META`), not from external files. No `SvgLoader` or async loading is required.

---

### 2. The `syncFromGameEngine` Pattern

Managers do **not** own game logic. They are rendering adapters. Each frame, `GameEngine.update(dt)` runs first (logic), then managers sync their pooled DOM elements to the engine's current entity state.

```typescript
// EnemyManager.ts
export class EnemyManager {
  private pool: EnemyRenderProxy[] = []
  private layerEl: SVGGElement

  init(layer: SVGGElement, hitFlashLayer: SVGGElement) {
    this.layerEl = layer
    // Pre-allocate 100 enemy <use> elements + matching hit flash circles
    for (let i = 0; i < 100; i++) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      el.style.visibility = 'hidden'
      layer.appendChild(el)
      const proxy = new EnemyRenderProxy(el)
      // Each enemy also gets a hit flash circle in the uiOverlayLayer
      const flashCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      flashCircle.setAttribute('r', '8')
      flashCircle.setAttribute('fill', '#ffffff')
      flashCircle.setAttribute('opacity', '0')
      flashCircle.style.visibility = 'hidden'
      hitFlashLayer.appendChild(flashCircle)
      proxy.setHitFlashElement(flashCircle)
      this.pool.push(proxy)
    }
  }

  /**
   * Called every frame AFTER GameEngine.update(dt).
   * Reads game state, writes to DOM. Does NOT modify game state.
   */
  syncFromGameEngine(enemies: Enemy[]) {
    let proxyIndex = 0

    for (const enemy of enemies) {
      if (proxyIndex >= this.pool.length) break // Pool exhausted

      const proxy = this.pool[proxyIndex]
      proxy.sync(enemy)
      proxyIndex++
    }

    // Hide unused proxies
    for (let i = proxyIndex; i < this.pool.length; i++) {
      this.pool[i].hide()
    }
  }
}

// EnemyRenderProxy.ts — Wraps a single <use> element
class EnemyRenderProxy {
  private el: SVGUseElement
  private hitFlashEl: SVGCircleElement | null = null
  private lastSpriteId: string = ''
  private active: boolean = false

  constructor(el: SVGUseElement) {
    this.el = el
  }

  setHitFlashElement(circleEl: SVGCircleElement) {
    this.hitFlashEl = circleEl
  }

  sync(enemy: Enemy) {
    this.active = true
    this.el.style.visibility = 'visible'

    // 1. Update Position via CSS Transform (GPU composited)
    this.el.style.transform = `translate(${enemy.x}px, ${enemy.y}px)`

    // 2. Update Animation Frame (computed from enemy timing state)
    // Frame index is derived from hitAnimTime and the sprite config from Constants.ts:
    //   frameIndex = Math.floor((elapsed % duration) / (duration / numFrames))
    // The EnemyManager.syncFromGameEngine() computes the current frame before passing it in.
    const spriteId = `enemy-${enemy.type}-f${enemy.currentFrame}`
    if (spriteId !== this.lastSpriteId) {
      this.el.setAttribute('href', `#${spriteId}`)
      this.lastSpriteId = spriteId
    }

    // 3. Apply slow filter if slowed (feColorMatrix from <defs>)
    if (enemy.slowFactor < 1) {
      const filterLevel = Math.ceil((1 - enemy.slowFactor) * 10)
      this.el.setAttribute('filter', `url(#slow-${filterLevel})`)
    } else {
      this.el.removeAttribute('filter')
    }

    // 4. Hit flash effect — white overlay with fading opacity (~150ms duration)
    // When hitAnimTime is recent, render a white <circle> overlay in the uiOverlayLayer
    // at the enemy's position with opacity proportional to remaining flash time.
    if (this.hitFlashEl) {
      const flashRemaining = enemy.hitAnimTime ? 150 - (performance.now() - enemy.hitAnimTime) : 0
      if (flashRemaining > 0) {
        this.hitFlashEl.style.visibility = 'visible'
        this.hitFlashEl.style.transform = `translate(${enemy.x}px, ${enemy.y}px)`
        this.hitFlashEl.style.opacity = String(flashRemaining / 150)
      } else {
        this.hitFlashEl.style.visibility = 'hidden'
      }
    }
  }

  hide() {
    if (this.active) {
      this.el.style.visibility = 'hidden'
      this.active = false
      this.lastSpriteId = '' // Force re-set on next sync
      this.el.removeAttribute('filter')
      if (this.hitFlashEl) {
        this.hitFlashEl.style.visibility = 'hidden'
      }
    }
  }
}
```

---

### 3b. Tower Rendering (TowerManager + TowerRenderProxy)

Towers use `<use>` elements for the sprite body and separate pooled `<circle>` elements for level pips. Barrel rotation is applied via CSS `transform: rotate()` on the `<use>` element.

```typescript
// TowerManager.ts
export class TowerManager {
  private pool: TowerRenderProxy[] = []
  private pipPool: SVGCircleElement[] = []
  private layerEl: SVGGElement

  init(layer: SVGGElement) {
    this.layerEl = layer
    // Pre-allocate 50 tower <use> elements
    for (let i = 0; i < 50; i++) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      el.style.visibility = 'hidden'
      layer.appendChild(el)
      this.pool.push(new TowerRenderProxy(el))
    }

    // Pre-allocate pip circles (up to 4 pips per tower, 50 towers max = 200 pips)
    for (let i = 0; i < 200; i++) {
      const pip = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      pip.setAttribute('r', '2')
      pip.style.visibility = 'hidden'
      layer.appendChild(pip)
      this.pipPool.push(pip)
    }
  }

  syncFromGameEngine(towers: Tower[]) {
    let proxyIndex = 0
    let pipIndex = 0

    for (const tower of towers) {
      if (proxyIndex >= this.pool.length) break // Pool exhausted

      const proxy = this.pool[proxyIndex]
      proxy.sync(tower)
      proxyIndex++

      // Render level pips (levels 2-4: silver, level 5+: gold)
      // Pips are arranged in a row below the sprite
      const pipCount = Math.max(0, tower.level - 1)
      for (let p = 0; p < pipCount; p++) {
        if (pipIndex >= this.pipPool.length) break
        const pip = this.pipPool[pipIndex]
        pip.style.visibility = 'visible'
        // Position pips in a row below the tower center
        const pipX = tower.x + (p - (pipCount - 1) / 2) * 5
        const pipY = tower.y + 12
        pip.style.transform = `translate(${pipX}px, ${pipY}px)`
        pip.setAttribute('fill', tower.level >= 5 ? '#ffd700' : '#c0c0c0')
        pipIndex++
      }
    }

    // Hide unused proxies
    for (let i = proxyIndex; i < this.pool.length; i++) {
      this.pool[i].hide()
    }
    // Hide unused pips
    for (let i = pipIndex; i < this.pipPool.length; i++) {
      this.pipPool[i].style.visibility = 'hidden'
    }
  }
}

// TowerRenderProxy.ts — Wraps a single <use> element
class TowerRenderProxy {
  private el: SVGUseElement
  private lastSpriteId: string = ''
  private active: boolean = false

  constructor(el: SVGUseElement) {
    this.el = el
  }

  sync(tower: Tower) {
    this.active = true
    this.el.style.visibility = 'visible'

    // 1. Update Position (static per-tower — set once on build, not per-frame)
    // Towers don't move, so transform only needs updating on build/sell
    // this.el.style.transform = `translate(${tower.x}px, ${tower.y}px)`

    // 2. Update Animation Frame (computed from tower.fireAnimTime and animation config)
    // Frame index: Math.floor((elapsed % duration) / (duration / numFrames))
    // The TowerManager.syncFromGameEngine() computes currentFrame from tower.fireAnimTime
    // and the tower's animation config from TOWER_META in Constants.ts.
    const spriteId = `tower-${tower.type}-f${tower.currentFrame}`
    if (spriteId !== this.lastSpriteId) {
      this.el.setAttribute('href', `#${spriteId}`)
      this.lastSpriteId = spriteId
    }

    // 3. Barrel rotation — rotate the SVG by tower.angle radians
    // Current TowerSprite.vue rotates via CSS transform: rotate(); same approach here.
    // The angle is in radians; convert to degrees for CSS transform.
    const rotationDeg = tower.angle * (180 / Math.PI)
    this.el.style.transform = `translate(${tower.x}px, ${tower.y}px) rotate(${rotationDeg}deg)`
  }

  hide() {
    if (this.active) {
      this.el.style.visibility = 'hidden'
      this.active = false
      this.lastSpriteId = '' // Force re-set on next sync
    }
  }
}
```

**Notes on tower rendering:**
- `tower.currentFrame` is a computed/derived value in the TowerManager, computed from `tower.fireAnimTime` and the tower's `animation` config from `TOWER_META` in `Constants.ts`. Neither `Enemy` nor `Tower` has an `animationFrame` property natively — the frame index is calculated in the manager each frame.
- Barrel rotation is applied per-frame via CSS `transform: rotate()` since `tower.angle` changes every frame as the tower tracks its target.
- Level pips are persistent visual indicators rendered as separate `<circle>` elements below the sprite. They are part of the `TowerManager.syncFromGameEngine()` but use a separate pip pool to avoid conflicts with the tower `<use>` pool.

---

### 3. UI Overlay Layer (HP Bars, Shield Bars, Boss Text)

HP bars and shield bars are **not** children of `<use>` elements. They live in a separate `uiOverlayLayer` with their own element pool. This avoids browser compatibility issues with `<use>` shadow tree modification.

```typescript
// UiOverlayManager.ts
export class UiOverlayManager {
  private hpBarPool: SVGRectElement[] = []
  private shieldBarPool: SVGRectElement[] = []
  private bossTextPool: SVGTextElement[] = []
  private hitFlashPool: SVGCircleElement[] = []
  private layerEl: SVGGElement

  init(layer: SVGGElement) {
    this.layerEl = layer

    // Pre-allocate HP bar background + foreground pairs
    for (let i = 0; i < 100; i++) {
      // Background (dark)
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.style.visibility = 'hidden'
      bg.setAttribute('width', '24')
      bg.setAttribute('height', '3')
      bg.setAttribute('fill', '#000000')
      bg.setAttribute('opacity', '0.6')
      layer.appendChild(bg)

      // Foreground (green/red)
      const fg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      fg.style.visibility = 'hidden'
      fg.setAttribute('width', '24')
      fg.setAttribute('height', '3')
      fg.setAttribute('fill', '#00ff00')
      layer.appendChild(fg)

      this.hpBarPool.push(bg, fg)
    }

    // Pre-allocate hit flash circles (one per enemy, max 100)
    for (let i = 0; i < 100; i++) {
      const flash = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      flash.setAttribute('r', '8')
      flash.setAttribute('fill', '#ffffff')
      flash.setAttribute('opacity', '0')
      flash.style.visibility = 'hidden'
      layer.appendChild(flash)
      this.hitFlashPool.push(flash)
    }

    // Shield bars (similar pattern, blue color)
    // Boss HP text (<text> elements)
  }

  syncFromGameEngine(enemies: Enemy[], selectedTower: Tower | null) {
    let barIndex = 0
    let flashIndex = 0

    for (const enemy of enemies) {
      if (barIndex + 1 >= this.hpBarPool.length) break

      const bg = this.hpBarPool[barIndex]
      const fg = this.hpBarPool[barIndex + 1]
      barIndex += 2

      // Position above enemy (enemy is centered at its x,y)
      // With enemy viewBox="-1 -1 2 2", the sprite is scaled by radius * 2 * tileSize.
      // HP bar offset is relative to the enemy's world position, not sprite pixel size.
      const barX = enemy.x - 12
      const barY = enemy.y - 16

      bg.style.visibility = 'visible'
      bg.style.transform = `translate(${barX}px, ${barY}px)`

      fg.style.visibility = 'visible'
      fg.style.transform = `translate(${barX}px, ${barY}px)`

      // Update width based on HP percentage
      const hpPercent = enemy.hp / enemy.maxHp
      fg.setAttribute('width', `${24 * hpPercent}`)
      fg.setAttribute('fill', hpPercent > 0.5 ? '#00ff00' : hpPercent > 0.25 ? '#ffff00' : '#ff0000')

      // Sync hit flash for this enemy
      if (flashIndex < this.hitFlashPool.length) {
        const flash = this.hitFlashPool[flashIndex]
        const flashRemaining = enemy.hitAnimTime ? 150 - (performance.now() - enemy.hitAnimTime) : 0
        if (flashRemaining > 0) {
          flash.style.visibility = 'visible'
          flash.style.transform = `translate(${enemy.x}px, ${enemy.y}px)`
          flash.style.opacity = String(flashRemaining / 150)
        } else {
          flash.style.visibility = 'hidden'
        }
        flashIndex++
      }
    }

    // Hide unused bars
    for (let i = barIndex; i < this.hpBarPool.length; i++) {
      this.hpBarPool[i].style.visibility = 'hidden'
    }
    // Hide unused hit flash circles
    for (let i = flashIndex; i < this.hitFlashPool.length; i++) {
      this.hitFlashPool[i].style.visibility = 'hidden'
    }

    // Sync shield bars and boss text similarly...
  }
}
```

---

### 4. Generating Defs and Static Layers

The `useSvgStaticContent` composable builds string content for `<defs>` and the static grid layer. Defs are split into **static** (symbols, filters — identical across all maps) and **map-specific** (gradients).

```typescript
// useSvgStaticContent.ts
import { computed, shallowRef, ComputedRef, ShallowRef } from 'vue'
import { ENEMY_TYPES, TOWER_META } from '@/game/Constants'
import type { GeneratedMap } from '@/grid/Map'
import type { Tower } from '@/towers/Tower'
import type { Enemy } from '@/enemies/Enemy'
import type { Grid } from '@/grid/Grid'

// Helper functions ported from Shapes.ts and Renderer.ts
// These are pure functions that return SVG strings, replacing the canvas drawing logic.

/**
 * Ported from Shapes.ts drawTile().
 * Returns SVG string for a single tile.
 */
function getTileSvg(tile: { type: 'terrain' | 'path' | 'base' | 'spawn'; height: number }, x: number, y: number, isBlocked: boolean): string {
  // Color logic ported from Shapes.ts drawTile() — extract fill/stroke computation for SVG
  const fill = /* derived from tile.type and region */ '#0a0d12'
  const stroke = /* derived from tile.type and region */ '#1a1d22'
  let svg = `
    <g transform="translate(${x}, ${y})">
      <rect width="36" height="36" fill="${fill}" />
      <rect width="36" height="36" fill="none" stroke="${stroke}" stroke-width="1" />
  `
  // Blocked tiles get a cross-hatch (was canvas drawTile cross-hatch)
  if (isBlocked) {
    svg += `<path d="M6 6 L30 30 M30 6 L6 30" stroke="rgba(255,255,255,0.2)" stroke-width="1" />`
  }
  // Height numbers
  if (tile.height !== undefined) {
    svg += `<text x="18" y="18" font-size="8" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.3)">${tile.height}</text>`
  }
  svg += `</g>`
  return svg
}

/**
 * Ported from Shapes.ts drawBase().
 * Returns SVG string for the base structure.
 */
function renderBaseStructure(base: { x: number; y: number }): string {
  // Convert canvas arcTo rounded corners to SVG path with A commands
  // Or use <rect rx="..." ry="..."> if the visual difference is acceptable
  const x = base.x * 36
  const y = base.y * 36
  const w = 2.7 * 36
  const h = 2.7 * 36
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${w}" height="${h}" rx="8" ry="8" fill="url(#base-grad)" />
      <circle cx="${w/2}" cy="${h/2}" r="10" fill="#5a8ec4" />
      <!-- Gems, hexagons, etc. ported from Shapes.ts -->
    </g>
  `
}

/**
 * Builds <symbol> definitions from inline SVG sprite strings defined in Constants.ts.
 * No external SVG files are needed — all sprites are inline strings in ENEMY_TYPES and TOWER_META.
 * 
 * Sprite naming convention matches actual type IDs from Constants.ts:
 *   Enemies: enemy-minion, enemy-runner, enemy-tank, enemy-shielded, enemy-healer, enemy-boss
 *   Towers:  tower-basic, tower-ice, tower-sniper, tower-cannon, tower-lightning, tower-railgun
 * 
 * Each sprite config in Constants.ts includes:
 *   - svg: string (the raw SVG content)
 *   - animation: { frames: number, duration: number } | null
 *   - viewBox: string (e.g., "-1 -1 2 2" for enemies, "-16 -16 32 32" for towers)
 */
function buildSymbolsFromConstants(): string {
  let symbols = ''

  // Build enemy symbols from ENEMY_TYPES in Constants.ts
  for (const [typeId, enemyConfig] of Object.entries(ENEMY_TYPES)) {
    const spriteConfig = enemyConfig.sprite
    if (!spriteConfig || !spriteConfig.svg) continue
    
    const numFrames = spriteConfig.animation?.frames ?? 1
    const viewBox = spriteConfig.viewBox || '-1 -1 2 2'
    
    for (let frame = 0; frame < numFrames; frame++) {
      // If the sprite config has per-frame SVG strings, use them.
      // Otherwise, all frames share the same SVG string (idle sprite).
      const frameSvg = spriteConfig.svg
      symbols += `
        <symbol id="enemy-${typeId}-f${frame}" viewBox="${viewBox}">
          ${frameSvg}
        </symbol>
      `
    }
  }

  // Build tower symbols from TOWER_META in Constants.ts
  for (const [typeId, towerConfig] of Object.entries(TOWER_META)) {
    const spriteConfig = towerConfig.sprite
    if (!spriteConfig || !spriteConfig.svg) continue
    
    const numFrames = spriteConfig.animation?.frames ?? 1
    const viewBox = spriteConfig.viewBox || '-16 -16 32 32'
    
    for (let frame = 0; frame < numFrames; frame++) {
      const frameSvg = spriteConfig.svg
      symbols += `
        <symbol id="tower-${typeId}-f${frame}" viewBox="${viewBox}">
          ${frameSvg}
        </symbol>
      `
    }
  }

  return symbols
}

export function useSvgStaticContent(currentMap: ComputedRef<GeneratedMap | null>, currentGrid: ComputedRef<Grid | null>) {
  // --- Static Defs Content (symbols, filters) ---
  // Generated ONCE — does not depend on currentMap
  const staticFiltersContent = computed(() => {
    let defs = ''
    
    // Glow Filter (shared)
    defs += `
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    `
    
    // Slow Filters (9 predefined intensity levels)
    for (let i = 1; i <= 9; i++) {
      const intensity = i * 0.1
      defs += `
        <filter id="slow-${i}" x="-50%" y="-50%" width="200%" height="200%">
          <feColorMatrix type="matrix" values="
            ${1 - intensity * 0.3} 0 0 0 0
            0 ${1 - intensity * 0.5} 0 0 0
            0 0 ${1 - intensity * 0.2} 0 0
            0 0 0 1 0
          " />
        </filter>
      `
    }
    
    return defs
  })
  
  // Symbols content — built once from Constants.ts (no async loading needed)
  const staticSymbolsContent = computed(() => buildSymbolsFromConstants())
  
  // Combine filters + symbols
  const staticDefsContent = computed(() => {
    return staticFiltersContent.value + staticSymbolsContent.value
  })
  
  // --- Map-Specific Defs Content (gradients) ---
  // Regenerated per-map
  const mapDefsContent = computed(() => {
    if (!currentMap.value) return ''
    
    return `
      <linearGradient id="base-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a5070" />
        <stop offset="50%" stop-color="#3d4460" />
        <stop offset="100%" stop-color="#353a55" />
      </linearGradient>
    `
  })

  // --- Grid Content ---
  // Grid.blocked is a Set<string> mutated directly (via registerTower / unregisterTower),
  // NOT a reactive ref. Vue's computed won't track Set mutations.
  // 
  // FIX: We use a reactive towerCount signal that increments whenever towers are placed/removed.
  // The Grid class exposes a towerCount property (or we derive it from Grid.blocked.size).
  // The gridContent computed depends on this signal to invalidate when blocked changes.
  //
  // Alternative: Rebuild grid content imperatively via a watcher on grid.blocked.size changes.
  // We use the computed approach with a derived signal for simplicity.
  let gridInvalidationSignal = 0
  const gridBlockCount = computed(() => currentGrid.value?.blocked?.size ?? 0)
  
  const gridContent = computed(() => {
    if (!currentMap.value) return ''
    
    // Depend on gridBlockCount to invalidate when towers are placed/removed
    const _invalidate = gridBlockCount.value
    void _invalidate

    const map = currentMap.value
    let grid = ''
    
    // Background rect
    grid += `<rect x="0" y="0" width="${map.width * 36}" height="${map.height * 36}" fill="#0a0d12" />`
    
    // Tiles — need to check blocked status from Grid
    // Grid.paths is typed as (Point[] | null)[] — each path is directly a Point[]
    // Grid.blocked is a Set<string> of "x,y" keys
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty][tx]
        // Blocked status tracked on Grid class (Set<string> of "x,y" keys)
        const isBlocked = currentGrid.value?.blocked?.has(`${tx},${ty}`) ?? false
        grid += getTileSvg(tile, tx * 36, ty * 36, isBlocked)
      }
    }
    
    // Spawn markers
    for (const spawn of map.spawns) {
      grid += `<rect x="${spawn.x * 36 + 4}" y="${spawn.y * 36 + 4}" width="28" height="28" fill="rgba(255,50,50,0.5)" />`
    }
    
    // Base structure
    if (map.base) {
      grid += renderBaseStructure(map.base)
    }
    
    // Path highlights — Grid.paths is (Point[] | null)[], not objects with .tiles
    const gridInstance = currentGrid.value
    for (const path of gridInstance?.paths ?? []) {
      if (!path) continue
      const points = path.map(t => `${t.x * 36 + 18},${t.y * 36 + 18}`).join(' ')
      grid += `<polyline points="${points}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="20" />`
    }
    
    return grid
  })

  return { staticDefsContent, mapDefsContent, gridContent }
}

**Notes on `GeneratedMap` and `Tile` types:**
- `GeneratedMap` has `width`, `height`, `tiles`, `spawns`, `base` — no `bounds` property. Use `map.width * 36` and `map.height * 36` for pixel dimensions.
- `Tile` type is `{ type, height }` — no `blocked` property. The blocked set lives on the `Grid` class as `Set<string>` with `"x,y"` keys. There is no `isBlocked` method on GeneratedMap; the composable would need access to the `Grid` instance to check `Grid.blocked.has(`${tx},${ty}`)`.
- `tiles` is `Tile[][]` (2D array), not a flat array.

---

### 5. Camera Utilities

```typescript
// src/render/svg/cameraUtils.ts

/**
 * New utility function inspired by Renderer.ts fitToGrid() logic, with simplified return signature for SVG camera management.
 * Calculates camera transform to fit the map within the viewport.
 */
export function fitToGrid(
  mapWidth: number,
  mapHeight: number,
  viewWidth: number,
  viewHeight: number
): { x: number; y: number; zoom: number } {
  const scaleX = viewWidth / mapWidth
  const scaleY = viewHeight / mapHeight
  const zoom = Math.min(scaleX, scaleY) * 0.9 // 90% to add padding
  
  const x = (viewWidth - mapWidth * zoom) / 2
  const y = (viewHeight - mapHeight * zoom) / 2
  
  return { x, y, zoom }
}
```

---

### 6. Migrating Canvas Features

#### Glow Effects (`shadowBlur`)
**Approach:** Define a single `<filter id="glow">` in `<defs>`. Apply it via `filter="url(#glow)"` on the specific effect element (e.g., the stun aura `<path>` or lightning `<path>`).
- *Performance Note:* Do not apply filters to parent `<g>` layers containing hundreds of elements. Apply them only to the specific transient effect element.

#### Dynamic Paths (Lightning, Stun Auras)
**Approach:** Pre-allocate a small pool of `<path>` elements in the effect layer. When lightning fires, grab an inactive path, compute the zigzag geometry, and set the `d` attribute.

```typescript
// In EffectManager
spawnLightning(segments: number[][]) {
  const pathEl = this.getInactivePath()
  if (!pathEl) return

  // vertsToPathD is imported from EnemyWalk.ts — it already exists and works for SVG
  pathEl.setAttribute('d', vertsToPathD(segments))
  pathEl.setAttribute('stroke', '#87ceeb')
  pathEl.setAttribute('stroke-width', '3')
  pathEl.setAttribute('fill', 'none')
  pathEl.setAttribute('filter', 'url(#glow)')
  pathEl.style.opacity = '1'
  pathEl.style.visibility = 'visible'

  this.activeLightning.push({ el: pathEl, life: 200, maxLife: 200 })
}

// In syncFromGameEngine:
for (const lightning of this.activeLightning) {
  lightning.life -= dt
  lightning.el.style.opacity = String(lightning.life / lightning.maxLife)
  if (lightning.life <= 0) {
    lightning.el.style.visibility = 'hidden'
    this.lightningPool.push(lightning.el)
  }
}
```

**Note:** `vertsToPathD(verts: number[][]): string` already exists in `EnemyWalk.ts` and converts a `number[][]` array to an SVG path-d string. Import and reuse it directly.

#### Slow Filters (Enemy Status Effect)
**Approach:** 9 discrete `<filter id="slow-1">` through `<filter id="slow-9">` definitions in `<defs>`, each with a different `feColorMatrix` intensity. When an enemy is slowed, apply `filter="url(#slow-3)"` to its `<use>` element. Switching the `filter` attribute is cheap.

#### Build Preview & Range Indicators
**Approach:** Dedicated elements in the effect layer, updated based on a local `mouseWorldPos` ref and `gameStore.selectedTowerType`.

```typescript
// In EffectManager.syncFromGameEngine(mousePos, selectedTowerType):
if (selectedTowerType && mousePos) {
  const tileX = Math.floor(mousePos.x / 36) * 36
  const tileY = Math.floor(mousePos.y / 36) * 36
  const isValid = false // placeholder — check Grid.canBuild(tileX / 36, tileY / 36)

  this.buildPreviewEl.style.visibility = 'visible'
  this.buildPreviewEl.style.transform = `translate(${tileX}px, ${tileY}px)`
  this.buildPreviewEl.setAttribute('fill', isValid ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)')

  this.rangeCircleEl.style.visibility = 'visible'
  this.rangeCircleEl.style.transform = `translate(${tileX + 18}px, ${tileY + 18}px)`
  // selectedTowerType is TowerId (string); range requires Tower stats lookup
  this.rangeCircleEl.setAttribute('r', '100') // placeholder — derive from tower type stats
} else {
  this.buildPreviewEl.style.visibility = 'hidden'
  this.rangeCircleEl.style.visibility = 'hidden'
}
```

#### Upgrade Button Rendering

The upgrade button is rendered as SVG elements in the effect layer when a tower is selected. However, **click handling remains centralized** — the button does not get its own `@click` handler.

```typescript
// In EffectManager.syncFromGameEngine():
const selectedTower = gameStore.selectedTower
if (selectedTower) {
  // Render upgrade button as <rect> + <text> + <circle> (ripple)
  this.upgradeButtonBg.style.visibility = 'visible'
  this.upgradeButtonBg.style.transform = `translate(${selectedTower.x + 20}px, ${selectedTower.y - 30}px)`
  
  this.upgradeButtonText.style.visibility = 'visible'
  this.upgradeButtonText.style.transform = `translate(${selectedTower.x + 28}px, ${selectedTower.y - 22}px)`
  this.upgradeButtonText.textContent = '^'
  
  // NOTE: No @click handler on these elements.
  // Click routing is handled by gameEngine.handleClick(worldX, worldY),
  // which checks if the click coordinates fall within the upgrade button's
  // hit area (same logic as current canvas approach, just using world coords).
}
```

The `GameEngine.handleClick()` method checks:
1. Is a tower selected? If yes, does the click fall within the upgrade button hit area? → Trigger upgrade.
2. Does the click fall on an existing tower? → Select that tower.
3. Is a tower type selected for building? Does the click fall on a valid build tile? → Place tower.

All of this uses world coordinates — no change to the routing logic, just the coordinate system.

#### Coordinate Conversion
**Critical:** Always use the CTM approach on `worldLayer`, not `svgRoot`. Both `handleClick()` and `setHover()` accept world coordinates.

```typescript
// CORRECT — uses worldLayer.getScreenCTM() which includes camera transform
const pt = svgRoot.value.createSVGPoint()
pt.x = e.clientX
pt.y = e.clientY
const ctm = worldLayer.value.getScreenCTM().inverse()
const worldPos = pt.matrixTransform(ctm)

// INCORRECT — svgRoot.getScreenCTM() only includes viewBox, NOT camera
// const ctm = svgRoot.value.getScreenCTM().inverse() // WRONG!
```

---

### 7. Pool Management Strategy

To avoid GC spikes and DOM layout thrashing, all dynamic elements use fixed-size pools.

| Element Type | Pool Size | Update Strategy | Layer |
|---|---|---|---|
| Enemies | 100 | `style.transform` (pos), `setAttribute('href', ...)` (anim), `setAttribute('filter', ...)` (slow) | entityLayer |
| Towers | 50 | `setAttribute('href', ...)` (anim), `style.transform` (pos + barrel rotation) | entityLayer |
| Tower Level Pips | 200 | `style.transform` (pos), `setAttribute('fill', ...)` (level color) | entityLayer |
| HP Bars (bg+fg pair) | 100 pairs | `style.transform` (pos), `setAttribute('width', ...)` (hp %) | uiOverlayLayer |
| Shield Bars | 100 pairs | `style.transform` (pos), `setAttribute('width', ...)` (shield %) | uiOverlayLayer |
| Boss HP Text | 10 | `style.transform` (pos), `textContent` (hp number) | uiOverlayLayer |
| Enemy Hit Flash | 100 | `style.transform` (pos), `style.opacity` (flash fade) | uiOverlayLayer |
| Projectiles (circle) | 150 | `style.transform` (pos), `setAttribute('r', ...)` | projectileLayer |
| Projectiles (line) | 50 | `setAttribute('x1/y1/x2/y2', ...)` | projectileLayer |
| Particles | 300 | `style.transform` (pos), `setAttribute('r', ...)`, `style.opacity` | effectLayer |
| Lightning Paths | 20 | `setAttribute('d', ...)`, `style.opacity` | effectLayer |
| Stun Aura Paths | 50 | `setAttribute('d', ...)`, `setAttribute('filter', ...)` | effectLayer |
| Build Preview | 1 (static) | `style.transform`, `setAttribute('fill', ...)` | effectLayer |
| Range Circle | 1 (static) | `style.transform`, `setAttribute('r', ...)` | effectLayer |
| Upgrade Button | 1 (static) | `style.transform`, `textContent` | effectLayer |

**Pool sizes are validated in Phase 1** by checking `WaveManager` max counts against the actual maximum simultaneous enemy and tower counts across all 36 maps. If waves exceed 100 simultaneous enemies, the pool size is increased in `EnemyManager.init()`. The pool allocation happens once in `init()`; runtime cost is zero regardless of pool size (unused elements are `visibility: hidden`).

**Deactivation Rule:** When an element is no longer needed, set `style.visibility = 'hidden'`. Do **not** use `display: none`, as it forces a DOM reflow when toggled back on. `visibility: hidden` simply skips painting and is cheap to toggle.

---

## File Changes Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/SvgGameRoot.vue` | New root component replacing GameCanvas + SpriteLayer. Owns the single SVG element and RAF loop. |
| `src/render/svg/EnemyManager.ts` | Enemy rendering pool adapter. Reads from GameEngine, writes to DOM. |
| `src/render/svg/TowerManager.ts` | Tower rendering pool adapter. |
| `src/render/svg/ProjectileManager.ts` | Projectile rendering pool adapter. |
| `src/render/svg/ParticleManager.ts` | Particle rendering pool adapter. |
| `src/render/svg/EffectManager.ts` | Lightning, stun aura, build preview, range circle, upgrade button rendering. |
| `src/render/svg/UiOverlayManager.ts` | HP bars, shield bars, boss HP text rendering. |
| `src/render/svg/useSvgStaticContent.ts` | Composable that generates `<defs>` and grid layer SVG strings. |
| `src/render/svg/cameraUtils.ts` | `fitToGrid()` function ported from `Renderer.ts`. |
| `src/render/svg/types.ts` | Shared types for render proxies and managers. |

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/GameScreen.vue` | Replace `<GameCanvas>` + `<SpriteLayer>` with `<SvgGameRoot>` |
| `src/game/GameEngine.ts` | **Constructor signature changes from `(canvas, gameStore, persistStore)` to `(gameStore, persistStore)`** — no canvas, no Renderer. Remove canvas render calls (`Renderer.draw()`). Keep `update(dt)` logic. Expose entity arrays for managers to read. **`handleClick()` updated from `(screenX, screenY)` to `(worldX, worldY)`** to match CTM-based coordinate conversion. **`setHover()` also updated to accept world coordinates.** |
| `src/grid/Map.ts` (GeneratedMap type definition) | Ensure `Grid` is accessible from `useSvgStaticContent` for blocked tile checks. |
| `src/render/EnemyWalk.ts` | No change — `vertsToPathD` is reused for lightning/stun path generation. |
| `src/stores/game.ts` | Remove `canvasOffset` tracking and `useCameraSync` import. `camera` ref remains for HUD zoom indicator, but no longer drives CSS transform sync. |

### Files to Delete (Phase 8 Cleanup)

| File | Reason |
|------|--------|
| `src/components/GameCanvas.vue` | Replaced by `SvgGameRoot.vue` |
| `src/components/SpriteLayer.vue` | Replaced by `SvgGameRoot.vue` |
| `src/components/TowerSprite.vue` | Replaced by symbol definitions + `TowerManager` |
| `src/components/EnemySprite.vue` | Replaced by symbol definitions + `EnemyManager` |
| `src/render/Renderer.ts` | Canvas-specific rendering, no longer needed. `fitToGrid()` logic adapted to `cameraUtils.ts` with simplified return signature. |
| `src/render/Shapes.ts` | Canvas shape drawing, replaced by SVG string builders in `useSvgStaticContent`. `drawTile()` → `getTileSvg()`, `drawBase()` → `renderBaseStructure()`. |
| `src/composables/useCameraSync.ts` | Camera sync now handled imperatively in `SvgGameRoot.vue` RAF loop. `canvasOffset` parameter is irrelevant without a canvas. |
| `src/services/CameraService.ts` | **Deleted outright.** Only consumed by `useCameraSync.ts` (also deleted). No other consumers exist. |
| `src/composables/useAnimation.ts` | Per-sprite RAF loops replaced by single RAF loop in `SvgGameRoot.vue` |

---

## Migration Phases

### Phase 1: Foundation & Minimal Symbols
**Goal:** Establish the SVG root, RAF loop, camera transform, and CTM-based input handling. Verify pan/zoom works. Validate pool sizes.

1. Create `SvgGameRoot.vue` with the template structure shown above.
2. Create `src/render/svg/cameraUtils.ts` with `fitToGrid()` ported from `Renderer.ts`.
3. Implement the RAF loop with camera transform only (no entity rendering yet).
4. Implement `onMouseMove` and `onClick` with CTM on `worldLayer` (not `svgRoot`).
5. **Validate pool sizes:** Check `WaveManager` max counts against the actual maximum simultaneous enemy and tower counts across all 36 maps before finalizing pool sizes in `EnemyManager.init()` and `TowerManager.init()`.
6. Create **minimal placeholder symbols** in `<defs>` imperatively (via `buildDefsImperative()`) — a simple `<symbol id="test-square" viewBox="0 0 10 10"><rect width="10" height="10" fill="red" /></symbol>`.
7. Verify: Pan/zoom works, mouse coordinates map correctly to world space, pool sizes are safe.

### Phase 2: Defs & Symbol Generation from Constants.ts
**Goal:** Generate all `<symbol>` definitions from inline SVG strings in `Constants.ts`.

1. Implement `buildSymbolsFromConstants()` in `useSvgStaticContent.ts`.
2. Iterate `ENEMY_TYPES` and `TOWER_META` from `Constants.ts` — each sprite config includes `svg` (raw SVG content), `animation` (frames/duration), and `viewBox`.
3. For each sprite type and frame, generate `<symbol id="enemy-{typeId}-f{frame}" viewBox="{viewBox}">` or `<symbol id="tower-{typeId}-f{frame}" viewBox="{viewBox}">`.
4. Actual type IDs from Constants.ts:
   - Enemies: `minion`, `runner`, `tank`, `shielded`, `healer`, `boss`
   - Towers: `basic`, `ice`, `sniper`, `cannon`, `lightning`, `railgun`
5. Split defs into `staticDefsContent` (symbols, filters — computed once) and `mapDefsContent` (gradients — per-map).
6. Build `<defs>` imperatively via `buildDefsImperative()` in `SvgGameRoot.vue` `onMounted`.
7. Verify: `<defs>` contains all expected symbol IDs. Use browser DevTools to inspect.
8. Test rendering a single `<use href="#enemy-minion-f0" />` manually to verify symbol works.

### Phase 3: Static Grid Layer
**Goal:** Render the grid, base structure, and path highlights via `v-html`.

1. Implement `gridContent` generation in `useSvgStaticContent.ts`.
2. Port `getTileFill()`, `getTileStroke()` from `Shapes.ts` `drawTile()`.
3. Port `renderBaseStructure()` from `Shapes.ts` `drawBase()`.
4. **Fix Grid.blocked reactivity:** `Grid.blocked` is a `Set<string>` mutated directly (via `registerTower()` / `unregisterTower()`), not a reactive ref. Vue's `computed` won't track Set mutations. Add a `gridBlockCount` computed signal (`currentGrid.value?.blocked?.size`) and depend on it in the `gridContent` computed to force invalidation when towers are placed/removed.
5. Ensure `Grid` is accessible from `useSvgStaticContent` for blocked tile checks via `Grid.blocked.has(`${tx},${ty}`)`.
6. Fix path highlight iteration: `Grid.paths` is `(Point[] | null)[]`, so iterate directly with `path.map(t => ...)`, not `path.tiles.map(...)`.
7. Verify: Grid renders correctly on all 36 maps. Visual match with old canvas.
8. Verify: Grid updates when towers are built/sold (path tiles change).

### Phase 4: Entity Managers (Towers & Enemies)
**Goal:** Implement the imperative `<use>` pooling system for towers and enemies.

1. Implement `EnemyManager` and `EnemyRenderProxy` with pool of 100 `<use>` elements + hit flash circles.
2. Implement `TowerManager` and `TowerRenderProxy` with pool of 50 `<use>` elements + 200 pip circles.
3. Implement `syncFromGameEngine()` — read entity arrays from `GameEngine`, update DOM elements.
4. **Compute `currentFrame` in managers:** Neither `Enemy` nor `Tower` has an `animationFrame` property. The `EnemyManager` computes `enemy.currentFrame` from `enemy.hitAnimTime` and the sprite config's `animation.frames`/`duration` from `Constants.ts`. The `TowerManager` computes `tower.currentFrame` from `tower.fireAnimTime` and the tower's `animation` config from `TOWER_META`.
5. **Tower barrel rotation:** `TowerRenderProxy.sync()` applies `rotate()` CSS transform based on `tower.angle` (radians converted to degrees).
6. **Tower level pips:** `TowerManager.syncFromGameEngine()` renders level pips as separate `<circle>` elements below the sprite (silver for levels 2-4, gold for 5+).
7. **Enemy hit flash:** `EnemyRenderProxy.sync()` renders a white `<circle>` overlay via `hitFlashEl` when `enemy.hitAnimTime` is recent (~150ms duration, fading opacity).
8. Verify: Enemies move and animate correctly. Towers animate (idle, attack frames) with barrel rotation.
9. Verify: Pool recycling works (enemies spawn and despawn without memory leaks).

### Phase 5: UI Overlay Layer (HP Bars, Shield Bars, Boss Text)
**Goal:** Render HP bars, shield bars, and boss HP text as separate pooled SVG elements.

1. Implement `UiOverlayManager` with pools for HP bar pairs (bg+fg), shield bar pairs, and boss text.
2. Position bars relative to enemy world coordinates (enemy.x - 12, enemy.y - 16).
3. Update width based on HP/shield percentage.
4. Verify: HP bars track enemies correctly. Shield bars appear when shielded. Boss HP text updates.

### Phase 6: Projectiles & Particles
**Goal:** Implement projectile and particle rendering pools.

1. Implement `ProjectileManager` with pools for `<circle>` (bullets) and `<line>` (beams).
2. Implement `ParticleManager` with pool of 300 `<circle>` elements.
3. Verify: Projectiles render and move correctly. Particles fade and expand.
4. Verify: Pool recycling works under heavy combat.

### Phase 7: Effects & Overlays
**Goal:** Implement lightning, stun auras, build preview, range indicators, upgrade button, and glow filters.

1. Implement `EffectManager` with pools for lightning paths, stun aura paths, build preview rect, range circle, upgrade button elements.
2. Apply `<filter id="glow">` to lightning and stun aura elements.
3. Apply `<filter id="slow-N">` to slowed enemy `<use>` elements.
4. Render upgrade button as SVG `<rect>` + `<text>` elements — **no `@click` handler on the elements**. Click routing stays centralized in `gameEngine.handleClick(worldX, worldY)`.
5. Verify: All visual effects match old canvas rendering. Glow effects work.
6. Verify: Click routing correctly detects upgrade button clicks, tower selection, and build placement.

### Phase 8: Cleanup
**Goal:** Remove all dead code from the old architecture.

1. Remove `GameCanvas.vue`, `SpriteLayer.vue`, `TowerSprite.vue`, `EnemySprite.vue`.
2. Remove `Renderer.ts`, `Shapes.ts`.
3. Remove `useCameraSync.ts`.
4. **Delete `CameraService.ts` outright** — only consumed by `useCameraSync.ts` (also deleted). No other consumers.
5. Remove `useAnimation.ts` (per-sprite RAF loops no longer needed).
6. Remove `canvasOffset` from `gameStore` and all references.
7. Update `GameEngine.ts` constructor to `(gameStore, persistStore)` — remove canvas parameter.
8. **Update `GameEngine.handleClick()` from `(screenX, screenY)` to `(worldX, worldY)`** and **`setHover()` from `(screenX, screenY)` to `(worldX, worldY)`** to match the CTM-based coordinate conversion in `SvgGameRoot.vue`.
9. Run full integration test suite. Verify all 36 maps, all tower types, all enemy types render correctly.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| SVG performance worse than canvas | Profile early in Phase 4. If SVG is too slow, check for: (a) Vue reactivity leaking into hot path, (b) filters applied to too many elements, (c) `display: none` instead of `visibility: hidden` causing reflows. |
| CTM coordinate conversion breaks under nested SVG | Use `worldLayer.getScreenCTM()`, not `svgRoot.getScreenCTM()`. Test with extreme zoom levels early in Phase 1. |
| Symbol viewBox mismatch causes sprite offset | Enemy symbols use `viewBox="-1 -1 2 2"`, tower symbols use `viewBox="-16 -16 32 32"`. Both are centered at origin, so `translate(x, y)` places the center at world `(x, y)`. Enemy sprites are scaled at render time by `enemy.meta.radius * 2 * tileSize`. |
| Pool exhaustion during heavy waves | **Validated in Phase 1** against `WaveManager` max counts across all 36 maps. If waves exceed 100 enemies, increase pool size in `EnemyManager.init()`. |
| `v-html` on `<defs>` causes Vue template compiler issues | **Avoided entirely.** `<defs>` is built imperatively in `onMounted` via `buildDefsImperative()` which sets `innerHTML` on the `<defs>` element directly. |
| Grid string recomputation on every reactive trigger | `useSvgStaticContent` splits into `staticDefsContent` (symbols, filters — computed once, no map dependency) and `mapDefsContent` (gradients — per-map). Grid string depends on `currentMap` only. |
| Grid.blocked not reactive causes grid layer to not update | `Grid.blocked` is a `Set<string>` mutated directly, not a reactive ref. Fixed by adding `gridBlockCount = computed(() => currentGrid.value?.blocked?.size)` and depending on it in the `gridContent` computed, forcing invalidation when towers are placed/removed. |
| No `animationFrame` property on Enemy or Tower | Frame index is computed in each manager from timing state (`hitAnimTime` for enemies, `fireAnimTime` for towers) and the sprite config's `animation` field from `Constants.ts`. Formula: `Math.floor((elapsed % duration) / (duration / numFrames))`. |
| Sprite naming doesn't match actual type IDs | Symbols are generated from `ENEMY_TYPES` and `TOWER_META` in `Constants.ts` using actual type IDs: `minion`, `runner`, `tank`, `shielded`, `healer`, `boss`, `basic`, `ice`, `sniper`, `cannon`, `lightning`, `railgun`. No hardcoded placeholder names. |
| Upgrade button click routing breaks | Keep click handling centralized in `gameEngine.handleClick(worldX, worldY)`. Do not add `@click` to SVG elements. Engine checks upgrade button hit area using world coordinates, same logic as current canvas approach. |
| `GeneratedMap` has no `bounds` property | Use `map.width * 36` and `map.height * 36` directly for pixel dimensions. |
| `Tile` has no `blocked` property | Blocked set lives on `Grid.blocked` as `Set<string>` with `"x,y"` keys; composable needs Grid instance to check. |
| `Grid.paths` is `(Point[] | null)[]`, not objects with `.tiles` | Iterate paths directly: `path.map(t => ...)` instead of `path.tiles.map(...)`. |
| Tower barrel rotation not tracked | `TowerRenderProxy.sync()` applies CSS `rotate()` each frame based on `tower.angle` (radians to degrees conversion). |
| Tower level pips missing | `TowerManager.syncFromGameEngine()` renders level pips as separate `<circle>` elements below the sprite using a dedicated pip pool. |
| Enemy hit flash missing | `EnemyRenderProxy.sync()` renders a white `<circle>` overlay via `hitFlashEl` when `enemy.hitAnimTime` is recent. |
