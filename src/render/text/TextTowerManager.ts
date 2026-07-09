import type { TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import type { TextRenderScale, TextThemeAccess } from "./types.js";

const TILE_SIZE = 36;

// Draws each tower's theme icon at its static tile-center cell on the canvas
// overlay. Towers never move, so their world position is the tile center
// `(tileX + 0.5) * TILE_SIZE`, converted to canvas px via the shared scale.
export class TextTowerManager {
  render(
    ctx: CanvasRenderingContext2D,
    towers: TowerSnapshot[],
    themeAccess: TextThemeAccess,
    scale: TextRenderScale,
  ): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const tower of towers) {
      const visual = themeAccess.getTowerVisual(tower.type);
      const icon = visual?.icon ?? "T";
      const color = visual?.color ?? "#ffffff";
      const worldX = (tower.tileX + 0.5) * TILE_SIZE;
      const worldY = (tower.tileY + 0.5) * TILE_SIZE;
      const pixelX = worldX * scale.scaleX;
      const pixelY = worldY * scale.scaleY;
      ctx.fillStyle = color;
      ctx.fillText(icon, pixelX, pixelY);
    }
  }
}
