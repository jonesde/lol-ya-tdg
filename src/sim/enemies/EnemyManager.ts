import { ENEMY_POOL_SIZE } from "@/render/svg/types.js";
import type { EnemyVisualMeta, MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { AttackTarget } from "./Enemy.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface PendingEnemyEntry {
  type: string;
  level: number;
  wave: number;
}

// One exposed outer edge-segment of the 3x3 base. `baseTile` is the base tile
// whose outer face is the dock; `outwardNormal` points away from the base center
// to the traversable tile just outside it.
interface BaseDock {
  dockIndex: number;
  baseTile: { x: number; y: number };
  outwardNormal: { dx: number; dy: number };
}

const SpatialCellSize = 100;

// Spatial-hash cell coordinates can be negative (enemies can briefly leave the
// map bounds during collision separation). Offset each coordinate by a power of
// two well beyond any map's cell range so the packed key stays a positive
// integer, and use a stride of 2*offset so every (cellX, cellY) pair maps to a
// unique key. Map cell coords top out around a few dozen, far below 1<<16.
const SPATIAL_AXIS_OFFSET = 1 << 16;
function spatialCellKey(cellX: number, cellY: number): number {
  return (cellX + SPATIAL_AXIS_OFFSET) * (2 * SPATIAL_AXIS_OFFSET) + (cellY + SPATIAL_AXIS_OFFSET);
}

export class EnemyManager {
  grid: Grid;
  particles: ParticleSpawner;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;
  defaultEnemyVisuals: Record<string, EnemyVisualMeta>;
  towerManager: TowerManager | null = null;
  baseTarget: AttackTarget | null = null;
  private spatialHash: Map<number, Enemy[]>;
  private idToEnemy: Map<number, Enemy>;
  private pendingQueues: Map<number, PendingEnemyEntry[]>;

  constructor(
    grid: Grid,
    particles: ParticleSpawner,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {},
  ) {
    this.grid = grid;
    this.particles = particles;
    this.enemies = [];
    this.difficultyTick = difficultyTick;
    this.theme = theme;
    this.defaultEnemyVisuals = defaultEnemyVisuals;
    this.spatialHash = new Map();
    this.idToEnemy = new Map();
    this.pendingQueues = new Map();
  }

  // Phase 1.5 plumbing: lets enemies resolve the tower (if any) on a tile. The
  // Engine wires the live TowerManager here after both managers are constructed.
  setTowerManager(towerManager: TowerManager | null): void {
    this.towerManager = towerManager;
  }

  towerAt(tileX: number, tileY: number): Tower | null {
    return this.towerManager?.towerAt(tileX, tileY) ?? null;
  }

  clear(): void {
    this.enemies = [];
    this.spatialHash.clear();
    this.idToEnemy.clear();
    this.pendingQueues.clear();
    resetEnemyId();
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy | null {
    const enemy = new Enemy(
      type,
      level,
      spawnIndex,
      this.grid,
      wave,
      this.difficultyTick,
      this.theme,
      this.defaultEnemyVisuals[type] ?? null,
      this.baseTarget,
    );
    if (!enemy.path) {
      return null;
    }
    this.enemies.push(enemy);
    this.idToEnemy.set(enemy.id, enemy);
    this.addToSpatialHash(enemy);
    return enemy;
  }

  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number): void {
    if (this.enemies.length < ENEMY_POOL_SIZE) {
      this.spawn(type, level, spawnIndex, wave);
      return;
    }
    if (!this.pendingQueues.has(spawnIndex)) {
      this.pendingQueues.set(spawnIndex, []);
    }
    this.pendingQueues.get(spawnIndex)!.push({ type, level, wave });
  }

  releaseOnePending(spawnIndex: number): void {
    const queue = this.pendingQueues.get(spawnIndex);
    if (!queue || queue.length === 0) return;
    if (this.enemies.length >= ENEMY_POOL_SIZE) return;
    const entry = queue.shift()!;
    this.spawn(entry.type, entry.level, spawnIndex, entry.wave);
  }

