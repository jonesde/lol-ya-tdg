// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { Enemy, resetEnemyId } from "@/enemies/Enemy.js";
import { EnemyManager } from "@/enemies/EnemyManager.js";
import { Grid } from "@/grid/Grid.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { TowerManager } from "@/towers/TowerManager.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem, makeSoundManager } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

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
  const unlocked = {} as Record<TowerId, UnlockedState>;
  for (const id of ["basic", "ice", "sniper", "cannon", "lightning", "railgun"] as TowerId[]) {
    unlocked[id] = {
      levels: [true, true, true, true, true, true, true],
      variantA: [true, true, true],
      variantB: [true, true, true],
      addons: [true, true, true],
    };
  }
  return {
    gems: 99999,
    unlocked,
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

describe("Enemy attack and collision (Phases 3 & 4)", () => {
  let grid: Grid;
  let enemyManager: EnemyManager;
  let towerManager: TowerManager;
  let particles: ReturnType<typeof makeParticleSystem>;
  let sound: ReturnType<typeof makeSoundManager>;

  beforeEach(() => {
    resetEnemyId();
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    const map = makeBastionMap();
    grid = new Grid(map);
    particles = makeParticleSystem();
    sound = makeSoundManager();
    const projectiles = { spawn() {}, fireLightning() {}, spawnLightningFlash() {} };
    towerManager = new TowerManager(grid, particles, projectiles, sound);
    enemyManager = new EnemyManager(grid, particles, 0);
    enemyManager.setTowerManager(towerManager);
  });

  it("attacks a live tower on its next path tile, lowering health and setting attackAnimTime", () => {
    const path = grid.getPathFor(0)!;
    const towerTile = path[1]!;
    const tower = towerManager.build("basic", towerTile.x, towerTile.y, makeSave(), grid);
    expect(tower).toBeTruthy();
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const startHealth = tower!.health;
    let attacked = false;
    for (let i = 0; i < 3000 && !attacked; i++) {
      enemy.update(0.05, enemyManager);
      if (enemy.attackAnimTime > 0) attacked = true;
    }
    expect(attacked).toBe(true);
    expect(tower!.health).toBeLessThan(startHealth);
    expect(enemy.attackAnimTime).toBeGreaterThan(0);
  });

  it("does not attack while stunned (attack timer is paused, no damage)", () => {
    const path = grid.getPathFor(0)!;
    const towerTile = path[1]!;
    const tower = towerManager.build("basic", towerTile.x, towerTile.y, makeSave(), grid);
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.applyStun(1000);
    for (let i = 0; i < 300; i++) enemy.update(0.05, enemyManager);
    expect(tower!.health).toBe(tower!.maxHealth);
    expect(enemy.attackAnimTime).toBe(0);
  });

  it("attacks less often when slowed (longer attack interval)", () => {
    const runScenario = (slowed: boolean): number => {
      const map = makeBastionMap();
      const scenarioGrid = new Grid(map);
      const scenarioTowers = new TowerManager(
        scenarioGrid,
        makeParticleSystem(),
        { spawn() {}, fireLightning() {}, spawnLightningFlash() {} },
        makeSoundManager(),
      );
      const scenarioEnemies = new EnemyManager(scenarioGrid, makeParticleSystem(), 0);
      scenarioEnemies.setTowerManager(scenarioTowers);
      const towerTile = scenarioGrid.getPathFor(0)![1]!;
      const tower = scenarioTowers.build("basic", towerTile.x, towerTile.y, makeSave(), scenarioGrid)!;
      tower.health = 100000;
      tower.maxHealth = 100000;
      const enemy = new Enemy("minion", 1, 0, scenarioGrid, 1);
      if (slowed) enemy.applySlow(0.5, 1000);
      for (let i = 0; i < 600; i++) enemy.update(0.05, scenarioEnemies);
      return tower.health;
    };
    const normalHealth = runScenario(false);
    const slowedHealth = runScenario(true);
    expect(normalHealth).toBeLessThan(slowedHealth);
  });

  it("separates a slower enemy to the right (+laneOffset) and a faster one to the left (-laneOffset)", () => {
    const slow = new Enemy("tank", 1, 0, grid, 1);
    const fast = new Enemy("runner", 1, 0, grid, 1);
    for (const enemy of [slow, fast]) {
      enemy.centerX = 100;
      enemy.centerY = 100;
      enemy.laneOffset = 0;
      enemy.x = 100;
      enemy.y = 100;
      enemy.moveAngle = 0;
    }
    enemyManager.enemies.push(slow, fast);
    enemyManager.updateSpatialHash();
    enemyManager.update(0.01, null);
    expect(slow.laneOffset).toBeGreaterThan(0);
    expect(fast.laneOffset).toBeLessThan(0);
  });
});
