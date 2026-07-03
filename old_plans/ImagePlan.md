# Image Plan: Inline SVG DOM Overlay with Vue-Driven Animation

## Overview

Replace Canvas 2D vector drawing for towers and enemies with **inline SVG elements in the DOM**, positioned as an overlay above the canvas. Vue reactivity drives per-frame animation updates: a `requestAnimationFrame` loop updates reactive `ref` values, and Vue efficiently patches only the changed SVG path attributes in the DOM. The browser's native SVG renderer handles anti-aliasing — no rasterization to bitmaps.

Tiles remain canvas-drawn (static fill patterns, no per-frame animation). The base remains canvas-drawn (`drawBase()`).

**Two rendering layers:**
- **Canvas** (bottom): grid, tiles, paths, projectiles, particles, HUD, build preview, highlights
- **DOM overlay** (top): towers, enemies — inline `<svg>` elements with reactive `<path>` data

Both layers are synchronized via a shared camera transform (zoom + pan).

---

## Architecture: Vue Reactivity + RAF Animation

### How it works

```
┌─────────────────────────────────────────┐
│  GameScreen.vue (template)              │
│                                         │
│  <canvas>  │  <div class="sprite-layer">│
│            │    <TowerSprite v-for>     │
│  (canvas)  │    <EnemySprite v-for>     │
│            │  </div>                    │
└─────────────────────────────────────────┘
```

1. **`GameScreen.vue`** renders the `<canvas>` and a sibling `<div class="sprite-layer">` for towers/enemies
2. The sprite layer uses `v-for` to render `<TowerSprite>` and `<EnemySprite>` Vue components
3. Each sprite component uses a **`useAnimation` composable** to drive its SVG path data
4. The composable runs a `requestAnimationFrame` loop in `onMounted`, updating reactive `ref` values each frame
5. Vue's reactivity system efficiently updates only the `<path :d="pathData">` attribute in the DOM — not the entire component
6. A **`useCameraSync` composable** applies matching CSS `transform: scale() translate()` to the sprite layer wrapper, keeping it aligned with the canvas camera

### Why Vue refs for animation

- Vue refs trigger targeted DOM updates — only the bound `<path d="...">` attribute is patched, not the full component tree
- `requestAnimationFrame` updates refs at the display refresh rate (60-144Hz), giving smooth animation
- Vue batches DOM mutations within the same tick, so even with many enemies the cost is minimal
- No manual DOM manipulation — Vue owns the SVG elements, handles mount/unmount with enemy lifecycle

---

## 1. Tower Sprites (Inline SVG + Rotation)

### Current drawing (`Shapes.js:323-427`)

Each tower is drawn as line-art with a barrel pointing in the `angle` direction, an icon character at center, and level pips at the bottom. The only animation is rotation via `ctx.rotate(angle)`.

### SVG approach

- Each tower is rendered as an **inline `<svg>` DOM element** inside a `<TowerSprite>` Vue component
- The SVG body shape is defined as reference images in the tower config — either **inline SVG text** or a **filename** pointing to an SVG file
- The barrel is rotated via CSS `transform: rotate(angle)` on a `<g>` group inside the SVG
- Tower color applied via CSS `stroke`/`fill` bound to the tower's `meta.color`
- Level pips rendered as small `<circle>` elements at the bottom

### Rotation

Rotation is applied via CSS `transform: rotate(${angle}rad)` on the barrel group `<g>` inside the SVG. This is cheaper than regenerating path data each frame and works naturally with Vue's reactive bindings.

### Configuration: animation reference images

Each tower's configuration in `Constants.js` (`TOWER_META`) gains an optional `animation` field. Each reference image is defined as **either inline SVG text or a filename**:

```js
// In Constants.js TOWER_META, add:
basic: {
  name: "Rifle Tower", cost: 20, color: "#8fbc8f", icon: "─",
  animation: {
    referenceImages: [
      { name: "idle",   svg: "<svg viewBox='-12 -12 24 24'><path d='M 0,-8 A 8 8 0 1 0 0 8 ...' .../></svg>", duration: 1.0 },
      { name: "firing", file: "assets/towers/basic_firing.svg", duration: 0.3 },
    ],
    default: "idle",
  },
},
```

