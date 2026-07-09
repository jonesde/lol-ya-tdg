// @ts-nocheck
import { describe, expect, it } from "vitest";
import { TextGridBuilder } from "@/render/text/TextGridBuilder.js";
import type { Grid } from "@/sim/grid/Grid.js";

type TileType = "terrain" | "path" | "base" | "spawn";

// Per-tile terrain height, defaulting to 1 when not specified.
type TileSpec = { type: TileType; height?: number };

function makeFakeGrid(width: number, height: number, tiles: TileSpec[][]): Grid {
  return {
    width,
    height,
    isTerrain: (x: number, y: number) => tiles[y]![x]!.type === "terrain",
    isPath: (x: number, y: number) => tiles[y]![x]!.type === "path",
    isBase: (x: number, y: number) => tiles[y]![x]!.type === "base",
    isSpawn: (x: number, y: number) => tiles[y]![x]!.type === "spawn",
    getHeight: (x: number, y: number) => tiles[y]![x]!.height ?? 1,
  } as unknown as Grid;
}

describe("TextGridBuilder", () => {
  const types: TileSpec[][] = [
    [{ type: "spawn" }, { type: "path" }, { type: "path" }, { type: "base" }],
    [{ type: "terrain", height: 1 }, { type: "path" }, { type: "path" }, { type: "terrain", height: 3 }],
    [{ type: "terrain", height: 2 }, { type: "terrain", height: 4 }, { type: "path" }, { type: "terrain", height: 1 }],
  ];

  const grid = makeFakeGrid(4, 3, types);

  it("has dimensions of grid.width*3 × grid.height*3", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.columnCount).toBe(12);
    expect(builder.rowCount).toBe(9);
  });

  it("puts the base marker in the base tile center", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(3, 0)).toBe("#");
  });

  it("puts the spawn marker in the spawn tile center", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(0, 0)).toBe("S");
  });

  it("leaves terrain tile centers empty", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(0, 1)).toBe(" ");
    expect(builder.getCenterChar(1, 2)).toBe(" ");
  });

  it("leaves path tile centers empty", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(1, 0)).toBe(" ");
    expect(builder.getCenterChar(1, 1)).toBe(" ");
  });

  it("draws a height-1 light-square border on terrain tiles", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getBorderTopLeft(0, 1)).toBe("┌");
  });

  it("draws a height-2 medium (light+heavy) border on terrain tiles", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getBorderTopLeft(0, 2)).toBe("╒");
  });

  it("draws a height-3 double border on terrain tiles", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getBorderTopLeft(3, 1)).toBe("╔");
  });

  it("draws a height-4 heavy border on terrain tiles", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getBorderTopLeft(1, 2)).toBe("┏");
  });

  it("draws a solid-block border on base and spawn tiles", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getBorderTopLeft(3, 0)).toBe("█");
    expect(builder.getBorderTopLeft(0, 0)).toBe("█");
  });

  it("produces text with the expected row count", () => {
    const builder = new TextGridBuilder(grid);
    const lines = builder.getText().split("\n");
    expect(lines.length).toBe(9);
    expect(lines[0]!.length).toBe(12);
  });
});
