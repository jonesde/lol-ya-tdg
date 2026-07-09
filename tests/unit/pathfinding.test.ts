// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Grid } from "@/grid/Grid.js";
import { bfsShortestPath, canPlaceWithoutBlocking, dijkstraWeakestPath } from "@/grid/Pathfinding.js";
import { makeBastionMap, makeMapData, makeSerpentineMap, makeSplitMap } from "../helpers/mock-grid";

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

  it("returns true for a path tile even when it would block the open route (Phase 2: towers are traversable)", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const testPos = { x: 4, y: 3 };
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, testPos, grid.blocked);
    expect(result).toBe(true);
  });

  it("returns true for terrain tiles (towers cannot block paths via terrain)", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 0, y: 0 }, grid.blocked);
    expect(result).toBe(true);
  });

  it("permits path-tile placement that overlaps an existing blocked path tile", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const existingBlocked = new Set(["2,3"]);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 3, y: 3 }, existingBlocked);
    expect(result).toBe(true);
  });

  it("returns true for terrain placement that does not disconnect spawns", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 0, y: 0 }, grid.blocked);
    expect(result).toBe(true);
  });

  it("returns true for split map with two spawns", () => {
    const map = makeSplitMap();
    const grid = new Grid(map);
    const result = canPlaceWithoutBlocking(grid, map.spawns, map.base, { x: 0, y: 0 }, grid.blocked);
    expect(result).toBe(true);
  });
});

describe("dijkstraWeakestPath", () => {
  it("routes through tower tiles when the open path is fully blocked", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    // Block every open path tile (as if live towers occupied them).
    for (const tile of grid.paths[0]!) {
      grid.blocked.add(`${tile.x},${tile.y}`);
    }
    const healths = new Map<string, number>();
    for (const tile of grid.paths[0]!) healths.set(`${tile.x},${tile.y}`, 100);
    const path = dijkstraWeakestPath(
      grid,
      map.spawns[0],
      map.base,
      (x, y) => healths.get(`${x},${y}`),
      () => false,
    );
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(map.spawns[0]);
    expect(path?.[path.length - 1]).toEqual(map.base);
    // The route must cross the (blocked) tower tiles rather than giving up.
    for (const tile of grid.paths[0]!) {
      expect(path!.some((p) => p.x === tile.x && p.y === tile.y)).toBe(true);
    }
  });

  it("prefers weaker towers (lower health) when an alternate route exists", () => {
    // 5x5 grid with two horizontal corridors (row 1 and row 3) joined at the left
    // and right ends. The middle column (x=2) is a tower on both corridors; the
    // enemy must cross exactly one of them to get from left to right. The top
    // crossing (2,1) is the weak tower, the bottom (2,3) is strong.
    const width = 5;
    const height = 5;
    const tiles: { type: string; height: number }[][] = [];
    for (let y = 0; y < height; y++) {
      const row: { type: string; height: number }[] = [];
      for (let x = 0; x < width; x++) row.push({ type: "terrain", height: 1 });
      tiles.push(row);
    }
    for (let x = 0; x < width; x++) {
      tiles[1][x].type = "path";
      tiles[3][x].type = "path";
    }
    tiles[2][0].type = "path";
    tiles[2][4].type = "path";
    const map = makeMapData({
      width,
      height,
      spawns: [{ x: 0, y: 3 }],
      base: { x: 4, y: 3 },
      tiles,
      regionId: 0,
      level: 1,
      style: "bastion",
    });
    const grid = new Grid(map);
    // Block the middle column so both crossings are "towers".
    grid.blocked.add("2,1");
    grid.blocked.add("2,3");
    const health = (x: number, y: number): number | undefined => {
      if (x === 2 && y === 1) return 10; // weak top crossing
      if (x === 2 && y === 3) return 200; // strong bottom crossing
      return undefined;
    };
    const path = dijkstraWeakestPath(grid, { x: 0, y: 3 }, { x: 4, y: 3 }, health, () => false);
    expect(path).not.toBeNull();
    // The weakest route should cross the weak tower at (2,1), not the strong one.
    expect(path!.some((p) => p.x === 2 && p.y === 1)).toBe(true);
    expect(path!.some((p) => p.x === 2 && p.y === 3)).toBe(false);
  });

  it("treats ghosted towers as free (weight 0)", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    for (const tile of grid.paths[0]!) grid.blocked.add(`${tile.x},${tile.y}`);
    const path = dijkstraWeakestPath(
      grid,
      map.spawns[0],
      map.base,
      () => 100,
      () => true,
    );
    expect(path).not.toBeNull();
    // Ghosted towers cost nothing, so the path should still traverse the row.
    expect(path!.length).toBe(grid.paths[0]!.length);
  });

  it("returns null when start and goal are disconnected by non-path terrain", () => {
    const map = makeBastionMap();
    const grid = new Grid(map);
    // Surround the base with impassable (non-path) terrain so no path tile reaches it.
    const path = dijkstraWeakestPath(
      grid,
      map.spawns[0],
      { x: 0, y: 0 },
      () => undefined,
      () => false,
    );
    expect(path).toBeNull();
  });
});
