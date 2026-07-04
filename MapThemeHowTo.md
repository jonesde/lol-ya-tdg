# Creating a New Map Theme

A map theme swaps the visual identity of towers, enemies, and map tiles on the `/game` screen without affecting gameplay stats, effects, overlays, or non-game screens. The existing polygon-based art is the default theme (`id: "default"`).

## File Location & Registration

1. Create a JSON file under `src/render/themes/data/` (e.g., `fantasy-map-theme.json`).
2. Register it in `src/render/themes/index.ts`:
   - Add an entry to `MAP_THEME_MANIFEST` with `{ id, label, file }`.
   - Call `registerThemeLoader(id, () => import('./data/your-theme.json').then(m => m.default))`.

## JSON Structure

```json
{
  "id": "your-theme-id",
  "label": "Display Name",
  "towers": { /* 6 tower types */ },
  "enemies": { /* 6 enemy types */ },
  "regions": [ /* 3 region objects */ ]
}
```

Each `image` value is either an inline `<svg>...</svg>` string or a relative path/URL to an external SVG file. External references are fetched and inlined automatically by `normalizeThemeImages`.

---

## Image Sets Reference

Every image set is an animation with a `duration` (seconds per full cycle) and an array of `frames`, each containing one `image` (SVG string or path). The renderers cycle through frames based on elapsed time.

### Tower Image Sets (12 total)

Each tower type has two image sets:

| Tower Type Key | animation (firing) | walking (idle) |
|---|---|---|
| `basic` | `towers.basic.animation` | `towers.basic.walking` |
| `ice` | `towers.ice.animation` | `towers.ice.walking` |
| `sniper` | `towers.sniper.animation` | `towers.sniper.walking` |
| `cannon` | `towers.cannon.animation` | `towers.cannon.walking` |
| `lightning` | `towers.lightning.animation` | `towers.lightning.walking` |
| `railgun` | `towers.railgun.animation` | `towers.railgun.walking` |

Each tower entry also requires `name` (string), `color` (CSS color), and `icon` (single-character display glyph).

### Enemy Image Sets (12 total)

Each enemy type has two image sets:

| Enemy Type Key | walking | hitReaction |
|---|---|---|
| `minion` | `enemies.minion.walking` | `enemies.minion.hitReaction` |
| `runner` | `enemies.runner.walking` | `enemies.runner.hitReaction` |
| `tank` | `enemies.tank.walking` | `enemies.tank.hitReaction` |
| `shielded` | `enemies.shielded.walking` | `enemies.shielded.hitReaction` |
| `healer` | `enemies.healer.walking` | `enemies.healer.hitReaction` |
| `boss` | `enemies.boss.walking` | `enemies.boss.hitReaction` |

Each enemy entry also requires `name` (string), `color` (CSS color), and `shape` (string — used for stats panel display).

### Region Tile Image Sets (15 total)

Each region has 5 tile images:

| Region ID | Region Name (default) | Tiles |
|---|---|---|
| `0` | Verdant Marches | `regions[0].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |
| `1` | Sunscorch Coast | `regions[1].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |
| `2` | Thornpeak Wilds | `regions[2].tiles.path`, `terrain1`, `terrain2`, `terrain3`, `terrain4` |

- `path`: walkable path tiles and spawn tiles.
- `terrain1` through `terrain4`: buildable terrain tiles, ordered by height value (1 = lowest, 4 = highest). Each region's terrain shades should form a visual gradient.

### Region Base Image Sets (3 total)

| Region ID | Base Art Field |
|---|---|
| `0` | `regions[0].base` |
| `1` | `regions[1].base` |
| `2` | `regions[2].base` |

An empty string (`""`) falls back to the default procedurally-generated base structure.

---

## Image Sizing Guidelines

The map tile size is **36px**. All images are rendered at specific sizes but may be scaled arbitrarily during rendering (camera zoom, hit-reaction scaling, etc.). Plan your level of detail for the base sizes below, and be aware the final rendered size will vary.

### Tower Sprites

| Property | Value |
|---|---|
| **viewBox** | `-16 -16 32 32` |
| **Base Size** | 27 x 27 px (`36 * 0.75`) |
| **Symbol viewBox** | `-16 -16 32 32` (hardcoded in `useSvgStaticContent.ts`) |

Towers are centered on their tile center, rendered at 27px, and rotated to face their target. The barrel/cannon should extend toward positive-X (right side) at 0 degrees rotation. Use `currentColor` in SVG strokes/fills to pick up the tower's theme color.

### Enemy Sprites

| Enemy Type | Radius (constant) | Base Size | Actual Rendered Size |
|---|---|---|---|
| `minion` | 0.4 | 0.4 tile units | 28.8 px (`0.4 * 36 * 0.5 * 4`) |
| `runner` | 0.4 | 0.4 tile units | 28.8 px |
| `tank` | 0.4 | 0.4 tile units | 28.8 px |
| `shielded` | 0.4 | 0.4 tile units | 28.8 px |
| `healer` | 0.36 | 0.36 tile units | 25.9 px (`0.36 * 36 * 0.5 * 4`) |
| `boss` | 0.6 | 0.6 tile units | 43.2 px (`0.6 * 36 * 0.5 * 4`) |