- Each reference image has **either** `svg` (inline SVG text string) **or** `file` (path relative to `public/`)
- `svg`: inline SVG text, parsed immediately at config load time
- `file`: path to an SVG file, loaded once at startup via `fetch()` and cached
- `referenceImages`: arbitrary array of key-frame SVGs, each with a `name` and `duration` (seconds for the full animation loop)
- `default`: which animation plays by default
- When the tower fires, switch to the "firing" animation; when cooldown expires, switch back to "idle"
- The `useAnimation` composable extracts path data from each SVG and interpolates between them

### SVG text format for reference images

Inline SVG text should contain `<path>` elements with `d` attributes using the same vertex topology as the base shape. Example:

```xml
<svg viewBox="-12 -12 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M 0,-8 A 8 8 0 1 0 0 8 A 8 8 0 1 0 0,-8 Z"
        stroke="#8fbc8f" stroke-width="2" fill="none"/>
  <line x1="8" y1="0" x2="16" y2="0" stroke="#8fbc8f" stroke-width="2"/>
</svg>
```

The composable extracts the `d` attribute from each `<path>` element and interpolates the path data between key frames.

### Implementation steps

1. Create `src/components/TowerSprite.vue`:
   - Receives tower data as props
   - Uses `useAnimation` composable for animation state
   - Renders inline `<svg>` with `<path>` elements
   - CSS `transform: rotate(angle)` on barrel group
   - Reactive `pathData` ref updated each RAF frame
2. Create `src/composables/useAnimation.js`:
   - Takes `referenceImages`, `default` animation name, and `isActive` flag
   - Resolves each reference image: inline `svg` text or loaded `file` content
   - RAF loop in `onMounted` updates current animation phase
   - Exposes reactive `pathData`, `currentAnimation`, `blend` refs
   - Handles animation transitions (crossfade between reference images)
3. Create `src/composables/useCameraSync.js`:
   - Watches renderer camera state from game store
   - Applies matching CSS transform to sprite layer wrapper
4. Replace `drawTower()` in `Shapes.js` — towers no longer drawn on canvas
5. Remove tower drawing from `Renderer.drawTowers()` — towers rendered by Vue components instead

### File list

```
src/components/TowerSprite.vue
src/composables/useAnimation.js
src/composables/useCameraSync.js
```

Shapes defined as inline SVG text in config or as SVG files in `assets/towers/`.

---

## 2. Tile Decoration (Canvas — Unchanged)

Tiles are static (no per-frame animation). They remain drawn on canvas with solid fills, cross-hatch patterns, and height numbers via `drawTile()` in `Shapes.js`. No changes to tile rendering in this plan.

The base (`drawBase()`) also remains canvas-drawn — it's a unique oversized element, not a repeating tile.

---

## 3. Enemy Sprites (Inline SVG + Vertex Interpolation + Walking Animation)

### Current drawing (`Shapes.js:176-321`)

Enemies are drawn as filled shapes (circle, triangle, square, hexagon, cross, star) with:
- Color from `ENEMY_TYPES` meta
- Bobbing motion: `Math.sin(t * 8 + enemy.id) * 1.5` (vertical offset)
- Status overlays: stun glow, slow frost, shield ring
- Health bar, shield bar, boss HP text (drawn separately, not part of the sprite)

### Vertex interpolation between key frames

Each enemy shape in `Shapes.js` is already a list of vertices in a fixed order:

| Shape | Vertices | Current path construction |
|-------|----------|--------------------------|
| circle | parametric | `ctx.arc(0, 0, r, 0, 2π)` → convert to N-point polyline |
| triangle | 3 | `M 0,-r → L r·0.866,r·0.5 → L -r·0.866,r·0.5 → Z` |
| square | 4 | `rect(-r, -r, 2r, 2r)` → 4 corner vertices |
| hexagon | 6 | 6 points at `cos(n·π/3)·r, sin(n·π/3)·r` |
| cross | 8 | 2 rects = 8 corner vertices |
| star | 10 | 5 outer + 5 inner alternating radii |

