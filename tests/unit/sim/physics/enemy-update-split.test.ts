// @ts-nocheck
import { describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";

// Minimal EnemyManagerRef satisfying what Enemy.update touches (no towers, no
// other enemies) so the split can be driven deterministically in isolation.
function makeEnemyManager(enemy: Enemy) {
  return { enemies: [enemy], getEnemiesInRange: () => [], forEachEnemyInRange: () => {}, towerAt: () => null };
}

const FIXED_DT = 1 / 60;

function snapshot(e: Enemy) {
  return {
    x: e.x,
    y: e.y,
    centerX: e.centerX,
    centerY: e.centerY,
    attackingBase: e.attackingBase,
    blockedByTower: e.blockedByTower,
    baseTarget: e.baseTarget,
    hp: e.hp,
    moveAngle: e.moveAngle,
    pathIdx: e.pathIdx,
    stunTimer: e.stunTimer,
    removed: e.removed,
    laneOffsetX: e.laneOffsetX,
    laneOffsetY: e.laneOffsetY,
  };
}

// The split must be faithful: calling update() (the thin wrapper) must produce
// byte-identical state to calling computeIntent() then postPhysics() separately.
// Both paths run the identical OFF code, so the snapshots match every frame —
// including across the base-arrival transition (contactLineSteer path).
describe("Enemy update split (computeIntent + postPhysics) characterization", () => {
  it("update() equals computeIntent()+postPhysics() every frame and reaches the base", () => {
    const grid = new Grid(getMap(0));
    const enemyA = new Enemy("minion", 1, 0, grid, 1);
    const enemyB = new Enemy("minion", 1, 0, grid, 1);
    const mgrA = makeEnemyManager(enemyA);
    const mgrB = makeEnemyManager(enemyB);

    let reachedBase = false;
    for (let tick = 0; tick < 20000; tick++) {
      enemyA.update(FIXED_DT, mgrA);
      enemyB.computeIntent(FIXED_DT, mgrB);
      enemyB.postPhysics(FIXED_DT, mgrB);
      expect(snapshot(enemyA)).toEqual(snapshot(enemyB));
      if (enemyA.attackingBase) {
        reachedBase = true;
        break;
      }
    }
    expect(reachedBase).toBe(true);
  });

  it("an OFF enemy advances along the path toward the base", () => {
    const grid = new Grid(getMap(0));
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    const manager = makeEnemyManager(enemy);
    const startX = enemy.centerX;
    const startY = enemy.centerY;
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const startDist = Math.hypot(startX - baseCenter.x, startY - baseCenter.y);

    for (let tick = 0; tick < 200; tick++) {
      enemy.update(FIXED_DT, manager);
    }

    expect(enemy.pathIdx).toBeGreaterThan(0);
    const endDist = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);
    expect(endDist).toBeLessThan(startDist);
  });
});
