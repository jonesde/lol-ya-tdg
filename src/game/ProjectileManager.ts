import type { Tower } from "@/towers/Tower.js";
import { PROJECTILE_HIT_THRESHOLD } from "./Constants.js";
import {
  ANTI_HEAL_DURATION,
  BOUNCE_DAMAGE_FALLOFF,
  BURN_CIRCUIT_DMG_MULT,
  BURN_CIRCUIT_DURATION,
  CHAIN_DAMAGE_FALLOFF,
  CHAIN_RANGE,
  MARK_TARGET_DURATION,
  MARKSMAN_CHANCE,
  NAPALM_BURN_DPS_RATIO,
  NAPALM_BURN_DURATION,
  RAILGUN_KNOCK_HP_DIVISOR,
  RAILGUN_KNOCK_SCALE,
  RAILGUN_KNOCKBACK_MULT,
  RAILGUN_KNOCKBASE,
  SPLASH_DAMAGE_RATIO,
  TOWER_BASE,
} from "./ConstantsTower.js";

export interface ProjectileGame {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  damage: number;
  speed: number;
  range: number;
  towerType: string;
  towerLevel: number;
  targetId: number;
  splashRadius: number;
  pierceCount: number;
  knockback: number;
  slowFactor: number;
  slowDuration: number;
  stunDuration: number;
  burnDps: number;
  burnDuration: number;
  critMultiplier: number;
  isCrit: boolean;
  marksman: boolean;
  active: boolean;
  age: number;
  hitCount: number;
  towerId: string;
  // Addon-driven effects
  critChance: number;
  goldOnCrit: number;
  bounceShot: boolean;
  bounceCount: number;
  splashStun: number;
  antiAir: boolean;
  trueShot: number;
  markTarget: number;
  antiHeal: boolean;
  burnCircuit: boolean;
}

interface LightningTarget {
  id: number;
  x: number;
  y: number;
  removed?: boolean;
  takeDamage(dmg: number): void;
  applyStun?(duration: number): void;
  applyBurn?(dps: number, duration: number): void;
}

interface GridRef {
  width: number;
  height: number;
  tileSize: number;
  tiles: { type: string; height: number }[][];
  blocked: Set<string>;
}

export interface EnemyManager {
  getEnemiesInRange(
    x: number,
    y: number,
    range: number,
  ): { id: number; hp: number; maxHp: number; x: number; y: number; takeDamage(dmg: number): void }[];
  getEnemyById(
    id: number,
  ): {
    id: number;
    type: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    removed: boolean;
    takeDamage(dmg: number): void;
  } | null;
  enemies: {
    id: number;
    type: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    removed: boolean;
    takeDamage(dmg: number): void;
  }[];
}

export interface ParticleSystem {
  spawn(x: number, y: number, color: string, count: number, opts: { speed: number; life: number }): void;
}

export type OnLightningFlashCallback = (startX: number, startY: number, endX: number, endY: number) => void;
export type OnStunEffectCallback = (x: number, y: number) => void;
export type OnGoldRewardCallback = (amount: number) => void;

export class ProjectileManager {
  private projectiles: ProjectileGame[];
  private enemyManager: EnemyManager;
  private particles: ParticleSystem | null;
  private grid: GridRef | null;
  private onLightningFlash: OnLightningFlashCallback | null;
  private onStunEffect: OnStunEffectCallback | null;
  private onGoldReward: OnGoldRewardCallback | null;
  private nextProjectileId: number;
  private towerLookup: ((towerId: string) => Tower | null) | null = null;

  constructor(
    enemyManager: EnemyManager,
    particles: ParticleSystem | null,
    onLightningFlash: OnLightningFlashCallback | null,
    towerLookup: ((towerId: string) => Tower | null) | null = null,
    grid: GridRef | null = null,
  ) {
    this.projectiles = [];
    this.enemyManager = enemyManager;
    this.particles = particles;
    this.grid = grid;
    this.onLightningFlash = onLightningFlash;
    this.onStunEffect = null;
    this.onGoldReward = null;
    this.nextProjectileId = 1;
    this.towerLookup = towerLookup;
  }

  setOnGoldReward(callback: OnGoldRewardCallback | null): void {
    this.onGoldReward = callback;
  }

