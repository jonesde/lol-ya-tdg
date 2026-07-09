# Plan: "Minimap" — A Plain-Text Grid Renderer (Second Renderer Test Case)

## Goal

Add a second, fun renderer that consumes the same `SimulationSnapshot` data as the SVG
renderer but draws the map as a monospaced text grid (3×3 characters per tile), with a
thin dot/line canvas overlay for projectiles and minimized effects (health bars, lightning
lines, stuns). It opens from a new **"Minimap"** button in the HUD into a movable, hovering
panel modeled on `TowerPanel.vue`.

This is a fun test case for the current architecture: a copy of the SVG renderer structure
with the graphical output parts replaced by a simple text grid and thin dot/line effects.

## Key architectural decision: passive second consumer of SnapshotStore

The snapshot stream is **single-consumer** and ack-gated (TECHNICAL.md §"Snapshot
Backpressure"). The worker posts a new snapshot only after the main thread sends
`snapshotAck`, and `SvgGameRoot.vue`'s render loop sends exactly one ack per rendered frame.
If the Minimap read the worker stream directly, we'd need per-consumer acks (the documented
open design point).

**Decision:** the Minimap does NOT touch the worker. It passively reads the same
snapshot that the SVG renderer drains, running its own `requestAnimationFrame` loop. This is
a true "second view" of the already-drained snapshot — no ack changes, no worker changes,
behavior-preserving. The SVG renderer remains the sole acker.

