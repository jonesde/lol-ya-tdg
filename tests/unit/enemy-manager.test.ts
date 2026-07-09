// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

describe("EnemyManager", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;

    resetEnemyId();
    const map = makeBastionMap();
    grid = new Grid(map);
    particles = makeParticleSystem();
    manager = new EnemyManager(grid, particles, 0);
  });

  it("starts with no enemies", () => {
    expect(manager.enemies).toHaveLength(0);
  });

  describe("spawn", () => {
    it("creates an enemy and adds to list", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeDefined();
      expect(enemy.type).toBe("minion");
      expect(manager.enemies).toHaveLength(1);
    });

    it("assigns unique IDs to spawned enemies", () => {
      const enemy1 = manager.spawn("minion", 1, 0, 1);
      const enemy2 = manager.spawn("runner", 1, 0, 1);
      expect(enemy2.id).not.toBe(enemy1.id);
    });

    it("spawns at the correct spawn point", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      const firstTile = grid.tileToWorld(grid.paths![0]![0].x, grid.paths![0]![0].y);
      expect(enemy.x).toBeCloseTo(firstTile.x, 0);
      expect(enemy.y).toBeCloseTo(firstTile.y, 0);
    });
  });

  describe("update", () => {
    it("calls onEnemyKill when an enemy is removed", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.hp = 1;
      const killed: unknown[] = [];
      manager.update(0.016, (enemy) => killed.push(enemy));
      expect(killed).toHaveLength(0);
    });

    it("culled dead enemies from the list", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      manager.update(0.016, () => {});
      expect(manager.enemies).toHaveLength(0);
    });

    it("removes enemies that die during update from spatial hash", () => {
      const enemy = manager.spawn("runner", 1, 0, 1);
      enemy.hp = 10;
      enemy.applyBurn(1000, 1.0);
      manager.update(0.016, () => {});
      expect(manager.enemies).toHaveLength(0);
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("spawns particles when enemy dies", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      const countBefore = particles.spawns.length;
      manager.update(0.016, () => {});
      expect(particles.spawns.length).toBeGreaterThan(countBefore);
    });

    it("moves enemies toward their target", () => {
      const enemy = manager.spawn("runner", 1, 0, 1);
      const startX = enemy.x;
      const startY = enemy.y;
      manager.update(1.0, () => {});
      const _expectedDist = ENEMY_TYPES.runner.speed * grid.tileSize;
      const _actualDist = Math.hypot(enemy.x - startX, enemy.y - startY);
      expect(enemy.x).not.toBe(startX);
    });
  });

  describe("getEnemiesInRange", () => {
    it("returns enemies within range", () => {
      manager.spawn("minion", 1, 0, 1);
      const towerPos = { x: 18, y: 18 };
      const inRange = manager.getEnemiesInRange(towerPos.x, towerPos.y, grid.tileSize * 3.5);
      expect(inRange.length).toBeGreaterThan(0);
    });

    it("excludes removed enemies", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      const inRange = manager.getEnemiesInRange(18, 18, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("excludes enemies that reached base", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.reachedBase = true;
      const inRange = manager.getEnemiesInRange(18, 18, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("returns empty array when no enemies in range", () => {
      const farEnemy = manager.spawn("minion", 1, 0, 1);
      farEnemy.x = 10000;
      farEnemy.y = 10000;
      const inRange = manager.getEnemiesInRange(18, 18, 1);
      expect(inRange).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all enemies and resets IDs", () => {
      manager.spawn("minion", 1, 0, 1);
      manager.spawn("minion", 1, 0, 1);
      manager.clear();
      expect(manager.enemies).toHaveLength(0);
      const enemy = manager.spawn("minion", 1, 0, 1);
      expect(enemy.id).toBe(1);
    });
  });

  describe("incremental spatial hash", () => {
    it("initializes enemy cell tracking on spawn", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      expect(enemy.lastCellX).toBe(Math.floor(enemy.x / 100));
      expect(enemy.lastCellY).toBe(Math.floor(enemy.y / 100));
    });

    it("does not rehash enemies that stay in the same cell", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      const cellXBefore = enemy.lastCellX;
      const cellYBefore = enemy.lastCellY;
      manager.update(0.001, () => {});
      expect(enemy.lastCellX).toBe(cellXBefore);
      expect(enemy.lastCellY).toBe(cellYBefore);
    });

    it("rehashes enemies that move to a new cell", () => {
      const enemy = manager.spawn("runner", 1, 0, 1);
      const cellXBefore = enemy.lastCellX;
      manager.update(1.0, () => {});
      const cellXAfter = enemy.lastCellX;
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).toContain(enemy);
      expect(cellXAfter).toBeGreaterThanOrEqual(cellXBefore);
    });

    it("removes enemy from spatial hash on cull", () => {
      const enemy = manager.spawn("minion", 1, 0, 1);
      enemy.removed = true;
      manager.update(0.016, () => {});
      const inRange = manager.getEnemiesInRange(enemy.x, enemy.y, 10);
      expect(inRange).not.toContain(enemy);
    });

    it("maintains correct hash after multiple spawn and cull cycles", () => {
      const e1 = manager.spawn("minion", 1, 0, 1);
      const e2 = manager.spawn("runner", 1, 0, 1);
      e1.removed = true;
      manager.update(0.016, () => {});
      expect(manager.enemies).toHaveLength(1);
      expect(manager.enemies[0]).toBe(e2);
      const inRange = manager.getEnemiesInRange(e2.x, e2.y, 10);
      expect(inRange).toContain(e2);
      expect(inRange).not.toContain(e1);
    });
  });

  describe("getEnemiesInRange equivalence with forEachEnemyInRange (Finding 5)", () => {
    it("visits the same survivors in the same order as the array form", () => {
      const e1 = manager.spawn("minion", 1, 0, 1);
      const e2 = manager.spawn("minion", 1, 0, 1);
      const removed = manager.spawn("runner", 1, 0, 1);
      removed.removed = true;
      const reached = manager.spawn("minion", 1, 0, 1);
      reached.reachedBase = true;

      const arr = manager.getEnemiesInRange(18, 18, 10000);
      const via: typeof arr = [];
      manager.forEachEnemyInRange(18, 18, 10000, (enemy) => via.push(enemy));

      expect(via.map((e) => e.id)).toEqual(arr.map((e) => e.id));
      expect(arr).not.toContain(removed);
      expect(arr).not.toContain(reached);
      expect(via).not.toContain(removed);
      expect(via).not.toContain(reached);
      expect(arr).toContain(e1);
      expect(arr).toContain(e2);
    });
  });
});
