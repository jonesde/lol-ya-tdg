import { beforeAll, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";

// A minimal base AttackTarget so Enemy.postPhysics can run its base-attack
// tick without a full GameEngine. The damage counter proves the wiring deals damage.
function makeBaseTarget(): AttackTarget & { damage: number } {
  const target = {
    damage: 0,
    isGhost: false as const,
    takeDamage(amount: number): void {
      target.damage += amount;
    },
  };
  return target;
}

describe("postPhysics base attack", () => {
  beforeAll(async () => {
    // setup.ts already initializes both WASM modules, but be safe for this suite.
    await initNavMesh();
  });

  it("marks attackingBase and deals damage when the body is at the base", () => {
    const grid = new Grid(makeBastionMap());
    const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    const physicsWorld = new PhysicsWorld(grid);
    enemyManager.setPhysicsWorld(physicsWorld);

    const fakeBase = makeBaseTarget();
    enemyManager.baseTarget = fakeBase;

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);

    // Drop the body onto the base center. Leave the crowd agent null — the ON
    // post-physics path guards the optional agent teleport with `?.`.
    const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    enemy!.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);

    enemy!.postPhysics(FIXED_DT, enemyManager);

    expect(enemy!.attackingBase).toBe(true);
    expect(fakeBase.damage).toBeGreaterThan(0);
  });

  // Best-effort tower edge case: a live tower the enemy is shoved against should
  // be detected via findAdjacentLiveTowerInContact and take damage (towers are
  // obstacles, so this only fires on contact / avoidance failure).
  it("attacks an adjacent live tower when not attacking the base", () => {
    const grid = new Grid(makeBastionMap());
    const enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    const physicsWorld = new PhysicsWorld(grid);
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.baseTarget = makeBaseTarget();

    const enemy = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemy).not.toBeNull();
    physicsWorld.addEnemy(enemy!);

    const towerDamage = { value: 0 };
    const fakeTower = {
      tileX: 3,
      tileY: 4,
      isGhost: false as const,
      health: 100,
      takeDamage(amount: number): void {
        towerDamage.value += amount;
      },
    } as unknown as Tower;
    const towerManagerStub = {
      towerAt: (tileX: number, tileY: number) => (tileX === 3 && tileY === 4 ? fakeTower : null),
    } as unknown as import("@/sim/towers/TowerManager.js").TowerManager;
    (enemyManager as unknown as { towerManager: unknown }).towerManager = towerManagerStub;

    // Tower tile must be in the blocked set or the detection clears blockedByTower.
    grid.blocked.add("3,4");
    // The body is placed adjacent to the tower tile (3,4) so currentTile() resolves
    // to a neighbor of the tower for the contact detection.
    // Place the body just inside contact range of the tower square (not the base).
    const towerCenter = grid.tileToWorld(3, 4);
    // Place the body in the neighbor tile (3,3) just above the tower square, within
    // contact range, so currentTile() resolves to a neighbor of the tower (3,4) and
    // findAdjacentLiveTowerInContact detects it.
    const offset = grid.tileSize * 0.5 + enemy!.radius * 0.5;
    enemy!.body!.setTranslation({ x: towerCenter.x, y: towerCenter.y - offset }, true);

    enemy!.postPhysics(FIXED_DT, enemyManager);

    expect(enemy!.attackingBase).toBe(false);
    expect(enemy!.blockedByTower).toBe(fakeTower);
    expect(towerDamage.value).toBeGreaterThan(0);
  });
});
