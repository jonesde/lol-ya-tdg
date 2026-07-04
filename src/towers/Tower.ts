import {
  MILESTONE_BONUS_PCT,
  MILESTONE_THRESHOLD,
  TERRAIN_HEIGHT_BONUS_PCT,
  TERRAIN_HEIGHT_RANGE_BONUS,
} from "../game/Constants.js";
import {
  CANCEL_BUILD_WINDOW_MS,
  ICE_AURA_DURATION,
  ICE_AURA_RANGE,
  ICE_AURA_SLOW_MULT,
  SELL_VALUE_RATIO,
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_META,
  TOWER_VARIANTS,
  type TowerId,
  type TowerMeta,
  UPGRADE_COST_BASE,
} from "../game/ConstantsTower.js";
import type { MapThemeAnimation, MapThemeData, MapThemeTowerVisual } from "../render/themes/index.js";
import { useMapThemeStore } from "../stores/mapTheme.js";
import { getGeneralAddonValue, maxLevelFor } from "./SkillTree.js";

interface SaveData {
  gems: number;
  unlocked: Record<string, { addons: boolean[]; variantA: boolean[]; variantB: boolean[]; levels: boolean[] }>;
  generalAddons?: Record<string, unknown>;
}

interface GridRef {
  tileSize: number;
  tiles?: { type: string; height: number }[][];
}

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

interface ParticleManagerRef {
  emit(x: number, y: number, color: string): void;
}

interface SoundManagerRef {
  play(name: string): void;
}

interface TowerStats {
  range: number;
  damage: number;
  fireRate: number;
  splash: number;
  chain: number;
  stun: number;
  pierce: number;
  pierceFalloff: number;
  slowAmt: number;
  slowDur: number;
  marksman: boolean;
  napalm: boolean;
  stormcall: boolean;
  knockback: boolean;
}

interface CanUpgradeResult {
  ok: boolean;
  cost?: number;
  nextLevel?: number;
  reason?: string;
  needVariant?: boolean;
}

export class Tower {
  type: string;
  id: string;
  tileX: number;
  tileY: number;
  grid: GridRef;
  x: number;
  y: number;
  worldPos: { x: number; y: number };
  meta: TowerMeta;
  base: {
    range: number;
    damage: number;
    fireRate: number;
    splash?: number;
    chain?: number;
    stun?: number;
    pierce?: number;
    pierceFalloff?: number;
    slowAmt?: number;
    slowDur?: number;
    projSpeed?: number;
    fixedAim?: boolean;
  };
  color: string;
  icon: string;
  name: string;
  animation: MapThemeAnimation | null;
  visualMeta: MapThemeTowerVisual | null;
  theme: MapThemeData | null;
  level: number;
  totalInvested: number;
  totalDamageDealt: number;
  waveDamage: number;
  targeting: string;
  cooldown: number;
  angle: number;
  fireAnimTime: number;
  variant: "A" | "B" | null;
  fixedAimDir: "N" | "E" | "S" | "W" | null;
  placedAt: number;
  addons: number[];
  save: SaveData | undefined;
  _statsCache: TowerStats | null;
  _statsCacheKey: number;
  terrainHeight: number;

  constructor(
    type: string,
    tileX: number,
    tileY: number,
    save: SaveData | undefined,
    grid: GridRef,
    theme: MapThemeData | null = null,
    placedAt: number = Date.now(),
  ) {
    this.type = type;
    this.id = "";
    this.tileX = tileX;
    this.tileY = tileY;
    this.grid = grid;
    this.x = tileX * (grid?.tileSize || 36) + (grid?.tileSize || 36) / 2;
    this.y = tileY * (grid?.tileSize || 36) + (grid?.tileSize || 36) / 2;
    this.worldPos = { x: this.x, y: this.y };
    const towerId = type as TowerId;
    this.meta = TOWER_META[towerId]!;
    this.base = TOWER_BASE[towerId]!;
    this.theme = theme;
    const towerVisual = (theme?.towers[type] ?? null) as MapThemeTowerVisual | null;
    const themeStore = useMapThemeStore();
    const defaultTower = themeStore.getDefaultTowerVisual(towerId);
    this.color = towerVisual?.color || defaultTower?.color || "#8fbc8f";
    this.icon = towerVisual?.icon || defaultTower?.icon || "\u2500";
    this.name = towerVisual?.name || defaultTower?.name || type;
    this.animation = towerVisual?.animation || null;
    this.visualMeta = towerVisual;

    this.level = 1;
    this.totalInvested = this.meta.cost;
    this.totalDamageDealt = 0;
    this.waveDamage = 0;
    this.targeting = type === "sniper" ? "strong" : "first";
    this.cooldown = 0;
    this.angle = -Math.PI / 4;
    this.fireAnimTime = 0;
    this.variant = null;
    this.fixedAimDir = null;
    this.placedAt = placedAt;
    this.addons = save?.unlocked[type]
      ? save.unlocked[type].addons.map((unlocked, i) => (unlocked ? i : null)).filter((x) => x !== null)
      : [];
    this.save = save;
    this._statsCache = null;
    this._statsCacheKey = -1;
    if (grid?.tiles?.[tileY]?.[tileX]) {
      this.terrainHeight = grid.tiles[tileY][tileX].height || 1;
    } else {
      this.terrainHeight = 1;
    }
  }

