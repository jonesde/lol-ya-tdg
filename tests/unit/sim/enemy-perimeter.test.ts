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

// A base-attack stand-in so we can observe damage gating and collapse.
class StubBaseTarget {
  readonly isGhost = false;
  health = 100;
  takeDamage(amount: number): void {
    this.health -= amount;
  }
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

  it("regression: a second enemy piles in the SAME arrival tile as the first (no scatter to an adjacent tile)", () => {
    const { enemyManager } = makeManager();
    const first = enemyManager.spawn("minion", 1, 0, 1);
    const second = enemyManager.spawn("minion", 1, 0, 1);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    for (let step = 0; step < 12000; step++) {
      enemyManager.update(FIXED_DT, null);
      if (first!.attackingBase && second!.attackingBase) break;
    }

    const firstTile = first!.currentTile();
    const secondTile = second!.currentTile();
    expect(`${firstTile.x},${firstTile.y}`).toBe(`${secondTile.x},${secondTile.y}`);
  });

  it("Issue 2: enemies pile in the arrival tile and overflow into neighbouring base-adjacent tiles, all outside the square", () => {
    const { grid, enemyManager } = makeManager();
    const count = 12;
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
    for (const enemy of survivors) {
      // Every enemy remains outside the base square (none drift inside).
      expect(distanceToBaseSquare(enemy.x, enemy.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
        enemy.radius - 1e-6,
      );
    }
    // The pile spreads across more than one tile (it is not a single-file column).
    const tiles = new Set(
      survivors.map((e) => {
        const t = e.currentTile();
        return `${t.x},${t.y}`;
      }),
    );
    expect(tiles.size).toBeGreaterThan(1);
  });

  it("fill: the front line spreads laterally along the base edge instead of collapsing to a single column", () => {
    const { grid, enemyManager } = makeManager();
    const count = 18;
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

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const segments = grid.getBaseEdgeSegments();
    expect(segments.length).toBeGreaterThan(0);
    // Tangent along the exposed edge (use the longest exposed segment's direction).
    const longest = segments.reduce((a, b) =>
      Math.hypot(b.x2 - b.x1, b.y2 - b.y1) > Math.hypot(a.x2 - a.x1, a.y2 - a.y1) ? b : a,
    );
    const segLen = Math.hypot(longest.x2 - longest.x1, longest.y2 - longest.y1) || 1;
    const tangentX = (longest.x2 - longest.x1) / segLen;
    const tangentY = (longest.y2 - longest.y1) / segLen;

    const isAdjacent = (e: Enemy) =>
      distanceToBaseSquare(e.centerX, e.centerY, baseCenter.x, baseCenter.y, half) <= e.radius + 1e-6;
    const fronts = enemies.filter((e) => !e.removed && isAdjacent(e));
    expect(fronts.length).toBeGreaterThan(0);

    // Project each front enemy onto the edge tangent; the pile must occupy more than
    // one lateral position (i.e. it fills across the edge, not a single-file column).
    const lateralPositions = new Set<number>();
    for (const e of fronts) {
      const proj = (e.centerX - baseCenter.x) * tangentX + (e.centerY - baseCenter.y) * tangentY;
      lateralPositions.add(Math.round(proj / 4)); // ~quarter-tile buckets
    }
    expect(lateralPositions.size).toBeGreaterThan(1);
  });

  it("front line damages the base; killing a front enemy lets a back enemy collapse forward", () => {
    const { grid, enemyManager } = makeManager();
    const baseTarget = new StubBaseTarget();
    enemyManager.baseTarget = baseTarget;
    const enemies: Enemy[] = [];
    for (let i = 0; i < 24; i++) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeTruthy();
      enemies.push(enemy!);
    }
    for (let step = 0; step < 12000; step++) {
      enemyManager.update(FIXED_DT, null);
      if (enemies.every((e) => e.attackingBase || e.removed)) break;
    }

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const isAdjacent = (e: Enemy) =>
      distanceToBaseSquare(e.centerX, e.centerY, baseCenter.x, baseCenter.y, half) <= e.radius + 1e-6;

    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);
    const fronts = survivors.filter(isAdjacent);
    const backs = survivors.filter((e) => !isAdjacent(e));
    // Front line touches the base and damages it; the formation has depth (back rows).
    expect(fronts.length).toBeGreaterThan(0);
    expect(baseTarget.health).toBeLessThan(100);
    expect(backs.length).toBeGreaterThan(0);

    // Kill a front enemy and confirm a back enemy advances into the freed edge spot.
    const front = fronts[0]!;
    const beforeAdjacentIds = new Set(survivors.filter((e) => isAdjacent(e) && e !== front).map((e) => e.id));
    front.removed = true;
    for (let step = 0; step < 480; step++) enemyManager.update(FIXED_DT, null);

    const afterAdjacent = survivors.filter((e) => !e.removed && isAdjacent(e));
    const advanced = afterAdjacent.some((e) => !beforeAdjacentIds.has(e.id));
    expect(advanced).toBe(true);
  });
});
