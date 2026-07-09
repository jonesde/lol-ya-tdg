import type { Grid } from "@/sim/grid/Grid.js";

// Static monochrome character buffer for the `<pre>` base layer of the text
// minimap. One text row/column per character; each map tile occupies a 3×3
// character block. Terrain tiles are drawn as an empty-centered 3×3 box whose
// border characters vary by terrain height (1–4) so the minimap mirrors the
// distinct terrain images on the main SVG map. Base/spawn tiles use a distinct
// solid-block border with their `#`/`S` marker in the center. The dynamic
// (colored) tower/enemy glyphs are drawn on the canvas overlay in the same
// center cells, so the two layers stay aligned.
//
//   tile (tileX, tileY) → center char cell (tileX*3+1, tileY*3+1)
//

interface BorderSet {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

// Border characters per terrain height (1–4). The four sets use visually
// distinct weights so height is readable at a glance:
//   1 = light (thinnest)      ┌┐└┘─│
//   2 = medium (light+heavy: heavy verticals, light horizontals) ╒╕╘╛─┃
//   3 = double                  ╔╗╚╝═║
//   4 = heavy (thickest)       ┏┓┗┛━┃
const TERRAIN_BORDERS: Record<number, BorderSet> = {
  1: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
  2: { topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛", horizontal: "─", vertical: "┃" },
  3: { topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝", horizontal: "═", vertical: "║" },
  4: { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "━", vertical: "┃" },
};

// Distinct solid-block border for base/spawn tiles so they stand out from the
// line-style terrain boxes. The `#`/`S` marker is kept in the center cell.
const SPECIAL_BORDER: BorderSet = {
  topLeft: "█",
  topRight: "█",
  bottomLeft: "█",
  bottomRight: "█",
  horizontal: "█",
  vertical: "█",
};

export class TextGridBuilder {
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly charRows: string[][];

  constructor(grid: Grid) {
    this.gridWidth = grid.width;
    this.gridHeight = grid.height;
    this.charRows = [];
    for (let rowIndex = 0; rowIndex < grid.height * 3; rowIndex++) {
      this.charRows.push(new Array<string>(grid.width * 3).fill(" "));
    }
    for (let tileY = 0; tileY < grid.height; tileY++) {
      for (let tileX = 0; tileX < grid.width; tileX++) {
        const topRow = tileY * 3;
        const centerRow = tileY * 3 + 1;
        const bottomRow = tileY * 3 + 2;
        const leftCol = tileX * 3;
        const centerCol = tileX * 3 + 1;
        const rightCol = tileX * 3 + 2;

        let border: BorderSet;
        let centerChar = " ";
        if (grid.isBase(tileX, tileY)) {
          border = SPECIAL_BORDER;
          centerChar = "#";
        } else if (grid.isSpawn(tileX, tileY)) {
          border = SPECIAL_BORDER;
          centerChar = "S";
        } else if (grid.isTerrain(tileX, tileY)) {
          const height = Math.min(4, Math.max(1, grid.getHeight(tileX, tileY)));
          border = TERRAIN_BORDERS[height]!;
        } else {
          // Path tiles are left empty (no border, no marker).
          continue;
        }

        this.charRows[topRow]![leftCol] = border.topLeft;
        this.charRows[topRow]![centerCol] = border.horizontal;
        this.charRows[topRow]![rightCol] = border.topRight;
        this.charRows[centerRow]![leftCol] = border.vertical;
        this.charRows[centerRow]![centerCol] = centerChar;
        this.charRows[centerRow]![rightCol] = border.vertical;
        this.charRows[bottomRow]![leftCol] = border.bottomLeft;
        this.charRows[bottomRow]![centerCol] = border.horizontal;
        this.charRows[bottomRow]![rightCol] = border.bottomRight;
      }
    }
  }

  get rowCount(): number {
    return this.gridHeight * 3;
  }

  get columnCount(): number {
    return this.gridWidth * 3;
  }

  // Returns the character in the center cell of the given tile (where the
  // dynamic tower/enemy glyphs are later drawn). Useful for tests.
  getCenterChar(tileX: number, tileY: number): string {
    return this.charRows[tileY * 3 + 1]![tileX * 3 + 1]!;
  }

  // Returns the character in the top-left cell of the given tile's 3×3 border
  // box. Useful for verifying per-height border styles in tests.
  getBorderTopLeft(tileX: number, tileY: number): string {
    return this.charRows[tileY * 3]![tileX * 3]!;
  }

  getText(): string {
    return this.charRows.map((row) => row.join("")).join("\n");
  }
}
