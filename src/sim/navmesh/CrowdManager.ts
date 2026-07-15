import { Crowd, type NavMesh } from "recast-navigation";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { toRecast } from "./coords.js";

// Acceleration factor on top of (speed * tileSize). The original value (8) lets
// agents follow the navmesh path at full responsiveness; the inside-corner catch
// that caused pause-and-reroute is fixed geometrically by the chamfered corridor
// walls (see PhysicsWorld.rebuildCorridor), so acceleration is left at the
// original value to avoid slowing every enemy's base approach.
const CROWD_MAX_ACCEL_FACTOR = 8;

// Wraps one DetourCrowd derived from the run's NavMesh. Each live enemy owns a
// CrowdAgent; the crowd computes the desired velocity (path follow + local
// avoidance) and CrowdManager.update pushes that into the enemy's Rapier body so
// Rapier remains the hard collision authority against towers/base/walls.
export class CrowdManager {
  private crowd: Crowd;
  private tileSize: number;

  constructor(navMesh: NavMesh, tileSize: number, maxAgents: number) {
    this.tileSize = tileSize;
    this.crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius: tileSize });
  }

  // Creates a CrowdAgent for `enemy` at its current world position and stores it
  // on the enemy so the rest of the sim can drive/poke it. `maxSpeed` is world
  // units/sec (enemy.speed is tiles/sec, so multiply by tileSize).
  addAgent(enemy: Enemy): void {
    const agent = this.crowd.addAgent(toRecast({ x: enemy.x, y: enemy.y }), {
      radius: enemy.radius,
      maxSpeed: enemy.speed * this.tileSize,
      // Lower acceleration than the default so agents follow a wider, smoother arc
      // through corners instead of snapping velocity to cut the inside of a bend
      // (which would clip the wall and trigger a physics reroute).
      maxAcceleration: enemy.speed * this.tileSize * CROWD_MAX_ACCEL_FACTOR,
      separationWeight: 1,
    });
    enemy.agent = agent;
  }

  removeAgent(enemy: Enemy): void {
    if (enemy.agent) {
      this.crowd.removeAgent(enemy.agent);
      enemy.agent = null;
    }
  }

  setBaseTarget(enemy: Enemy, baseWorld: { x: number; y: number }): void {
    enemy.agent?.requestMoveTarget(toRecast(baseWorld));
  }

  requestMoveTarget(enemy: Enemy, world: { x: number; y: number }): void {
    enemy.agent?.requestMoveTarget(toRecast(world));
  }

  setMaxSpeed(enemy: Enemy, speedWorldPerSec: number): void {
    enemy.agent?.updateParameters({ maxSpeed: speedWorldPerSec });
  }

  teleportAgent(enemy: Enemy, world: { x: number; y: number }): void {
    enemy.agent?.teleport(toRecast(world));
  }

  // Advances the crowd one fixed step, then writes each agent's desired velocity
  // into its Rapier body. Stun/hold/attackingBase force zero velocity so the agent
  // parks while Rapier still resolves tower/base/wall contacts.
  update(dt: number, enemies: Enemy[]): void {
    this.crowd.update(dt);
    for (const enemy of enemies) {
      if (!enemy.agent || !enemy.body) continue;
      if (enemy.stunTimer > 0 || enemy.routingMode === "hold" || enemy.attackingBase) {
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }
      const velocity = enemy.agent.velocity();
      // Recast Y is height and stays 0; game Y lives in Recast Z.
      enemy.body.setLinvel({ x: velocity.x, y: velocity.z }, true);
    }
  }

  destroy(): void {
    this.crowd.destroy();
  }
}
