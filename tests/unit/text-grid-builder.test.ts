// @ts-nocheck
import { describe, expect, it } from "vitest";
import type { Grid } from "@/grid/Grid.js";
import { TextGridBuilder } from "@/render/text/TextGridBuilder.js";

type TileType = "terrain" | "path" | "base" | "spawn";

function makeFakeGrid(width: number, height: number, types: TileType[][]): Grid {
  return {
    width,
    height,
    isTerrain: (x: number, y: number) => types[y]![x] === "terrain",
    isPath: (x: number, y: number) => types[y]![x] === "path",
    isBase: (x: number, y: number) => types[y]![x] === "base",
    isSpawn: (x: number, y: number) => types[y]![x] === "spawn",
  } as unknown as Grid;
}

describe("TextGridBuilder", () => {
  const types: TileType[][] = [
    ["spawn", "path", "path", "base"],
    ["terrain", "path", "path", "terrain"],
    ["terrain", "terrain", "path", "terrain"],
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

  it("puts a faint dot in terrain tile centers", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(0, 1)).toBe("·");
    expect(builder.getCenterChar(1, 2)).toBe("·");
  });

  it("leaves path tile centers empty", () => {
    const builder = new TextGridBuilder(grid);
    expect(builder.getCenterChar(1, 0)).toBe(" ");
    expect(builder.getCenterChar(1, 1)).toBe(" ");
  });

  it("produces text with the expected row count", () => {
    const builder = new TextGridBuilder(grid);
    const lines = builder.getText().split("\n");
    expect(lines.length).toBe(9);
    expect(lines[0]!.length).toBe(12);
  });
});