If two key frames have the same topology (same vertex count, same command sequence), **interpolate each `(x, y)` pair linearly**: `p(t) = p0·(1-t) + p1·t`. The browser's SVG renderer draws the interpolated path as fresh vector geometry each frame — no rasterization.

For the **circle**, convert `ctx.arc()` to a 32-point polyline:
```
M r,0 → L r·cos(π/16), r·sin(π/16) → L r·cos(2π/16), r·sin(2π/16) → ... → Z
```
This gives it the same vertex-based topology as the other shapes.

### The `useAnimation` composable

```js
// src/composables/useAnimation.js

import { ref, onMounted, onUnmounted } from 'vue'
import { loadSvgContent } from '../services/SvgLoader.js'

export function useAnimation(config) {
  // config: {
  //   referenceImages: [                  // animation key frames
  //     { name: 'frame0', svg: '<svg>...</svg>', duration: 0.13 },
  //     { name: 'frame1', file: 'assets/enemies/minion_f1.svg', duration: 0.13 },
  //   ],
  //   duration: 0.91,                     // total seconds for full loop
  //   color: '#e85a6a',
  // }

  // Resolve all reference images to inline SVG text
  const resolvedImages = config.referenceImages.map(async (img) => {
    const svgText = img.svg || await loadSvgContent(img.file)
    return { ...img, svgText }
  })

  const pathData = ref('')
  const currentAnimation = ref(config.referenceImages[0]?.name)
  const blend = ref(0)
  const isActive = ref(true)
  const imagesReady = ref(false)

  let rafId = null
  let lastTime = performance.now()
  let animStartTime = performance.now()
  let resolvedCache = []

  async function init() {
    resolvedCache = await Promise.all(resolvedImages)
    imagesReady.value = true
    pathData.value = extractPathD(resolvedCache[0].svgText)
  }

  function tick() {
    const now = performance.now()
    const dt = (now - lastTime) / 1000
    lastTime = now

    if (!isActive.value || !imagesReady.value) {
      rafId = requestAnimationFrame(tick)
      return
    }

    const elapsed = (now - animStartTime) / 1000
    const loopedTime = elapsed % config.duration
    const t = loopedTime / config.duration // 0..1 through the loop

    // Find two adjacent reference images within the loop
    const idx = Math.floor(t * resolvedCache.length)
    const nextIdx = (idx + 1) % resolvedCache.length
    const frameBlend = t * resolvedCache.length - idx // 0..1

    // Extract and interpolate path data between the two key frames
    const d0 = extractPathD(resolvedCache[idx].svgText)
    const d1 = extractPathD(resolvedCache[nextIdx].svgText)
    const interpolated = interpolatePathD(d0, d1, frameBlend)

    pathData.value = interpolated
    blend.value = frameBlend

    rafId = requestAnimationFrame(tick)
  }

  onMounted(async () => {
    await init()
    rafId = requestAnimationFrame(tick)
  })

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId)
  })

  function play(name) {
    currentAnimation.value = name
    animStartTime = performance.now()
  }

  function stop() { isActive.value = false }
  function restart() { isActive.value = true; animStartTime = performance.now() }

  return { pathData, currentAnimation, blend, imagesReady, play, stop, restart }
}

// Extract the primary <path d="..."> from SVG text
function extractPathD(svgText) {
  const match = svgText.match(/<path[^>]*\sd=["']([^"']*)["']/i)
  return match ? match[1] : ''
}

// Interpolate path data: parse numeric commands, lerp coordinates, rebuild string
function interpolatePathD(d0, d1, t) {
  const coords0 = extractCoordinates(d0)
  const coords1 = extractCoordinates(d1)
  if (coords0.length !== coords1.length) return d0 // fallback to first frame

  const interpolated = coords0.map(([x0, y0], i) => {
    const [x1, y1] = coords1[i]
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
  })

  return rebuildPathD(d0, interpolated)
}

// Parse all numeric values from a path d-string (preserves command structure)
function extractCoordinates(d) {
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) || []
  return Array.from({ length: nums.length / 2 }, (_, i) => [nums[i * 2], nums[i * 2 + 1]])
}

// Rebuild path d-string with interpolated coordinates, preserving commands
function rebuildPathD(template, coords) {
  const parts = template.split(/(\s)/).filter(Boolean)
  let coordIdx = 0
  return parts.map((part) => {
    if (/^-?\d+\.?\d*$/.test(part) && coordIdx < coords.length) {
      const [x, y] = coords[coordIdx++]
      return `${x},${y}`
    }
    return part
  }).join('')
}
```

