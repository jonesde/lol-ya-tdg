// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import { SELL_VALUE_RATIO } from "@/game/Constants.js";
import { Grid } from "@/grid/Grid.js";
import type { Tower } from "@/towers/Tower.js";
import { TowerManager } from "@/towers/TowerManager.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem, makeSoundManager } from "../helpers/mock-managers";

type TowerId = "basic" | "ice" | "sniper" | "cannon" | "lightning" | "railgun";

interface UnlockedState {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

interface SaveFixture {
  gems: number;
  unlocked: Record<TowerId, UnlockedState>;
  generalAddons: Record<string, unknown>;
}

function makeSave(): SaveFixture {
  return {
    gems: 99999,
    unlocked: {
      basic: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      ice: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      sniper: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      cannon: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      lightning: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      railgun: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
    },
    generalAddons: {
      extraHealth: null,
      startingGold: null,
      sellRefundUnlocked: false,
      sellDiscountUnlocked: false,
      sellActive: null,
      upgradeCostReduction: null,
      terrainHeightBonus: null,
      damageMilestoneBonus: null,
    },
  };
}

describe("TowerManager", () => {
  let manager: TowerManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;
  let sound: ReturnType<typeof makeSoundManager>;

  beforeEach(() => {
    const map = makeBastionMap();
    const realGrid = new Grid(map);
    grid = realGrid;

    particles = makeParticleSystem();
    sound = makeSoundManager();
    const projectiles = {
      spawn: () => {},
      fireLightning: () => {},
      spawnLightningFlash: () => {},
      setOnLightningFlash: () => {},
    };
    manager = new TowerManager(realGrid, particles, projectiles, sound);
  });

  it("starts with no towers", () => {
    expect(manager.towers).toHaveLength(0);
  });

  describe("build", () => {
    it("builds a tower on a valid terrain tile", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(tower.type).toBe("basic");
      expect(tower.tileX).toBe(0);
      expect(tower.tileY).toBe(0);
      expect(manager.towers).toHaveLength(1);
    });

    it("returns null when canBuild returns false", () => {
      // Base tile should not be buildable
      const tower = manager.build("basic", grid.base.x, grid.base.y, makeSave(), grid);
      expect(tower).toBeNull();
    });

    it("registers the tower on the grid", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      // For terrain tiles, should be in terrainTowers
      expect(grid.terrainTowers.has("0,0")).toBe(true);
    });

    it("spawns particles at tower position", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[0].x).toBe(0 * 36 + 18);
      expect(particles.spawns[0].y).toBe(0 * 36 + 18);
    });

    it("plays place sound", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(sound.plays).toContain("place");
    });

    it("can build multiple towers on different tiles", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      manager.build("basic", 1, 0, makeSave(), grid);
      manager.build("basic", 2, 0, makeSave(), grid);
      expect(manager.towers).toHaveLength(3);
    });
  });

  describe("sell", () => {
    it("removes tower from manager and grid", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(manager.towers).toHaveLength(1);
      const _val = manager.sell(tower, makeSave());
      expect(manager.towers).toHaveLength(0);
      expect(grid.terrainTowers.has("0,0")).toBe(false);
    });

    it("returns the sell value", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      const expected = Math.round(tower.totalInvested * SELL_VALUE_RATIO);
      const val = manager.sell(tower, makeSave());
      expect(val).toBe(expected);
    });

    it("spawns sell particles", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.sell(tower, makeSave());
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[particles.spawns.length - 1].color).toBe("#ffcf4d");
    });
  });

  describe("cancelBuild", () => {
    it("removes tower from manager and grid", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(manager.towers).toHaveLength(1);
      const refund = manager.cancelBuild(tower);
      expect(manager.towers).toHaveLength(0);
      expect(grid.terrainTowers.has("0,0")).toBe(false);
      expect(refund).toBe(tower.totalInvested);
    });

    it("spawns cancel particles", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.cancelBuild(tower);
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[particles.spawns.length - 1].color).toBe("#88ff88");
    });
  });

  describe("towerAt", () => {
    it("returns the tower at the given grid coords", () => {
      const tower = manager.build("basic", 3, 2, makeSave(), grid);
      expect(manager.towerAt(3, 2)).toBe(tower);
    });

    it("returns null when no tower at coords", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(manager.towerAt(5, 5)).toBeFalsy();
    });

    it("returns null for out-of-bounds coords", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(manager.towerAt(-1, -1)).toBeFalsy();
    });
  });

  describe("clear", () => {
    it("removes all towers", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      manager.build("basic", 1, 0, makeSave(), grid);
      manager.clear();
      expect(manager.towers).toHaveLength(0);
    });
  });
});
