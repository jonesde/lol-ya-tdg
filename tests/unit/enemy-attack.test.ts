// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { TowerManager } from "@/sim/towers/TowerManager.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap, makeMapData } from "../helpers/mock-grid";
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

  it("does not skip a live tower around the corner when the blocking tower is destroyed", () => {
    // L-shaped path: spawn (0,0) → east along row 0 → turn at (4,0) → south along
    // column 4 → base (4,4). Tower A sits on the corner (4,0); tower B sits just
    // around the corner (4,1). After A is destroyed, enemies still on/near the
    // corner must re-anchor onto A's now-passable tile and attack B — not jump
    // across B to the base.
    const width = 6;
    const height = 6;
    const tiles: { type: string; height: number }[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: { type: string; height: number }[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        row.push({ type: "terrain", height: 1 });
      }
      tiles.push(row);
    }
    for (let colIndex = 0; colIndex <= 4; colIndex++) tiles[0][colIndex].type = "path";
    for (let rowIndex = 0; rowIndex <= 4; rowIndex++) tiles[rowIndex][4].type = "path";
    const map = makeMapData({
      width,
      height,
      spawns: [{ x: 0, y: 0 }],
      base: { x: 4, y: 4 },
      tiles,
      regionId: 0,
      level: 1,
      style: "bastion",
    });
    const scenarioGrid = new Grid(map);
    const scenarioTowers = new TowerManager(
      scenarioGrid,
      makeParticleSystem(),
      { spawn() {}, fireLightning() {}, spawnLightningFlash() {} },
      makeSoundManager(),
    );
    const scenarioEnemies = new EnemyManager(scenarioGrid, makeParticleSystem(), 0);
    scenarioEnemies.setTowerManager(scenarioTowers);

    const towerA = scenarioTowers.build("basic", 4, 0, makeSave(), scenarioGrid)!;
    const towerB = scenarioTowers.build("basic", 4, 1, makeSave(), scenarioGrid)!;
    // A dies quickly; B survives long enough to confirm the enemy attacks it.
    towerA.health = towerA.maxHealth = 50;
    towerB.health = towerB.maxHealth = 100000;

    const enemy = new Enemy("minion", 1, 0, scenarioGrid, 1);

    // Drive the enemy until tower A dies. In the real engine, `Tower.takeDamage`
    // flips `isGhost` the instant health hits zero, but the grid only un-blocks the
    // tile (and bumps the path version) one frame later. During that window a fast
    // enemy / pile-up can leave it standing on the dead corner tower's own tile when
    // the re-anchor fires. The re-anchor must anchor it on A's (now passable) tile
    // and attack B — not snap it past B to the base.
    let aDestroyed = false;
    for (let i = 0; i < 5000 && !aDestroyed; i++) {
      enemy.update(0.05, scenarioEnemies);
      if (towerA.health <= 0) {
        // Place the enemy at A's tile center (the post-death position that exposes
        // the bug), then un-block A so the re-anchor fires.
        const towerCenter = scenarioGrid.tileToWorld(4, 0);
        enemy.centerX = towerCenter.x;
        enemy.centerY = towerCenter.y;
        enemy.x = towerCenter.x;
        enemy.y = towerCenter.y;
        scenarioGrid.setTowerGhost(4, 0);
        towerA.isGhost = true;
        aDestroyed = true;
      }
    }
    expect(aDestroyed).toBe(true);

    // Continue simulating. The enemy must now attack B rather than hop across it.
    for (let i = 0; i < 5000; i++) {
      enemy.update(0.05, scenarioEnemies);
      if (enemy.removed || enemy.reachedBase) break;
    }

    expect(towerB.health).toBeLessThan(towerB.maxHealth);
    expect(enemy.reachedBase).toBe(false);
  });

  it("separates a slower enemy to the right (+laneOffset) and a faster one to the left (-laneOffset)", () => {
    const slow = new Enemy("tank", 1, 0, grid, 1);
    const fast = new Enemy("runner", 1, 0, grid, 1);
    for (const enemy of [slow, fast]) {
      enemy.centerX = 100;
      enemy.centerY = 100;
      enemy.laneOffsetX = 0;
      enemy.laneOffsetY = 0;
      enemy.x = 100;
      enemy.y = 100;
      enemy.moveAngle = 0;
    }
    enemyManager.enemies.push(slow, fast);
    enemyManager.updateSpatialHash();
    // Drive collision resolution directly with a fixed heading so the synthetic
    // frame is deterministic (the full update would also walk the enemies along
    // their real path and re-resolve, washing out the lateral separation).
    (slow as unknown as { resolveCollisions: (m: EnemyManager) => void }).resolveCollisions(enemyManager);
    // The lane offset is a world-space vector; project it onto each enemy's own
    // (right) perpendicular to recover the intended signed separation.
    const slowPerp = { x: -Math.sin(slow.moveAngle), y: Math.cos(slow.moveAngle) };
    const fastPerp = { x: -Math.sin(fast.moveAngle), y: Math.cos(fast.moveAngle) };
    const slowProj = slow.laneOffsetX * slowPerp.x + slow.laneOffsetY * slowPerp.y;
    const fastProj = fast.laneOffsetX * fastPerp.x + fast.laneOffsetY * fastPerp.y;
    expect(slowProj).toBeGreaterThan(0);
    expect(fastProj).toBeLessThan(0);
  });
});
