// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AttackTarget, Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
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
      if (enemy.removed) break;
    }

    expect(towerB.health).toBeLessThan(towerB.maxHealth);
    expect(enemy.attackingBase).toBe(false);
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

describe("base attack", () => {
  let grid: Grid;
  let enemyManager: EnemyManager;
  let towerManager: TowerManager;

  class StubBaseTarget implements AttackTarget {
    readonly isGhost = false;
    health = 100;
    takeDamage(amount: number): void {
      this.health -= amount;
    }
  }

  beforeEach(() => {
    resetEnemyId();
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    const map = makeBastionMap();
    grid = new Grid(map);
    const projectiles = { spawn() {}, fireLightning() {}, spawnLightningFlash() {} };
    towerManager = new TowerManager(grid, makeParticleSystem(), projectiles, makeSoundManager());
    enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
    enemyManager.setTowerManager(towerManager);
  });

  function makeAttackingEnemy(baseTarget: AttackTarget): Enemy {
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.baseTarget = baseTarget;
    enemy.pathIdx = enemy.path!.length - 1;
    // Park the enemy against the base edge so it qualifies as in contact with
    // the square (the proximity gate in Enemy.update only lets an attacking
    // enemy damage the base when it is actually adjacent to it).
    const baseTile = grid.getBase();
    const baseCenter = grid.tileToWorld(baseTile.x, baseTile.y);
    enemy.centerX = baseCenter.x + 1.5 * grid.tileSize + enemy.radius + 1;
    enemy.centerY = baseCenter.y;
    enemy.x = enemy.centerX;
    enemy.y = enemy.centerY;
    return enemy;
  }

  it("enemy attacks base on cooldown and does not despawn", () => {
    const baseTarget = new StubBaseTarget();
    const enemy = makeAttackingEnemy(baseTarget);
    enemyManager.enemies.push(enemy);

    enemy.update(0.05, enemyManager);
    expect(enemy.attackingBase).toBe(true);
    expect(enemy.removed).toBe(false);

    const healthBefore = baseTarget.health;
    for (let step = 0; step < 200; step++) enemy.update(0.05, enemyManager);
    expect(baseTarget.health).toBeLessThan(healthBefore);
    expect(enemy.removed).toBe(false);
    expect(enemyManager.enemies).toContain(enemy);
  });

  it("two enemies both attack the base without despawning", () => {
    const singleTarget = new StubBaseTarget();
    const singleEnemy = makeAttackingEnemy(singleTarget);
    for (let step = 0; step < 200; step++) singleEnemy.update(0.05, enemyManager);
    const singleDamage = 100 - singleTarget.health;

    const doubleTarget = new StubBaseTarget();
    const enemyA = makeAttackingEnemy(doubleTarget);
    const enemyB = makeAttackingEnemy(doubleTarget);
    enemyManager.enemies.push(enemyA, enemyB);
    for (let step = 0; step < 200; step++) {
      enemyA.update(0.05, enemyManager);
      enemyB.update(0.05, enemyManager);
    }
    const doubleDamage = 100 - doubleTarget.health;

    expect(enemyA.attackingBase).toBe(true);
    expect(enemyB.attackingBase).toBe(true);
    expect(enemyA.removed).toBe(false);
    expect(enemyB.removed).toBe(false);
    expect(doubleDamage).toBeGreaterThan(singleDamage * 1.5);
  });

  function distanceToBaseSquare(x: number, y: number, baseCenterX: number, baseCenterY: number, half: number): number {
    const deltaX = x - baseCenterX;
    const deltaY = y - baseCenterY;
    const closestX = baseCenterX + Math.max(-half, Math.min(half, deltaX));
    const closestY = baseCenterY + Math.max(-half, Math.min(half, deltaY));
    return Math.hypot(x - closestX, y - closestY);
  }

  it("base-attacking enemy settles just outside the 3x3 base square (not at the center)", () => {
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const target = new StubBaseTarget();
    const enemy = makeAttackingEnemy(target);
    enemyManager.enemies.push(enemy);

    let previousX = enemy.x;
    let previousY = enemy.y;
    let maxStep = 0;
    for (let step = 0; step < 400; step++) {
      enemy.update(0.05, enemyManager);
      maxStep = Math.max(maxStep, Math.hypot(enemy.x - previousX, enemy.y - previousY));
      previousX = enemy.x;
      previousY = enemy.y;
    }

    expect(enemy.removed).toBe(false);
    expect(enemy.attackingBase).toBe(true);
    // Rendered position ends up outside the base square (ring around its edge).
    expect(distanceToBaseSquare(enemy.x, enemy.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
      enemy.radius - 1e-6,
    );
    // No teleport-scale jumps: each frame moves at most a fraction of a tile.
    expect(maxStep).toBeLessThan(grid.tileSize);
  });

  it("clustered base-attacking enemies all stay outside the base square", () => {
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const target = new StubBaseTarget();
    const enemies = [makeAttackingEnemy(target), makeAttackingEnemy(target), makeAttackingEnemy(target)];
    enemyManager.enemies.push(...enemies);

    for (let step = 0; step < 400; step++) {
      for (const enemy of enemies) enemy.update(0.05, enemyManager);
    }

    for (const enemy of enemies) {
      expect(enemy.removed).toBe(false);
      expect(distanceToBaseSquare(enemy.x, enemy.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
        enemy.radius - 1e-6,
      );
    }
  });
});

describe("contact-line steering (polite motion)", () => {
  let grid: Grid;
  let enemyManager: EnemyManager;
  let towerManager: TowerManager;

  // A custom map with a 3-tile-wide approach to the tower, so enemies have room to
  // spread laterally around the tower instead of being confined to a 1-tile corridor.
  function makeWideApproachMap() {
    const width = 8;
    const height = 6;
    const tiles: { type: string; height: number }[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: { type: string; height: number }[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        row.push({ type: "terrain", height: 1 });
      }
      tiles.push(row);
    }
    for (let colIndex = 0; colIndex < width; colIndex++) {
      tiles[1][colIndex].type = "path";
      tiles[2][colIndex].type = "path";
      tiles[3][colIndex].type = "path";
    }
    return makeMapData({
      width,
      height,
      spawns: [{ x: 0, y: 2 }],
      base: { x: width - 1, y: 2 },
      tiles,
      regionId: 0,
      level: 1,
      style: "bastion",
    });
  }

  beforeEach(() => {
    resetEnemyId();
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    const map = getMap(0);
    grid = new Grid(map);
    const projectiles = { spawn() {}, fireLightning() {}, spawnLightningFlash() {} };
    towerManager = new TowerManager(grid, makeParticleSystem(), projectiles, makeSoundManager());
    enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
    enemyManager.setTowerManager(towerManager);
  });

  it("enemies attacking a path-blocking tower spread across tiles instead of stacking in a single column", () => {
    const wideMap = makeWideApproachMap();
    const wideGrid = new Grid(wideMap);
    const wideTowers = new TowerManager(
      wideGrid,
      makeParticleSystem(),
      { spawn() {}, fireLightning() {}, spawnLightningFlash() {} },
      makeSoundManager(),
    );
    const wideEnemies = new EnemyManager(wideGrid, makeParticleSystem(), 0);
    wideEnemies.setTowerManager(wideTowers);

    const path = wideGrid.getPathFor(0)!;
    const towerTile = path[3]!;
    const tower = wideTowers.build("basic", towerTile.x, towerTile.y, makeSave(), wideGrid)!;
    tower.health = 100000;
    tower.maxHealth = 100000;

    const count = 12;
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      const enemy = new Enemy("minion", 1, 0, wideGrid, 1);
      enemies.push(enemy);
      wideEnemies.enemies.push(enemy);
    }
    wideEnemies.updateSpatialHash();

    for (let step = 0; step < 8000; step++) {
      wideEnemies.update(1 / 60, null);
    }

    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);
    const tiles = new Set(
      survivors.map((e) => {
        const tile = e.currentTile();
        return `${tile.x},${tile.y}`;
      }),
    );
    expect(tiles.size).toBeGreaterThan(1);
  });

  it("a pile against a path-blocking tower still damages it (regression: tower attack survives lateral spread)", () => {
    // A 3-wide staging room funnels into a 1-wide choke; the tower sits on the choke
    // mouth, so it is the only way through — enemies must pile against it (with real
    // lateral spread on its exposed faces) rather than route around it.
    const width = 9;
    const height = 3;
    const tiles: { type: string; height: number }[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: { type: string; height: number }[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        const inRoom = colIndex <= 3;
        const inChoke = colIndex >= 4 && rowIndex === 1;
        row.push({ type: inRoom || inChoke ? "path" : "terrain", height: 1 });
      }
      tiles.push(row);
    }
    const map = makeMapData({
      width,
      height,
      spawns: [{ x: 0, y: 1 }],
      base: { x: width - 1, y: 1 },
      tiles,
      regionId: 0,
      level: 1,
      style: "bastion",
    });
    const blockGrid = new Grid(map);
    const blockTowers = new TowerManager(
      blockGrid,
      makeParticleSystem(),
      { spawn() {}, fireLightning() {}, spawnLightningFlash() {} },
      makeSoundManager(),
    );
    const blockEnemies = new EnemyManager(blockGrid, makeParticleSystem(), 0);
    blockEnemies.setTowerManager(blockTowers);

    const towerTile = { x: 4, y: 1 };
    const tower = blockTowers.build("basic", towerTile.x, towerTile.y, makeSave(), blockGrid)!;
    // Enough health to survive the run but low enough that a 12-enemy pile's attacks
    // are clearly observable.
    tower.health = tower.maxHealth = 100000;

    const count = 12;
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      const enemy = new Enemy("minion", 1, 0, blockGrid, 1);
      enemies.push(enemy);
      blockEnemies.enemies.push(enemy);
    }
    blockEnemies.updateSpatialHash();

    for (let step = 0; step < 8000; step++) {
      blockEnemies.update(1 / 60, null);
    }

    // Before the fix, the attack target was gated on center-to-center distance, which
    // became false the moment contactLineSteer spread the pile tangentially along the
    // tower face — so the tower took no damage. With square-distance contact, the pile
    // keeps attacking, so health must drop below max.
    expect(tower.health).toBeLessThan(tower.maxHealth);

    // Regression for the sideways-into-terrain drift: the 1-tile choke is flanked by
    // terrain (rows 0 and 2 are terrain). The tangential collision push used to shove
    // piled enemies past the choke span onto those terrain tiles. Every surviving enemy
    // must keep its whole body on traversable (non-terrain) tiles.
    const bodyOnPathTiles = (enemy: Enemy): boolean => {
      const r = enemy.radius;
      const points = [
        { x: enemy.x, y: enemy.y },
        { x: enemy.x + r, y: enemy.y },
        { x: enemy.x - r, y: enemy.y },
        { x: enemy.x, y: enemy.y + r },
        { x: enemy.x, y: enemy.y - r },
      ];
      for (const point of points) {
        const tileX = Math.floor(point.x / blockGrid.tileSize);
        const tileY = Math.floor(point.y / blockGrid.tileSize);
        if (!blockGrid.inBounds(tileX, tileY)) return false;
        if (blockGrid.isTerrain(tileX, tileY)) return false;
      }
      return true;
    };
    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);
    for (const survivor of survivors) {
      expect(bodyOnPathTiles(survivor)).toBe(true);
    }
  });

  function makeCorridorMap() {
    const width = 10;
    const height = 3;
    const tiles: { type: string; height: number }[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      const row: { type: string; height: number }[] = [];
      for (let colIndex = 0; colIndex < width; colIndex++) {
        row.push({ type: "terrain", height: 1 });
      }
      tiles.push(row);
    }
    for (let colIndex = 0; colIndex < width; colIndex++) {
      tiles[1][colIndex].type = "path";
    }
    return makeMapData({
      width,
      height,
      spawns: [{ x: 0, y: 1 }],
      base: { x: width - 1, y: 1 },
      tiles,
      regionId: 0,
      level: 1,
      style: "bastion",
    });
  }

  it("in-contact tower attackers reach contactLineSteer (regression guard for the dead branch)", () => {
    const corridorMap = makeCorridorMap();
    const corridorGrid = new Grid(corridorMap);
    const corridorTowers = new TowerManager(
      corridorGrid,
      makeParticleSystem(),
      { spawn() {}, fireLightning() {}, spawnLightningFlash() {} },
      makeSoundManager(),
    );
    const corridorEnemies = new EnemyManager(corridorGrid, makeParticleSystem(), 0);
    corridorEnemies.setTowerManager(corridorTowers);

    const path = corridorGrid.getPathFor(0)!;
    const towerTile = path[5]!;
    const tower = corridorTowers.build("basic", towerTile.x, towerTile.y, makeSave(), corridorGrid)!;
    tower.health = 100000;
    tower.maxHealth = 100000;

    const count = 12;
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      const enemy = new Enemy("minion", 1, 0, corridorGrid, 1);
      enemies.push(enemy);
      corridorEnemies.enemies.push(enemy);
    }
    corridorEnemies.updateSpatialHash();

    // getTowerEdgeSegments is only called from inside the in-contact tower
    // steering branch (Enemy.ts:839). Spying on it isolates that path from the
    // base steering branch, which would otherwise also call contactLineSteer.
    const edgeSpy = vi.spyOn(corridorGrid, "getTowerEdgeSegments");

    for (let step = 0; step < 8000; step++) {
      corridorEnemies.update(1 / 60, null);
    }

    expect(edgeSpy).toHaveBeenCalled();
    edgeSpy.mockRestore();

    // The corridor is 1 tile tall (terrain above and below), so a pile against the
    // tower can only stack in depth on the single corridor tile — there is nowhere to
    // spread laterally without leaving the path. The regression guard here is that the
    // in-contact tower steering ran (edgeSpy above) and that the pile stays on the
    // path tile rather than being shoved sideways into the flanking terrain.
    const bodyOnPathTiles = (enemy: Enemy): boolean => {
      const r = enemy.radius;
      const points = [
        { x: enemy.x, y: enemy.y },
        { x: enemy.x + r, y: enemy.y },
        { x: enemy.x - r, y: enemy.y },
        { x: enemy.x, y: enemy.y + r },
        { x: enemy.x, y: enemy.y - r },
      ];
      for (const point of points) {
        const tileX = Math.floor(point.x / corridorGrid.tileSize);
        const tileY = Math.floor(point.y / corridorGrid.tileSize);
        if (!corridorGrid.inBounds(tileX, tileY)) return false;
        if (corridorGrid.isTerrain(tileX, tileY)) return false;
      }
      return true;
    };
    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);
    for (const survivor of survivors) {
      expect(bodyOnPathTiles(survivor)).toBe(true);
    }
  });
});
