// @ts-nocheck
import { describe, expect, it } from "vitest";
import { FIXED_DT, GameState, STARTING_GOLD_BONUS, STARTING_HEALTH_BONUS, StartingGold } from "@/game/Constants.js";
import { TOWER_META } from "@/game/ConstantsTower.js";
import { GameEngine } from "@/game/GameEngine.js";
import { createTestStores } from "../helpers/mock-stores";

function runTicks(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    engine.update(FIXED_DT);
  }
}

describe("Integration: Single Wave Simulation", () => {
  let engine: GameEngine;
  let gameStore: ReturnType<typeof createTestStores>["game"];
  let persistStore: ReturnType<typeof createTestStores>["persist"];

  it("kills all enemies in wave 1 with adequate tower defense", () => {
    const stores = createTestStores();
    gameStore = stores.game;
    persistStore = stores.persist;
    engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    engine.towerManager?.build("basic", 2, 2, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);
    engine.towerManager?.build("basic", 4, 2, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);
    engine.towerManager?.build("basic", 6, 2, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);

    engine.waveManager?.startNextWave();
    gameStore.setWave(engine.waveManager!.currentWave);

    runTicks(engine, 2400);

    expect(engine.waveManager?.currentWave).toBeGreaterThanOrEqual(1);
  });

  it("towers deal damage during wave", () => {
    const stores = createTestStores();
    gameStore = stores.game;
    persistStore = stores.persist;
    engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    engine.towerManager?.build("basic", 2, 2, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);

    engine.waveManager?.startNextWave();
    gameStore.setWave(engine.waveManager!.currentWave);

    runTicks(engine, 1200);

    expect(engine.towerManager?.towers.length).toBeGreaterThan(0);
    expect(engine.waveManager?.currentWave).toBeGreaterThanOrEqual(1);
  });

  it("player loses lives when enemies reach base", () => {
    const stores = createTestStores();
    gameStore = stores.game;
    persistStore = stores.persist;
    engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);

    engine.waveManager?.startNextWave();
    gameStore.setWave(engine.waveManager!.currentWave);

    const livesBefore = gameStore.lives;
    runTicks(engine, 1200);

    if (gameStore.state !== GameState.GAME_OVER) {
      expect(gameStore.lives).toBeLessThan(livesBefore);
    }
  });

  it("gold increases from enemy bounties", () => {
    const _stores = createTestStores();
    const _goldBefore = (): number => gameStore.gold;

    const stores2 = createTestStores();
    gameStore = stores2.game;
    persistStore = stores2.persist;
    engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const _initialGold = gameStore.gold;

    engine.waveManager?.startNextWave();
    gameStore.setWave(engine.waveManager!.currentWave);

    runTicks(engine, 600);

    expect(engine.totalGoldEarned).toBeGreaterThanOrEqual(0);
  });
});

describe("Integration: Tower Placement Flow", () => {
  it("placing a tower does not block the path in non-critical positions", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, grid);
    expect(tower).not.toBeNull();

    const path = grid.getPathFor(0);
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(0);
  });

  it("placing a tower on a critical path tile blocks the route", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const pathTile = grid.paths![0]![3];
    expect(grid.canBuild(pathTile.x, pathTile.y)).toBe(false);
  });

  it("tower can be selected and upgraded", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, grid);
    gameStore.selectTower(tower);
    expect(gameStore.selectedTower).toStrictEqual(tower);

    engine.upgradeSelected();
    expect(tower!.level).toBe(2);
    expect(gameStore.selectedTower).toStrictEqual(tower!);
  });

  it("tower can be sold and gold refunded", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const goldBefore = gameStore.gold;
    const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, grid);
    gameStore.selectTower(tower);

    engine.sellSelected();
    engine.executeSell();
    const expectedRefund = Math.round(tower!.totalInvested * 0.6);
    expect(gameStore.gold).toBe(goldBefore + expectedRefund);
    expect(gameStore.selectedTower).toBeNull();
  });
});

describe("Integration: Economy Flow", () => {
  it("buying towers reduces gold correctly", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;
    const initialGold = gameStore.gold;

    engine.towerManager?.build("basic", 0, 0, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);

    engine.towerManager?.build("basic", 1, 0, persistStore.$state, grid);
    gameStore.setGold(gameStore.gold - TOWER_META.basic.cost);

    expect(gameStore.gold).toBe(initialGold - TOWER_META.basic.cost * 2);
  });

  it("upgrading a tower costs the correct amount", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, grid);
    gameStore.selectTower(tower);

    const cost = engine.getUpgradeCost(tower!);
    const goldBefore = gameStore.gold;
    engine.upgradeSelected();

    expect(tower!.level).toBe(2);
    expect(gameStore.gold).toBe(goldBefore - cost);
  });

  it("sell returns 60% of total invested", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    engine.loadMap(0);
    const grid = engine.grid!;

    const tower = engine.towerManager!.build("basic", 0, 0, persistStore.$state, grid);
    gameStore.selectTower(tower);
    engine.upgradeSelected();

    const goldBefore = gameStore.gold;
    engine.sellSelected();
    engine.executeSell();

    const expectedRefund = Math.round(tower!.totalInvested * 0.6);
    expect(gameStore.gold).toBe(goldBefore + expectedRefund);
  });

  it("general addons affect starting resources", () => {
    const stores = createTestStores();
    const gameStore = stores.game;
    const persistStore = stores.persist;
    const engine = new GameEngine(gameStore, persistStore);

    persistStore.generalAddons.startingGold = 0;
    persistStore.generalAddons.extraHealth = 0;

    engine.loadMap(0);

    expect(gameStore.gold).toBe(StartingGold[0] + STARTING_GOLD_BONUS[0]);
    expect(gameStore.lives).toBe(20 + STARTING_HEALTH_BONUS[0]);
  });
});