**Seam:** reuse the existing module-level `getLatestSnapshot()` exported from
`src/sim/SnapshotStore.ts` (already used by `StatsPanel` for the same "read the latest
snapshot without threading the instance" purpose). `TextGameRoot.vue` calls
`import { getLatestSnapshot } from "@/sim/SnapshotStore.js"` and `getLatestSnapshot()` each
rAF frame. This avoids storing a class instance with methods on the reactive Pinia store
(the `worker` field is the only precedent and is a plain object) and removes any lifecycle
coupling between `SvgGameRoot` and the Minimap. The Minimap's loop guards with
`if (!snapshot) return` for the pre-first-frame race. No `gameStore.snapshotStore`,
`setSnapshotStore`/`clearSnapshotStore`, or `SvgGameRoot` edits are needed.

## Characters & color

- **Towers**: use the theme's existing `icon` field (already a single unicode char) via
  `themeStore.getTowerVisual(type).icon`, drawn in the tower's theme `color`.
- **Enemies**: no icon exists, so the theme store's `getEnemyGlyph(shape)` maps each theme
  enemy **`shape`** string → a unicode glyph chosen to resemble that shape. The glyph is
  resolved via `themeStore.getEnemyVisual(type).shape` (e.g. circle→`●`, triangle→`▲`,
  square→`■`, hexagon→`⬢`, cross→`✚`, star→`★`, boss→a bold distinct glyph), drawn in the
  enemy's theme `color`. Keying by `shape` (not `EnemyType`) makes the map auto-track theme
  shape changes. `getEnemyGlyph` lives on `mapTheme.ts` with a fallback for unknown shapes.

### Consequence: colored glyphs live on the canvas, not in `<pre>`

A single `<pre>` `textContent` cannot be per-cell colored. So the rendering splits into:

- **`<pre>` layer** = the *static* monochrome base grid only (terrain `·`, path spaces,
  base `#`, spawn `S`) — built once by `TextGridBuilder`, dim/gray.
- **`<canvas>` overlay** = *all dynamic content*, drawn each frame with a monospace font
  sized to the measured cell box:
  - Tower glyphs (theme color) via `fillText` at each tower tile's center cell.
  - Enemy glyphs (theme color) via `fillText` at each enemy's tile center cell.
  - Then the thin effects: projectile dots, HP bar lines, lightning lines, stun marks.

This keeps the "3×3 char per tile, empty center unless occupied" look while allowing
per-glyph color, and still mirrors the SVG manager split.

## Structure — mirror the SVG renderer

Create a parallel `src/render/text/` directory mirroring `src/render/svg/`, plus Vue
components mirroring `SvgGameRoot.vue`:

```
src/render/text/
├── TextGridBuilder.ts      # Static grid → dim monochrome char buffer for the <pre> base layer
├── TextTowerManager.ts     # Draws tower glyph (icon + theme color) at tile center on canvas
├── TextEnemyManager.ts     # Draws enemy glyph (themeStore.getEnemyGlyph(shape) + theme color) at enemy tile on canvas
└── TextOverlayRenderer.ts  # Canvas: projectile dots, HP bars, lightning lines, stun marks
                            #   (mirrors svg ProjectileManager + UiOverlayManager + EffectManager)
```

**Enemy glyph mapping — no new file.** Instead of a standalone `charMap.ts`, add a
`getEnemyGlyph(shape: string): string` helper to `src/stores/mapTheme.ts` (alongside the
existing `getEnemyVisual`/`getTowerVisual`). It maps each theme enemy `shape` string → a
unicode glyph (circle→`●`, triangle→`▲`, square→`■`, hexagon→`⬢`, cross→`✚`, star→`★`,
boss→a bold distinct glyph) with a fallback for unknown shapes. `TextEnemyManager` calls
`themeStore.getEnemyGlyph(themeStore.getEnemyVisual(type).shape)`. This keeps all
theme-derived glyph logic co-located with the rest of the theme accessors.

Plus:
```
src/components/TextGameRoot.vue   # Mirrors SvgGameRoot.vue: own rAF loop reading SnapshotStore,
                                  # renders <pre> static grid + <canvas> overlay. NO worker, NO input.
src/components/MinimapPanel.vue   # Movable hovering panel wrapper (copy of TowerPanel drag pattern)
```

## Rendering model

- **Text grid (`<pre>`)**: static base only. Grid char dimensions =
  `grid.width*3 × grid.height*3`. Terrain tiles filled with a faint `·` (center space),
  path tiles spaces, base `#`/`B`, spawn `S`. Built once on mount; dim gray text.
- **Canvas overlay** (absolutely positioned over the `<pre>`, sized to match; cell size
  derived from measured monospace char box):
  - **Tower/enemy glyphs**: `fillText` at tile center cell in theme color.
  - **Projectiles**: 1–2px moving dots at `proj.x/proj.y` scaled from world to cell coords.
  - **Health bars**: thin 1px lines above enemies with `hp/maxHp` fraction (minimized
    `UiOverlayManager`).
  - **Lightning**: thin straight lines between `lightningEffects` segment endpoints
    (no jaggedness — "simple lines").
  - **Stun**: a small dot/`*` mark at `stunEffects` positions.
  - No sprites, no particles (or optional faint dots), no range circles, no build preview.

Coordinate mapping: world pixels use `tileSize = 36`. Map (tileX,tileY) → grid char cell
(tileX*3+1, tileY*3+1). Overlay maps world px → canvas px via `cellPx / 36`.

`<pre>` × canvas pixel alignment: the `<pre>` base grid and the canvas overlay must share the
exact same font family, font size, line-height, and top-left origin, or glyphs will not sit
in their cells. Render both from one shared CSS variable / computed style.

`TextOverlayRenderer.render(ctx, snapshot)` and `TextTowerManager`/`TextEnemyManager` **take
the `CanvasRenderingContext2D` as a parameter** (passed in by `TextGameRoot`) rather than
calling `canvas.getContext` internally. This keeps the overlay decoupled and makes it testable
with the jsdom mock context directly.

Measured-cell fallback: the monospace cell box is measured once on mount, but the test/jsdom
`measureText` returns `{ width: 0 }` and fonts may not be loaded on the first frame, so
`TextGameRoot` must compute a **non-zero fallback cell box** (e.g. `fontSize` tall ×
`0.6 * fontSize` wide) and never divide by the measured width when it is 0.

## TextGameRoot.vue behavior

- On mount: read `gameStore.grid` + `gameStore.map`, build the static base char buffer via
  `TextGridBuilder`, measure a monospace cell to size the overlay canvas.
- rAF loop: `snapshot = getLatestSnapshot()` (from `@/sim/SnapshotStore.js`); if present,
  redraw the canvas — clear, draw tower glyphs (`TextTowerManager`), enemy glyphs
  (`TextEnemyManager`), then `TextOverlayRenderer.render(ctx, snapshot)` for dots/bars/lines.
  Does **not** send `snapshotAck` (SVG loop owns that). Stops on unmount.
- Read-only: no click handling, no commands, no input (it's a monitor view).

## UI integration

1. **`GameHud.vue`**: add a `Minimap` button in `.hud-right` (e.g. `🗺`), calling
   `uiStore.toggleMinimap()`.
2. **`stores/ui.ts`**: add `showMinimap: boolean` to `UiStateShape`, `defaultUiState()`,
   plus `toggleMinimap()`/`closeMinimap()` actions; include in `closeAllDialogs()`.
3. **`stores/game.ts`**: add `minimapPanelPos: { x, y }` (default e.g. `{ x: 40, y: 80 }`)
   alongside `towerPanelPos`, reset in the same places (`initMap` + `resetToMenu`). No
   `snapshotStore` field is needed — the Minimap reads `getLatestSnapshot()` directly.
4. **`GameScreen.vue`**: render `<MinimapPanel v-if="uiStore.showMinimap" />` as a sibling
   overlay.
5. **`MinimapPanel.vue`**: copy the drag-by-header pattern from `TowerPanel.vue` (uses
   `gameStore.minimapPanelPos`), with a header ("Minimap" + close ✕) and body hosting
   `<TextGameRoot>`. Fixed reasonable size (e.g. 320px wide, auto height); text grid scaled
   to fit.
6. **No `SvgGameRoot.vue` change is required** — the snapshot seam is the existing
   `getLatestSnapshot()` module function, so the SVG renderer's ack behavior is untouched.

## Testing (mirror existing render-manager tests)

- `tests/unit/text-grid-builder.test.ts`: static buffer has correct dimensions; path/base/
  spawn chars at right cells.
- `tests/unit/text-render.test.ts`: `TextTowerManager`/`TextEnemyManager` draw the right
  glyph at the right cell from a fake snapshot; `themeStore.getEnemyGlyph(shape)` returns
  distinct glyphs for every theme `shape` (circle/triangle/square/hexagon/cross/star/boss)
  and a fallback for unknown shapes; tower glyph resolves from theme icon.
- `tests/unit/components/minimap-panel.test.ts`: toggles with `uiStore.showMinimap`; drag
  updates `gameStore.minimapPanelPos`; renders a `<pre>`.
- `tests/unit/ui-store.test.ts` (existing): add `toggleMinimap`/`closeMinimap`/
  `closeAllDialogs` coverage.
- Canvas overlay managers take the `ctx` as a parameter, so tests pass the exported
  `mockCtx` (from `tests/setup.ts`) directly and smoke-assert `fillText`/`lineTo` without
  asserting pixels or patching `getContext`. The `<pre>` is smoke-tested via the DOM; the
  shared `mockCtx` is module-global, so multi-manager tests construct fresh inputs as needed.
- `TextGameRoot.vue` reads `getLatestSnapshot()`; a component test can set the module-level
  latest snapshot (via `SnapshotStore.apply`) and flush rAF to verify the canvas redraw is
  driven and that no `snapshotAck` is ever posted.

## Docs

- Update `TECHNICAL.md`: add `src/render/text/` files, `TextGameRoot.vue`/`MinimapPanel.vue`
  to the directory tree + tables, and a short "Second Renderer (Text Minimap)" design note
  explaining it's a passive second consumer of the snapshot via the existing
  `getLatestSnapshot()` module function (not the worker stream, no `gameStore` field) to
  sidestep the single-ack gate.

## Out of scope

No worker/snapshot-protocol changes, no ack/backpressure changes, no camera/zoom, no
sprites/particles/range-circles, no input/click handling in the text view, no theme JSON
changes (enemy chars derived in code; tower chars from existing theme `icon`).
