import { ENEMY_POOL_SIZE } from "@/render/svg/types.js";
import type { MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "../grid/Grid.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface ParticleManagerRef {
  spawn(x: number, y: number, color: string, count: number, opts: { speed: number; life: number }): void;
}

interface PendingEnemyEntry {
  type: string;
  level: number;
  wave: number;
}

const SpatialCellSize = 100;

export class EnemyManager {
  grid: Grid;
  particles: ParticleManagerRef;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;
  private spatialHash: Map<string, Enemy[]>;
  private idToEnemy: Map<number, Enemy>;
  private pendingQueues: Map<number, PendingEnemyEntry[]>;

  constructor(
    grid: Grid,
    particles: ParticleManagerRef,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
  ) {
    this.grid = grid;
    this.particles = particles;
    this.enemies = [];
    this.difficultyTick = difficultyTick;
    this.theme = theme;
    this.spatialHash = new Map();
    this.idToEnemy = new Map();
    this.pendingQueues = new Map();
  }

  clear(): void {
    this.enemies = [];
    this.spatialHash.clear();
    this.idToEnemy.clear();
    this.pendingQueues.clear();
    resetEnemyId();
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy {
    const enemy = new Enemy(type, level, spawnIndex, this.grid, wave, this.difficultyTick, this.theme);
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

  update(dt: number, onEnemyKill: ((enemy: Enemy) => void) | null): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed || enemy.reachedBase) {
        this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
        if (onEnemyKill) onEnemyKill(enemy);
        this.removeFromSpatialHash(enemy);
        this.idToEnemy.delete(enemy.id);
        const removedSpawnIndex = enemy.spawnIndex;
        this.enemies.splice(i, 1);
        this.releaseOnePending(removedSpawnIndex);
        continue;
      }
      enemy.update(dt, this);
    }
    this.updateSpatialHash();
  }

  rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const cellKey = `${Math.floor(enemy.x / SpatialCellSize)},${Math.floor(enemy.y / SpatialCellSize)}`;
      const bucket = this.spatialHash.get(cellKey);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.spatialHash.set(cellKey, [enemy]);
      }
    }
  }

  addToSpatialHash(enemy: Enemy): void {
    const cellKey = `${Math.floor(enemy.x / SpatialCellSize)},${Math.floor(enemy.y / SpatialCellSize)}`;
    const bucket = this.spatialHash.get(cellKey);
    if (bucket) {
      bucket.push(enemy);
    } else {
      this.spatialHash.set(cellKey, [enemy]);
    }
    enemy.lastCellX = Math.floor(enemy.x / SpatialCellSize);
    enemy.lastCellY = Math.floor(enemy.y / SpatialCellSize);
  }

  removeFromSpatialHash(enemy: Enemy): void {
    const cellKey = `${enemy.lastCellX},${enemy.lastCellY}`;
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
      const cellKey = `${currentCellX},${currentCellY}`;
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

  getEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const rangeSquared = range * range;
    const cellRadius = Math.ceil(range / SpatialCellSize);
    const centerCellX = Math.floor(x / SpatialCellSize);
    const centerCellY = Math.floor(y / SpatialCellSize);
    const result: Enemy[] = [];

    for (let cellX = centerCellX - cellRadius; cellX <= centerCellX + cellRadius; cellX++) {
      for (let cellY = centerCellY - cellRadius; cellY <= centerCellY + cellRadius; cellY++) {
        const bucket = this.spatialHash.get(`${cellX},${cellY}`);
        if (!bucket) continue;
        for (const enemy of bucket) {
          if (enemy.removed || enemy.reachedBase) continue;
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
