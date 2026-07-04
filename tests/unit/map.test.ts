// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { MAP_GEM_MULTIPLIERS, MAP_LEVELS, TOTAL_MAPS } from "@/game/Constants.js";
import { BOSS_CADENCE } from "@/game/ConstantsEnemy.js";
import { Grid } from "@/grid/Grid.js";
import { generateRandomMap, getMap } from "@/grid/Map.js";

describe("Map generation", () => {
  describe("getMap", () => {
    it("returns a valid map for each of the 36 maps", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        expect(map).toBeDefined();
        expect(map.width).toBeGreaterThan(0);
        expect(map.height).toBeGreaterThan(0);
        expect(map.spawns.length).toBeGreaterThan(0);
        expect(map.base).toBeDefined();
      }
    });

    it("returns maps with valid spawn-to-base paths", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = grid.getPathFor(s);
          expect(path, `Map ${i}, spawn ${s} should have a valid path`).not.toBeNull();
          expect(path?.length).toBeGreaterThan(0);
          const pathTiles = path!;
          const last = pathTiles[pathTiles.length - 1];
          expect(last.x).toBe(map.base.x);
          expect(last.y).toBe(map.base.y);
        }
      }
    });

    it("returns maps with correct region metadata", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const config = MAP_LEVELS[i];
        expect(map.regionId).toBe(config.regionId);
        expect(map.level).toBe(config.level);
        expect(map.style).toBe(config.style);
        expect(map.bossCadence).toBe(BOSS_CADENCE[config.regionId]);
      }
    });

    it("returns maps with correct dimensions from config", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        const config = MAP_LEVELS[i];
        expect(map.width).toBe(config.width);
        expect(map.height).toBe(config.height);
      }
    });

    it("caches maps (returns same object on repeat calls)", () => {
      const map1 = getMap(0);
      const map2 = getMap(0);
      expect(map1).toBe(map2);
    });

    it("returns different objects for different map indices", () => {
      const map0 = getMap(0);
      const map1 = getMap(1);
      expect(map0).not.toBe(map1);
    });

    it("all maps have name property", () => {
      for (let i = 0; i < TOTAL_MAPS; i++) {
        const map = getMap(i);
        expect(map.name).toBeDefined();
        expect(typeof map.name).toBe("string");
        expect(map.name).toMatch(/^Region \d+ \d+$/);
      }
    });
  });

  describe("generateRandomMap", () => {
    it("produces deterministic output for same seed", () => {
      const map1 = generateRandomMap(20, 20, "bastion", 0, 1, 12345);
      const map2 = generateRandomMap(20, 20, "bastion", 0, 1, 12345);
      expect(map2).toEqual(map1);
    });

    it("produces different output for different seeds", () => {
      const map1 = generateRandomMap(20, 20, "open", 0, 1, 12345);
      const map2 = generateRandomMap(20, 20, "open", 0, 1, 99999);
      let different = false;
      for (let y = 0; y < map1.height && !different; y++) {
        for (let x = 0; x < map1.width && !different; x++) {
          if (map1.tiles[y][x].type !== map2.tiles[y][x].type) different = true;
        }
      }
      expect(different).toBe(true);
    });

    it("all 6 styles produce valid maps with paths", () => {
      const styles = ["open", "canyon", "serpentine", "split", "bastion", "battlefield"];
      for (const style of styles) {
        const map = generateRandomMap(20, 20, style, 0, 1, 42);
        const grid = new Grid(map);
        for (let s = 0; s < grid.spawns.length; s++) {
          const path = grid.getPathFor(s);
          expect(path, `${style}: spawn ${s} should have a valid path`).not.toBeNull();
          void path;
        }
      }
    });

    it("split style produces 2 spawns", () => {
      const map = generateRandomMap(20, 20, "split", 0, 1, 42);
      expect(map.spawns).toHaveLength(2);
    });

    it("other styles produce 1 spawn", () => {
      const styles = ["open", "canyon", "serpentine", "bastion", "battlefield"];
      for (const style of styles) {
        const map = generateRandomMap(20, 20, style, 0, 1, 42);
        expect(map.spawns, `${style} should have 1 spawn`).toHaveLength(1);
      }
    });

    it("tiles contain only valid types", () => {
      const map = generateRandomMap(20, 20, "bastion", 0, 1, 42);
      const validTypes = new Set(["terrain", "path", "base", "spawn"]);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          expect(validTypes.has(map.tiles[y][x].type)).toBe(true);
        }
      }
    });

    it("height values are between 1 and 4", () => {
      const map = generateRandomMap(20, 20, "bastion", 0, 1, 42);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const height = map.tiles[y][x].height;
          expect(height).toBeGreaterThanOrEqual(1);
          expect(height).toBeLessThanOrEqual(4);
        }
      }
    });

    it("regionId is set correctly", () => {
      for (let r = 0; r < 3; r++) {
        const map = generateRandomMap(20, 20, "bastion", r, 1, 42);
        expect(map.regionId).toBe(r);
      }
    });

    it("MAP_GEM_MULTIPLIERS has 36 entries", () => {
      expect(MAP_GEM_MULTIPLIERS.length).toBe(36);
    });

    it("MAP_GEM_MULTIPLIERS values increase with map index", () => {
      expect(MAP_GEM_MULTIPLIERS[0]).toBe(1);
      expect(MAP_GEM_MULTIPLIERS[4]).toBe(2);
      expect(MAP_GEM_MULTIPLIERS[8]).toBe(3);
      expect(MAP_GEM_MULTIPLIERS[12]).toBe(4);
      expect(MAP_GEM_MULTIPLIERS[24]).toBe(7);
      expect(MAP_GEM_MULTIPLIERS[32]).toBe(10);
    });
  });
});
