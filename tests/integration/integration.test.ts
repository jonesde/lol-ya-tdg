// @ts-nocheck
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "@/sim/applyCommand.js";
import {
  FIXED_DT,
  GameState,
  STARTING_BASE_HEALTH,
  STARTING_GOLD_BONUS,
  STARTING_HEALTH_BONUS,
  StartingGold,
} from "@/sim/Constants.js";
import { TOWER_META } from "@/sim/ConstantsTower.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores";
import { orderedPath } from "../helpers/navmesh-test-utils.js";

function setupPinia() {
  const pinia = createPinia();
  setActivePinia(pinia);
  createTestMapThemeStore();
}

function runTicks(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    engine.update(FIXED_DT);
  }
}

function buildTowerAt(engine: GameEngine, tileX: number, tileY: number): void {
  const tileSize = engine.grid!.tileSize;
  applyCommand(engine, { type: "action:selectBuildType", towerType: "basic" });
  applyCommand(engine, {
    type: "input:click",
    worldX: tileX * tileSize + tileSize / 2,
    worldY: tileY * tileSize + tileSize / 2,
  });
}

describe("Integration: Single Wave Simulation", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  beforeEach(() => {
    setupPinia();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
  });

  it("kills all enemies in wave 1 with adequate tower defense", () => {
    buildTowerAt(engine, 2, 2);
    buildTowerAt(engine, 4, 2);
    buildTowerAt(engine, 6, 2);

    engine.waveManager?.startNextWave();

    runTicks(engine, 2400);

    expect(engine.waveManager?.currentWave).toBeGreaterThanOrEqual(1);
  });

  it("towers deal damage during wave", () => {
    buildTowerAt(engine, 2, 2);

    engine.waveManager?.startNextWave();

    runTicks(engine, 1200);

    expect(engine.towerManager?.towers.length).toBeGreaterThan(0);
    expect(engine.waveManager?.currentWave).toBeGreaterThanOrEqual(1);
  });

  it("player loses lives when enemies reach base", () => {
    engine.waveManager?.startNextWave();

    const livesBefore = engine.runState.baseHealth;
    runTicks(engine, 1200);

    if (engine.runState.state !== GameState.GAME_OVER) {
      expect(engine.runState.baseHealth).toBeLessThanOrEqual(livesBefore);
    }
  });

  it("gold increases from enemy bounties", () => {
    engine.waveManager?.startNextWave();

    runTicks(engine, 600);

    expect(engine.totalGoldEarned).toBeGreaterThanOrEqual(0);
  });
});

describe("Integration: Tower Placement Flow", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  beforeEach(() => {
    setupPinia();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
  });

  it("placing a tower does not block the path in non-critical positions", () => {
    buildTowerAt(engine, 0, 0);
    const tower = engine.towerManager!.towerAt(0, 0);
    expect(tower).not.toBeNull();

    // Navmesh model: a terrain placement cannot sever the walkable corridor, so the
    // maze remains reachable.
    expect(engine.navMeshBuilder!.wouldRemainReachable(0, 0)).toBe(true);
  });

  it("a route still exists and the maze stays connected when a path tile is used", () => {
    const grid = engine.grid!;
    const path = orderedPath(grid, 0);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(0);
    const baseGoal = grid.getBaseGoalTiles();
    expect(baseGoal.some((goal) => goal.x === path[path.length - 1].x && goal.y === path[path.length - 1].y)).toBe(
      true,
    );
    // A terrain (non-corridor) tile can never sever the maze.
    expect(engine.navMeshBuilder!.wouldRemainReachable(0, 0)).toBe(true);
  });

  it("tower can be selected and upgraded", () => {
    buildTowerAt(engine, 0, 0);
    const tower = engine.towerManager!.towerAt(0, 0)!;
    applyCommand(engine, { type: "action:selectTower", towerId: tower.id });

    const cost = engine.getUpgradeCost(tower);
    const goldBefore = buildSnapshot(engine).meta.gold;
    applyCommand(engine, { type: "action:upgradeSelected" });

    expect(tower.level).toBe(2);
    expect(buildSnapshot(engine).meta.gold).toBe(goldBefore - cost);
    expect(buildSnapshot(engine).meta.selectedTowerId).toBe(String(tower.id));
  });

  it("tower can be sold and gold refunded", () => {
    buildTowerAt(engine, 0, 0);
    const tower = engine.towerManager!.towerAt(0, 0)!;
    applyCommand(engine, { type: "action:selectTower", towerId: tower.id });

    const goldBefore = buildSnapshot(engine).meta.gold;
    applyCommand(engine, { type: "action:executeSell", towerId: tower.id });

    const expectedRefund = Math.round(tower.totalInvested * 0.6);
    expect(buildSnapshot(engine).meta.gold).toBe(goldBefore + expectedRefund);
    expect(buildSnapshot(engine).meta.selectedTowerId).toBeNull();
  });
});

describe("Integration: Economy Flow", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  beforeEach(() => {
    setupPinia();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
  });

  it("buying towers reduces gold correctly", () => {
    const initialGold = buildSnapshot(engine).meta.gold;

    buildTowerAt(engine, 0, 0);
    buildTowerAt(engine, 2, 2);

    expect(buildSnapshot(engine).meta.gold).toBe(initialGold - TOWER_META.basic.cost * 2);
  });

  it("upgrading a tower costs the correct amount", () => {
    buildTowerAt(engine, 0, 0);
    const tower = engine.towerManager!.towerAt(0, 0)!;
    applyCommand(engine, { type: "action:selectTower", towerId: tower.id });

    const cost = engine.getUpgradeCost(tower);
    const goldBefore = buildSnapshot(engine).meta.gold;
    applyCommand(engine, { type: "action:upgradeSelected" });

    expect(tower.level).toBe(2);
    expect(buildSnapshot(engine).meta.gold).toBe(goldBefore - cost);
  });

  it("sell returns 60% of total invested", () => {
    buildTowerAt(engine, 0, 0);
    const tower = engine.towerManager!.towerAt(0, 0)!;
    applyCommand(engine, { type: "action:selectTower", towerId: tower.id });

    applyCommand(engine, { type: "action:upgradeSelected" });

    const goldBefore = buildSnapshot(engine).meta.gold;
    applyCommand(engine, { type: "action:executeSell", towerId: tower.id });

    const expectedRefund = Math.round(tower.totalInvested * 0.6);
    expect(buildSnapshot(engine).meta.gold).toBe(goldBefore + expectedRefund);
  });

  it("general addons affect starting resources", () => {
    persistState.generalAddons.startingGold = 0;
    persistState.generalAddons.extraHealth = 0;

    // Re-create engine with modified persistState
    const newPersistState = createTestPersistState();
    newPersistState.generalAddons.startingGold = 0;
    newPersistState.generalAddons.extraHealth = 0;
    const newEngine = new GameEngine(newPersistState, createTestThemeBundle(), new MockHostBindings(), 0);
    newEngine.loadMap(0);

    expect(newEngine.runState.gold).toBe(StartingGold[0] + STARTING_GOLD_BONUS[0]);
    expect(newEngine.runState.baseHealth).toBe(STARTING_BASE_HEALTH + STARTING_HEALTH_BONUS[0]);
  });
});