- `loadSvgContent(file)` fetches the SVG text from `public/<file>` and caches it (see SvgLoader below)
- `extractPathD` pulls the `d` attribute from the first `<path>` element in the SVG
- `interpolatePathD` parses numeric coordinates from both path strings, linearly interpolates each `(x,y)` pair, and rebuilds the path string preserving the original command structure (`M`, `L`, `A`, `Z`, etc.)
- If the two paths have different coordinate counts, falls back to the first frame (topology mismatch)

### Enemy configuration: walking animation

Each enemy type's definition in `Constants.js` (`ENEMY_TYPES`) gains a `walking` animation config with an arbitrary number of reference images. Each reference image is **either inline SVG text or a filename**:

```js
// In Constants.js ENEMY_TYPES, add walking animation:
minion: {
  name: "Minion", baseHp: 8, speed: 1.0, bounty: 2,
  color: "#e85a6a", radius: 0.35, shape: "circle",
  walking: {
    referenceImages: [
      { name: "frame0", svg: "<svg viewBox='-8 -8 16 16' xmlns='http://www.w3.org/2000/svg'><path d='M 0,-1.5 A 3.5 3.5 0 1 0 0 1.5 A 3.5 3.5 0 1 0 0,-1.5 Z' fill='#e85a6a' stroke='rgba(0,0,0,0.5)' stroke-width='1.5'/></svg>", duration: 0.13 },
      { name: "frame1", svg: "<svg viewBox='-8 -8 16 16' xmlns='http://www.w3.org/2000/svg'><path d='M 0,-1.0 A 3.5 3.5 0 1 0 0 1.0 A 3.5 3.5 0 1 0 0,-1.0 Z' fill='#e85a6a' stroke='rgba(0,0,0,0.5)' stroke-width='1.5'/></svg>", duration: 0.13 },
      { name: "frame2", svg: "<svg viewBox='-8 -8 16 16' xmlns='http://www.w3.org/2000/svg'><path d='M 0,0 A 3.5 3.5 0 1 0 0 0 A 3.5 3.5 0 1 0 0,0 Z' fill='#e85a6a' stroke='rgba(0,0,0,0.5)' stroke-width='1.5'/></svg>", duration: 0.13 },
      // ... more frames ...
      { name: "frame7", svg: "<svg viewBox='-8 -8 16 16' xmlns='http://www.w3.org/2000/svg'><path d='M 0,1.5 A 3.5 3.5 0 1 0 0,-1.5 A 3.5 3.5 0 1 0 0,1.5 Z' fill='#e85a6a' stroke='rgba(0,0,0,0.5)' stroke-width='1.5'/></svg>", duration: 0.13 },
    ],
    duration: 0.91, // total seconds for full loop (sum of frame durations)
    default: true, // plays automatically on spawn
  },
},
```

- `referenceImages`: **arbitrary number** of key-frame SVGs. Each has **either** `svg` (inline SVG text) **or** `file` (path relative to `public/`), plus `name` and `duration` (seconds that frame holds before transitioning).
- `duration`: **total seconds** the full animation loop runs over. The composable loops within this duration.
- The number of reference images determines smoothness: 4 frames feels steppy, 8 is smooth, 16+ is overkill for simple bobs but useful for complex motions.
- The composable extracts the `<path d="...">` from each SVG and interpolates the numeric coordinates between adjacent frames, producing smooth vector animation at the display refresh rate.

**Mixing inline and file-based references is allowed** — some frames can be inline SVG text (for simple shapes derived from current `Shapes.js` code) and others can be `file` paths (for artist-created SVG assets). The composable handles both transparently.

### Per-enemy animation design

