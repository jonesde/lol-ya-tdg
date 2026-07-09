import type { Grid } from "@/grid/Grid.js";

// Static monochrome character buffer for the `<pre>` base layer of the text
// minimap. One text row/column per character; each map tile occupies a 3×3
// character block with the marker placed in the center cell. The dynamic
// (colored) glyphs are drawn on the canvas overlay in the same center cells,
// so the two layers stay aligned.
//
//   tile (tileX, tileY) → center char cell (tileX*3+1, tileY*3+1)
//
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
        const centerRow = tileY * 3 + 1;
        const centerCol = tileX * 3 + 1;
        if (grid.isBase(tileX, tileY)) {
          this.charRows[centerRow]![centerCol] = "#";
        } else if (grid.isSpawn(tileX, tileY)) {
          this.charRows[centerRow]![centerCol] = "S";
        } else if (grid.isTerrain(tileX, tileY)) {
          this.charRows[centerRow]![centerCol] = "·";
        } else {
          this.charRows[centerRow]![centerCol] = " ";
        }
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

  getText(): string {
    return this.charRows.map((row) => row.join("")).join("\n");
  }
}
