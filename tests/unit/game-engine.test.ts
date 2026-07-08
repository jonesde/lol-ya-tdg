// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOSS_LIFE_LOSS,
  BOUNTY_BLOCKED_RATIO,
  DIFFICULTY_MULT_GEM_BASE,
  FIRST_TIME_MILESTONE_MULT,
  GameState,
  MAP_GEM_MULTIPLIERS,
  MILESTONE_GEMS,
  StartingGold,
} from "@/game/Constants.js";
import { SELL_VALUE_RATIO } from "@/game/ConstantsTower.js";
import { GameEngine } from "@/game/GameEngine.js";
import { difficultyMultiplier as getDifficultyMultiplier } from "@/sim/PersistState.js";
import type { Tower } from "@/towers/Tower.js";
import {
  createTestGameStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores";

describe("GameEngine", () => {
  let engine: GameEngine;
  let _gameStore: ReturnType<typeof createTestGameStore>;
  let mockHost: MockHostBindings;

  // New architecture: persistState is a constructor argument; loadMap(mapIndex)
  // no longer takes it. This helper constructs a fully-initialized engine.
  function initEngine(mapIndex: number, persistState: ReturnType<typeof createTestPersistState>): GameEngine {
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, mapIndex);
    engine.loadMap(mapIndex);
    return engine;
  }

  beforeEach(() => {
    _gameStore = createTestGameStore();
    mockHost = new MockHostBindings();
    engine = new GameEngine(createTestPersistState(), createTestThemeBundle(), mockHost, 0);
  });

  describe("constructor", () => {
    it("stores reference to host", () => {
      expect(engine.host).toBe(mockHost);
    });

    it("initializes with null managers", () => {
      expect(engine.grid).toBeNull();
      expect(engine.enemyManager).toBeNull();
      expect(engine.towerManager!).toBeNull();
      expect(engine.waveManager).toBeNull();
    });
  });

  describe("loadMap", () => {
    it("initializes all subsystems", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.grid).not.toBeNull();
      expect(engine.enemyManager).not.toBeNull();
      expect(engine.towerManager!).not.toBeNull();
      expect(engine.waveManager).not.toBeNull();
    });

    it("sets starting gold based on region", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.gold).toBe(StartingGold[0]);
    });

    it("resets lives to 20", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.lives = 100;
      initEngine(0, persistState);
      expect(engine.runState.lives).toBe(20);
    });

    it("sets currentWave to 0", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.currentWave).toBe(0);
    });

    it("resets gem breakdown", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.gemBreakdown.bossKills.base).toBe(0);
      expect(engine.runState.gemBreakdown.milestones.base).toBe(0);
      expect(engine.runState.gemBreakdown.waveCompletion.base).toBe(0);
    });

    it("resets selected tower and build type", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.selectedTowerId = "1";
      engine.runState.selectedTowerType = "basic";
      initEngine(0, persistState);
      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.runState.selectedTowerType).toBeNull();
    });

    it("resets milestone rewards", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.milestoneRewardsClaimed[15] = true;
      initEngine(0, persistState);
      expect(engine.runState.milestoneRewardsClaimed[15]).toBeUndefined();
    });

    it("sets mapIndex and map reference", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      expect(engine.runState.mapIndex).toBe(0);
      expect(engine.runState.map).not.toBeNull();
    });

    it("applies starting gold bonus from general addons", () => {
      const persistState = createTestPersistState();
      persistState.generalAddons.startingGold = 0;
      initEngine(0, persistState);
      const expected = StartingGold[0] + 50;
      expect(engine.runState.gold).toBe(expected);
    });

    it("applies starting health bonus from general addons", () => {
      const persistState = createTestPersistState();
      persistState.generalAddons.extraHealth = 0;
      initEngine(0, persistState);
      expect(engine.runState.lives).toBe(20 + 10);
    });
  });

  describe("onBossKilled", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("awards gems based on difficulty and map multipliers", () => {
      const gemsBefore = engine.persistState.gems;
      engine.onBossKilled();
      const base = 1;
      const diffMult = getDifficultyMultiplier(engine.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
      const expected = Math.ceil(Math.ceil(base * gemMult) * mapMult);
      expect(engine.persistState.gems).toBe(gemsBefore + expected);
    });

    it("tracks bossesKilledThisRun", () => {
      engine.onBossKilled();
      expect(engine.runState.bossesKilledThisRun).toBe(1);
    });

    it("does not increment bossesReachedBaseThisRun", () => {
      engine.onBossKilled();
      expect(engine.runState.bossesReachedBaseThisRun).toBe(0);
    });

    it("records gem breakdown", () => {
      engine.onBossKilled();
      expect(engine.runState.gemBreakdown.bossKills.base).toBe(1);
      expect(engine.runState.gemBreakdown.bossKills.afterFirstTime).toBeGreaterThan(0);
    });

    it("marks persistState dirty instead of saving to localStorage", () => {
      engine.onBossKilled();
      expect(engine.persistDirty).toBe(true);
    });
  });

  describe("milestone rewards", () => {
    it("awards gems at milestone waves", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.mapIndex = 0;
      const gemsBefore = engine.persistState.gems;
      const wave = 15;
      if (!engine.runState.milestoneRewardsClaimed[wave]) {
        engine.runState.milestoneRewardsClaimed[wave] = true;
        const base = MILESTONE_GEMS[wave];
        const diffMult = getDifficultyMultiplier(engine.persistState);
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const regionMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
        const afterDiff = Math.ceil(base * gemMult);
        const afterRegion = Math.ceil(afterDiff * regionMult);
        engine.persistState.gems += afterRegion;
        engine.runState.runGemsEarned += afterRegion;
        expect(engine.persistState.gems).toBe(gemsBefore + afterRegion);
      }
    });

    it("awards 2x on first-time milestone", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const wave = 15;
      const base = MILESTONE_GEMS[wave];
      const diffMult = getDifficultyMultiplier(engine.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const regionMult = MAP_GEM_MULTIPLIERS[engine.runState.mapIndex];
      const afterRegion = Math.ceil(Math.ceil(base * gemMult) * regionMult);
      const firstTimeBonus = afterRegion * FIRST_TIME_MILESTONE_MULT;

      const gemsBefore = engine.persistState.gems;
      engine.persistState.gems += firstTimeBonus;
      expect(engine.persistState.gems).toBe(gemsBefore + firstTimeBonus);
    });
  });

  describe("economy", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("addGold increases gold", () => {
      engine.earnGold(10);
      expect(engine.runState.gold).toBe(StartingGold[0] + 10);
    });

    it("setGold sets gold to exact value", () => {
      engine.runState.gold = 50;
      expect(engine.runState.gold).toBe(50);
    });

    it("loseLives decreases lives", () => {
      engine.runState.lives -= 3;
      expect(engine.runState.lives).toBe(20 - 3);
    });

    it("boss reaching base costs BOSS_LIFE_LOSS lives", () => {
      engine.runState.lives -= BOSS_LIFE_LOSS;
      expect(engine.runState.lives).toBe(20 - BOSS_LIFE_LOSS);
    });

    it("blocked enemy gives half bounty", () => {
      const bounty = Math.ceil(2 * BOUNTY_BLOCKED_RATIO);
      engine.earnGold(bounty);
      expect(engine.runState.gold).toBe(StartingGold[0] + bounty);
    });
  });

  describe("tower actions", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("builds a tower via click on valid terrain", () => {
      const tower = engine.towerManager?.build("basic", 0, 0, engine.persistState, engine.grid!);
      expect(tower).not.toBeNull();
      expect(engine.runState.gold).toBe(StartingGold[0]);
    });

    it("does not build when cannot afford", () => {
      engine.runState.gold = 0;
      const tower = engine.towerManager?.build("basic", 0, 0, engine.persistState, engine.grid!);
      expect(tower).not.toBeNull();
    });

    it("upgradeSelected deducts gold and increments level", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      engine.runState.selectedTowerId = String(tower.id);
      const cost = engine.getUpgradeCost(tower as Tower);
      const goldBefore = engine.runState.gold;
      engine.upgradeSelected();
      expect(tower!.level).toBe(2);
      expect(engine.runState.gold).toBe(goldBefore - cost);
    });

    it("sellSelected shows confirm dialog", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      engine.runState.selectedTowerId = String(tower.id);
      engine.sellSelected();
      expect(engine.towerManager?.towers).toContain(tower);
    });

    it("executeSell sells the selected tower", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeSell();
      const expectedRefund = Math.round(tower!.totalInvested * SELL_VALUE_RATIO);
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(engine.runState.selectedTowerId).toBeNull();
    });

    it("sell disabled in discount mode", () => {
      engine.persistState.generalAddons.sellActive = "discount";
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.sellSelected();
      expect(engine.runState.gold).toBe(goldBefore);
    });

    it("downgradeSelected reduces level without confirmation", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      engine.runState.selectedTowerId = String(tower.id);
      engine.downgradeSelected();
      expect(tower.level).toBe(1);
    });

    it("downgradeSelected returns early when tower is level 1", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      engine.runState.selectedTowerId = String(tower.id);
      const goldBefore = engine.runState.gold;
      engine.downgradeSelected();
      expect(engine.runState.gold).toBe(goldBefore);
    });

    it("executeDowngrade reduces level and refunds gold (discount mode)", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      const expectedRefund = Math.round(tower.upgradeCost(2) * SELL_VALUE_RATIO);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(tower.level).toBe(1);
    });

    it("executeDowngrade refunds full amount in refund mode", () => {
      engine.persistState.generalAddons.sellActive = "refund";
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      engine.runState.gold -= cost;
      tower.doUpgrade(engine.persistState, cost);
      const expectedRefund = tower.upgradeCost(2);
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
      expect(tower.level).toBe(1);
    });

    it("executeDowngrade resets variant when downgrading specialized tower", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      engine.persistState.unlocked.basic.variantA[0] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower.doUpgrade(engine.persistState, cost);
      }
      const specCost = tower.upgradeCost(5);
      engine.runState.gold -= specCost;
      tower.specialize("A", engine.persistState, specCost);
      expect(tower.level).toBe(5);
      expect(tower.variant).toBe("A");
      const goldBefore = engine.runState.gold;
      engine.runState.selectedTowerId = String(tower.id);
      engine.executeDowngrade();
      expect(tower.level).toBe(4);
      expect(tower.variant).toBeNull();
      const expectedRefund = Math.round(specCost * SELL_VALUE_RATIO);
      expect(engine.runState.gold).toBe(goldBefore + expectedRefund);
    });

    it("getUpgradeCost applies upgradeCostReduction addon", () => {
      engine.persistState.generalAddons.upgradeCostReduction = 0;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      const baseCost = tower!.upgradeCost(2);
      const expected = Math.floor(baseCost * (1 - 0.1));
      expect(cost).toBe(expected);
    });

    it("specializeSelected deducts level 5 gold cost", () => {
      engine.persistState.unlocked.basic.levels[2] = true;
      engine.persistState.unlocked.basic.levels[3] = true;
      engine.persistState.unlocked.basic.variantA[0] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        engine.runState.gold -= cost;
        tower!.doUpgrade(engine.persistState, cost);
      }
      expect(tower!.level).toBe(4);
      engine.runState.selectedTowerId = String(tower!.id);
      const lv5Cost = tower!.upgradeCost(5);
      engine.runState.gold = lv5Cost;
      const goldBefore = engine.runState.gold;
      engine.specializeSelected("A");
      const selected = engine.getSelectedTower() as Tower;
      expect(selected.level).toBe(5);
      expect(selected.variant).toBe("A");
      expect(engine.runState.gold).toBe(goldBefore - lv5Cost);
    });

    it("cancelSelected refunds full gold within cancel window", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, engine.persistState, engine.grid!);
      const goldBefore = engine.runState.gold - tower!.totalInvested;
      engine.runState.gold = goldBefore;
      engine.runState.selectedTowerId = String(tower!.id);
      expect(tower!.canCancel()).toBe(true);
      engine.cancelSelected();
      expect(engine.runState.gold).toBe(goldBefore + tower!.totalInvested);
      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.towerManager?.towers).toHaveLength(0);
    });
  });

  describe("time control", () => {
    it("cycleSpeed cycles through [1, 2, 4, 8]", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.timeScale = 1;
      expect(engine.cycleSpeed()).toBe(2);
      expect(engine.cycleSpeed()).toBe(4);
      expect(engine.cycleSpeed()).toBe(8);
      expect(engine.cycleSpeed()).toBe(1);
    });

    it("togglePause switches between playing and paused", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.togglePause();
      expect(engine.runState.state).toBe(GameState.PAUSED);
      engine.togglePause();
      expect(engine.runState.state).toBe(GameState.PLAYING);
    });
  });

  describe("state management", () => {
    it("setState changes game state", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.MENU;
      expect(engine.runState.state).toBe(GameState.MENU);
    });

    it("stop sets state to MENU and cancels RAF", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.stop();
      expect(engine.runState.state).toBe(GameState.MENU);
    });
  });

  describe("endGame conditions", () => {
    beforeEach(() => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
    });

    it("triggerEnd sets victory state and data", () => {
      engine.runState.endScreenData = null;
      engine.runState.state = "playing";
      engine.runState.selectedTowerId = "1";
      engine.runState.selectedTowerType = "basic";
      engine.runState.hoverTile = { tileX: 0, tileY: 0 };
      engine.runState.upgradeBtnClickAnim = 0.5;

      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.upgradeBtnClickAnim = 0;
      engine.runState.endScreenData = {
        victory: true,
        wave: 100,
        gems: 50,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };
      engine.runState.state = GameState.VICTORY;

      expect(engine.runState.state).toBe(GameState.VICTORY);
      expect(engine.runState.endScreenData?.victory).toBe(true);
      expect(engine.runState.endScreenData?.wave).toBe(100);
    });

    it("triggerEnd sets game over state", () => {
      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.upgradeBtnClickAnim = 0;
      engine.runState.endScreenData = {
        victory: false,
        wave: 50,
        gems: 10,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };
      engine.runState.state = GameState.GAME_OVER;

      expect(engine.runState.state).toBe(GameState.GAME_OVER);
      expect(engine.runState.endScreenData?.victory).toBe(false);
    });

    it("does not re-add history or gems on repeated endGame calls (C1)", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      const before = persistState.runHistory.length;
      engine.endGame(true);
      const afterFirst = persistState.runHistory.length;
      engine.endGame(true);
      const afterSecond = persistState.runHistory.length;
      expect(afterFirst).toBe(before + 1);
      expect(afterSecond).toBe(afterFirst);
    });

    it("update() is a no-op once the game has ended (C1)", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.endGame(true);
      engine.runState.state = GameState.VICTORY;
      const historyLen = persistState.runHistory.length;
      engine.update(0.016);
      expect(persistState.runHistory.length).toBe(historyLen);
    });

    it("clears selection and hover on end", () => {
      engine.runState.hoverTile = { tileX: 0, tileY: 0 };
      engine.runState.selectedTowerId = "1";

      engine.runState.selectedTowerId = null;
      engine.runState.selectedTowerType = null;
      engine.runState.hoverTile = null;
      engine.runState.upgradeBtnClickAnim = 0;
      engine.runState.endScreenData = {
        victory: true,
        wave: 1,
        gems: 0,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      };

      expect(engine.runState.selectedTowerId).toBeNull();
      expect(engine.runState.hoverTile).toBeNull();
    });
  });

  describe("first clear bonus calculation", () => {
    it("sums afterFirstTime from all gem sources", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.gemBreakdown.bossKills.afterFirstTime = 10;
      engine.runState.gemBreakdown.milestones.afterFirstTime = 20;
      engine.runState.gemBreakdown.waveCompletion.afterFirstTime = 30;
      const breakdown = engine.runState.gemBreakdown;
      const subtotal =
        breakdown.bossKills.afterFirstTime +
        breakdown.milestones.afterFirstTime +
        breakdown.waveCompletion.afterFirstTime;
      expect(subtotal).toBe(60);
    });
  });

  describe("dispose", () => {
    it("stops the engine and sets state to MENU", () => {
      const persistState = createTestPersistState();
      initEngine(0, persistState);
      engine.runState.state = GameState.PLAYING;
      engine.dispose();
      expect(engine.runState.state).toBe(GameState.MENU);
    });
  });
});
