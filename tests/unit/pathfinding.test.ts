// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Grid } from "@/grid/Grid.js";
import { bfsShortestPath, canPlaceWithoutBlocking } from "@/grid/Pathfinding.js";
import { makeBastionMap, makeSerpentineMap, makeSplitMap } from "../helpers/mock-grid";

describe("bfsShortestPath", () => {
  it("returns a path from start to goal", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const path = bfsShortestPath(grid, start, map.base, grid.blocked);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(start);
    expect(path?.[path?.length - 1]).toEqual(map.base);
  });

  it("returns the shortest path (BFS guarantee)", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const path = bfsShortestPath(grid, start, map.base, grid.blocked);
    expect(path?.length).toBe(map.width);
  });

  it("avoids blocked tiles", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const blocked = new Set(["3,3"]);
    const path = bfsShortestPath(grid, start, map.base, blocked);
    if (path) {
      for (const tile of path) {
        expect(blocked.has(`${tile.x},${tile.y}`)).toBe(false);
      }
    }
  });

  it("returns null when all paths are blocked", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const blocked = new Set<string>();
    for (const tile of grid.paths[0]!) {
      blocked.add(`${tile.x},${tile.y}`);
    }
    const path = bfsShortestPath(grid, start, map.base, blocked);
    expect(path).toBeNull();
  });

  it("returns a path through a serpentine map", () => {
    const map = makeSerpentineMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const path = bfsShortestPath(grid, start, map.base, grid.blocked);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(start);
    expect(path?.[path?.length - 1]).toEqual(map.base);
  });

  it("only traverses path, base, and spawn tiles", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const start = map.spawns[0];
    const path = bfsShortestPath(grid, start, map.base, grid.blocked);
    for (const tile of path!) {
      const isPassable = grid.isPath(tile.x, tile.y) || grid.isBase(tile.x, tile.y) || grid.isSpawn(tile.x, tile.y);
      expect(isPassable).toBe(true);
    }
  });

  it("handles start == goal", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const path = bfsShortestPath(grid, map.base, map.base, grid.blocked);
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path?.[0]).toEqual(map.base);
  });
});

describe("canPlaceWithoutBlocking", () => {
  it("returns true for a non-critical path tile", () => {
    const serpent = makeSerpentineMap();
    const serpentGrid = new Grid(serpent);
    const result = canPlaceWithoutBlocking(
      serpentGrid,
      serpent.spawns,
      serpent.base,
      { x: 0, y: 3 },
      serpentGrid.blocked,
    );
    expect(result).toBe(true);
  });

  it("returns false when placement blocks all routes from a spawn", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const testPos = { x: 4, y: 3 };
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, testPos, grid.blocked);
    expect(result).toBe(false);
  });

  it("returns true for terrain tiles (towers cannot block paths via terrain)", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 0, y: 0 }, grid.blocked);
    expect(result).toBe(true);
  });

  it("considers existing blocked tiles", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const existingBlocked = new Set(["2,3"]);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 3, y: 3 }, existingBlocked);
    expect(result).toBe(false);
  });

  it("returns true for split map with two spawns", () => {
    const map = makeSplitMap();
    const grid = new Grid(map);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 0, y: 0 }, grid.blocked);
    expect(result).toBe(true);
  });
});