  get stats(): TowerStats {
    if (!this.save) {
      return this._computeStats();
    }
    const key = this._computeCacheKey();
    if (this._statsCache && this._statsCacheKey === key) {
      return this._statsCache;
    }

    const stats = this._computeStats();
    this._statsCache = stats;
    this._statsCacheKey = key;
    return stats;
  }

  _computeCacheKey(): number {
    const heightTier = getGeneralAddonValue(this.save!, "terrainHeightBonus");
    const rangeTier = getGeneralAddonValue(this.save!, "terrainHeightRangeBonus");
    const milestoneTier = getGeneralAddonValue(this.save!, "damageMilestoneBonus");
    const milestoneLevels =
      milestoneTier !== null && milestoneTier !== undefined
        ? Math.floor(this.totalDamageDealt / MILESTONE_THRESHOLD)
        : -1;
    const h = typeof heightTier === "number" ? heightTier : -1;
    const r = typeof rangeTier === "number" ? rangeTier : -1;
    const m = typeof milestoneTier === "number" ? milestoneTier : -1;
    return h | (r << 8) | (m << 16) | ((milestoneLevels & 0xffff) << 24);
  }

  _computeStats(): TowerStats {
    const level = this.level;
    const dmgMult = TOWER_LEVEL_DMG_MULT ** (level - 1);
    const rateMult = TOWER_LEVEL_RATE_MULT ** (level - 1);
    let range = this.base.range * TOWER_LEVEL_RANGE_MULT ** (level - 1);
    let damage = this.base.damage * dmgMult;
    let fireRate = this.base.fireRate * rateMult;
    let splash = this.base.splash || 0;
    let chain = this.base.chain || 0;
    let stun = this.base.stun || 0;
    let pierce = this.base.pierce || 0;
    let pierceFalloff = this.base.pierceFalloff || 0;
    let slowAmt = this.base.slowAmt || 0;
    let slowDur = this.base.slowDur || 0;
    let marksman = false;
    let napalm = false;
    let stormcall = false;
    let knockback = false;

    if (this.level >= 5 && this.variant === "A") {
      const variantA = TOWER_VARIANTS[this.type as TowerId]?.A;
      if (variantA) {
        const result = variantA.apply(
          {
            range,
            damage,
            fireRate,
            splash,
            chain,
            stun,
            pierce,
            pierceFalloff,
            slowAmt,
            slowDur,
            marksman,
            napalm,
            stormcall,
            knockback,
          },
          level - 5,
        ) as unknown as TowerStats;
        ({
          range,
          damage,
          fireRate,
          splash,
          chain,
          stun,
          pierce,
          pierceFalloff,
          slowAmt,
          slowDur,
          marksman,
          napalm,
          stormcall,
          knockback,
        } = result);
      }
    }
    if (this.level >= 5 && this.variant === "B") {
      const variantB = TOWER_VARIANTS[this.type as TowerId]?.B;
      if (variantB) {
        const result = variantB.apply(
          {
            range,
            damage,
            fireRate,
            splash,
            chain,
            stun,
            pierce,
            pierceFalloff,
            slowAmt,
            slowDur,
            marksman,
            napalm,
            stormcall,
            knockback,
          },
          level - 5,
        ) as unknown as TowerStats;
        ({
          range,
          damage,
          fireRate,
          splash,
          chain,
          stun,
          pierce,
          pierceFalloff,
          slowAmt,
          slowDur,
          marksman,
          napalm,
          stormcall,
          knockback,
        } = result);
      }
    }

    if (this.addons.includes(2) && this.type === "sniper") range += 2;
    if (this.addons.includes(2) && this.type === "basic") chain = Math.max(chain, 1);
    if (this.addons.includes(0) && this.type === "cannon") splash *= 1.5;
    if (this.addons.includes(0) && this.type === "lightning") chain += 1;
    if (this.addons.includes(2) && this.type === "lightning") damage *= 1.2;

    const heightTier = this.save ? getGeneralAddonValue(this.save, "terrainHeightBonus") : null;
    if (heightTier !== null && heightTier !== undefined) {
      const bonusPct = TERRAIN_HEIGHT_BONUS_PCT[heightTier as number] || 0;
      const heightBonus = 1 + bonusPct * this.terrainHeight;
      damage *= heightBonus;
    }

    const rangeTier = this.save ? getGeneralAddonValue(this.save, "terrainHeightRangeBonus") : null;
    if (rangeTier !== null && rangeTier !== undefined) {
      const bonusPerHeight = TERRAIN_HEIGHT_RANGE_BONUS[rangeTier as number] || 0;
      range += bonusPerHeight * this.terrainHeight;
    }

    const milestoneTier = this.save ? getGeneralAddonValue(this.save, "damageMilestoneBonus") : null;
    if (milestoneTier !== null && milestoneTier !== undefined) {
      const tiers = Math.floor(this.totalDamageDealt / MILESTONE_THRESHOLD);
      const [dmgPct, speedPct] = MILESTONE_BONUS_PCT[milestoneTier as number] || [0, 0];
      damage *= 1 + dmgPct * tiers;
      fireRate *= 1 + speedPct * tiers;
    }

    return {
      range,
      damage,
      fireRate,
      splash,
      chain,
      stun,
      pierce,
      pierceFalloff,
      slowAmt,
      slowDur,
      marksman,
      napalm,
      stormcall,
      knockback,
    };
  }

