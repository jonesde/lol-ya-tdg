import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import type { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";

export function stepPhysics(
  enemyManager: EnemyManager,
  physicsWorld: PhysicsWorld,
  dt: number,
  onEnemyKill: ((enemy: Enemy) => void) | null = null,
  onEnemyBeginAttackBase: ((enemy: Enemy) => void) | null = null,
): void {
  enemyManager.preStep(dt);
  physicsWorld.step();
  enemyManager.postStep(dt, onEnemyKill, onEnemyBeginAttackBase);
}
