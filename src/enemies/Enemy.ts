import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import { DIFFICULTY_MULT_TICK } from "../game/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "../game/ConstantsEnemy.js";
import { useMapThemeStore } from "../stores/mapTheme.js";

let nextId = 1;

export function resetEnemyId() {
  nextId = 1;
}

interface SlowEntry {
  eff: number;
  remaining: number;
}

interface EnemyMetaRef {
  baseHp: number;
  speed: number;
  bounty: number;
  radius: number;
  walking: unknown;
  hitReaction: unknown;
  resist?: number;
  slowResist?: number;
  shield?: number;
  heal?: number;
  healRange?: number;
}

interface GridRef {
  tileSize: number;
  getPathFor(spawnIndex: number): { x: number; y: number }[] | null;
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  getBase(): { x: number; y: number };
  blocked: Set<string>;
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
}

export class Enemy {
  id: number;
  type: string;
  level: number;
  meta: EnemyMetaRef;
  maxHp: number;
  hp: number;
  speed: number;
  bounty: number;
  color: string;
  radius: number;
  shape: unknown;
  walking: MapThemeAnimation | null;
  hitReaction: MapThemeAnimation | null;
  visualMeta: EnemyVisualMeta | null;
  theme: MapThemeData | null;
  resist: number;
  slowResist: number;
  shield: number;
  maxShield: number;
  heal: number;
  healRange: number;
  spawnIndex: number;
  grid: GridRef;
  path: { x: number; y: number }[] | null;
  pathIdx: number;
  x!: number;
  y!: number;
  worldPos!: { x: number; y: number };
  slowFactor!: number;
  slowStack!: SlowEntry[];
  stunTimer!: number;
  reachedBase!: boolean;
  removed!: boolean;
  burnTimer!: number;
  burnDps!: number;
  hitAnimTime!: number;
  _gameSeconds: number = 0;
  onPathBlocked!: boolean;
  moveAngle!: number;
  markTargetMult!: number;
  markTargetTimer!: number;
  antiHealTimer!: number;
  lastCellX!: number;
  lastCellY!: number;

  constructor(
    type: string,
    level: number,
    spawnIndex: number,
    grid: GridRef,
    wave: number,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
  ) {
    const meta = ENEMY_TYPES[type] as unknown as EnemyMetaRef;
    this.id = nextId++;
    this.type = type;
    this.level = level;
    this.meta = meta;
    this.theme = theme;
    const enemyVisual = (theme?.enemies[type] ?? null) as EnemyVisualMeta | null;
    const themeStore = useMapThemeStore();
    const defaultEnemy = themeStore.getDefaultEnemyVisual(type);
    this.color = enemyVisual?.color || defaultEnemy?.color || "#e85a6a";
    this.radius = meta.radius * grid.tileSize * 0.5;
    this.shape = enemyVisual?.shape || defaultEnemy?.shape || "circle";
    this.walking = enemyVisual?.walking || null;
    this.hitReaction = enemyVisual?.hitReaction || null;
    this.visualMeta = enemyVisual;
    this.resist = meta.resist || 0;
    this.slowResist = meta.slowResist || 0;
    this.shield = meta.shield ? meta.shield * level : 0;
    this.maxShield = this.shield;
    this.heal = meta.heal || 0;
    this.healRange = (meta.healRange || 0) * grid.tileSize;

    const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
    const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
    this.maxHp = meta.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.hp = this.maxHp;
    this.speed = meta.speed;
    this.bounty = Math.ceil(meta.bounty * (1 + 0.5 * (level - 1)));

    this.spawnIndex = spawnIndex;
    this.grid = grid;
    this.slowFactor = 1;
    this.slowStack = [];
    this.stunTimer = 0;
    this.burnTimer = 0;
    this.burnDps = 0;
    this.hitAnimTime = 0;
    this._gameSeconds = 0;
    this.moveAngle = 0;
    this.markTargetMult = 0;
    this.markTargetTimer = 0;
    this.antiHealTimer = 0;
    this.path = grid.getPathFor(spawnIndex);
    this.pathIdx = 0;
    if (!this.path || this.path.length === 0) {
      this.removed = true;
      this.onPathBlocked = true;
      return;
    }
    const start = grid.tileToWorld(this.path[0]!.x, this.path[0]!.y);
    this.x = start.x;
    this.y = start.y;
    this.worldPos = { x: this.x, y: this.y };
    this.lastCellX = -1;
    this.lastCellY = -1;

    this.reachedBase = false;
    this.removed = false;
  }

  applySlow(amount: number, duration: number) {
    const eff = amount * (1 - this.slowResist);
    if (eff <= 0) return;
    const existing = this.slowStack.find((slowEntry) => slowEntry.eff <= eff && slowEntry.remaining > 0);
    if (existing) {
      existing.eff = eff;
      existing.remaining = Math.max(existing.remaining, duration);
    } else {
      this.slowStack.push({ eff, remaining: duration });
    }
    this.recalcSlow();
  }