- **viewBox**: `-1 -1 2 2` (hardcoded in `useSvgStaticContent.ts`).
- **Symbol viewBox**: `-1 -1 2 2` (hardcoded).
- **Render formula**: `radius * tileSize * 0.5 * 4`, where `radius` is the constant from `ENEMY_TYPES` and `tileSize` is 36.
- Enemies are scaled by camera zoom. During hit reaction, they scale down to 70% (`scale(0.7)`).
- The boss at 43.2px is roughly 1.6x the tower size, visually appropriate for a larger threat.
- Plan detail for these base sizes, but expect arbitrary scaling from camera zoom and effects.

### Tile Images

| Property | Value |
|---|---|
| **viewBox** | `0 0 36 36` |
| **Base Size** | 36 x 36 px |
| **Symbol viewBox** | `0 0 36 36` (hardcoded) |

Tiles fill each grid cell exactly. Scaled by camera zoom. The default theme uses a subtle cross-hatch overlay (`<path d="M7.2,7.2 L28.8,28.8 M28.8,7.2 L7.2,28.8">`) — optional for your theme.

### Region Base Art

| Property | Value |
|---|---|
| **viewBox** | Freeform (use `0 0 W H` matching your art) |
| **Base Size** | ~97 x 97 px (spans 3 x 3 tiles: `3 * 36 - tile gaps`) |
| **Placement** | Translated to `(base.x - 1) * 36, (base.y - 1) * 36` |

The base art replaces the default procedural base. If left as `""`, the default base renderer (rounded rectangle with gems and hexagonal emblem) is used instead. Your SVG is inserted directly into a `<g transform="translate(...)">` wrapper.

---

## Symbol ID Contract

The renderers generate `<symbol>` elements with specific IDs. Your theme's frame index determines which symbol is referenced. Do not change these IDs:

| Entity | Walking Symbol ID | Animation Symbol ID |
|---|---|---|
| Tower type `basic`, frame 0 | `tower-basic-f0` | `tower-basic-f0` (same pool) |
| Enemy type `minion`, frame 0 | `enemy-minion-f0` | — |
| Enemy type `minion`, hit frame 0 | `enemy-minion-hit-f0` | — |

Pattern: `tower-{type}-f{index}`, `enemy-{type}-f{index}`, `enemy-{type}-hit-f{index}`.

Frame 0 is always the "idle" or "default" frame. Animation frames (tower firing, enemy hit reaction) play their sequence then return to frame 0 of the walking animation.

---

## Animation Timing

- **Tower animation duration**: Time for the firing animation to complete before reverting to idle. Typical range: 0.3–1.0 seconds.
- **Tower walking duration**: Cycle time for the idle animation. Typical range: 0.5–1.0 seconds.
- **Enemy walking duration**: Full cycle time for the walking bob/wobble. Typical range: 0.5–1.5 seconds.
- **Enemy hit reaction duration**: How long the hit flash/stutter plays. Default: 0.12 seconds (fast, snappy feedback).

Frame count per cycle:
- Tower animation (firing): 2 frames (idle + fire flash)
- Tower walking (idle): 1 frame (static) or more for subtle animation
- Enemy walking: 8 frames (smooth bob/wobble cycle)
- Enemy hit reaction: 3 frames (hit flash + recoil + hold)

---

## Image Format

Each `image` in a frame can be:

1. **Inline SVG**: A complete `<svg>` element as a string, e.g. `"<svg viewBox=\"-16 -16 32 32\"><circle .../></svg>"`.
2. **External path**: A relative path like `"./sprites/tower-basic-f0.svg"` or a URL. The `normalizeThemeImages` function fetches and inlines these at load time.

The normalizer strips XML prologues, HTML comments, and whitespace. For inline SVGs, the outer `<svg>` tag and its attributes are stripped when building `<symbol>` content — only the inner elements are preserved.

---

## Complete Image Set Count

| Category | Count |
|---|---|
| Tower animation sets | 6 |
| Tower walking sets | 6 |
| Enemy walking sets | 6 |
| Enemy hit reaction sets | 6 |
| Region tile sets | 15 (3 regions × 5 tile types) |
| Region base sets | 3 |
| **Total image sets** | **42** |

---

## Testing Your Theme

1. Register the theme in `MAP_THEME_MANIFEST`.
2. Run `npm run dev` and navigate to `/map-select`.
3. Select your theme from the dropdown.
4. Start any map and verify:
   - Tower sprites render correctly with proper colors and rotation.
   - Enemy sprites walk, bob, and flash on hit.
   - Tile images fill grid cells without gaps.
   - Base art appears at the correct location.
5. Run the test suite: `npm run test` (includes `map-theme.test.ts` for theme loading/normalization).
