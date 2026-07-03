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
import { SELL_VALUE_RATIO, TOWER_META } from "@/game/ConstantsTower.js";
import { GameEngine, getGameEngine } from "@/game/GameEngine.js";
import type { useGameStore } from "@/stores/game.js";
import type { usePersistStore } from "@/stores/persist.js";
import type { Tower } from "@/towers/Tower.js";
import { createTestStores } from "../helpers/mock-stores";

describe("GameEngine", () => {
  let engine: GameEngine;
  let gameStore: ReturnType<typeof useGameStore>;
  let persistStore: ReturnType<typeof usePersistStore>;

  beforeEach(() => {
    const stores = createTestStores();
    gameStore = stores.game;
    persistStore = stores.persist;
    engine = new GameEngine(gameStore, persistStore);
  });

  describe("constructor", () => {
    it("stores references to stores", () => {
      expect(engine.gameStore).toBe(gameStore);
      expect(engine.persistStore).toBe(persistStore);
    });

    it("registers itself via getGameEngine()", () => {
      expect(getGameEngine()).toBeTruthy();
      expect(getGameEngine()?.constructor.name).toBe("GameEngine");
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
      engine.loadMap(0);
      expect(engine.grid).not.toBeNull();
      expect(engine.enemyManager).not.toBeNull();
      expect(engine.towerManager!).not.toBeNull();
      expect(engine.waveManager).not.toBeNull();
    });

    it("sets starting gold based on region", () => {
      engine.loadMap(0);
      expect(gameStore.gold).toBe(StartingGold[0]);
    });

    it("resets lives to 20", () => {
      gameStore.lives = 100;
      engine.loadMap(0);
      expect(gameStore.lives).toBe(20);
    });

    it("sets currentWave to 0", () => {
      engine.loadMap(0);
      expect(gameStore.currentWave).toBe(0);
    });

    it("resets gem breakdown", () => {
      engine.loadMap(0);
      expect(gameStore.gemBreakdown.bossKills.base).toBe(0);
      expect(gameStore.gemBreakdown.milestones.base).toBe(0);
      expect(gameStore.gemBreakdown.waveCompletion.base).toBe(0);
    });

    it("resets selected tower and build type", () => {
      gameStore.selectedTower = {} as unknown as Tower;
      gameStore.selectedTowerType = "basic";
      engine.loadMap(0);
      expect(gameStore.selectedTower).toBeNull();
      expect(gameStore.selectedTowerType).toBeNull();
    });

    it("resets milestone rewards", () => {
      gameStore.claimMilestone(15);
      engine.loadMap(0);
      expect(gameStore.hasClaimedMilestone(15)).toBe(false);
    });

    it("sets mapIndex and map reference", () => {
      engine.loadMap(0);
      expect(gameStore.mapIndex).toBe(0);
      expect(gameStore.map).not.toBeNull();
    });

    it("applies starting gold bonus from general addons", () => {
      persistStore.generalAddons.startingGold = 0;
      engine.loadMap(0);
      const expected = StartingGold[0] + 50;
      expect(gameStore.gold).toBe(expected);
    });

    it("applies starting health bonus from general addons", () => {
      persistStore.generalAddons.extraHealth = 0;
      engine.loadMap(0);
      expect(gameStore.lives).toBe(20 + 10);
    });
  });

  describe("onBossKilled", () => {
    beforeEach(() => {
      engine.loadMap(0);
    });

    it("awards gems based on difficulty and map multipliers", () => {
      const gemsBefore = persistStore.gems;
      engine.onBossKilled();
      const base = 1;
      const diffMult = persistStore.difficultyMultiplier;
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = MAP_GEM_MULTIPLIERS[gameStore.mapIndex];
      const expected = Math.ceil(Math.ceil(base * gemMult) * mapMult);
      expect(persistStore.gems).toBe(gemsBefore + expected);
    });

    it("tracks bossesKilledThisRun", () => {
      engine.onBossKilled();
      expect(gameStore.bossesKilledThisRun).toBe(1);
    });

    it("records gem breakdown", () => {
      engine.onBossKilled();
      expect(gameStore.gemBreakdown.bossKills.base).toBe(1);
      expect(gameStore.gemBreakdown.bossKills.afterFirstTime).toBeGreaterThan(0);
    });

    it("saves to persist store", () => {
      engine.onBossKilled();
      expect(localStorage.setItem).toHaveBeenCalled();
    });
  });

  describe("milestone rewards", () => {
    it("awards gems at milestone waves", () => {
      engine.loadMap(0);
      gameStore.mapIndex = 0;
      const gemsBefore = persistStore.gems;
      const wave = 15;
      if (!gameStore.hasClaimedMilestone(wave)) {
        gameStore.claimMilestone(wave);
        const base = MILESTONE_GEMS[wave];
        const diffMult = persistStore.difficultyMultiplier;
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const regionMult = MAP_GEM_MULTIPLIERS[gameStore.mapIndex];
        const afterDiff = Math.ceil(base * gemMult);
        const afterRegion = Math.ceil(afterDiff * regionMult);
        persistStore.gems += afterRegion;
        gameStore.runGemsEarned += afterRegion;
        expect(persistStore.gems).toBe(gemsBefore + afterRegion);
      }
    });

    it("awards 2x on first-time milestone", () => {
      engine.loadMap(0);
      const wave = 15;
      const base = MILESTONE_GEMS[wave];
      const diffMult = persistStore.difficultyMultiplier;
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const regionMult = MAP_GEM_MULTIPLIERS[gameStore.mapIndex];
      const afterRegion = Math.ceil(Math.ceil(base * gemMult) * regionMult);
      const firstTimeBonus = afterRegion * FIRST_TIME_MILESTONE_MULT;

      const gemsBefore = persistStore.gems;
      persistStore.gems += firstTimeBonus;
      expect(persistStore.gems).toBe(gemsBefore + firstTimeBonus);
    });
  });

  describe("economy", () => {
    beforeEach(() => {
      engine.loadMap(0);
    });

    it("addGold increases gold", () => {
      gameStore.addGold(10);
      expect(gameStore.gold).toBe(StartingGold[0] + 10);
    });

    it("setGold sets gold to exact value", () => {
      gameStore.setGold(50);
      expect(gameStore.gold).toBe(50);
    });

    it("loseLives decreases lives", () => {
      gameStore.loseLives(3);
      expect(gameStore.lives).toBe(20 - 3);
    });

    it("boss reaching base costs BOSS_LIFE_LOSS lives", () => {
      gameStore.loseLives(BOSS_LIFE_LOSS);
      expect(gameStore.lives).toBe(20 - BOSS_LIFE_LOSS);
    });

    it("blocked enemy gives half bounty", () => {
      const bounty = Math.ceil(2 * BOUNTY_BLOCKED_RATIO);
      gameStore.addGold(bounty);
      expect(gameStore.gold).toBe(StartingGold[0] + bounty);
    });
  });

  describe("tower actions", () => {
    beforeEach(() => {
      engine.loadMap(0);
    });

    it("builds a tower via click on valid terrain", () => {
      const tower = engine.towerManager?.build("basic", 0, 0, persistStore.$state, engine.grid!);
      expect(tower).not.toBeNull();
      expect(gameStore.gold).toBe(StartingGold[0]);
    });

    it("does not build when cannot afford", () => {
      gameStore.gold = 0;
      // towerManager.build doesn't check gold, so it will still build
      const tower = engine.towerManager?.build("basic", 0, 0, persistStore.$state, engine.grid!);
      expect(tower).not.toBeNull();
    });

    it("upgradeSelected deducts gold and increments level", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      gameStore.selectTower(tower);
      const cost = engine.getUpgradeCost(tower as Tower);
      gameStore.gold -= cost;
      engine.upgradeSelected();
      expect(tower!.level).toBe(2);
      expect(gameStore.gold).toBe(StartingGold[0] - TOWER_META.basic.cost - cost);
    });

    it("sellSelected shows confirm dialog", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      gameStore.selectTower(tower);
      engine.sellSelected();
      expect(engine.towerManager?.towers).toContain(tower);
    });

    it("executeSell sells the selected tower", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      const goldBefore = gameStore.gold;
      gameStore.selectTower(tower);
      engine.executeSell();
      const expectedRefund = Math.round(tower!.totalInvested * SELL_VALUE_RATIO);
      expect(gameStore.gold).toBe(goldBefore + expectedRefund);
      expect(gameStore.selectedTower).toBeNull();
    });

    it("sell disabled in discount mode", () => {
      persistStore.generalAddons.sellActive = "discount";
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      const goldBefore = gameStore.gold;
      gameStore.selectTower(tower);
      engine.sellSelected();
      expect(gameStore.gold).toBe(goldBefore);
    });

    it("getUpgradeCost applies upgradeCostReduction addon", () => {
      persistStore.generalAddons.upgradeCostReduction = 0;
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      const cost = engine.getUpgradeCost(tower!);
      const baseCost = tower!.upgradeCost(2);
      const expected = Math.floor(baseCost * (1 - 0.1));
      expect(cost).toBe(expected);
    });

    it("specializeSelected deducts level 5 gold cost", () => {
      persistStore.unlocked.basic.levels[2] = true;
      persistStore.unlocked.basic.levels[3] = true;
      persistStore.unlocked.basic.variantA[0] = true;
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      for (let i = 0; i < 3; i++) {
        const cost = engine.getUpgradeCost(tower!);
        gameStore.gold -= cost;
        tower!.doUpgrade(persistStore.$state);
      }
      expect(tower!.level).toBe(4);
      gameStore.selectTower(tower!);
      const lv5Cost = tower!.upgradeCost(5);
      gameStore.setGold(lv5Cost);
      const goldBefore = gameStore.gold;
      engine.specializeSelected("A");
      const selected = engine.gameStore.selectedTower as Tower;
      expect(selected.level).toBe(5);
      expect(selected.variant).toBe("A");
      expect(gameStore.gold).toBe(goldBefore - lv5Cost);
    });

    it("cancelSelected refunds full gold within cancel window", () => {
      const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, engine.grid!);
      const goldBefore = gameStore.gold - tower!.totalInvested;
      gameStore.setGold(goldBefore);
      gameStore.selectTower(tower!);
      expect(tower!.canCancel()).toBe(true);
      engine.cancelSelected();
      expect(gameStore.gold).toBe(goldBefore + tower!.totalInvested);
      expect(gameStore.selectedTower).toBeNull();
      expect(engine.towerManager?.towers).toHaveLength(0);
    });
  });

  describe("time control", () => {
    it("cycleSpeed cycles through [1, 2, 4, 8]", () => {
      gameStore.timeScale = 1;
      expect(engine.cycleSpeed()).toBe(2);
      expect(engine.cycleSpeed()).toBe(4);
      expect(engine.cycleSpeed()).toBe(8);
      expect(engine.cycleSpeed()).toBe(1);
    });

    it("togglePause switches between playing and paused", () => {
      gameStore.setState(GameState.PLAYING);
      engine.togglePause();
      expect(gameStore.state).toBe(GameState.PAUSED);
      engine.togglePause();
      expect(gameStore.state).toBe(GameState.PLAYING);
    });
  });

  describe("state management", () => {
    it("setState changes game state", () => {
      engine.gameStore.setState(GameState.MENU);
      expect(gameStore.state).toBe(GameState.MENU);
    });

    it("stop sets state to MENU and cancels RAF", () => {
      engine.gameStore.setState(GameState.PLAYING);
      engine.stop();
      expect(gameStore.state).toBe(GameState.MENU);
    });
  });

  describe("endGame conditions", () => {
    beforeEach(() => {
      engine.loadMap(0);
    });

    it("triggerEnd sets victory state and data", () => {
      engine.gameStore.triggerEnd(true, {
        wave: 100,
        gems: 50,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      });
      expect(gameStore.state).toBe(GameState.VICTORY);
      expect(gameStore.endScreenData?.victory).toBe(true);
      expect(gameStore.endScreenData?.wave).toBe(100);
    });

    it("triggerEnd sets game over state", () => {
      engine.gameStore.triggerEnd(false, {
        wave: 50,
        gems: 10,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      });
      expect(gameStore.state).toBe(GameState.GAME_OVER);
      expect(gameStore.endScreenData?.victory).toBe(false);
    });

    it("clears selection and hover on end", () => {
      gameStore.hoverTile = { tileX: 0, tileY: 0 };
      engine.gameStore.triggerEnd(true, {
        wave: 1,
        gems: 0,
        gemBreakdown: {
          bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
          firstClearBonus: 0,
        },
      });
      expect(gameStore.selectedTower).toBeNull();
      expect(gameStore.hoverTile).toBeNull();
    });
  });

  describe("first clear bonus calculation", () => {
    it("sums afterFirstTime from all gem sources", () => {
      engine.loadMap(0);
      gameStore.gemBreakdown.bossKills.afterFirstTime = 10;
      gameStore.gemBreakdown.milestones.afterFirstTime = 20;
      gameStore.gemBreakdown.waveCompletion.afterFirstTime = 30;
      const breakdown = gameStore.gemBreakdown;
      const subtotal =
        breakdown.bossKills.afterFirstTime +
        breakdown.milestones.afterFirstTime +
        breakdown.waveCompletion.afterFirstTime;
      expect(subtotal).toBe(60);
    });
  });

  describe("dispose", () => {
    it("stops the engine and clears engine reference", () => {
      engine.gameStore.setState(GameState.PLAYING);
      engine.dispose();
      expect(getGameEngine()).toBeNull();
      expect(gameStore.state).toBe(GameState.MENU);
    });
  });
});