  recalcSlow() {
    this.slowFactor = 1;
    for (const slowEntry of this.slowStack) this.slowFactor *= 1 - slowEntry.eff;
    this.slowFactor = Math.max(MIN_SLOW_FACTOR, this.slowFactor);
  }

  applyStun(duration: number) {
    if (this.type === "boss") duration *= BOSS_STUN_REDUCTION;
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  applyBurn(dps: number, duration: number) {
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnTimer = Math.max(this.burnTimer, duration);
  }

  applyMarkTarget(mult: number, duration: number) {
    this.markTargetMult = Math.max(this.markTargetMult, mult);
    this.markTargetTimer = Math.max(this.markTargetTimer, duration);
  }

  applyAntiHeal(duration: number) {
    this.antiHealTimer = Math.max(this.antiHealTimer, duration);
  }

  takeDamage(amount: number, armorPiercing: boolean = false) {
    if (this.shield > 0 && !armorPiercing) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return 0;
    let dmg = amount * (1 - this.resist);
    if (this.markTargetMult > 0) {
      dmg *= 1 + this.markTargetMult;
    }
    this.hp -= dmg;
    this.hitAnimTime = this._gameSeconds;
    if (this.hp <= 0) this.removed = true;
    return dmg;
  }

  update(dt: number, enemyManager: EnemyManagerRef | null) {
    if (this.removed || this.reachedBase) return;

    this._gameSeconds += dt;

    for (let i = this.slowStack.length - 1; i >= 0; i--) {
      const slowEntry = this.slowStack[i]!;
      slowEntry.remaining -= dt;
      if (slowEntry.remaining <= 0) {
        this.slowStack.splice(i, 1);
      }
    }
    if (this.slowStack.length === 0) this.slowFactor = 1;
    else this.recalcSlow();
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
    }
    if (this.burnTimer > 0 && !this.removed) {
      this.burnTimer -= dt;
      this.takeDamage(this.burnDps * dt, true);
    }
    if (this.removed) return;
    if (this.markTargetTimer > 0) {
      this.markTargetTimer -= dt;
      if (this.markTargetTimer <= 0) {
        this.markTargetTimer = 0;
        this.markTargetMult = 0;
      }
    }
    if (this.antiHealTimer > 0) {
      this.antiHealTimer -= dt;
      if (this.antiHealTimer <= 0) {
        this.antiHealTimer = 0;
      }
    }

    if (this.heal > 0 && this.antiHealTimer <= 0 && enemyManager) {
      const nearbyAllies = enemyManager.getEnemiesInRange(this.x, this.y, this.healRange);
      for (const ally of nearbyAllies) {
        if (ally === this) continue;
        ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * this.heal * dt);
      }
    }

    if (this.stunTimer > 0) {
      return;
    }
    if (!this.path || this.pathIdx >= this.path.length - 1) {
      this.reachedBase = true;
      return;
    }
    const target = this.grid.tileToWorld(this.path[this.pathIdx + 1]!.x, this.path[this.pathIdx + 1]!.y);
    const deltaX = target.x - this.x;
    const deltaY = target.y - this.y;
    const dist = Math.hypot(deltaX, deltaY);
    const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
    if (step >= dist) {
      this.x = target.x;
      this.y = target.y;
      this.pathIdx++;
      if (this.pathIdx < this.path.length) {
        const next = this.path[this.pathIdx]!;
        if (this.grid.blocked.has(`${next.x},${next.y}`)) {
          const newPath = this.grid.getPathFor(this.spawnIndex);
          if (newPath) {
            this.path = newPath;
            const baseTile = this.grid.getBase();
            const baseWorldPos = this.grid.tileToWorld(baseTile.x, baseTile.y);
            const currentDistSqToBase = (this.x - baseWorldPos.x) ** 2 + (this.y - baseWorldPos.y) ** 2;
            let minDist = Infinity;
            let nearestIdx = 0;
            let bestForwardIdx = -1;
            let bestForwardDist = Infinity;
            for (let i = 0; i < newPath.length; i++) {
              const worldPos = this.grid.tileToWorld(newPath[i]!.x, newPath[i]!.y);
              const distSq = (worldPos.x - this.x) ** 2 + (worldPos.y - this.y) ** 2;
              if (distSq < minDist) {
                minDist = distSq;
                nearestIdx = i;
              }
              const distSqToBase = (worldPos.x - baseWorldPos.x) ** 2 + (worldPos.y - baseWorldPos.y) ** 2;
              if (distSqToBase < currentDistSqToBase && distSq < bestForwardDist) {
                bestForwardDist = distSq;
                bestForwardIdx = i;
              }
            }
            this.pathIdx = bestForwardIdx >= 0 ? bestForwardIdx : nearestIdx;
          } else {
            this.onPathBlocked = true;
            this.removed = true;
          }
        }
      }
    } else {
      this.x += (deltaX / dist) * step;
      this.y += (deltaY / dist) * step;
      this.moveAngle = Math.atan2(deltaY, deltaX);
    }
    this.worldPos = { x: this.x, y: this.y };
  }
}
