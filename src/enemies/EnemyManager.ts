import type { MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "../grid/Grid.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface ParticleManagerRef {
  spawn(x: number, y: number, color: string, count: number, opts: { speed: number; life: number }): void;
}

const SpatialCellSize = 100;

export class EnemyManager {
  grid: Grid;
  particles: ParticleManagerRef;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;
  private spatialHash: Map<string, Enemy[]>;

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
  }

  clear(): void {
    this.enemies = [];
    this.spatialHash.clear();
    resetEnemyId();
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy {
    const enemy = new Enemy(type, level, spawnIndex, this.grid, wave, this.difficultyTick, this.theme);
    this.enemies.push(enemy);
    this.rebuildSpatialHash();
    return enemy;
  }

  update(dt: number, onEnemyKill: ((enemy: Enemy) => void) | null): void {
    const enemies = this.enemies.slice();
    for (const enemy of enemies) enemy.update(dt, this);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed || enemy.reachedBase) {
        this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
        if (onEnemyKill) onEnemyKill(enemy);
        this.enemies.splice(i, 1);
      }
    }
    this.rebuildSpatialHash();
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
    return this.enemies.find((enemy) => enemy.id === id) || null;
  }
}
