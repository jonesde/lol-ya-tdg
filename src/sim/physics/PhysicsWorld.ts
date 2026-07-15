import type RAPIER from "@dimforge/rapier2d-compat";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import { getRapier } from "./rapierContext.js";

// Wraps one Rapier2d world that owns enemy motion (dynamic circle bodies driven
// by velocity) plus the static containment/world geometry: a base collider, fixed
// tower colliders, and a closed boundary of thin wall segments around the
// walkable corridor (path ∪ base ∪ spawn tiles). Physics is always on, so building
// it (and loading the Rapier WASM) is gated behind getRapier() resolving — see
// rapierContext.ts.
export class PhysicsWorld {
  private grid: Grid;
  private world: RAPIER.World;
  // Static geometry is tracked by its rigid body; removing the body also removes
  // its attached collider, which avoids Rapier's panicking `removeCollider`.
  private baseBody: RAPIER.RigidBody | null = null;
  private towerBodies: RAPIER.RigidBody[] = [];
  private corridorBodies: RAPIER.RigidBody[] = [];
  private enemyByHandle: Map<number, Enemy> = new Map();
  // Whether enemy bodies collide with each other. Default true (OFF path, no
  // change). Under RECAST_NAV the DetourCrowd owns enemy-enemy avoidance, so this
  // is flipped to false to avoid two solvers fighting (enemies still collide with
  // towers/base/walls via Rapier's default groups).
  enemyEnemyCollisions = true;

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

