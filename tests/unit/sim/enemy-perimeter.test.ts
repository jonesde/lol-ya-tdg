import { describe, expect, it } from "vitest";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { makeParticleSystem } from "../../helpers/mock-managers.js";

const FIXED_DT = 1 / 60;

function makeManager() {
  const grid = new Grid(getMap(0));
  const enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
  return { grid, enemyManager };
}

function distanceToBaseSquare(x: number, y: number, baseCenterX: number, baseCenterY: number, half: number): number {
  const deltaX = x - baseCenterX;
  const deltaY = y - baseCenterY;
  const closestX = baseCenterX + Math.max(-half, Math.min(half, deltaX));
  const closestY = baseCenterY + Math.max(-half, Math.min(half, deltaY));
  return Math.hypot(x - closestX, y - closestY);
}

describe("Enemy perimeter surround routing", () => {
  it("Issue 1: a routed enemy never enters the base square and settles just outside the edge", () => {
    const { grid, enemyManager } = makeManager();
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    expect(enemy).toBeTruthy();
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;

    let minDistance = Infinity;
    for (let step = 0; step < 6000 && !enemy!.attackingBase; step++) {
      enemyManager.update(FIXED_DT, null);
      minDistance = Math.min(minDistance, distanceToBaseSquare(enemy!.x, enemy!.y, baseCenter.x, baseCenter.y, half));
    }

    expect(enemy!.attackingBase).toBe(true);
    // Never stepped inside the square during the whole approach.
    expect(minDistance).toBeGreaterThanOrEqual(enemy!.radius - 1e-6);
    // Final resting position is outside the square (rings the edge).
    expect(distanceToBaseSquare(enemy!.x, enemy!.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
      enemy!.radius - 1e-6,
    );
  });

  it("Issue 2: enemies load-balance onto distinct perimeter docks and stay outside the square", () => {
    const { grid, enemyManager } = makeManager();
    const count = 8;
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeTruthy();
      enemies.push(enemy!);
    }

    for (let step = 0; step < 12000; step++) {
      enemyManager.update(FIXED_DT, null);
      if (enemies.every((e) => e.attackingBase || e.removed)) break;
    }

    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const distinctSlots = new Set<string>();
    for (const enemy of survivors) {
      // Every enemy remains outside the base square.
      expect(distanceToBaseSquare(enemy.x, enemy.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
        enemy.radius - 1e-6,
      );
      // Every enemy carries a perimeter dock assignment.
      expect(enemy.baseSlot).not.toBeNull();
      distinctSlots.add(`${enemy.baseSlot!.dockIndex},${enemy.baseSlot!.radial}`);
    }
    // Spreading: enemies occupy more than one (dock, radial) slot rather than
    // funneling into a single tile.
    expect(distinctSlots.size).toBeGreaterThan(1);
  });

  it("assigns a dock whose outward tile is traversable (not terrain or map edge)", () => {
    const { grid, enemyManager } = makeManager();
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    expect(enemy).toBeTruthy();
    expect(enemy!.baseSlot).not.toBeNull();
    const target = enemy!.baseSlot!.targetTile;
    expect(grid.inBounds(target.x, target.y)).toBe(true);
    expect(grid.isTerrain(target.x, target.y)).toBe(false);
  });
});
