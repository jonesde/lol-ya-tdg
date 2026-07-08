import { GRID_TILE_SIZE } from "@/render/svg/types.js";
import type { Tower } from "@/towers/Tower.js";
import { MAX_PROJECTILE_AGE, PROJECTILE_HIT_THRESHOLD } from "./Constants.js";
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
  targetX: number;
  targetY: number;
  splashRadius: number;
  maxHitCount: number;
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
  // Fixed-aim tracking
  hitEnemyIds?: Set<number>;
  fixedAimHits?: number;
  fixedAim: boolean;
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
  ): {
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
  }[];
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

export type OnStunEffectCallback = (x: number, y: number, duration: number) => void;
export type OnGoldRewardCallback = (amount: number) => void;

export interface LightningVisualEffect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StunVisualEffect {
  x: number;
  y: number;
}

export class ProjectileManager {
  private projectiles: ProjectileGame[];
  private enemyManager: EnemyManager;
  private particles: ParticleSystem | null;
  private grid: GridRef | null;
  private onStunEffect: OnStunEffectCallback | null;
  private onGoldReward: OnGoldRewardCallback | null;
  private nextProjectileId: number;
  private towerLookup: ((towerId: string) => Tower | null) | null = null;
  private pendingLightning: LightningVisualEffect[];
  private pendingStuns: StunVisualEffect[];

  constructor(
    enemyManager: EnemyManager,
    particles: ParticleSystem | null,
    towerLookup: ((towerId: string) => Tower | null) | null = null,
    grid: GridRef | null = null,
  ) {
    this.projectiles = [];
    this.enemyManager = enemyManager;
    this.particles = particles;
    this.grid = grid;
    this.onStunEffect = null;
    this.onGoldReward = null;
    this.nextProjectileId = 1;
    this.towerLookup = towerLookup;
    this.pendingLightning = [];
    this.pendingStuns = [];
  }

  setOnGoldReward(callback: OnGoldRewardCallback | null): void {
    this.onGoldReward = callback;
  }

  setTowerLookup(callback: ((towerId: string) => Tower | null) | null): void {
    this.towerLookup = callback;
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
    targetX?: number;
    targetY?: number;
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
    pierce?: number;
    stunDur?: number;
    splash?: number;
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
      targetX: opts.targetX ?? 0,
      targetY: opts.targetY ?? 0,
      splashRadius: 0,
      maxHitCount: 0,
      knockback: 0,
      slowFactor: opts.slowAmt ?? 0,
      slowDuration: opts.slowDur ?? 0,
      stunDuration: opts.stunDur ?? 0,
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
      fixedAim: opts.targetId === 0,
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
      opts.pierce,
      opts.splash,
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
    pierce?: number,
    splash?: number,
  ): void {
    const tier = Math.max(0, towerLevel - 4);

    if (napalm) {
      projectile.burnDps = projectile.damage * NAPALM_BURN_DPS_RATIO;
      projectile.burnDuration = NAPALM_BURN_DURATION;
    }

    // Base splash radius: cannon has an inherent radius; other towers use the
    // computed stats.splash (variant + Wide Blast addon). Take the max so a
    // cannon's base radius is never lost.
    const baseSplash = towerType === "cannon" ? 2 : 0;
    projectile.splashRadius = Math.max(baseSplash, splash ?? 0);

    if (towerType === "railgun") {
      projectile.maxHitCount = 1 + tier + (pierce ?? 0);
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
      projectile.maxHitCount = (pierce ?? 0) - 1;
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
    const steps = Math.floor(knockAmount / stepSize);
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
      if (projectile.age > MAX_PROJECTILE_AGE) {
        this.removeProjectile(projectile, "expired");
        this.projectiles.splice(i, 1);
        continue;
      }
      this.updateCircleProjectile(projectile, dt);
    }
  }