| Enemy | Shape | Vertices | Suggested walking animation | Ref images | Duration |
|-------|-------|----------|----------------------------|------------|----------|
| minion | circle (32-pt polyline) | 32 | Bob: Y oscillation | 8 | 0.785s |
| runner | triangle | 3 | Quick bob + forward lean | 8 | 0.5s |
| tank | square | 4 | Slow heavy bob (larger amplitude) | 8 | 1.2s |
| shielded | hexagon | 6 | Hover pulse (scale oscillation) | 8 | 1.0s |
| healer | cross | 8 | Gentle sway (rotation) | 8 | 1.0s |
| boss | star | 10 | Prominent bob + slow rotation | 8 | 1.5s |

Different enemy types can have different durations and different numbers of reference images. The composable handles any count.

### Status effects and overlays

Status effects (stun glow, slow frost, shield ring), health bar, shield bar, and boss HP text remain **canvas-drawn overlays** drawn after the sprite layer. The SVG sprite provides the base shape + walking animation; everything else is rendered on canvas on top.

### Enemy Vue component

```vue
<!-- src/components/EnemySprite.vue -->
<template>
  <svg
    class="enemy-sprite"
    :style="layerStyle"
    :viewBox="viewBox"
  >
    <path
      :d="pathData"
      :fill="color"
      stroke="rgba(0,0,0,0.5)"
      stroke-width="1.5"
    />
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { useAnimation } from '../composables/useAnimation.js'
import { getEnemyWalkingConfig, buildBaseVertices } from '../game/EnemyWalk.js'

const props = defineProps({
  enemy: { type: Object, required: true },
  worldPos: { type: Object, required: true }, // { x, y } in world pixels
})

const scale = computed(() => props.enemy.radius * 2) // size multiplier
const viewBox = computed(() => {
  const s = scale.value
  return `${-s} ${-s} ${s * 2} ${s * 2}`
})

const config = computed(() => ({
  vertices: buildBaseVertices(props.enemy.shape, scale.value),
  referenceImages: props.enemy.walking.referenceImages,
  duration: props.enemy.walking.duration,
  color: props.enemy.color,
}))

const { pathData } = useAnimation(config)

const layerStyle = computed(() => ({
  transform: `translate(${props.worldPos.x}px, ${props.worldPos.y}px)`,
  width: `${scale.value * 2}px`,
  height: `${scale.value * 2}px`,
}))
</script>
```

### Implementation steps

1. Create `src/services/SvgLoader.js`:
   - `loadSvgContent(file)` — fetches SVG text from `public/<file>`, caches in a `Map`, returns the text
   - Called by `useAnimation` to resolve `file` reference images at component mount time
2. Create `src/composables/useAnimation.js` (animation composable above)
3. Create `src/composables/useCameraSync.js` (camera sync composable)
4. Create `src/components/EnemySprite.vue`:
   - Renders inline `<svg>` with `<path :d="pathData">`
   - Uses `useAnimation` composable
   - Positioned via CSS `transform: translate()`
5. Add `walking` config to each enemy type in `Constants.js` (`ENEMY_TYPES`)
   - Use inline `svg` text for frames derived from current `Shapes.js` shapes
   - Use `file` paths for artist-created SVG assets
6. Create `src/components/TowerSprite.vue` (similar pattern)
7. Create `src/components/SpriteLayer.vue`:
   - Parent component that renders all `<EnemySprite>` and `<TowerSprite>` components
   - Uses `useCameraSync` to align with canvas camera
   - Mounted alongside the canvas in `GameScreen.vue`
8. Remove tower/enemy drawing from `Renderer.js` and `Shapes.js`
9. Status overlays, health bars, shield bars remain in `Shapes.js` canvas drawing

### File list

```
src/services/SvgLoader.js
src/composables/useAnimation.js
src/composables/useCameraSync.js
src/components/EnemySprite.vue
src/components/TowerSprite.vue
src/components/SpriteLayer.vue
```

Shapes defined as inline SVG text in config or as SVG files in `assets/`.

---

## 4. Shared Infrastructure

### SVG Loader (`src/services/SvgLoader.js`)

Handles loading SVG content from files. Inline SVG text in config requires no loading.

```js
// src/services/SvgLoader.js

const cache = new Map()

export async function loadSvgContent(file) {
  if (cache.has(file)) return cache.get(file)
  const response = await fetch(`/${file}`)
  const text = await response.text()
  cache.set(file, text)
  return text
}

export function clearCache() { cache.clear() }
```

