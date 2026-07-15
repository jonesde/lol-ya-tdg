import { beforeAll, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { makeBastionMap, makeMapData } from "../../../helpers/mock-grid.js";

// A synthetic 1-tile-wide L-shaped corridor (a horizontal run then a vertical run
// to the base) — the canonical inside-corner case. Used to verify a wide enemy
// rounds the bend and reaches the base instead of clipping the wall / stalling.
function makeOneWideCornerMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: "terrain" | "path" | "base" | "spawn"; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: "terrain" | "path" | "base" | "spawn"; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) row.push({ type: "terrain", height: 1 });
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < 7; colIndex++) tiles[4]![colIndex]!.type = "path";
  for (let rowIndex = 4; rowIndex < 8; rowIndex++) tiles[rowIndex]![7]!.type = "path";
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 7 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

// A minimal base attack target so Enemy.postPhysics can run its base-attack
// tick without needing a full GameEngine. The damage value is never asserted.
function makeBaseTarget(): AttackTarget {
  return { isGhost: false, takeDamage: () => {} };
}

function distanceToBase(enemy: { centerX: number; centerY: number }, baseWorld: { x: number; y: number }): number {
  return Math.hypot(enemy.centerX - baseWorld.x, enemy.centerY - baseWorld.y);
}

describe("CrowdManager motion", () => {
  beforeAll(async () => {
    // setup.ts already initializes both WASM modules, but be safe for this suite.
    await initNavMesh();
  });

  it("drives enemies toward the base and keeps them from overlapping", () => {
    const grid = new Grid(makeBastionMap());
    const navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);
    const navMesh = navBuilder.getNavMesh()!;

    const crowdManager = new CrowdManager(navMesh, grid.tileSize, 50);

    const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    const physicsWorld = new PhysicsWorld(grid);
    // DetourCrowd owns enemy-enemy avoidance, so disable Rapier enemy-enemy
    // collisions — this isolates the crowd's local avoidance in the overlap check.
    physicsWorld.setEnemyEnemyCollisions(false);
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.baseTarget = makeBaseTarget();

    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);

    const enemyA = enemyManager.spawn("runner", 1, 0, 1);
    const enemyB = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemyA).not.toBeNull();
    expect(enemyB).not.toBeNull();

    // Offset enemyB slightly off the spawn tile so the crowd has a clear lateral
    // direction to separate the two agents (both target the same base point).
    const offset = grid.tileSize * 0.4;
    enemyB!.body!.setTranslation({ x: enemyB!.x + offset, y: enemyB!.y }, true);
    enemyB!.x = enemyB!.x + offset;
    enemyB!.centerX = enemyB!.x;

    crowdManager.addAgent(enemyA!);
    crowdManager.setBaseTarget(enemyA!, baseWorld);
    crowdManager.addAgent(enemyB!);
    crowdManager.setBaseTarget(enemyB!, baseWorld);

    const startDistA = distanceToBase(enemyA!, baseWorld);
    const startDistB = distanceToBase(enemyB!, baseWorld);

    // Drive the crowd + physics loop (mirrors GameEngine.update under RECAST_NAV).
    // postPhysics reads the stepped body back and re-syncs the crowd agent to
    // it so the two stay aligned, exactly as the engine does on the ON path.
    for (let step = 0; step < 200; step++) {
      crowdManager.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      for (const enemy of enemyManager.enemies) {
        enemy.postPhysics(FIXED_DT, enemyManager);
      }
    }

    // (a) Each enemy moved closer to the base over time.
    expect(distanceToBase(enemyA!, baseWorld)).toBeLessThan(startDistA);
    expect(distanceToBase(enemyB!, baseWorld)).toBeLessThan(startDistB);

    // (b) Two agents started near each other end the loop not overlapping —
    // demonstrating DetourCrowd local avoidance (no Rapier enemy-enemy collision).
    const centerDistance = Math.hypot(enemyA!.centerX - enemyB!.centerX, enemyA!.centerY - enemyB!.centerY);
    expect(centerDistance).toBeGreaterThan(enemyA!.radius * 0.5);
  });

  it("rounds a 1-wide inside corner and reaches the base (tank clearance)", () => {
    // The largest common enemy (tank) is wider than the old runner-only navmesh
    // clearance. With the widened clearance its full circle stays off the
    // inside-corner wall through the bend, so it threads the L and reaches base
    // without stalling or reversing.
    const grid = new Grid(makeOneWideCornerMap());
    const navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);

    const physicsWorld = new PhysicsWorld(grid);
    physicsWorld.setEnemyEnemyCollisions(false);
    const crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.setCrowdManager(crowdManager);
    enemyManager.baseTarget = makeBaseTarget();

    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    const enemy = enemyManager.spawn("tank", 1, 0, 1)!;
    expect(enemy).not.toBeNull();

    const onEnemyKill = () => {};
    const onEnemyBeginAttackBase = () => {};

    const startDistance = distanceToBase(enemy, baseWorld);
    let previousDistance = startDistance;
    let maxBacktrack = 0;
    let reached = false;
    for (let step = 0; step < 12000 && !reached; step++) {
      enemyManager.preStep(FIXED_DT);
      crowdManager.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      enemyManager.postStep(FIXED_DT, onEnemyKill, onEnemyBeginAttackBase);
      const currentDistance = distanceToBase(enemy, baseWorld);
      if (currentDistance - previousDistance > maxBacktrack) maxBacktrack = currentDistance - previousDistance;
      previousDistance = currentDistance;
      reached = enemy.attackingBase;
      if (enemy.removed) break;
    }

    // (a) The tank advanced a meaningful distance toward the base.
    expect(startDistance - distanceToBase(enemy, baseWorld)).toBeGreaterThan(grid.tileSize * 2);
    // (b) It reached the base — i.e. it navigated the inside corner without stalling.
    expect(reached).toBe(true);
    // (c) It never reversed by more than a small bobble: no wall-shove reroute at
    // the inside corner.
    expect(maxBacktrack).toBeLessThan(enemy.radius);
  });
});
