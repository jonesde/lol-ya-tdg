import type { MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "../grid/Grid.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface ParticleManagerRef {
  spawn(x: number, y: number, color: string, count: number, opts: { speed: number; life: number }): void;
}

export class EnemyManager {
  grid: Grid;
  particles: ParticleManagerRef;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;

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
  }

  clear(): void {
    this.enemies = [];
    resetEnemyId();
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy {
    const enemy = new Enemy(type, level, spawnIndex, this.grid, wave, this.difficultyTick, this.theme);
    this.enemies.push(enemy);
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
  }

  getEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const r2 = range * this.grid.tileSize * (range * this.grid.tileSize);
    return this.enemies.filter((enemy) => {
      const deltaX = enemy.x - x,
        deltaY = enemy.y - y;
      return deltaX * deltaX + deltaY * deltaY <= r2 && !enemy.removed && !enemy.reachedBase;
    });
  }

  getEnemyById(id: number): Enemy | null {
    return this.enemies.find((enemy) => enemy.id === id) || null;
  }
}
