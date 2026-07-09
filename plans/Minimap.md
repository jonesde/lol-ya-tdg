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
`SnapshotStore` that the SVG renderer already drains (`snapshotStore.get()`), running its own
`requestAnimationFrame` loop. This is a true "second view" of the already-drained snapshot —
no ack changes, no worker changes, behavior-preserving. The SVG renderer remains the sole
acking consumer.

One wiring change: `SnapshotStore` is currently created privately inside `SvgGameRoot.vue`.
Expose it by storing the reference on `gameStore` (mirroring how `worker` is stored via
`setWorker`/`clearWorker`), set in `SvgGameRoot.onMounted`, cleared on unmount. The Minimap
reads `gameStore.snapshotStore?.get()`.

## Characters & color

- **Towers**: use the theme's existing `icon` field (already a single unicode char) via
  `themeStore.getTowerVisual(type).icon`, drawn in the tower's theme `color`.
- **Enemies**: no icon exists, so `charMap.ts` maps each `EnemyType` → a unicode glyph
  chosen to resemble its theme `shape` description (e.g. circle→`●`, triangle→`▲`,
  square→`■`, diamond→`◆`, hexagon→`⬢`, star→`★`, boss→a bold distinct glyph), drawn in the
  enemy's theme `color`.

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
├── TextEnemyManager.ts     # Draws enemy glyph (charMap + theme color) at enemy tile on canvas
├── TextOverlayRenderer.ts  # Canvas: projectile dots, HP bars, lightning lines, stun marks
│                           #   (mirrors svg ProjectileManager + UiOverlayManager + EffectManager)
└── charMap.ts              # enemy type → single unicode glyph (shape-like); tower char via theme icon
```

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

## TextGameRoot.vue behavior

- On mount: read `gameStore.grid` + `gameStore.map`, build the static base char buffer via
  `TextGridBuilder`, measure a monospace cell to size the overlay canvas.
- rAF loop: `snapshot = gameStore.snapshotStore?.get()`; if present, redraw the canvas —
  clear, draw tower glyphs (`TextTowerManager`), enemy glyphs (`TextEnemyManager`), then
  `TextOverlayRenderer.render(ctx, snapshot)` for dots/bars/lines. Does **not** send
  `snapshotAck` (SVG loop owns that). Stops on unmount.
- Read-only: no click handling, no commands, no input (it's a monitor view).

## UI integration

1. **`GameHud.vue`**: add a `Minimap` button in `.hud-right` (e.g. `🗺`), calling
   `uiStore.toggleMinimap()`.
2. **`stores/ui.ts`**: add `showMinimap: boolean` to `UiStateShape`, `defaultUiState()`,
   plus `toggleMinimap()`/`closeMinimap()` actions; include in `closeAllDialogs()`.
3. **`stores/game.ts`**: add `minimapPanelPos: { x, y }` (default e.g. `{ x: 40, y: 80 }`)
   alongside `towerPanelPos`, reset in the same places; add `snapshotStore` ref +
   `setSnapshotStore`/`clearSnapshotStore` (mirroring `worker`).
4. **`GameScreen.vue`**: render `<MinimapPanel v-if="uiStore.showMinimap" />` as a sibling
   overlay.
5. **`MinimapPanel.vue`**: copy the drag-by-header pattern from `TowerPanel.vue` (uses
   `gameStore.minimapPanelPos`), with a header ("Minimap" + close ✕) and body hosting
   `<TextGameRoot>`. Fixed reasonable size (e.g. 320px wide, auto height); text grid scaled
   to fit.
6. **`SvgGameRoot.vue`**: in `onMounted`, `gameStore.setSnapshotStore(snapshotStore)`; in
   `onUnmounted`, `gameStore.clearSnapshotStore()`.

## Testing (mirror existing render-manager tests)

- `tests/unit/text-grid-builder.test.ts`: static buffer has correct dimensions; path/base/
  spawn chars at right cells.
- `tests/unit/text-render.test.ts`: `TextTowerManager`/`TextEnemyManager` draw the right
  glyph at the right cell from a fake snapshot; `charMap` returns distinct glyphs for all
  enemy types; tower glyph resolves from theme icon.
- `tests/unit/components/minimap-panel.test.ts`: toggles with `uiStore.showMinimap`; drag
  updates `gameStore.minimapPanelPos`; renders a `<pre>`.
- `tests/unit/ui-store.test.ts` (existing): add `toggleMinimap`/`closeMinimap`/
  `closeAllDialogs` coverage.
- Canvas overlay uses the existing jsdom Canvas 2D mock (`tests/setup.ts`), so overlay code
  can be smoke-tested without asserting pixels.

## Docs

- Update `TECHNICAL.md`: add `src/render/text/` files, `TextGameRoot.vue`/`MinimapPanel.vue`
  to the directory tree + tables, and a short "Second Renderer (Text Minimap)" design note
  explaining it's a passive second consumer of `SnapshotStore` (not the worker stream) to
  sidestep the single-ack gate.

## Out of scope

No worker/snapshot-protocol changes, no ack/backpressure changes, no camera/zoom, no
sprites/particles/range-circles, no input/click handling in the text view, no theme JSON
changes (enemy chars derived in code; tower chars from existing theme `icon`).
