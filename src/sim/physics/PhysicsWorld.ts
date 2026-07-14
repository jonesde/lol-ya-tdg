import type RAPIER from "@dimforge/rapier2d-compat";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import { getRapier } from "./rapierContext.js";

// Wraps one Rapier2d world that owns enemy motion (dynamic circle bodies driven
// by velocity) plus the static containment/world geometry: a base collider, fixed
// tower colliders, and a closed boundary of thin wall segments around the
// walkable corridor (path ∪ base ∪ spawn tiles). Constructed only when the
// RAPIER_PHYSICS flag is on, so building it (and loading the Rapier WASM) is
// gated behind getRapier() resolving — see rapierContext.ts.
export class PhysicsWorld {
  private grid: Grid;
  private world: RAPIER.World;
  private baseCollider: RAPIER.Collider | null = null;
  private towerColliders: RAPIER.Collider[] = [];
  private corridorColliders: RAPIER.Collider[] = [];

  constructor(grid: Grid) {
    const RAPIER = getRapier();
    this.grid = grid;
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = FIXED_DT;
    this.buildBase();
    this.rebuildCorridor();
  }

  // True when `tile` is part of the walkable corridor: a path tile, the base
  // tile, or a spawn tile. Used to decide where to emit containment walls.
  private isWalkable(x: number, y: number): boolean {
    return this.grid.isPath(x, y) || this.grid.isBase(x, y) || this.grid.isSpawn(x, y);
  }

  private dropBaseCollider(): void {
    if (this.baseCollider) {
      this.world.removeCollider(this.baseCollider, false);
      this.baseCollider = null;
    }
  }

  private dropColliders(list: RAPIER.Collider[]): void {
    for (const collider of list) {
      this.world.removeCollider(collider, false);
    }
    list.length = 0;
  }

  // One fixed cuboid covering the 3x3 base, so enemies pile against it instead
  // of passing through.
  buildBase(): void {
    const RAPIER = getRapier();
    this.dropBaseCollider();
    const baseCenter = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    const half = 1.5 * this.grid.tileSize;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(baseCenter.x, baseCenter.y));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, half), body);
    this.baseCollider = collider;
  }

  // Rebuild fixed tower colliders from the current TowerManager. Ghost towers
  // are skipped (they do not block). A full rebuild (drop + recreate) is keyed
  // off grid.pathVersion bumps by the caller.
  rebuildTowers(towerManager: TowerManager): void {
    const RAPIER = getRapier();
    this.dropColliders(this.towerColliders);
    for (const tower of towerManager.towers) {
      if (tower.isGhost) continue;
      const centerX = tower.x ?? this.grid.tileToWorld(tower.tileX, tower.tileY).x;
      const centerY = tower.y ?? this.grid.tileToWorld(tower.tileX, tower.tileY).y;
      const half = this.grid.tileSize / 2;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, half), body);
      this.towerColliders.push(collider);
    }
  }

  // Emit a closed boundary of thin fixed wall segments around every walkable
  // tile: for each walkable tile, every orthogonal neighbor that is out of bounds
  // or not walkable gets a wall along the shared edge. This keeps free rigid
  // bodies on the corridor instead of drifting into terrain.
  rebuildCorridor(): void {
    const RAPIER = getRapier();
    this.dropColliders(this.corridorColliders);
    const tileSize = this.grid.tileSize;
    const halfThickness = tileSize * 0.05;
    const halfLength = tileSize / 2;

    const walkableTiles: { x: number; y: number }[] = [];
    for (const path of this.grid.paths) {
      if (path) {
        for (const tile of path) {
          walkableTiles.push({ x: tile.x, y: tile.y });
        }
      }
    }
    walkableTiles.push({ x: this.grid.base.x, y: this.grid.base.y });
    for (const spawn of this.grid.spawns) {
      walkableTiles.push({ x: spawn.x, y: spawn.y });
    }

    const neighbors = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (const tile of walkableTiles) {
      const tileCenter = this.grid.tileToWorld(tile.x, tile.y);
      for (const neighbor of neighbors) {
        const nx = tile.x + neighbor.dx;
        const ny = tile.y + neighbor.dy;
        if (this.isWalkable(nx, ny)) continue;

        const neighborCenter = this.grid.tileToWorld(nx, ny);
        const edgeCenterX = (tileCenter.x + neighborCenter.x) / 2;
        const edgeCenterY = (tileCenter.y + neighborCenter.y) / 2;

        // Vertical edge (neighbor left/right) → thin along x, full length along y.
        // Horizontal edge (neighbor up/down) → full length along x, thin along y.
        const halfX = neighbor.dx !== 0 ? halfThickness : halfLength;
        const halfY = neighbor.dx !== 0 ? halfLength : halfThickness;

        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(edgeCenterX, edgeCenterY),
        );
        const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY), body);
        this.corridorColliders.push(collider);
      }
    }
  }

  // Create a dynamic circle body for an enemy and assign it to enemy.body.
  addEnemy(enemy: Enemy): void {
    const RAPIER = getRapier();
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(enemy.x, enemy.y)
      .lockRotations()
      .setLinearDamping(0.9);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(enemy.radius).setRestitution(0);
    this.world.createCollider(colliderDesc, body);
    enemy.body = body;
  }

  // Remove the enemy's rigid body (and its collider) from the world.
  removeEnemy(enemy: Enemy): void {
    if (enemy.body) {
      this.world.removeRigidBody(enemy.body);
      enemy.body = null;
    }
  }

  setEnemyVelocity(enemy: Enemy, vx: number, vy: number): void {
    enemy.body?.setLinvel({ x: vx, y: vy }, true);
  }

  getEnemyPosition(enemy: Enemy): { x: number; y: number } | null {
    return enemy.body ? enemy.body.translation() : null;
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.dropBaseCollider();
    this.dropColliders(this.towerColliders);
    this.dropColliders(this.corridorColliders);
    this.world.free();
    this.world = null as unknown as RAPIER.World;
  }
}