- `file` paths are relative to `public/` (Vite convention)
- Cached after first load — subsequent calls are O(1)
- Called by `useAnimation` in `onMounted` to resolve `file` reference images
- Inline `svg` text in config bypasses loading entirely

### Camera synchronization

The canvas and DOM overlay must stay aligned as the user zooms/panns. A shared camera service provides the transform to both:

```js
// src/services/CameraService.js
import { ref } from 'vue'

export const cameraTransform = ref({ x: 0, y: 0, zoom: 1 })

export function updateCamera(x, y, zoom) {
  cameraTransform.value = { x, y, zoom }
}

export function getCameraCSS() {
  const { x, y, zoom } = cameraTransform.value
  return `translate(${x}px, ${y}px) scale(${zoom})`
}
```

- Canvas applies transform via `ctx.translate(camera.x, camera.y)` + `ctx.scale(camera.zoom, camera.zoom)`
- Sprite layer wrapper applies matching CSS: `transform: getCameraCSS()`
- Both update whenever the camera changes (map load, resize, drag)

### Why inline SVG instead of `ctx.drawImage()` with SVG data URLs

| Approach | Vector? | DOM cost | Pipeline |
|----------|---------|----------|----------|
| Rasterized SVG via `Image` (old plan) | No — bitmap per frame | Low | Single canvas |
| Dynamic SVG data URL → `ctx.drawImage()` | Source is vector, rendered as bitmap | Low | Single canvas |
| **Inline SVG DOM overlay** | **Yes — native vector each frame** | **Moderate** | **Two layers** |

Inline SVG keeps the vector rendering benefit: the browser's SVG renderer handles anti-aliasing, gradients, and filters natively, and path data is regenerated as fresh vector geometry each frame via coordinate interpolation. The DOM cost is acceptable because:
- Vue batches DOM updates within each RAF tick
- Only `<path d="...">` attributes change per frame, not element structure
- 20-60 enemies × 1 SVG each = 20-60 DOM elements, well within browser limits
- Towers are static (few dozen), enemies are dynamic (20-60 active max)

---

## 5. Migration Order

| Phase | Scope | Risk | Effort |
|-------|-------|------|--------|
| 1 | Camera sync + SVG loader infrastructure | Low | Low |
| 2 | Enemy sprites (walking animation + path interpolation) | Medium | Medium |
| 3 | Tower sprites (rotation + optional animation refs) | Medium | Medium |
| 4 | Remove old canvas drawing for towers/enemies | Medium | Low |

### Phase 1: Infrastructure (no visual changes)

- Create `src/services/CameraService.js`
- Create `src/services/SvgLoader.js`
- Create `src/composables/useCameraSync.js`
- Create `src/components/SpriteLayer.vue` (empty shell)
- Mount `SpriteLayer` alongside canvas in `GameScreen.vue`
- **No sprites rendered yet** — just the infrastructure

### Phase 2: Enemy sprites

- Add `walking` config to each enemy type in `Constants.js`
  - Use inline `svg` text for frames derived from current `Shapes.js` shapes
  - Use `file` paths for artist-created SVG assets (optional, later)
- Create `src/composables/useAnimation.js`
- Create `src/components/EnemySprite.vue`
- Render enemies via `<EnemySprite>` in `SpriteLayer.vue`
- Keep old canvas `drawEnemy()` as fallback during development
- **Walking animation works with path data interpolation**

### Phase 3: Tower sprites

- Add `animation` config to tower types in `Constants.js`
  - Use inline `svg` text for base shapes
  - Use `file` paths for artist-created assets (optional, later)
- Create `src/components/TowerSprite.vue`
- Render towers via `<TowerSprite>` in `SpriteLayer.vue`
- Rotation via CSS `transform: rotate()` on barrel group

### Phase 4: Clean up

- Remove `drawTower()` and `drawEnemy()` from `Shapes.js`
- Remove tower/enemy loops from `Renderer.js`
- Update tests: mock DOM/SVG instead of canvas context for sprite rendering
- Status overlays (health bars, shield bars, stun glow) remain in canvas drawing