  // Returns the exposed outer edge-segments of the 3x3 base. A segment is exposed
  // only when its outward-adjacent tile is in bounds and not terrain (i.e. not a
  // terrain tile or the map edge), so enemies can stand on the tile just outside it.
  // The 3x3 yields up to 12 segments (3 per cardinal side); corner base tiles
  // contribute one segment per adjacent side, giving the formation room to spread to
  // both sides as a side fills.
  getBaseDocks(): BaseDock[] {
    const base = this.grid.getBase();
    const sides: { dx: number; dy: number }[] = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ];
    const offsets = [-1, 0, 1];
    const docks: BaseDock[] = [];
    for (const side of sides) {
      for (const offset of offsets) {
        const baseTile =
          side.dx === 0 ? { x: base.x + offset, y: base.y + side.dy } : { x: base.x + side.dx, y: base.y + offset };
        const outwardX = baseTile.x + side.dx;
        const outwardY = baseTile.y + side.dy;
        if (!this.grid.inBounds(outwardX, outwardY)) continue;
        if (this.grid.isTerrain(outwardX, outwardY)) continue;
        docks.push({ dockIndex: docks.length, baseTile, outwardNormal: side });
      }
    }
    return docks;
  }

  // Returns the exposed base-adjacent tiles (the `baseTile` of every open dock) as
  // plain tile coordinates. Used by enemy lateral-seeking so a blocked enemy can slip
  // into an open tile that still touches the base, spreading the pile around the
  // perimeter instead of stacking one-deep against a single edge.
  baseDocks(): { x: number; y: number }[] {
    return this.getBaseDocks().map((dock) => ({ x: dock.baseTile.x, y: dock.baseTile.y }));
  }

  // Count of live enemies currently standing on the given tile. Used by enemy
  // lateral-seeking to pick the least-occupied adjacent tile when blocked.
  enemiesInTile(tileX: number, tileY: number): number {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const tile = enemy.currentTile();
      if (tile.x === tileX && tile.y === tileY) count++;
    }
    return count;
  }

  removeDeadEnemy(i: number): void {
    const enemy = this.enemies[i]!;
    this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
    this.removeFromSpatialHash(enemy);
    this.idToEnemy.delete(enemy.id);
    const removedSpawnIndex = enemy.spawnIndex;
    this.enemies.splice(i, 1);
    this.releaseOnePending(removedSpawnIndex);
  }

  hasPendingEnemies(): boolean {
    for (const queue of this.pendingQueues.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  getPendingCountForSpawn(spawnIndex: number): number {
    const queue = this.pendingQueues.get(spawnIndex);
    return queue ? queue.length : 0;
  }

  getActiveEnemyCountForSpawn(spawnIndex: number): number {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.spawnIndex === spawnIndex) count++;
    }
    return count;
  }

  update(
    dt: number,
    onEnemyKill: ((enemy: Enemy) => void) | null,
    onEnemyBeginAttackBase?: ((enemy: Enemy) => void) | null,
  ): void {
    // Guards against the kill callback firing more than once for a single enemy
    // (e.g. if an enemy is already terminal at loop entry and the loop is later
    // refactored to not `continue`). The callback must run at most once per enemy.
    const handledEnemyIds = new Set<number>();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
        this.removeDeadEnemy(i);
        continue;
      }
      const wasAttackingBase = enemy.attackingBase;
      enemy.update(dt, this);
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
        this.removeDeadEnemy(i);
        continue;
      }
      if (!wasAttackingBase && enemy.attackingBase) {
        onEnemyBeginAttackBase?.(enemy);
      }
    }
    this.updateSpatialHash();
  }

  rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const cellX = Math.floor(enemy.x / SpatialCellSize);
      const cellY = Math.floor(enemy.y / SpatialCellSize);
      const cellKey = spatialCellKey(cellX, cellY);
      const bucket = this.spatialHash.get(cellKey);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.spatialHash.set(cellKey, [enemy]);
      }
    }
  }

  addToSpatialHash(enemy: Enemy): void {
    const cellX = Math.floor(enemy.x / SpatialCellSize);
    const cellY = Math.floor(enemy.y / SpatialCellSize);
    const cellKey = spatialCellKey(cellX, cellY);
    const bucket = this.spatialHash.get(cellKey);
    if (bucket) {
      bucket.push(enemy);
    } else {
      this.spatialHash.set(cellKey, [enemy]);
    }
    enemy.lastCellX = cellX;
    enemy.lastCellY = cellY;
  }

  removeFromSpatialHash(enemy: Enemy): void {
    const cellKey = spatialCellKey(enemy.lastCellX, enemy.lastCellY);
    const bucket = this.spatialHash.get(cellKey);
    if (!bucket) return;
    const index = bucket.indexOf(enemy);
    if (index !== -1) bucket.splice(index, 1);
    if (bucket.length === 0) this.spatialHash.delete(cellKey);
  }

  updateSpatialHash(): void {
    for (const enemy of this.enemies) {
      const currentCellX = Math.floor(enemy.x / SpatialCellSize);
      const currentCellY = Math.floor(enemy.y / SpatialCellSize);
      if (currentCellX === enemy.lastCellX && currentCellY === enemy.lastCellY) continue;
      this.removeFromSpatialHash(enemy);
      const cellKey = spatialCellKey(currentCellX, currentCellY);
      const bucket = this.spatialHash.get(cellKey);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.spatialHash.set(cellKey, [enemy]);
      }
      enemy.lastCellX = currentCellX;
      enemy.lastCellY = currentCellY;
    }
  }

  // Allocation-free range query. Iterates the same buckets and applies the same
  // distance filter as getEnemiesInRange, but invokes `cb` per surviving enemy
  // instead of building a result array — eliminating per-call array allocation
  // (and the GC churn it causes under heavy waves / lightning usage).
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void {
    const rangeSquared = range * range;
    const cellRadius = Math.ceil(range / SpatialCellSize);
    const centerCellX = Math.floor(x / SpatialCellSize);
    const centerCellY = Math.floor(y / SpatialCellSize);

    for (let cellX = centerCellX - cellRadius; cellX <= centerCellX + cellRadius; cellX++) {
      for (let cellY = centerCellY - cellRadius; cellY <= centerCellY + cellRadius; cellY++) {
        const bucket = this.spatialHash.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const enemy of bucket) {
          if (enemy.removed) continue;
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) cb(enemy);
        }
      }
    }
  }

  getEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const rangeSquared = range * range;
    const cellRadius = Math.ceil(range / SpatialCellSize);
    const centerCellX = Math.floor(x / SpatialCellSize);
    const centerCellY = Math.floor(y / SpatialCellSize);
    const result: Enemy[] = [];

    for (let cellX = centerCellX - cellRadius; cellX <= centerCellX + cellRadius; cellX++) {
      for (let cellY = centerCellY - cellRadius; cellY <= centerCellY + cellRadius; cellY++) {
        const bucket = this.spatialHash.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const enemy of bucket) {
          if (enemy.removed) continue;
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) {
            result.push(enemy);
          }
        }
      }
    }
    return result;
  }

  getEnemyById(id: number): Enemy | null {
    return this.idToEnemy.get(id) || null;
  }
}
