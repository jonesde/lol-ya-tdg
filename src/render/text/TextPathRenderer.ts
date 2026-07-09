import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import type { TextRenderScale } from "./types.js";

const TILE_SIZE = 36;
const PATH_COLOR = "rgba(255,255,255,0.4)";
const PATH_LINE_WIDTH = 1.5;

// Draws the worker-authoritative enemy path as a faint line on the minimap
// canvas overlay — the same data the main SVG map renders as path highlights
// (`SvgGameRoot.vue`). Each path is a list of tile coords; we map every tile
// center to canvas px through the shared `scale` (identical conversion the
// tower/enemy managers use) and stroke a polyline.
//
// `snapshot.paths` is `undefined` on ticks where the route has not changed
// (the worker omits it), so we cache the last non-null copy and keep drawing
// it across cleared frames — mirroring the main map's cached-highlight behavior.
export class TextPathRenderer {
  private lastPaths: Array<Array<{ x: number; y: number }> | null> | null = null;

  render(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    if (snapshot.paths) {
      this.lastPaths = snapshot.paths;
    }
    const paths = this.lastPaths;
    if (!paths || paths.length === 0) return;

    ctx.strokeStyle = PATH_COLOR;
    ctx.lineWidth = PATH_LINE_WIDTH;
    for (const path of paths) {
      if (!path || path.length === 0) continue;
      ctx.beginPath();
      path.forEach((tile, tileIndex) => {
        const worldX = tile.x * TILE_SIZE + TILE_SIZE / 2;
        const worldY = tile.y * TILE_SIZE + TILE_SIZE / 2;
        const pixelX = worldX * scale.scaleX;
        const pixelY = worldY * scale.scaleY;
        if (tileIndex === 0) {
          ctx.moveTo(pixelX, pixelY);
        } else {
          ctx.lineTo(pixelX, pixelY);
        }
      });
      ctx.stroke();
    }
  }
}
