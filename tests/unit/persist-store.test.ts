// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPersistStore } from "../helpers/mock-stores";

describe("PersistStore", () => {
  let store: ReturnType<typeof createTestPersistStore>;

  beforeEach(() => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {});
    vi.spyOn(localStorage, "getItem").mockImplementation(() => null);
    store = createTestPersistStore();
  });

  describe("initial state", () => {
    it("starts with 0 gems", () => {
      expect(store.gems).toBe(0);
    });

    it("starts with highestUnlockedMap = 0", () => {
      expect(store.highestUnlockedMap).toBe(0);
    });

    it("starts with empty bestWaves", () => {
      expect(store.bestWaves).toEqual({});
    });

    it("starts with default difficulty tick 0", () => {
      expect(store.difficulty.multiplierTick).toBe(0);
    });

    it("starts with all general addons null", () => {
      expect(store.generalAddons.extraHealth).toBeNull();
      expect(store.generalAddons.startingGold).toBeNull();
      expect(store.generalAddons.upgradeCostReduction).toBeNull();
      expect(store.generalAddons.terrainHeightBonus).toBeNull();
      expect(store.generalAddons.damageMilestoneBonus).toBeNull();
      expect(store.generalAddons.slowHealing).toBeNull();
    });

    it("has all expected general addon keys in default state", () => {
      const expectedKeys = [
        "extraHealth",
        "startingGold",
        "sellRefundUnlocked",
        "sellDiscountUnlocked",
        "sellActive",
        "upgradeCostReduction",
        "terrainHeightBonus",
        "damageMilestoneBonus",
        "slowHealing",
      ];
      for (const key of expectedKeys) {
        expect(store.generalAddons).toHaveProperty(key);
      }
    });

    it("starts with all tower levels 1-2 unlocked", () => {
      for (const towerId of Object.keys(store.unlocked)) {
        expect(store.unlocked[towerId].levels[0]).toBe(true);
        expect(store.unlocked[towerId].levels[1]).toBe(true);
        expect(store.unlocked[towerId].levels[2]).toBe(false);
      }
    });
  });

  describe("difficultyMultiplier getter", () => {
    it("returns 1.0 when tick is 0", () => {
      expect(store.difficultyMultiplier).toBe(1.0);
    });

    it("returns 1.25 when tick is 1", () => {
      store.setDifficultyTick(1);
      expect(store.difficultyMultiplier).toBeCloseTo(1.25, 4);
    });

    it("returns 2.0 when tick is 4", () => {
      store.setDifficultyTick(4);
      expect(store.difficultyMultiplier).toBeCloseTo(2.0, 4);
    });

    it("returns 4.0 when tick is 12 (max)", () => {
      store.setDifficultyTick(12);
      expect(store.difficultyMultiplier).toBeCloseTo(4.0, 4);
    });

    it("formula is tick * 0.25 + 1", () => {
      for (let tick = 0; tick <= 12; tick++) {
        store.setDifficultyTick(tick);
        const expected = tick * 0.25 + 1;
        expect(store.difficultyMultiplier).toBeCloseTo(expected, 4);
      }
    });
  });

  describe("setDifficultyTick / getDifficultyTick", () => {
    it("stores and retrieves the tick value", () => {
      store.setDifficultyTick(6);
      expect(store.getDifficultyTick()).toBe(6);
    });

    it("persists via save()", () => {
      store.setDifficultyTick(3);
      expect(store.difficulty.multiplierTick).toBe(3);
    });
  });

  describe("updateBestWave", () => {
    it("stores best wave for a map", () => {
      store.updateBestWave(0, 10);
      expect(store.bestWaves.best_0).toBe(10);
    });

    it("only improves (does not lower) the best wave", () => {
      store.updateBestWave(0, 10);
      store.updateBestWave(0, 5);
      expect(store.bestWaves.best_0).toBe(10);
    });

    it("updates when new wave is higher", () => {
      store.updateBestWave(0, 10);
      store.updateBestWave(0, 15);
      expect(store.bestWaves.best_0).toBe(15);
    });

    it("handles different maps independently", () => {
      store.updateBestWave(0, 10);
      store.updateBestWave(1, 20);
      expect(store.bestWaves.best_0).toBe(10);
      expect(store.bestWaves.best_1).toBe(20);
    });
  });

  describe("maybeUnlockNextMap", () => {
    it("increments highestUnlockedMap", () => {
      store.highestUnlockedMap = 0;
      store.maybeUnlockNextMap(0);
      expect(store.highestUnlockedMap).toBe(1);
    });

    it("does not go beyond map 35", () => {
      store.highestUnlockedMap = 35;
      store.maybeUnlockNextMap(35);
      expect(store.highestUnlockedMap).toBe(35);
    });

    it("does not unlock for negative map index", () => {
      store.highestUnlockedMap = 0;
      store.maybeUnlockNextMap(-1);
      expect(store.highestUnlockedMap).toBe(0);
    });

    it("uses Math.max (does not go backward)", () => {
      store.highestUnlockedMap = 5;
      store.maybeUnlockNextMap(2);
      expect(store.highestUnlockedMap).toBe(5);
    });
  });

  describe("active waves", () => {
    it("saves and retrieves active wave", () => {
      store.saveActiveWave(0, 15);
      expect(store.activeWaves[0]).toBe(15);
    });

    it("clears active wave on game end", () => {
      store.saveActiveWave(0, 15);
      store.clearActiveWave(0);
      expect(store.activeWaves[0]).toBeUndefined();
    });

    it("handles clearing non-existent wave gracefully", () => {
      expect(() => store.clearActiveWave(99)).not.toThrow();
    });
  });

  describe("first-time milestones", () => {
    it("returns true before marking (first time)", () => {
      expect(store.isFirstTimeMilestone(0, 15)).toBe(true);
    });

    it("returns false after marking", () => {
      store.markFirstTimeMilestone(0, 15);
      expect(store.isFirstTimeMilestone(0, 15)).toBe(false);
    });

    it("tracks different maps independently", () => {
      store.markFirstTimeMilestone(0, 15);
      expect(store.isFirstTimeMilestone(0, 15)).toBe(false);
      expect(store.isFirstTimeMilestone(1, 15)).toBe(true);
    });

    it("tracks different waves independently", () => {
      store.markFirstTimeMilestone(0, 15);
      expect(store.isFirstTimeMilestone(0, 15)).toBe(false);
      expect(store.isFirstTimeMilestone(0, 30)).toBe(true);
    });
  });

  describe("first clears", () => {
    it("returns true before marking (first clear)", () => {
      expect(store.isFirstClear(0)).toBe(true);
    });

    it("returns false after marking", () => {
      store.markFirstClear(0);
      expect(store.isFirstClear(0)).toBe(false);
    });

    it("tracks different maps independently", () => {
      store.markFirstClear(0);
      expect(store.isFirstClear(0)).toBe(false);
      expect(store.isFirstClear(1)).toBe(true);
    });
  });

  describe("save / load", () => {
    it("save writes to localStorage", () => {
      store.gems = 100;
      store.save();
      expect((localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it("load restores from localStorage", () => {
      const testData = { gems: 50, highestUnlockedMap: 3 };
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(JSON.stringify(testData));
      store.load();
      expect(store.gems).toBe(50);
      expect(store.highestUnlockedMap).toBe(3);
    });

    it("load merges with defaults for missing fields", () => {
      const testData = { gems: 50 };
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(JSON.stringify(testData));
      store.load();
      expect(store.gems).toBe(50);
      expect(store.bestWaves).toEqual({});
    });

    it("reset restores default state", () => {
      store.gems = 999;
      store.setDifficultyTick(6);
      store.reset();
      expect(store.gems).toBe(0);
      expect(store.difficulty.multiplierTick).toBe(0);
    });
  });

  describe("schema migration on load", () => {
    it("handles old save format with missing fields", () => {
      const oldData = { gems: 10 };
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce(JSON.stringify(oldData));
      expect(() => store.load()).not.toThrow();
      expect(store.gems).toBe(10);
      expect(store.generalAddons).toBeDefined();
    });

    it("handles corrupted save by resetting", () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce("not json");
      expect(() => store.load()).not.toThrow();
      expect(store.gems).toBe(0);
    });
  });
});