  currentMilestoneBonus() {
    if (!this.save) return { damagePct: 0, speedPct: 0, tiers: 0 };
    const tier = getGeneralAddonValue(this.save, "damageMilestoneBonus");
    if (tier === null || tier === undefined) return { damagePct: 0, speedPct: 0, tiers: 0 };
    const tiers = Math.floor(this.totalDamageDealt / MILESTONE_THRESHOLD);
    const [dmgPct, speedPct] = MILESTONE_BONUS_PCT[tier as number] || [0, 0];
    return { damagePct: dmgPct * tiers * 100, speedPct: speedPct * tiers * 100, tiers };
  }

  upgradeCost(nextLevel: number): number {
    return Math.round(this.meta.cost * UPGRADE_COST_BASE ** (nextLevel - 2));
  }

  canUpgrade(save: SaveData | undefined): CanUpgradeResult {
    const cost = this.upgradeCost(this.level + 1);
    if (this.level === 4 && this.variant === null) {
      return { ok: false, reason: "Choose specialization", needVariant: true };
    }
    if (!save) return { ok: true, cost, nextLevel: this.level + 1 };
    const maxLvl = maxLevelFor(save, this.type, this.variant);
    if (this.level >= maxLvl) return { ok: false, reason: "Max level reached" };
    return { ok: true, cost, nextLevel: this.level + 1 };
  }

  specialize(variant: "A" | "B", save: SaveData, actualCost?: number): boolean {
    if (this.level !== 4) return false;
    const unlocked = save.unlocked[this.type];
    if (!unlocked) return false;
    const arr =
      variant === "A"
        ? (unlocked as { variantA: boolean[]; variantB: boolean[] }).variantA
        : (unlocked as { variantA: boolean[]; variantB: boolean[] }).variantB;
    if (!arr[0]) return false;
    this.variant = variant;
    this.level = 5;
    this.totalInvested += actualCost ?? this.upgradeCost(5);
    this._statsCache = null;
    return true;
  }

  doUpgrade(save: SaveData, actualCost?: number): CanUpgradeResult {
    const check = this.canUpgrade(save);
    if (!check.ok) return check;
    this.level++;
    this.totalInvested += actualCost ?? check.cost ?? 0;
    this._statsCache = null;
    return { ok: true };
  }

  sellValue(): number {
    return Math.round(this.totalInvested * SELL_VALUE_RATIO);
  }

  canCancel(): boolean {
    return Date.now() - this.placedAt < CANCEL_BUILD_WINDOW_MS && this.level === 1;
  }

  cancelRemainingMs(): number {
    return Math.max(0, CANCEL_BUILD_WINDOW_MS - (Date.now() - this.placedAt));
  }