  setTowerLookup(callback: ((towerId: string) => Tower | null) | null): void {
    this.towerLookup = callback;
  }

  setOnLightningFlash(callback: OnLightningFlashCallback | null): void {
    this.onLightningFlash = callback;
  }

  setOnStunEffect(callback: OnStunEffectCallback | null): void {
    this.onStunEffect = callback;
  }

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
    marksman?: boolean;
    knockback?: boolean;
    variant?: "A" | "B" | null;
    critChance?: number;
    goldOnCrit?: number;
    bounceShot?: boolean;
    splashStun?: number;
    antiAir?: boolean;
    trueShot?: number;
    markTarget?: number;
    antiHeal?: boolean;
  }): void {
    const projectile: ProjectileGame = {
      id: this.nextProjectileId++,
      x: opts.x,
      y: opts.y,
      radius: opts.towerType === "cannon" ? 5 : 3,
      color: "#ffcf4d",
      damage: opts.damage,
      speed: opts.speed,
      range: opts.range,
      towerType: opts.towerType,
      towerLevel: opts.towerLevel,
      targetId: opts.targetId,
      splashRadius: 0,
      pierceCount: 0,
      knockback: 0,
      slowFactor: opts.slowAmt ?? 0,
      slowDuration: opts.slowDur ?? 0,
      stunDuration: 0,
      burnDps: 0,
      burnDuration: 0,
      critMultiplier: 2,
      isCrit: false,
      marksman: false,
      active: true,
      age: 0,
      hitCount: 0,
      towerId: opts.towerId ?? "",
      critChance: opts.critChance ?? 0,
      goldOnCrit: opts.goldOnCrit ?? 0,
      bounceShot: opts.bounceShot ?? false,
      bounceCount: 0,
      splashStun: opts.splashStun ?? 0,
      antiAir: opts.antiAir ?? false,
      trueShot: opts.trueShot ?? 0,
      markTarget: opts.markTarget ?? 0,
      antiHeal: opts.antiHeal ?? false,
      burnCircuit: false,
    };

    // Roll crit only if tower has crit ability
    if (projectile.critChance > 0 && Math.random() < projectile.critChance) {
      projectile.isCrit = true;
    }

    this.applyProjectileEffects(
      projectile,
      opts.towerType,
      opts.towerLevel,
      opts.napalm ?? false,
      opts.marksman ?? false,
      opts.knockback ?? false,
      opts.variant,
    );

    this.projectiles.push(projectile);
  }

  private applyProjectileEffects(
    projectile: ProjectileGame,
    towerType: string,
    towerLevel: number,
    napalm: boolean,
    marksman: boolean,
    knockback: boolean,
    variant?: "A" | "B" | null,
  ): void {
    const tier = Math.max(0, towerLevel - 4);

    if (napalm) {
      projectile.burnDps = projectile.damage * NAPALM_BURN_DPS_RATIO;
      projectile.burnDuration = NAPALM_BURN_DURATION;
    }

    if (towerType === "cannon") {
      projectile.splashRadius = 2;
    }

    if (towerType === "railgun") {
      projectile.pierceCount = 1 + tier;
      projectile.knockback = RAILGUN_KNOCKBASE + RAILGUN_KNOCK_SCALE * tier;
      if (knockback) {
        projectile.knockback *= RAILGUN_KNOCKBACK_MULT;
      }
      projectile.stunDuration = 0.3;
    }

    if (marksman) {
      projectile.marksman = Math.random() < MARKSMAN_CHANCE;
    }

    if (towerType === "sniper" && towerLevel >= 5 && variant === "B") {
      projectile.pierceCount = 1;
      projectile.stunDuration = TOWER_BASE.sniper!.stun ?? 0;
    }
  }

  private clampKnockback(
    enemyX: number,
    enemyY: number,
    knockDx: number,
    knockDy: number,
    knockAmount: number,
  ): { x: number; y: number } {
    if (!this.grid) {
      return { x: enemyX + knockDx * knockAmount, y: enemyY + knockDy * knockAmount };
    }

    const grid = this.grid;
    const stepSize = 1;
    const steps = Math.ceil(knockAmount / stepSize);
    let clampedX = enemyX;
    let clampedY = enemyY;

    for (let step = 0; step < steps; step++) {
      const nextX = clampedX + knockDx * stepSize;
      const nextY = clampedY + knockDy * stepSize;

      const tileX = Math.floor(nextX / grid.tileSize);
      const tileY = Math.floor(nextY / grid.tileSize);

      if (tileX < 0 || tileY < 0 || tileX >= grid.width || tileY >= grid.height) {
        break;
      }

      const tile = grid.tiles[tileY]?.[tileX];
      if (!tile) break;

      if (tile.type === "terrain") {
        break;
      }

      if (tile.type === "path" && grid.blocked.has(`${tileX},${tileY}`)) {
        break;
      }

      clampedX = nextX;
      clampedY = nextY;
    }

    const remainder = knockAmount - Math.floor(knockAmount / stepSize) * stepSize;
    if (remainder > 0) {
      clampedX += knockDx * remainder;
      clampedY += knockDy * remainder;
    }

    return { x: clampedX, y: clampedY };
  }

  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile) continue;
      if (!projectile.active) {
        this.projectiles.splice(i, 1);
        continue;
      }
      projectile.age += dt;
      this.updateCircleProjectile(projectile, dt);
    }
  }

  private updateCircleProjectile(projectile: ProjectileGame, dt: number): void {
    const enemy = this.enemyManager.getEnemyById(projectile.targetId);
    if (!enemy || enemy.removed) {
      this.removeProjectile(projectile, "target-lost");
      return;
    }

    const dx = enemy.x - projectile.x;
    const dy = enemy.y - projectile.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < projectile.radius + PROJECTILE_HIT_THRESHOLD) {
      this.hitCircleProjectile(projectile, enemy);
      return;
    }

    const moveDist = projectile.speed * dt;
    if (dist > 0) {
      projectile.x += (dx / dist) * moveDist;
      projectile.y += (dy / dist) * moveDist;
    }
  }

  private hitCircleProjectile(
    projectile: ProjectileGame,
    enemy: {
      id: number;
      type: string;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      takeDamage(dmg: number, armorPiercing?: boolean): void;
      applyBurn?(dps: number, duration: number): void;
      applySlow?(factor: number, duration: number): void;
      applyStun?(duration: number): void;
      applyMarkTarget?(mult: number, duration: number): void;
      applyAntiHeal?(duration: number): void;
    },
  ): void {
    const finalDamage = projectile.isCrit ? projectile.damage * projectile.critMultiplier : projectile.damage;

    // True Shot: 20% chance to instant-kill non-boss enemies
    if (projectile.trueShot > 0 && enemy.type !== "boss" && Math.random() < projectile.trueShot) {
      const instantKillDamage = enemy.hp + 1;
      enemy.takeDamage(instantKillDamage);
      if (projectile.towerId) {
        const tower = this.towerLookup?.(projectile.towerId);
        if (tower) {
          tower.totalDamageDealt += instantKillDamage;
          tower.waveDamage += instantKillDamage;
        }
      }
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    if (projectile.marksman && enemy.type !== "boss") {
      const instantKillDamage = enemy.hp + 1;
      enemy.takeDamage(instantKillDamage);
      if (projectile.towerId) {
        const tower = this.towerLookup?.(projectile.towerId);
        if (tower) {
          tower.totalDamageDealt += instantKillDamage;
          tower.waveDamage += instantKillDamage;
        }
      }
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    // Mark Target: target takes +25% damage from all sources
    if (projectile.markTarget > 0 && enemy.applyMarkTarget) {
      enemy.applyMarkTarget(projectile.markTarget, MARK_TARGET_DURATION);
    }

    // Anti-Air: ignore shields
    enemy.takeDamage(finalDamage, projectile.antiAir);

    // Anti-Heal: disable enemy healer auras
    if (projectile.antiHeal && enemy.applyAntiHeal) {
      enemy.applyAntiHeal(ANTI_HEAL_DURATION);
    }

    if (projectile.towerId) {
      const tower = this.towerLookup?.(projectile.towerId);
      if (tower) {
        tower.totalDamageDealt += finalDamage;
        tower.waveDamage += finalDamage;
      }
    }

    // Gold Rush: grant gold on critical hit
    if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
      this.onGoldReward(projectile.goldOnCrit);
    }

    if (projectile.burnDps > 0 && enemy.applyBurn) {
      enemy.applyBurn(projectile.burnDps, projectile.burnDuration);
    }

    if (projectile.slowFactor > 0 && enemy.applySlow) {
      enemy.applySlow(projectile.slowFactor, projectile.slowDuration);
    }

    if (projectile.stunDuration > 0) {
      if (enemy.applyStun) {
        enemy.applyStun(projectile.stunDuration);
      }
      if (this.onStunEffect) {
        this.onStunEffect(enemy.x, enemy.y);
      }
    }

    if (projectile.knockback > 0) {
      const knockAmount = projectile.knockback * (enemy.maxHp / RAILGUN_KNOCK_HP_DIVISOR);
      const dx = enemy.x - projectile.x;
      const dy = enemy.y - projectile.y;
      const knockDist = Math.sqrt(dx * dx + dy * dy);
      if (knockDist > 0) {
        const knockDx = dx / knockDist;
        const knockDy = dy / knockDist;
        const clamped = this.clampKnockback(enemy.x, enemy.y, knockDx, knockDy, knockAmount);
        enemy.x = clamped.x;
        enemy.y = clamped.y;
      }
    }

    if (projectile.pierceCount > 0) {
      projectile.hitCount++;
      if (projectile.hitCount <= projectile.pierceCount) {
        const nextTarget = this.findNearestEnemy(projectile.x, projectile.y, projectile.range, enemy.id);
        if (nextTarget) {
          projectile.targetId = nextTarget.id;
          return;
        }
      }
    }

    if (projectile.splashRadius > 0 && this.particles) {
      const splashRadiusPx = projectile.splashRadius * (this.grid?.tileSize ?? 1);
      const splashEnemies = this.enemyManager.getEnemiesInRange(projectile.x, projectile.y, splashRadiusPx);
      for (const splashEnemy of splashEnemies) {
        if (splashEnemy.id !== enemy.id && (splashEnemy as { takeDamage?: unknown }).takeDamage) {
          const splashDamage = finalDamage * SPLASH_DAMAGE_RATIO;
          (splashEnemy as { takeDamage(dmg: number): void }).takeDamage(splashDamage);
          if (projectile.towerId) {
            const tower = this.towerLookup?.(projectile.towerId);
            if (tower) {
              tower.totalDamageDealt += splashDamage;
              tower.waveDamage += splashDamage;
            }
          }
          // Stun Shell: splash damage applies stun
          if (projectile.splashStun > 0) {
            const splashEnemyWithStun = splashEnemy as unknown as { applyStun?: (duration: number) => void };
            if (splashEnemyWithStun.applyStun) {
              splashEnemyWithStun.applyStun(projectile.splashStun);
            }
          }
        }
      }
    }

    // Bounce Shot: redirect projectile to 1 nearby enemy (max 1 bounce)
    if (projectile.bounceShot && projectile.bounceCount < 1) {
      const bounceTarget = this.findNearestEnemy(projectile.x, projectile.y, projectile.range, enemy.id);
      if (bounceTarget) {
        projectile.targetId = bounceTarget.id;
        projectile.damage *= BOUNCE_DAMAGE_FALLOFF;
        projectile.bounceCount++;
        return;
      }
    }

    if (this.particles) {
      this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
    }

    this.removeProjectile(projectile, "hit");
  }

  fireLightning(opts: {
    originX: number;
    originY: number;
    damage: number;
    towerLevel: number;
    targetId: number;
    stunDuration: number;
    towerId?: string;
    doubleDischarge?: number;
    antiAir?: boolean;
    burnCircuit?: boolean;
    critChance?: number;
    goldOnCrit?: number;
    range?: number;
  }): void {
    let current: LightningTarget | null = this.enemyManager.getEnemyById(opts.targetId);
    if (!current || current.removed) return;

    const tier = Math.max(0, opts.towerLevel - 4);
    let remainingChains = 2 + tier;
    const critChance = opts.critChance ?? 0;
    const isCrit = critChance > 0 && Math.random() < critChance;
    const finalDamage = isCrit ? opts.damage * 2 : opts.damage;

    // Lightning strikes instantly: the initial target takes full damage, each
    // chained target takes reduced damage, and all enemies in the chain are
    // stunned. The tower->final-target flash fires once at the end.
    const chainTargets: LightningTarget[] = [];

    current.takeDamage(finalDamage);
    if (opts.towerId) {
      const tower = this.towerLookup?.(opts.towerId);
      if (tower) {
        tower.totalDamageDealt += finalDamage;
        tower.waveDamage += finalDamage;
      }
    }
    // Gold Rush: grant gold on critical hit
    if (isCrit && (opts.goldOnCrit ?? 0) > 0 && this.onGoldReward) {
      this.onGoldReward(opts.goldOnCrit ?? 0);
    }
    chainTargets.push(current);
    if (this.particles) {
      this.particles.spawn(current.x, current.y, "#ffcf4d", 3, { speed: 30, life: 0.2 });
    }

    let chainsUsed = 0;
    while (remainingChains > 0) {
      const chainRangePx = CHAIN_RANGE * (this.grid?.tileSize ?? 1);
      const nextTarget = this.findNearestEnemy(current.x, current.y, chainRangePx, current.id);
      if (!nextTarget) break;

      const chainDamage = finalDamage * CHAIN_DAMAGE_FALLOFF ** (chainsUsed + 1);
      nextTarget.takeDamage(chainDamage);
      if (opts.towerId) {
        const tower = this.towerLookup?.(opts.towerId);
        if (tower) {
          tower.totalDamageDealt += chainDamage;
          tower.waveDamage += chainDamage;
        }
      }
      chainTargets.push(nextTarget);
      if (this.particles) {
        this.particles.spawn(nextTarget.x, nextTarget.y, "#ffcf4d", 3, { speed: 30, life: 0.2 });
      }
      // Burn Circuit: chained enemies take burn damage over time
      if (opts.burnCircuit && nextTarget.applyBurn) {
        nextTarget.applyBurn(chainDamage * BURN_CIRCUIT_DMG_MULT, BURN_CIRCUIT_DURATION);
      }
      if (this.onLightningFlash) {
        this.onLightningFlash(current.x, current.y, nextTarget.x, nextTarget.y);
      }
      chainsUsed++;
      remainingChains--;
      current = nextTarget;
    }

    if (opts.stunDuration > 0) {
      for (const target of chainTargets) {
        if (target.applyStun) target.applyStun(opts.stunDuration);
        if (this.onStunEffect) this.onStunEffect(target.x, target.y);
      }
      if (this.onLightningFlash) {
        this.onLightningFlash(opts.originX, opts.originY, current.x, current.y);
      }
    }

    // Double Discharge: 10% chance to fire a second bolt to a different target
    if (opts.doubleDischarge && opts.doubleDischarge > 0 && Math.random() < opts.doubleDischarge) {
      const secondTarget = this.findNearestEnemy(
        opts.originX,
        opts.originY,
        (opts.range ?? CHAIN_RANGE) * (this.grid?.tileSize ?? 1),
        opts.targetId,
      );
      if (secondTarget) {
        const secondDamage = finalDamage * 0.5;
        secondTarget.takeDamage(secondDamage);
        if (opts.towerId) {
          const tower = this.towerLookup?.(opts.towerId);
          if (tower) {
            tower.totalDamageDealt += secondDamage;
            tower.waveDamage += secondDamage;
          }
        }
        if (opts.stunDuration > 0 && secondTarget.applyStun) {
          secondTarget.applyStun(opts.stunDuration);
        }
        if (this.onLightningFlash) {
          this.onLightningFlash(opts.originX, opts.originY, secondTarget.x, secondTarget.y);
        }
      }
    }
  }

  private findNearestEnemy(x: number, y: number, range: number, excludeId: number): LightningTarget | null {
    const enemies = this.enemyManager.getEnemiesInRange(x, y, range);
    let closest: LightningTarget | null = null;
    let closestDist = Infinity;

    for (const enemy of enemies) {
      if (enemy.id === excludeId) continue;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = enemy;
      }
    }

    return closest;
  }

  private removeProjectile(projectile: ProjectileGame, _reason: string): void {
    projectile.active = false;
  }

  getRenderData(): Array<{ id: number; x: number; y: number; radius: number; color: string }> {
    const result: Array<{ id: number; x: number; y: number; radius: number; color: string }> = [];
    for (const p of this.projectiles) {
      if (p.active) {
        result.push({ id: p.id, x: p.x, y: p.y, radius: p.radius, color: p.color });
      }
    }
    return result;
  }

  clear(): void {
    this.projectiles = [];
  }
}