  private updateCircleProjectile(projectile: ProjectileGame, dt: number): void {
    // Fixed-aim: targetId === 0, travel straight toward aimed world position
    if (projectile.targetId === 0) {
      const hitThreshold = projectile.radius + PROJECTILE_HIT_THRESHOLD;
      const hitEnemyIds = projectile.hitEnemyIds;
      if (hitEnemyIds === undefined) {
        projectile.hitEnemyIds = new Set<number>();
      }
      const hitSet = projectile.hitEnemyIds as Set<number>;
      let fixedAimHits: number = projectile.fixedAimHits ?? 0;
      if (projectile.fixedAimHits === undefined) {
        projectile.fixedAimHits = 0;
      }

      const targetDx = projectile.targetX - projectile.x;
      const targetDy = projectile.targetY - projectile.y;
      const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
      const moveAmount = projectile.speed * dt;

      // Scan for enemies at current position before moving
      const scanNearby = (): boolean => {
        const nearbyEnemies = this.enemyManager.getEnemiesInRange(projectile.x, projectile.y, hitThreshold);
        for (const nearbyEnemy of nearbyEnemies) {
          if (!hitSet.has(nearbyEnemy.id)) {
            this.hitCircleProjectile(projectile, nearbyEnemy);
            hitSet.add(nearbyEnemy.id);
            fixedAimHits++;
            projectile.fixedAimHits = fixedAimHits;
            // If pierce removed projectile, restore it to continue toward aim point
            if (!projectile.active && fixedAimHits <= projectile.maxHitCount) {
              projectile.active = true;
              projectile.targetId = 0;
            }
            return true;
          }
        }
        return false;
      };

      scanNearby();
      if (!projectile.active) return;

      // Move toward target position
      if (targetDist > 0) {
        const moveDist = Math.min(moveAmount, targetDist);
        projectile.x += (targetDx / targetDist) * moveDist;
        projectile.y += (targetDy / targetDist) * moveDist;
      }

      // Scan for enemies at new position after moving
      scanNearby();
      if (!projectile.active) return;

      // Check if reached aim point (after hit scan so enemies AT aim point are hit)
      const finalDx = projectile.targetX - projectile.x;
      const finalDy = projectile.targetY - projectile.y;
      const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
      if (finalDist <= hitThreshold) {
        this.removeProjectile(projectile, "reached-target");
      }
      return;
    }

    const enemy = this.enemyManager.getEnemyById(projectile.targetId);
    if (!enemy || enemy.removed) {
      this.removeProjectile(projectile, "target-lost");
      return;
    }

    const dx = enemy.x - projectile.x;
    const dy = enemy.y - projectile.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const maxRange = projectile.range * (this.grid?.tileSize ?? GRID_TILE_SIZE);
    if (dist > maxRange) {
      this.removeProjectile(projectile, "out-of-range");
      return;
    }

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
      enemy.takeDamage(instantKillDamage, true);
      if (projectile.towerId) {
        const tower = this.towerLookup?.(projectile.towerId);
        if (tower) {
          tower.totalDamageDealt += instantKillDamage;
          tower.waveDamage += instantKillDamage;
          tower.clearStatsCache();
        }
      }
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
        this.onGoldReward(projectile.goldOnCrit);
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    if (projectile.marksman && enemy.type !== "boss") {
      const instantKillDamage = enemy.hp + 1;
      enemy.takeDamage(instantKillDamage, true);
      if (projectile.towerId) {
        const tower = this.towerLookup?.(projectile.towerId);
        if (tower) {
          tower.totalDamageDealt += instantKillDamage;
          tower.waveDamage += instantKillDamage;
          tower.clearStatsCache();
        }
      }
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
        this.onGoldReward(projectile.goldOnCrit);
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

    this.recordDamage(projectile.towerId, finalDamage);

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
        this.onStunEffect(enemy.x, enemy.y, projectile.stunDuration);
      }
    }

