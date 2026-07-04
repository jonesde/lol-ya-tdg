import type { MapThemeData } from "@/render/themes/index.js";
import { Tower } from "./Tower.js";

interface EnemyManagerRef {
  enemies: {
    x: number;
    y: number;
    pathIdx: number;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    applySlow(amount: number, duration: number): void;
  }[];
}

interface ParticleManagerRef {
  spawn(x: number, y: number, color: string, count: number, opts: { speed: number; life: number }): void;
}

interface ProjectileManagerRef {
  spawn(opts: {
    x: number;
    y: number;
    damage: number;
    speed: number;
    range: number;
    towerType: string;
    towerLevel: number;
    targetId: number;
    slowAmt?: number;
    slowDur?: number;
    towerId?: string;
  }): void;
  fireLightning(opts: {
    originX: number;
    originY: number;
    damage: number;
    towerLevel: number;
    targetId: number;
    stunDuration: number;
    towerId?: string;
  }): void;
  setOnLightningFlash(callback: (startX: number, startY: number, endX: number, endY: number) => void): void;
}

interface SoundManagerRef {
  play(name: string): void;
}

interface SaveData {
  gems: number;
  unlocked: Record<string, { addons: boolean[]; variantA: boolean[]; variantB: boolean[]; levels: boolean[] }>;
  generalAddons?: Record<string, unknown>;
}

interface GridRef {
  tileSize: number;
  canBuild(x: number, y: number): boolean;
  registerTower(x: number, y: number): boolean;
  unregisterTower(x: number, y: number): boolean;
}

export class TowerManager {
  grid: GridRef;
  particles: ParticleManagerRef;
  projectiles: ProjectileManagerRef;
  sound: SoundManagerRef | null;
  towers: Tower[];
  private nextTowerId: number = 0;
  theme: MapThemeData | null;

  constructor(
    grid: GridRef,
    particles: ParticleManagerRef,
    projectiles: ProjectileManagerRef,
    sound: SoundManagerRef | null,
    theme: MapThemeData | null = null,
  ) {
    this.grid = grid;
    this.particles = particles;
    this.projectiles = projectiles;
    this.sound = sound;
    this.theme = theme;
    this.towers = [];
  }

  clear(): void {
    this.towers = [];
  }

  build(type: string, tileX: number, tileY: number, save: SaveData | undefined, grid: GridRef): Tower | null {
    if (!this.grid.canBuild(tileX, tileY)) return null;
    const tower = new Tower(type, tileX, tileY, save, grid, this.theme);
    tower.id = `tower-${++this.nextTowerId}`;
    if (!this.grid.registerTower(tileX, tileY)) return null;
    this.towers.push(tower);
    this.particles.spawn(tower.x, tower.y, tower.color, 10, { speed: 50, life: 0.4 });
    if (this.sound) this.sound.play("place");
    return tower;
  }

  sell(tower: Tower, _save: SaveData | undefined): number {
    const val = tower.sellValue();
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    const index = this.towers.findIndex(
      (candidate) => candidate.tileX === tower.tileX && candidate.tileY === tower.tileY,
    );
    if (index >= 0) this.towers.splice(index, 1);
    this.particles.spawn(tower.x, tower.y, "#ffcf4d", 14, { speed: 70, life: 0.5 });
    return val;
  }

  cancelBuild(tower: Tower): number {
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    const index = this.towers.findIndex(
      (candidate) => candidate.tileX === tower.tileX && candidate.tileY === tower.tileY,
    );
    if (index >= 0) this.towers.splice(index, 1);
    this.particles.spawn(tower.x, tower.y, "#88ff88", 14, { speed: 70, life: 0.5 });
    return tower.totalInvested;
  }

  update(dt: number, enemyManager: EnemyManagerRef): void {
    for (const tower of this.towers)
      tower.update(
        dt,
        enemyManager,
        this.projectiles,
        this.particles as unknown as { emit(x: number, y: number, color: string): void },
        this.sound as unknown as { play: (name: string) => void },
      );
  }

  towerAt(tileX: number, tileY: number): Tower | undefined {
    return this.towers.find((tower) => tower.tileX === tileX && tower.tileY === tileY);
  }
}