  selectTarget(
    enemies: { x: number; y: number; pathIdx: number; hp: number; id: number }[],
  ): { x: number; y: number; pathIdx: number; hp: number; id: number } | null {
    if (!enemies.length) return null;
    let target: { x: number; y: number; pathIdx: number; hp: number; id: number } | null = null;
    const stats = this.stats;
    const tileSize = this.grid?.tileSize || 36;
    const r2 = stats.range * tileSize * (stats.range * tileSize);
    const inRange = enemies.filter((enemy) => {
      const deltaX = enemy.x - this.x;
      const deltaY = enemy.y - this.y;
      return deltaX * deltaX + deltaY * deltaY <= r2;
    });
    if (!inRange.length) return null;

    switch (this.targeting) {
      case "first":
        target = inRange.reduce((prevA, prevB) => (prevA.pathIdx > prevB.pathIdx ? prevA : prevB));
        break;
      case "last":
        target = inRange.reduce((prevA, prevB) => (prevA.pathIdx < prevB.pathIdx ? prevA : prevB));
        break;
      case "closest":
        target = inRange.reduce((prevA, prevB) => {
          const da = (prevA.x - this.x) ** 2 + (prevA.y - this.y) ** 2;
          const db = (prevB.x - this.x) ** 2 + (prevB.y - this.y) ** 2;
          return da < db ? prevA : prevB;
        });
        break;
      case "strong":
        target = inRange.reduce((prevA, prevB) => (prevA.hp > prevB.hp ? prevA : prevB));
        break;
      case "furthest":
        target = inRange.reduce((prevA, prevB) => {
          const da = (prevA.x - this.x) ** 2 + (prevA.y - this.y) ** 2;
          const db = (prevB.x - this.x) ** 2 + (prevB.y - this.y) ** 2;
          return da > db ? prevA : prevB;
        });
        break;
      default:
        target = inRange[0]!;
    }
    return target;
  }

  update(
    dt: number,
    enemyManager: EnemyManagerRef,
    projectileManager: ProjectileManagerRef,
    particleManager: ParticleManagerRef,
    soundManager: SoundManagerRef,
  ) {
    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.addons.includes(0) && this.type === "ice") {
      const stats = this.stats;
      const tileSize = this.grid?.tileSize || 36;
      const r2 = (ICE_AURA_RANGE * tileSize) ** 2;
      for (const enemy of enemyManager.enemies) {
        const deltaX = enemy.x - this.x;
        const deltaY = enemy.y - this.y;
        if (deltaX * deltaX + deltaY * deltaY <= r2)
          enemy.applySlow(stats.slowAmt * ICE_AURA_SLOW_MULT, ICE_AURA_DURATION);
      }
    }

    if (this.base.fixedAim && this.fixedAimDir) {
      const dirVectors = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as Record<string, [number, number]>;
      const [ddx, ddy] = dirVectors[this.fixedAimDir]!;
      const stats = this.stats;
      const tileSize = this.grid?.tileSize || 36;
      const rangePx = stats.range * tileSize;
      let targetEnemy: { x: number; y: number } | null = null;
      for (const enemy of enemyManager.enemies) {
        const edx = enemy.x - this.x;
        const edy = enemy.y - this.y;
        const dist = Math.hypot(edx, edy);
        if (dist > rangePx || dist === 0) continue;
        const dot = (edx / dist) * ddx + (edy / dist) * ddy;
        if (dot > 0.5) {
          if (!targetEnemy || dist < Math.hypot(targetEnemy.x - this.x, targetEnemy.y - this.y)) {
            targetEnemy = enemy;
          }
        }
      }
      if (targetEnemy) {
        this.angle = Math.atan2(ddy, ddx);
        if (this.cooldown <= 0) {
          const aimTarget = { x: this.x + ddx * rangePx, y: this.y + ddy * rangePx, id: 0 };
          this.fire(aimTarget, enemyManager, projectileManager, particleManager, soundManager);
          this.cooldown = 1 / stats.fireRate;
        }
      } else {
        this.angle = Math.atan2(ddy, ddx);
      }
      return;
    }

    const target = this.selectTarget(enemyManager.enemies);
    if (target) {
      this.angle = Math.atan2(target.y - this.y, target.x - this.x);
      if (this.cooldown <= 0) {
        this.fire(target, enemyManager, projectileManager, particleManager, soundManager);
        const stats = this.stats;
        this.cooldown = 1 / stats.fireRate;
      }
    }
  }

  fire(
    target: { x: number; y: number; id: number },
    _enemyManager: EnemyManagerRef,
    projectileManager: ProjectileManagerRef,
    _particles: ParticleManagerRef,
    sound: SoundManagerRef,
  ) {
    const stats = this.stats;
    if (this.type === "lightning") {
      projectileManager.fireLightning({
        originX: this.x,
        originY: this.y,
        damage: stats.damage,
        towerLevel: this.level,
        targetId: target.id,
        stunDuration: stats.stun,
        towerId: this.id,
      });
      this.fireAnimTime = performance.now() / 1000;
      if (sound) sound.play(`shoot_${this.type}`);
      return;
    }
    const tileSize = this.grid?.tileSize || 36;
    projectileManager.spawn({
      towerId: this.id,
      x: this.x,
      y: this.y,
      damage: stats.damage,
      speed: (this.base.projSpeed || 1) * tileSize,
      range: stats.range,
      towerType: this.type,
      towerLevel: this.level,
      targetId: target.id,
      slowAmt: stats.slowAmt,
      slowDur: stats.slowDur,
    });
    this.fireAnimTime = performance.now() / 1000;
    if (sound) sound.play(`shoot_${this.type}`);
  }
}
