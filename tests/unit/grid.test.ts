// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import { Grid } from "@/grid/Grid.js";
import { makeBastionMap, makeSplitMap } from "../helpers/mock-grid";

describe("Grid", () => {
  describe("constructor", () => {
    it("stores width and height from map data", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      expect(grid.width).toBe(map.width);
      expect(grid.height).toBe(map.height);
    });

    it("stores tiles, spawns, and base from map data", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      expect(grid.tiles).toBe(map.tiles);
      expect(grid.spawns).toEqual(map.spawns);
      expect(grid.base).toEqual(map.base);
    });

    it("computes initial paths for all spawns", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      expect(grid.paths).toHaveLength(1);
      expect(grid.paths?.[0]).not.toBeNull();
      expect(grid.paths?.[0]?.length).toBeGreaterThan(0);
    });

    it("caches the first path for quick access", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      expect(grid.pathCache).not.toBeNull();
      expect(grid.pathCache).toBe(grid.paths?.[0]);
    });
  });

  describe("tile type queries", () => {
    let grid: Grid;
    beforeEach(() => {
      const map = makeBastionMap();
      grid = new Grid(map);
    });

    it("isPath returns true for path tiles", () => {
      const pathTile = grid.paths![0]!.find((tile) => grid.tiles[tile.y][tile.x].type === "path");
      expect(pathTile).toBeDefined();
      expect(grid.isPath(pathTile!.x, pathTile!.y)).toBe(true);
    });

    it("isPath returns false for terrain tiles", () => {
      expect(grid.isPath(0, 0)).toBe(false);
      expect(grid.isPath(0, 2)).toBe(false);
    });

    it("isTerrain returns true for terrain tiles", () => {
      expect(grid.isTerrain(0, 0)).toBe(true);
      expect(grid.isTerrain(0, 2)).toBe(true);
    });

    it("isTerrain returns false for path tiles", () => {
      const pathTile = grid.paths![0]![0];
      expect(grid.isTerrain(pathTile.x, pathTile.y)).toBe(false);
    });

    it("isBase returns true for base tiles", () => {
      const { base } = grid;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bx = base.x + dx;
          const by = base.y + dy;
          if (grid.inBounds(bx, by)) {
            expect(grid.isBase(bx, by)).toBe(true);
          }
        }
      }
    });

    it("isBase returns false for non-base tiles", () => {
      expect(grid.isBase(0, 0)).toBe(false);
    });

    it("isSpawn returns true for spawn tiles", () => {
      const spawn = grid.spawns[0];
      expect(grid.isSpawn(spawn.x, spawn.y)).toBe(true);
    });

    it("isSpawn returns false for non-spawn tiles", () => {
      expect(grid.isSpawn(0, 1)).toBe(false);
    });

    it("inBounds returns correct values for edges", () => {
      expect(grid.inBounds(0, 0)).toBe(true);
      expect(grid.inBounds(grid.width - 1, grid.height - 1)).toBe(true);
      expect(grid.inBounds(-1, 0)).toBe(false);
      expect(grid.inBounds(0, -1)).toBe(false);
      expect(grid.inBounds(grid.width, 0)).toBe(false);
      expect(grid.inBounds(0, grid.height)).toBe(false);
    });
  });

  describe("canBuild", () => {
    let grid: Grid;
    beforeEach(() => {
      const map = makeBastionMap();
      grid = new Grid(map);
    });

    it("returns false for base tiles", () => {
      const { base } = grid;
      expect(grid.canBuild(base.x, base.y)).toBe(false);
      expect(grid.canBuild(base.x + 1, base.y)).toBe(false);
    });

    it("returns false for spawn tiles", () => {
      const spawn = grid.spawns[0];
      expect(grid.canBuild(spawn.x, spawn.y)).toBe(false);
    });

    it("returns true for empty terrain tiles", () => {
      expect(grid.canBuild(0, 0)).toBe(true);
      expect(grid.canBuild(0, 2)).toBe(true);
    });

    it("returns true for path tiles that do not block all routes", () => {
      const map = makeSplitMap();
      const grid2 = new Grid(map);
      expect(grid2.canBuild(0, 0)).toBe(true);
    });

    it("returns false for out-of-bounds tiles", () => {
      expect(grid.canBuild(-1, 0)).toBe(false);
      expect(grid.canBuild(grid.width, 0)).toBe(false);
    });

    it("returns false for terrain tiles already occupied by a tower", () => {
      grid.terrainTowers.add("2,0");
      expect(grid.canBuild(2, 0)).toBe(false);
    });
  });

  describe("registerTower / unregisterTower", () => {
    let grid: Grid;
    beforeEach(() => {
      const map = makeBastionMap();
      grid = new Grid(map);
    });

    it("registers a tower on terrain without affecting paths", () => {
      grid.registerTower(0, 0);
      expect(grid.terrainTowers.has("0,0")).toBe(true);
      expect(grid.blocked.has("0,0")).toBe(false);
      expect(grid.getPathFor(0)).not.toBeNull();
    });

    it("registers a tower on a path tile and marks it blocked", () => {
      const pathTile = grid.paths![0]!.find((tile) => grid.tiles[tile.y][tile.x].type === "path" && tile.x > 0);
      grid.registerTower(pathTile!.x, pathTile!.y);
      expect(grid.blocked.has(`${pathTile!.x},${pathTile!.y}`)).toBe(true);
      expect(grid.terrainTowers.has(`${pathTile!.x},${pathTile!.y}`)).toBe(false);
    });

    it("recomputes paths when a path tile is blocked", () => {
      const pathTile = grid.paths![0]!.find((tile) => grid.tiles[tile.y][tile.x].type === "path" && tile.x > 0);
      const originalPath = [...grid.paths![0]!];
      grid.registerTower(pathTile!.x, pathTile!.y);
      expect(grid.paths![0]!).not.toEqual(originalPath);
    });

    it("unregisters a terrain tower", () => {
      grid.registerTower(0, 0);
      expect(grid.terrainTowers.has("0,0")).toBe(true);
      grid.unregisterTower(0, 0);
      expect(grid.terrainTowers.has("0,0")).toBe(false);
    });

    it("unregisters a path tower and removes from blocked", () => {
      const pathTile = grid.paths![0]!.find((tile) => grid.tiles[tile.y][tile.x].type === "path" && tile.x > 0);
      grid.registerTower(pathTile!.x, pathTile!.y);
      expect(grid.blocked.has(`${pathTile!.x},${pathTile!.y}`)).toBe(true);
      grid.unregisterTower(pathTile!.x, pathTile!.y);
      expect(grid.blocked.has(`${pathTile!.x},${pathTile!.y}`)).toBe(false);
    });

    it("getPathFor returns null for invalid spawn index", () => {
      expect(grid.getPathFor(-1)).toBeNull();
      expect(grid.getPathFor(99)).toBeNull();
    });

    it("getPathFor returns the path for valid spawn index", () => {
      const path = grid.getPathFor(0);
      expect(path).not.toBeNull();
      expect(Array.isArray(path)).toBe(true);
    });
  });

  describe("world/tile conversions", () => {
    it("worldToTile converts world coords to grid coords", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      const tile = grid.worldToTile(0, 0);
      expect(tile).toEqual({ x: 0, y: 0 });
    });

    it("tileToWorld converts grid coords to world center", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      const world = grid.tileToWorld(0, 0);
      expect(world).toEqual({ x: grid.tileSize / 2, y: grid.tileSize / 2 });
    });

    it("round-trips through worldToTile and tileToWorld", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      const tileX = 3;
      const tileY = 2;
      const world = grid.tileToWorld(tileX, tileY);
      const back = grid.worldToTile(world.x, world.y);
      expect(back).toEqual({ x: tileX, y: tileY });
    });
  });

  describe("multi-spawn maps", () => {
    it("computes paths for each spawn in a split map", () => {
      const map = makeSplitMap();
      const grid = new Grid(map);
      expect(grid.paths).toHaveLength(2);
      expect(grid.paths?.[0]).not.toBeNull();
      expect(grid.paths?.[1]).not.toBeNull();
    });

    it("getPathFor returns correct path for each spawn", () => {
      const map = makeSplitMap();
      const grid = new Grid(map);
      const path0 = grid.getPathFor(0)!;
      const path1 = grid.getPathFor(1)!;
      expect(path0[0]).toEqual(map.spawns[0]);
      expect(path1[0]).toEqual(map.spawns[1]);
    });
  });

  describe("getHeight", () => {
    it("returns the height of a tile", () => {
      const map = makeBastionMap();
      const grid = new Grid(map);
      expect(grid.getHeight(0, 0)).toBe(1);
      expect(grid.getHeight(5, 3)).toBe(1);
    });
  });
});