  // One fixed cuboid covering the 3x3 base, so enemies pile against it instead
  // of passing through.
  buildBase(): void {
    const RAPIER = getRapier();
    this.dropBase();
    const baseCenter = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    const half = 1.5 * this.grid.tileSize;
    this.baseBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(baseCenter.x, baseCenter.y));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, half), this.baseBody);
  }

  // Rebuild fixed tower colliders from the current TowerManager. Ghost towers
  // are skipped (they do not block). A full rebuild (drop + recreate) is keyed
  // off grid.pathVersion bumps by the caller.
  rebuildTowers(towerManager: TowerManager): void {
    const RAPIER = getRapier();
    this.dropBodies(this.towerBodies);
    for (const tower of towerManager.towers) {
      if (tower.isGhost) continue;
      const centerX = tower.x ?? this.grid.tileToWorld(tower.tileX, tower.tileY).x;
      const centerY = tower.y ?? this.grid.tileToWorld(tower.tileX, tower.tileY).y;
      const half = this.grid.tileSize / 2;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, half), body);
      this.towerBodies.push(body);
    }
  }

  // Emit a closed boundary of thin fixed wall segments around every walkable
  // tile: for each walkable tile, every orthogonal neighbor that is out of bounds
  // or not walkable gets a wall along the shared edge. This keeps free rigid
  // bodies on the corridor instead of drifting into terrain.
  rebuildCorridor(): void {
    const RAPIER = getRapier();
    this.dropBodies(this.corridorBodies);
    const tileSize = this.grid.tileSize;
    const halfThickness = tileSize * 0.05;
    const halfLength = tileSize / 2;

    const walkableTiles: { x: number; y: number }[] = [];
    const seenWalkable = new Set<string>();
    const addWalkable = (x: number, y: number): void => {
      const key = `${x},${y}`;
      if (seenWalkable.has(key)) return;
      seenWalkable.add(key);
      walkableTiles.push({ x, y });
    };
    for (let tileY = 0; tileY < this.grid.height; tileY++) {
      for (let tileX = 0; tileX < this.grid.width; tileX++) {
        if (this.isWalkable(tileX, tileY)) addWalkable(tileX, tileY);
      }
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

        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(edgeCenterX, edgeCenterY));
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY), body);
        this.corridorBodies.push(body);
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
    // When enemy-enemy collisions are disabled (RECAST_NAV), put enemies in group
    // 1 and exclude group 1 from their collision filter. Membership/filter are the
    // high/low 16 bits of the group: (group << 16) | filter. Towers/base/walls keep
    // Rapier's default groups, so enemies still collide with them.
    if (!this.enemyEnemyCollisions) colliderDesc.setCollisionGroups((0x0001 << 16) | 0xfffe);
    this.world.createCollider(colliderDesc, body);
    enemy.body = body;
    this.enemyByHandle.set(body.handle, enemy);
  }

  // Toggle enemy-enemy collisions (see `enemyEnemyCollisions`). Only takes effect
  // for enemies added after the call; existing bodies are left as-is.
  setEnemyEnemyCollisions(enabled: boolean): void {
    this.enemyEnemyCollisions = enabled;
  }

  // Remove the enemy's rigid body (and its collider) from the world.
  removeEnemy(enemy: Enemy): void {
    if (enemy.body) {
      this.enemyByHandle.delete(enemy.body.handle);
      this.world.removeRigidBody(enemy.body);
      enemy.body = null;
    }
  }

  // Returns true only for colliders whose parent rigid body is a live enemy.
  private isEnemyCollider = (collider: RAPIER.Collider): boolean => {
    const parent = collider.parent();
    return parent !== null && this.enemyByHandle.has(parent.handle);
  };

  // Resolves a collider back to its Enemy, skipping removed enemies.
  private enemyFromCollider(collider: RAPIER.Collider): Enemy | null {
    const parent = collider.parent();
    if (!parent) return null;
    const enemy = this.enemyByHandle.get(parent.handle);
    return enemy && !enemy.removed ? enemy : null;
  }

  // Proximity query replacing the deleted spatial hash. Returns enemies whose
  // CENTER is within `range` of (x, y) — matches the legacy getEnemiesInRange
  // center-distance filter exactly.
  queryEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const RAPIER = getRapier();
    const result: Enemy[] = [];
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      new RAPIER.Ball(range),
      (collider) => {
        const enemy = this.enemyFromCollider(collider);
        if (enemy) {
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) result.push(enemy);
        }
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      this.isEnemyCollider,
    );
    return result;
  }

  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void {
    const RAPIER = getRapier();
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      new RAPIER.Ball(range),
      (collider) => {
        const enemy = this.enemyFromCollider(collider);
        if (enemy) {
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) cb(enemy);
        }
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      this.isEnemyCollider,
    );
  }

  // Swept-shape cast against enemy colliders only. Returns the first enemy hit
  // along (dirX, dirY) from (originX, originY) within `maxDistance`, plus its
  // collider (needed to exclude it on a subsequent pierce pass). `excluded`
  // skips previously-hit colliders: either a single collider or a Set of them.
  // Returns null if nothing is hit.
  castShapeFirstEnemy(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    excluded?: RAPIER.Collider | Set<RAPIER.Collider> | null,
  ): { enemy: Enemy; collider: RAPIER.Collider } | null {
    const RAPIER = getRapier();
    const length = Math.hypot(dirX, dirY) || 1;
    const velocity = { x: (dirX / length) * maxDistance, y: (dirY / length) * maxDistance };
    const excludedSet = excluded instanceof Set ? excluded : excluded ? new Set([excluded]) : null;
    const hit = this.world.castShape(
      { x: originX, y: originY },
      0,
      velocity,
      new RAPIER.Ball(ballRadius),
      0,
      1,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => {
        if (excludedSet?.has(collider)) return false;
        return this.isEnemyCollider(collider);
      },
    );
    if (!hit) return null;
    const enemy = this.enemyFromCollider(hit.collider);
    if (!enemy) return null;
    return { enemy, collider: hit.collider };
  }

  // Multi-hit variant for piercing: repeatedly casts from the SAME origin,
  // accumulating every hit collider in an exclusion set so the next pass returns
  // the next enemy along the ray (closest-first). Calling `cb(enemy)` for each
  // hit; `cb` returns false to stop early. Stops after `maxHits` hits or when
  // nothing more is hit.
  castShapePierce(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    maxHits: number,
    cb: (enemy: Enemy) => boolean,
  ): void {
    const excluded = new Set<RAPIER.Collider>();
    let hits = 0;
    while (hits < maxHits) {
      const result = this.castShapeFirstEnemy(originX, originY, dirX, dirY, ballRadius, maxDistance, excluded);
      if (!result) break;
      hits++;
      const keepGoing = cb(result.enemy);
      if (!keepGoing) break;
      excluded.add(result.collider);
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

  // Remove a set of rigid bodies (and their attached colliders) from the world.
  private dropBodies(bodies: RAPIER.RigidBody[]): void {
    for (const body of bodies) {
      this.world.removeRigidBody(body);
    }
    bodies.length = 0;
  }

  private dropBase(): void {
    if (this.baseBody) {
      this.world.removeRigidBody(this.baseBody);
      this.baseBody = null;
    }
  }

  // Free the entire world in one call. Rapier's `removeCollider`/`removeRigidBody`
  // can panic on already-detached handles, so we rely on `world.free()` to reclaim
  // everything and just drop our references. Guarded so dispose is idempotent.
  dispose(): void {
    this.baseBody = null;
    this.towerBodies = [];
    this.corridorBodies = [];
    if (this.world) {
      this.world.free();
      this.world = null as unknown as RAPIER.World;
    }
  }
}
