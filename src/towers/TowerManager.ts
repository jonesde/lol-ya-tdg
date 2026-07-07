import type { MapThemeData } from "@/render/themes/index.js";
import { Tower } from "./Tower.js";

interface EnemyManagerRef {
  enemies: {
    x: number;
    y: number;
    pathIdx: number;
    path: { x: number; y: number }[] | null;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
  }[];
  getEnemiesInRange(
    x: number,
    y: number,
    range: number,
  ): {
    x: number;
    y: number;
    pathIdx: number;
    path: { x: number; y: number }[] | null;
    removed: boolean;
    maxHp: number;
    hp: number;
    id: number;
    applySlow(amount: number, duration: number): void;
    applyStun?(duration: number): void;
  }[];
  getEnemyById(
    id: number,
  ): {
    id: number;
    removed: boolean;
    x: number;
    y: number;
    hp: number;
    pathIdx: number;
    path: { x: number; y: number }[] | null;
  } | null;
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
    napalm?: boolean;
    variant?: "A" | "B" | null;
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
  sound: SoundManagerRef;
  towers: Tower[];
  private nextTowerId: number = 0;
  private towerMap: Map<string, Tower> = new Map();
  private tileMap: Map<string, Tower> = new Map();
  theme: MapThemeData | null;

  constructor(
    grid: GridRef,
    particles: ParticleManagerRef,
    projectiles: ProjectileManagerRef,
    sound: SoundManagerRef,
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
    this.towerMap.clear();
    this.tileMap.clear();
  }

  build(type: string, tileX: number, tileY: number, save: SaveData | undefined, grid: GridRef): Tower | null {
    if (!this.grid.canBuild(tileX, tileY)) return null;
    const tower = new Tower(type, tileX, tileY, save, grid, this.theme);
    tower.id = `tower-${++this.nextTowerId}`;
    if (!this.grid.registerTower(tileX, tileY)) return null;
    this.towers.push(tower);
    this.towerMap.set(tower.id, tower);
    this.tileMap.set(`${tileX},${tileY}`, tower);
    this.particles.spawn(tower.x, tower.y, tower.color, 10, { speed: 50, life: 0.4 });
    this.sound.play("place");
    return tower;
  }

  sell(tower: Tower, _save: SaveData | undefined): number {
    const val = tower.sellValue();
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerMap.delete(tower.id);
    this.tileMap.delete(`${tower.tileX},${tower.tileY}`);
    this.particles.spawn(tower.x, tower.y, "#ffcf4d", 14, { speed: 70, life: 0.5 });
    this.sound.play("sell");
    return val;
  }

  cancelBuild(tower: Tower): number {
    this.grid.unregisterTower(tower.tileX, tower.tileY);
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerMap.delete(tower.id);
    this.tileMap.delete(`${tower.tileX},${tower.tileY}`);
    this.particles.spawn(tower.x, tower.y, "#88ff88", 14, { speed: 70, life: 0.5 });
    this.sound.play("cancel");
    return tower.totalInvested;
  }

  downgradeTower(tower: Tower): number {
    if (tower.level <= 1) return 0;
    let removedCost = 0;
    if (tower.variant) {
      removedCost = tower.levelCosts[4] ?? 0;
      tower.levelCosts.pop();
      tower.totalInvested -= removedCost;
      tower.variant = null;
      tower.level = 4;
    } else {
      const levelIndex = tower.level - 1;
      removedCost = tower.levelCosts[levelIndex] ?? 0;
      tower.levelCosts.pop();
      tower.totalInvested -= removedCost;
      tower.level--;
    }
    if (tower.totalInvested < 0) tower.totalInvested = 0;
    tower._statsCache = null;
    this.particles.spawn(tower.x, tower.y, "#ffd060", 10, { speed: 50, life: 0.4 });
    return removedCost;
  }

  update(dt: number, enemyManager: EnemyManagerRef): void {
    for (const tower of this.towers) tower.update(dt, enemyManager, this.projectiles, this.sound);
  }

  getTowerById(id: string): Tower | undefined {
    return this.towerMap.get(id);
  }

  towerAt(tileX: number, tileY: number): Tower | undefined {
    return this.tileMap.get(`${tileX},${tileY}`);
  }
}