---

## 6. Performance Considerations

- **DOM element count**: ~20-60 enemy SVGs + ~10-30 tower SVGs = ~30-90 inline SVG elements. Well within browser limits.
- **Per-frame cost**: Each RAF tick updates `pathData` refs for active enemies. Vue patches only the `<path d="...">` attributes — no full component re-renders. Estimated ~0.02-0.1ms per enemy for the ref update + DOM patch.
- **No rasterization**: Paths are fresh vector geometry each frame. The browser's SVG renderer handles anti-aliasing natively — no bitmap conversion overhead.
- **Camera transform**: Applied once to the sprite layer wrapper via CSS. Cheap.
- **Memory**: SVG text is cached (inline in config or fetched once from disk). Trivial — a few KB per enemy/tower type.
- **RAF vs Vue ticks**: Vue refs updated inside `requestAnimationFrame` are still batched by Vue's reactivity system. DOM updates happen at the next microtask, which aligns with the display refresh rate.
- **SVG loader**: File-based reference images are fetched once at component mount and cached. Subsequent mounts reuse the cached text. No repeated network calls.

---

## 7. Visual Design Notes

### Shape SVG text (derived from current `Shapes.js`)

The current `Shapes.js` path constructions map directly to SVG `<path>` elements. For simple shapes, the SVG text is written inline in config:

```xml
<!-- Shapes.js: circle → SVG path -->
<path d="M 0,-r A r r 0 1 0 0 r A r r 0 1 0 0,-r Z"
      fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>

<!-- Shapes.js: triangle → SVG path -->
<path d="M 0,-r L r*0.866, r*0.5 L -r*0.866, r*0.5 Z"
      fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>

<!-- Shapes.js: hexagon → SVG path -->
<path d="M r,0 L r*0.5, r*0.866 L -r*0.5, r*0.866 L -r,0 L -r*0.5, -r*0.866 L r*0.5, -r*0.866 Z"
      fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
```

### Walking animation reference images

Each reference image is either inline SVG text (for simple shapes) or a file path (for artist-created assets). The composable extracts the `<path d="...">` from each SVG and interpolates the numeric coordinates between adjacent frames. All reference images must share the same SVG structure (same number of `<path>` elements, same command structure) for smooth interpolation.

### Tower SVG structure

```html
<svg viewBox="-16 -16 32 32">
  <g class="body">
    <path :d="bodyPathData" stroke="currentColor" fill="none" stroke-width="2"/>
  </g>
  <g class="barrel" :style="{ transform: `rotate(${angle}rad)` }">
    <line x1="8" y1="0" x2="16" y2="0" stroke="currentColor" stroke-width="2"/>
  </g>
  <text class="icon" :fill="color" text-anchor="middle" dominant-baseline="middle"
        x="0" y="0" font-size="12" font-weight="bold">{{ icon }}</text>
  <g class="pips">
    <circle v-for="pip in levelPips" :cx="pip.x" :cy="pip.y" r="1.5" :fill="pip.color"/>
  </g>
</svg>
```

---

## 8. Testing Considerations

- `npm run test` runs ~490 tests. The `shapes.test.js` and `renderer.test.js` files test drawing functions.
- When removing `drawTower()` and `drawEnemy()` from `Shapes.js`, remove or update those test cases
- New tests for `useAnimation` composable:
  - Verify path data interpolation produces correct intermediate coordinates
  - Verify loop wraps correctly at duration boundary
  - Verify animation switching updates phase correctly
  - Verify RAF cleanup on unmount
  - Verify inline `svg` text is parsed correctly (no fetch needed)
  - Verify `file` paths trigger `loadSvgContent` and cache the result
  - Verify `extractPathD` extracts the `d` attribute from SVG text
  - Verify `interpolatePathD` preserves command structure (`M`, `L`, `A`, `Z`)
- New tests for `SvgLoader.js`:
  - Verify `loadSvgContent` fetches and caches SVG text
  - Verify cached entries are returned on subsequent calls (no duplicate fetch)
- Sprite component tests: verify SVG renders with correct `d` attribute, position, and color
- No changes needed to game logic tests — rendering is isolated in components/composables
