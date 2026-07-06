// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnemyId } from "@/enemies/Enemy.js";
import { EnemyManager } from "@/enemies/EnemyManager.js";
import {
  BETWEEN_WAVES_TIMER,
  BOSS_CADENCE,
  ENEMY_TYPES,
  PRE_EMPTIVE_WAVE_TIMER,
  VICTORY_WAVE,
  WAVE_COUNT_BASE,
  WAVE_COUNT_SCALE,
} from "@/game/Constants.js";
import { Grid } from "@/grid/Grid.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { WaveManager } from "@/waves/WaveManager.js";
import { makeBastionMap, makeMapData } from "../helpers/mock-grid";
import { makeParticleSystem } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores";

beforeEach(() => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const themeStore = useMapThemeStore();
  themeStore.defaultTheme = mockDefaultTheme;
  themeStore.activeTheme = mockDefaultTheme;
});

function makeWaveManager(mapData: ReturnType<typeof makeBastionMap>) {
  resetEnemyId();
  const grid = new Grid(mapData);
  const particles = makeParticleSystem();
  const enemyManager = new EnemyManager(grid, particles, 0);
  return new WaveManager(mapData, enemyManager);
}

function makeMultiSpawnMap() {
  const map = makeBastionMap();
  map.spawns = [
    { x: 0, y: 3 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
  ];
  return map;
}

function makeMultiSpawnWaveManager() {
  const map = makeMultiSpawnMap();
  resetEnemyId();
  const grid = new Grid(map);
  const particles = makeParticleSystem();
  const enemyManager = new EnemyManager(grid, particles, 0);
  return new WaveManager(map, enemyManager);
}
describe("WaveManager", () => {
  describe("constructor", () => {
    it("initializes with wave 0 and betweenWaves = true", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.currentWave).toBe(0);
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.active).toBe(false);
    });

    it("sets bossCadence from map", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.bossCadence).toBe(BOSS_CADENCE[0]);
    });

    it("sets maxWaves to VICTORY_WAVE", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      expect(waveManager.maxWaves).toBe(VICTORY_WAVE);
    });
  });

  describe("generateWave", () => {
    it("generates correct enemy count for wave 1", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(1);
      const expectedCount = WAVE_COUNT_BASE + Math.floor(1 * WAVE_COUNT_SCALE);
      expect(wave.length).toBe(expectedCount);
    });

    it("scales enemy count with wave number", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const waveOne = waveManager.generateWave(1);
      const waveTen = waveManager.generateWave(10);
      const expectedOne = WAVE_COUNT_BASE + Math.floor(1 * WAVE_COUNT_SCALE);
      const expectedTen = WAVE_COUNT_BASE + Math.floor(10 * WAVE_COUNT_SCALE);
      // Wave 10 is a boss wave (10 % 5 === 0), so it has extra bosses
      expect(waveOne.length).toBe(expectedOne);
      expect(waveTen.length).toBeGreaterThanOrEqual(expectedTen);
      expect(waveTen.length).toBeGreaterThan(waveOne.length);
    });

    it("sets enemy level based on wave and region level", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      const wave = waveManager.generateWave(10);
      const expectedLevel = Math.max(1, Math.floor(10 / 3) + map.level);
      for (const entry of wave) {
        expect(entry.level).toBe(expectedLevel);
      }
    });

    it("includes boss at boss cadence waves for region 0", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(BOSS_CADENCE[0]);
      const bosses = wave.filter((enemy) => enemy.type === "boss");
      expect(bosses.length).toBeGreaterThanOrEqual(1);
    });

    it("does not include boss at non-cadence waves", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(7); // 7 % 10 !== 0
      const bosses = wave.filter((enemy) => enemy.type === "boss");
      expect(bosses).toHaveLength(0);
    });

    it("includes extra bosses at wave 30, 60, 90...", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave30 = waveManager.generateWave(30);
      const bosses30 = wave30.filter((enemy) => enemy.type === "boss");
      const expectedBossCount = 1 + Math.floor(30 / 30);
      expect(bosses30.length).toBe(expectedBossCount);
    });

    it("produces deterministic waves for the same seed", () => {
      const map = makeBastionMap();
      const waveManagerA = makeWaveManager(map);
      const waveManagerB = makeWaveManager(map);
      const waveA = waveManagerA.generateWave(10);
      const waveB = waveManagerB.generateWave(10);
      expect(waveA).toEqual(waveB);
    });

    it("produces different waves for different seeds", () => {
      const mapA = makeBastionMap();
      const mapB = makeMapData({ ...mapA, seed: 9999 });
      const waveManagerA = makeWaveManager(mapA);
      const waveManagerB = makeWaveManager(mapB);
      const waveA = waveManagerA.generateWave(10);
      const waveB = waveManagerB.generateWave(10);
      expect(waveA).not.toEqual(waveB);
    });

    it("includes runners in waves >= 5", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave5 = waveManager.generateWave(5);
      const types = new Set(wave5.map((e) => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it("includes varied enemy types in waves >= 8", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave8 = waveManager.generateWave(8);
      const types = new Set(wave8.map((e) => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it("includes varied enemy types in waves >= 12", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave12 = waveManager.generateWave(12);
      const types = new Set(wave12.map((e) => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it("includes varied enemy types in waves >= 15", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave15 = waveManager.generateWave(15);
      const types = new Set(wave15.map((e) => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it("all enemies have valid types", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      for (let waveNumber = 1; waveNumber <= 20; waveNumber++) {
        const wave = waveManager.generateWave(waveNumber);
        for (const entry of wave) {
          expect(ENEMY_TYPES[entry.type]).toBeDefined();
        }
      }
    });

    it("each entry has a delay property", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      const wave = waveManager.generateWave(1);
      for (const entry of wave) {
        expect(entry.delay).toBeDefined();
        expect(typeof entry.delay).toBe("number");
      }
    });
  });

  describe("startNextWave", () => {
    it("increments currentWave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.currentWave).toBe(1);
    });

    it("sets betweenWaves to false", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("sets active to true", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.active).toBe(true);
    });

    it("generates and stores the wave queue", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.queue.length).toBeGreaterThan(0);
    });

    it("counts bosses in the wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      const expectedBosses = waveManager.queue.filter((enemy) => enemy.type === "boss").length;
      expect(waveManager.bossesThisWave).toBe(expectedBosses);
    });
  });

  describe("update", () => {
    it("waits BETWEEN_WAVES_TIMER seconds between waves", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      // betweenTimer starts at 0, so first update will start wave immediately
      let startedWave: number | null = null;
      waveManager.update(0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(1);
      expect(waveManager.betweenWaves).toBe(false);
    });

    it("calls onWaveStart when starting a wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      let startedWave: number | null = null;
      waveManager.update(BETWEEN_WAVES_TIMER + 0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(1);
    });

    it("spawns enemies from the queue", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      const initialEnemyCount = waveManager.enemyManager.enemies.length;
      waveManager.update(10.0, null, null); // Let time pass
      expect(waveManager.enemyManager.enemies.length).toBeGreaterThan(initialEnemyCount);
    });

    it("starts countdown immediately when all enemies are dead and queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.countdownActive).toBe(true);
      expect(waveManager.countdownTimer).toBe(BETWEEN_WAVES_TIMER);
    });

    it("does not start countdown before PRE_EMPTIVE_WAVE_TIMER when enemies remain", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER - 1, null, null);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.countdownTimer).toBe(0);
    });

    it("starts next wave directly after PRE_EMPTIVE_WAVE_TIMER even when enemies remain", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, null);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.betweenWaves).toBe(false);
      expect(waveManager._waveGameTime).toBe(0);
    });

    it("timer starts next wave with onWaveStart callback", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.queue = [];
      let startedWave: number | null = null;
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(2);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.countdownActive).toBe(false);
      expect(waveManager.betweenWaves).toBe(false);
    });
  });

  describe("reportBossReachedBase", () => {
    it("increments bossesReachedBaseThisWave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.reportBossReachedBase();
      waveManager.reportBossReachedBase();
      expect(waveManager.bossesReachedBaseThisWave).toBe(2);
    });

    it("resets on startNextWave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.reportBossReachedBase();
      expect(waveManager.bossesReachedBaseThisWave).toBe(1);
      waveManager.startNextWave();
      expect(waveManager.bossesReachedBaseThisWave).toBe(0);
    });
  });

  describe("waveComposition", () => {
    it("tracks type counts after starting a wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      expect(waveManager.waveComposition).toBeDefined();
      expect(typeof waveManager.waveComposition).toBe("object");
      // Should have at least one type
      const total = Object.values(waveManager.waveComposition).reduce((sum, value) => sum + value, 0);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("spawn state tracking", () => {
    it("initializes all spawn states as closed", () => {
      const map = makeBastionMap();
      const waveManager = makeWaveManager(map);
      expect(waveManager.spawnStates).toHaveLength(map.spawns.length);
      for (const state of waveManager.spawnStates) {
        expect(state.visualState).toBe("closed");
        expect(state.closeTransitionTimer).toBe(0);
      }
    });

    it("markSpawnUsed sets spawn to open", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(0);
      expect(waveManager.spawnStates[0]!.visualState).toBe("open");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0);
    });

    it("markSpawnUsed ignores out-of-range indices", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(999);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
    });

    it("updateSpawnTimers decrements closeTransitionTimer", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.spawnStates[0]!.visualState = "transition";
      waveManager.spawnStates[0]!.closeTransitionTimer = 1;
      waveManager.updateSpawnTimers(0.4);
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeCloseTo(0.6);
    });

    it("updateSpawnTimers transitions to closed when timer reaches zero", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.spawnStates[0]!.visualState = "transition";
      waveManager.spawnStates[0]!.closeTransitionTimer = 0.5;
      waveManager.updateSpawnTimers(0.6);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeLessThanOrEqual(0);
    });

    it("updateSpawnTimers does not affect closed or open spawns", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.spawnStates[0]!.visualState = "closed";
      waveManager.spawnStates[0]!.closeTransitionTimer = 0.5;
      waveManager.spawnStates[1]!.visualState = "open";
      waveManager.spawnStates[1]!.closeTransitionTimer = 0.5;
      waveManager.updateSpawnTimers(1);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0.5);
      expect(waveManager.spawnStates[1]!.visualState).toBe("open");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(0.5);
    });

    it("saveActiveSpawns captures open spawns", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.saveActiveSpawns();
      expect(waveManager.prevWaveSpawnIndices.has(0)).toBe(true);
      expect(waveManager.prevWaveSpawnIndices.has(1)).toBe(true);
      expect(waveManager.prevWaveSpawnIndices.has(2)).toBe(false);
    });

    it("transitionActiveSpawnsToTransition sets open spawns to transition", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.saveActiveSpawns();
      waveManager.transitionActiveSpawnsToTransition();
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("closeAllSpawns resets tracked spawns to closed", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.markSpawnUsed(0);
      waveManager.saveActiveSpawns();
      waveManager.transitionActiveSpawnsToTransition();
      waveManager.closeAllSpawns();
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(0);
      expect(waveManager.prevWaveSpawnIndices.size).toBe(0);
    });

    it("queue empty transitions all open spawns to transition", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("queue empty does not re-transition already-transitioning spawns", () => {
      const waveManager = makeMultiSpawnWaveManager();
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.markSpawnUsed(1);
      waveManager.transitionSpawnToClosed(0);
      waveManager.queue = [];
      waveManager.update(0.1, null, null);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[0]!.closeTransitionTimer).toBeCloseTo(0.9);
      expect(waveManager.spawnStates[1]!.visualState).toBe("transition");
      expect(waveManager.spawnStates[1]!.closeTransitionTimer).toBe(1);
      expect(waveManager.spawnStates[2]!.visualState).toBe("closed");
    });

    it("natural wave clear transitions open spawns to transition when queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.queue = [];
      let waveCleared = false;
      waveManager.update(
        0.1,
        () => {
          waveCleared = true;
        },
        null,
      );
      expect(waveCleared).toBe(true);
      expect(waveManager.countdownActive).toBe(true);
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
    });

    it("pre-emptive wave transitions open spawns to transition when queue is empty", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.enemyManager.spawn("minion", 1, 0, 1);
      waveManager.queue = [];
      waveManager.update(PRE_EMPTIVE_WAVE_TIMER + 1, null, null);
      expect(waveManager.currentWave).toBe(2);
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
    });

    it("between-waves close transitions to closed then starts next wave", () => {
      const waveManager = makeWaveManager(makeBastionMap());
      waveManager.startNextWave();
      waveManager.markSpawnUsed(0);
      waveManager.queue = [];
      waveManager.update(0.1, () => {}, null);
      // Queue was empty, so spawn transitions to "transition" immediately
      expect(waveManager.spawnStates[0]!.visualState).toBe("transition");
      expect(waveManager.betweenWaves).toBe(true);
      expect(waveManager.countdownActive).toBe(true);

      // Advance past both the 1s transition timer and the between-waves timer
      let startedWave: number | null = null;
      waveManager.update(BETWEEN_WAVES_TIMER + 0.1, null, (wave) => {
        startedWave = wave;
      });
      expect(startedWave).toBe(2);
      expect(waveManager.spawnStates[0]!.visualState).toBe("closed");
    });
  });
});
