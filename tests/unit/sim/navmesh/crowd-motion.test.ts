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
import { makeBastionMap } from "../../../helpers/mock-grid.js";

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
});