    if (projectile.knockback > 0) {
      const knockAmount =
        projectile.knockback *
        (this.grid?.tileSize ?? GRID_TILE_SIZE) *
        Math.max(0.1, Math.min(2, RAILGUN_KNOCK_HP_DIVISOR / enemy.maxHp));
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

    if (projectile.maxHitCount > 0) {
      projectile.hitCount++;
      if (projectile.hitCount <= projectile.maxHitCount) {
        // Fixed-aim projectiles travel toward a fixed world point, so they must
        // not re-home onto an enemy — continue straight and hit whatever lies
        // along the aim line (handled by the targetId === 0 branch next frame).
        if (!projectile.fixedAim) {
          const nextTarget = this.findNearestEnemy(
            projectile.x,
            projectile.y,
            projectile.range * (this.grid?.tileSize ?? 36),
            enemy.id,
          );
          if (nextTarget) {
            projectile.targetId = nextTarget.id;
            return;
          }
        }
      }
    }

    if (projectile.splashRadius > 0 && this.particles) {
      const splashRadiusPx = projectile.splashRadius * (this.grid?.tileSize ?? 1);
      const splashEnemies = this.enemyManager.getEnemiesInRange(enemy.x, enemy.y, splashRadiusPx);
      for (const splashEnemy of splashEnemies) {
        if (splashEnemy.id !== enemy.id && (splashEnemy as { takeDamage?: unknown }).takeDamage) {
          const splashDamage = finalDamage * SPLASH_DAMAGE_RATIO;
          // Anti-Air: secondary splash targets must bypass shields just like the primary.
          (splashEnemy as { takeDamage(dmg: number, armorPiercing?: boolean): void }).takeDamage(
            splashDamage,
            projectile.antiAir,
          );
          this.recordDamage(projectile.towerId, splashDamage);
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

    // Bounce Shot: redirect projectile to 1 nearby enemy (max 1 bounce).
    // Fixed-aim projectiles keep their aim point instead of re-homing.
    if (projectile.bounceShot && projectile.bounceCount < 1 && !projectile.fixedAim) {
      const bounceTarget = this.findNearestEnemy(
        projectile.x,
        projectile.y,
        projectile.range * (this.grid?.tileSize ?? 36),
        enemy.id,
      );
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
    chain?: number;
    stormcall?: boolean;
  }): void {
    let current: LightningTarget | null = this.enemyManager.getEnemyById(opts.targetId);
    if (!current || current.removed) return;

    const tier = Math.max(0, opts.towerLevel - 4);
    let remainingChains = opts.chain ?? 2 + tier;
    const critChance = opts.critChance ?? 0;
    const isCrit = critChance > 0 && Math.random() < critChance;
    const finalDamage = isCrit ? opts.damage * 2 : opts.damage;

    // Lightning strikes instantly: the initial target takes full damage, each
    // chained target takes reduced damage, and all enemies in the chain are
    // stunned. The tower->final-target flash fires once at the end.
    const chainTargets: LightningTarget[] = [];

    current.takeDamage(finalDamage);
    this.recordDamage(opts.towerId, finalDamage);
    // Gold Rush: grant gold on critical hit
    if (isCrit && (opts.goldOnCrit ?? 0) > 0 && this.onGoldReward) {
      this.onGoldReward(opts.goldOnCrit ?? 0);
    }
    chainTargets.push(current);
    if (this.particles) {
      this.particles.spawn(current.x, current.y, "#ffcf4d", 3, { speed: 30, life: 0.2 });
    }

    const chainedIds = new Set<number>([current.id]);
    let chainsUsed = 0;
    while (remainingChains > 0) {
      const chainRangePx = CHAIN_RANGE * (this.grid?.tileSize ?? 1);
      const nextTarget = this.findNearestEnemy(current.x, current.y, chainRangePx, undefined, chainedIds);
      if (!nextTarget) break;

      const chainDamage = finalDamage * CHAIN_DAMAGE_FALLOFF ** (chainsUsed + 1);
      nextTarget.takeDamage(chainDamage);
      this.recordDamage(opts.towerId, chainDamage);
      chainTargets.push(nextTarget);
      chainedIds.add(nextTarget.id);
      if (this.particles) {
        this.particles.spawn(nextTarget.x, nextTarget.y, "#ffcf4d", 3, { speed: 30, life: 0.2 });
      }
      // Burn Circuit: chained enemies take burn damage over time
      if (opts.burnCircuit && nextTarget.applyBurn) {
        nextTarget.applyBurn(chainDamage * BURN_CIRCUIT_DMG_MULT, BURN_CIRCUIT_DURATION);
      }
      this.pendingLightning.push({ x1: current.x, y1: current.y, x2: nextTarget.x, y2: nextTarget.y });
      chainsUsed++;
      remainingChains--;
      current = nextTarget;
    }

    // Stormcall (lightning B variant): strike random enemies in a wide area in
    // addition to the normal chain. Each random strike deals reduced damage, is
    // added to chainTargets so it also gets stunned, and fires a lightning flash.
    if (opts.stormcall) {
      const wideRangePx = CHAIN_RANGE * 3 * (this.grid?.tileSize ?? 1);
      const stormcallCount = 1 + tier;
      const stormcallChainedIds = new Set(chainTargets.map((target) => target.id));
      const wideEnemies = this.enemyManager
        .getEnemiesInRange(opts.originX, opts.originY, wideRangePx)
        .filter((enemy) => !stormcallChainedIds.has(enemy.id));
      for (let strike = 0; strike < stormcallCount && wideEnemies.length > 0; strike++) {
        const pickIndex = Math.floor(Math.random() * wideEnemies.length);
        const stormTarget = wideEnemies.splice(pickIndex, 1)[0]!;
        const stormDamage = finalDamage * CHAIN_DAMAGE_FALLOFF;
        stormTarget.takeDamage(stormDamage);
        this.recordDamage(opts.towerId, stormDamage);
        chainTargets.push(stormTarget);
        if (this.particles) {
          this.particles.spawn(stormTarget.x, stormTarget.y, "#ffcf4d", 3, { speed: 30, life: 0.2 });
        }
        this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: stormTarget.x, y2: stormTarget.y });
      }
    }

    if (opts.stunDuration > 0) {
      for (const target of chainTargets) {
        if (target.applyStun) target.applyStun(opts.stunDuration);
        this.pendingStuns.push({ x: target.x, y: target.y });
      }
      this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: current.x, y2: current.y });
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
        const secondIsCrit = critChance > 0 && Math.random() < critChance;
        const secondDamage = finalDamage * 0.5 * (secondIsCrit ? 2 : 1);
        secondTarget.takeDamage(secondDamage);
        this.recordDamage(opts.towerId, secondDamage);
        // Gold Rush: grant gold on critical hit for second bolt
        if (secondIsCrit && (opts.goldOnCrit ?? 0) > 0 && this.onGoldReward) {
          this.onGoldReward(opts.goldOnCrit ?? 0);
        }
        if (opts.stunDuration > 0 && secondTarget.applyStun) {
          secondTarget.applyStun(opts.stunDuration);
        }
        this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: secondTarget.x, y2: secondTarget.y });
      }
    }
  }

  private recordDamage(towerId: string | undefined, amount: number): void {
    if (!towerId) return;
    const tower = this.towerLookup?.(towerId);
    if (tower) {
      tower.totalDamageDealt += amount;
      tower.waveDamage += amount;
      tower.clearStatsCache();
    }
  }

  private findNearestEnemy(
    x: number,
    y: number,
    range: number,
    excludeId?: number,
    excludeIds?: Set<number>,
  ): LightningTarget | null {
    const fullRangeEnemies = this.enemyManager.getEnemiesInRange(x, y, range);

    if (fullRangeEnemies.length <= 8) {
      let closest: LightningTarget | null = null;
      let closestDist = Infinity;
      for (const enemy of fullRangeEnemies) {
        if (enemy.id === excludeId) continue;
        if (excludeIds?.has(enemy.id)) continue;
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

    const tileSize = GRID_TILE_SIZE;
    const halfTileRange = 0.5 * tileSize;
    const quarterRange = 0.25 * range;
    const halfRange = 0.5 * range;

    const subRanges = [halfTileRange, quarterRange, halfRange];
    for (const subRange of subRanges) {
      const subEnemies = this.enemyManager.getEnemiesInRange(x, y, subRange);
      let closest: LightningTarget | null = null;
      let closestDist = Infinity;
      for (const enemy of subEnemies) {
        if (enemy.id === excludeId) continue;
        if (excludeIds?.has(enemy.id)) continue;
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closest = enemy;
        }
      }
      if (closest) return closest;
    }

    let fallback: LightningTarget | null = null;
    let fallbackDist = Infinity;
    for (const enemy of fullRangeEnemies) {
      if (enemy.id === excludeId) continue;
      if (excludeIds?.has(enemy.id)) continue;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < fallbackDist) {
        fallbackDist = dist;
        fallback = enemy;
      }
    }
    return fallback;
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

  getRenderVisualEffects(): { lightning: LightningVisualEffect[]; stuns: StunVisualEffect[] } {
    return { lightning: [...this.pendingLightning], stuns: [...this.pendingStuns] };
  }

  consumeRenderVisualEffects(): { lightning: LightningVisualEffect[]; stuns: StunVisualEffect[] } {
    const effects = { lightning: [...this.pendingLightning], stuns: [...this.pendingStuns] };
    this.clearVisualEffects();
    return effects;
  }

  private clearVisualEffects(): void {
    this.pendingLightning = [];
    this.pendingStuns = [];
  }

  clear(): void {
    this.projectiles = [];
    this.pendingLightning = [];
    this.pendingStuns = [];
  }
}
