import { describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { itIfOff } from "../../helpers/physicsFlags.js";

// Minimal EnemyManagerRef satisfying what Enemy.update touches (no towers, no
// other enemies) so we can drive routing in isolation.
function makeEnemyManager(enemy: Enemy) {
  return { enemies: [enemy], getEnemiesInRange: () => [], forEachEnemyInRange: () => {}, towerAt: () => null };
}

const FIXED_DT = 1 / 60;

function runUntil(
  enemy: Enemy,
  manager: ReturnType<typeof makeEnemyManager>,
  predicate: () => boolean,
  maxTicks = 6000,
): void {
  for (let tick = 0; tick < maxTicks; tick++) {
    enemy.update(FIXED_DT, manager);
    if (predicate()) return;
  }
}

describe("Enemy routing (target-tile model)", () => {
  itIfOff("applyRoute('hold') parks the enemy at the target tile and does not advance past it", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const manager = makeEnemyManager(enemy);
    const holdTile = grid.getPathFor(0)![3]!;
    const route = grid.computeRoute(enemy.currentTile(), holdTile);
    enemy.applyRoute(route, "hold");

    runUntil(
      enemy,
      manager,
      () =>
        Math.floor(enemy.centerX / grid.tileSize) === holdTile.x &&
        Math.floor(enemy.centerY / grid.tileSize) === holdTile.y,
    );
    expect(enemy.attackingBase).toBe(false);
    // The enemy sits on the hold tile (it never passes it).
    expect(Math.floor(enemy.centerX / grid.tileSize)).toBe(holdTile.x);
    expect(Math.floor(enemy.centerY / grid.tileSize)).toBe(holdTile.y);
  });

  itIfOff("applyRoute('route') follows the route then reverts to default pathing on completion", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const manager = makeEnemyManager(enemy);
    const route = grid.computeRoute(enemy.currentTile(), grid.base);
    enemy.applyRoute(route, "route");

    const defaultPath = grid.getPathFor(0);
    runUntil(enemy, manager, () => enemy.path === defaultPath);
    expect(enemy.path).toBe(defaultPath);
  });

  itIfOff("releaseToDefault reverts routingMode to default and re-anchors to the grid path", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const route = grid.computeRoute(enemy.currentTile(), grid.getPathFor(0)![3]!);
    enemy.applyRoute(route, "hold");
    enemy.releaseToDefault();
    expect(enemy.path).toBe(grid.getPathFor(0));
  });

  itIfOff("the pathVersion re-anchor is NOT applied while routingMode !== default", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const route = grid.computeRoute(enemy.currentTile(), grid.getPathFor(0)![3]!);
    enemy.applyRoute(route, "hold");
    const commanderPath = enemy.path;
    // A tower build/sell bumps pathVersion; a hold/route enemy's path is commander-owned.
    grid.pathVersion += 1;
    enemy.update(FIXED_DT, makeEnemyManager(enemy));
    expect(enemy.path).toBe(commanderPath);
    expect(enemy.path).not.toBe(grid.getPathFor(0));
  });

  itIfOff("applyRoute(null, 'hold') falls back to releaseToDefault", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.applyRoute(null, "hold");
    expect(enemy.attackingBase).toBe(false);
    expect(enemy.path).toBe(grid.getPathFor(0));
  });

  itIfOff("applyRoute(null, 'route') falls back to releaseToDefault", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.applyRoute(null, "route");
    expect(enemy.attackingBase).toBe(false);
    expect(enemy.path).toBe(grid.getPathFor(0));
  });

  itIfOff("computeRoute returns null for an unreachable terrain goal", () => {
    const grid = new Grid(getMap(0));
    // A terrain tile away from any path/spawn/base tile is unreachable.
    let terrainTile: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.height && !terrainTile; y++) {
      for (let x = 0; x < grid.width && !terrainTile; x++) {
        if (grid.tiles[y]![x]!.type === "terrain") terrainTile = { x, y };
      }
    }
    expect(terrainTile).not.toBeNull();
    const route = grid.computeRoute(grid.base, terrainTile!);
    expect(route).toBeNull();
  });
});
