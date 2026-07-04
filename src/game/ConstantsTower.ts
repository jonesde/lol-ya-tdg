// string keys for tower types, passed to Tower constructor (Tower.js)
export const TowerIds = {
  BASIC: "basic",
  ICE: "ice",
  SNIPER: "sniper",
  CANNON: "cannon",
  LIGHTNING: "lightning",
  RAILGUN: "railgun",
} as const;

export type TowerId = (typeof TowerIds)[keyof typeof TowerIds];

// ===== Tower Definitions =====

// tower purchase cost (Game.js, Tower.js)
export interface TowerMeta {
  cost: number;
}

export const TOWER_META: Record<string, TowerMeta> = {
  basic: { cost: 20 },
  ice: { cost: 35 },
  sniper: { cost: 50 },
  cannon: { cost: 60 },
  lightning: { cost: 70 },
  railgun: { cost: 90 },
};

// ===== Base Tower Stats (level 1) =====
// - raw values before level scaling

// base stats per tower type, used as foundation for level scaling (Tower.js) and build preview (Game.js)
export interface TowerBase {
  range: number;
  damage: number;
  fireRate: number;
  projSpeed: number;
  splash?: number;
  slowAmt?: number;
  slowDur?: number;
  stun?: number;
  chain?: number;
  pierceFalloff?: number;
  fixedAim?: boolean;
}

export const TOWER_BASE: Record<string, TowerBase> = {
  basic: { range: 3.5, damage: 8, fireRate: 1.2, projSpeed: 14, splash: 0 },
  ice: { range: 2.8, damage: 4, fireRate: 1.0, projSpeed: 12, slowAmt: 0.45, slowDur: 1.5, splash: 0.25 },
  sniper: { range: 7, damage: 32, fireRate: 0.45, projSpeed: 30, splash: 0, stun: 0.2 },
  cannon: { range: 3.2, damage: 16, fireRate: 0.55, projSpeed: 9, splash: 0.5 },
  lightning: { range: 3.5, damage: 4, fireRate: 0.8, projSpeed: 99, chain: 2, stun: 0.1 },
  railgun: { range: 8, damage: 14, fireRate: 0.28, projSpeed: 60, pierceFalloff: 0.5, fixedAim: true },
};

// ===== Tower Level Scaling =====
// - each level N applies: damage = base * 1.8^(N-1), rate = base * 1.4^(N-1), range = base * 1.1^(N-1) (Tower.js)

// damage multiplier per level: base * TOWER_LEVEL_DMG_MULT^(level-1) (Tower.js)
export const TOWER_LEVEL_DMG_MULT = 1.8;
// fire rate multiplier per level: base * TOWER_LEVEL_RATE_MULT^(level-1) (Tower.js)
export const TOWER_LEVEL_RATE_MULT = 1.4;
// range multiplier per level: base * TOWER_LEVEL_RANGE_MULT^(level-1) (Tower.js)
export const TOWER_LEVEL_RANGE_MULT = 1.1;
// upgrade cost: meta.cost * UPGRADE_COST_BASE^(nextLevel-2) (Tower.js)
export const UPGRADE_COST_BASE = 2;
// sell returns: totalInvested * SELL_VALUE_RATIO (Tower.js)
export const SELL_VALUE_RATIO = 0.6;
// cancel build refund window in milliseconds (Tower.js)
export const CANCEL_BUILD_WINDOW_MS = 60000;
// ice aura slow: base_slowAmt * ICE_AURA_SLOW_MULT (Tower.js)
export const ICE_AURA_SLOW_MULT = 0.45;
// ice aura slow duration in seconds (Tower.js)
export const ICE_AURA_DURATION = 0.3;
// ice aura range in tiles, squared for distance check: (ICE_AURA_RANGE * grid.tileSize)² (Tower.js)
export const ICE_AURA_RANGE = 1.5;

// splash AoE damage: damage * SPLASH_DAMAGE_RATIO (ProjectileManager.js)
export const SPLASH_DAMAGE_RATIO = 0.6;
// lightning chain damage per hop: dmg *= CHAIN_DAMAGE_FALLOFF (ProjectileManager.js)
export const CHAIN_DAMAGE_FALLOFF = 0.8;
// lightning chain range: chain hops only target enemies within CHAIN_RANGE tiles (ProjectileManager.js)
export const CHAIN_RANGE = 2;
// railgun knockback: base amount (ProjectileManager.js)
export const RAILGUN_KNOCKBASE = 0.3;
// railgun knockback: per-level increment (ProjectileManager.js)
export const RAILGUN_KNOCK_SCALE = 0.2;
// railgun knockback: health scaling divisor — lower HP enemies get more knockback (ProjectileManager.js)
export const RAILGUN_KNOCK_HP_DIVISOR = 64;
// napalm burn DPS: damage * NAPALM_BURN_DPS_RATIO (ProjectileManager.js)
export const NAPALM_BURN_DPS_RATIO = 0.2;
// napalm burn lasts NAPALM_BURN_DURATION seconds (ProjectileManager.js)
export const NAPALM_BURN_DURATION = 2;
// basic tower with addon 0 crits CRIT_CHANCE of the time for bonus damage (ProjectileManager.js)
export const CRIT_CHANCE = 0.15;
// marksman variant instant-kill chance (ProjectileManager.js)
export const MARKSMAN_CHANCE = 0.2;
// marksman knockback multiplier for railgun variant A (ProjectileManager.js)
export const RAILGUN_KNOCKBACK_MULT = 3;

// ===== Tower Variant Definitions =====
// Applied when a tower reaches level 4 and is specialized (Tower.js)

export interface TowerVariantConfig {
  name: string;
  apply: (
    stats: {
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
    },
    tierIdx: number,
  ) => Record<string, number | boolean>;
}

export const TOWER_VARIANTS: Record<TowerId, { A: TowerVariantConfig; B: TowerVariantConfig }> = {
  basic: {
    A: { name: "Rapid", apply: (s, _t) => ({ ...s, fireRate: s.fireRate * 3, damage: s.damage * 0.6 }) },
    B: { name: "Heavy", apply: (s, _t) => ({ ...s, fireRate: s.fireRate * 0.5, damage: s.damage * 2.5 }) },
  },
  ice: {
    A: { name: "Permafrost", apply: (s, tierIdx) => ({ ...s, splash: [1, 1.25, 1.5][tierIdx]! }) },
    B: { name: "Shatter", apply: (s, _t) => ({ ...s, damage: s.damage * 2 }) },
  },
  sniper: {
    A: { name: "Marksman", apply: (s, _t) => ({ ...s, marksman: true }) },
    B: { name: "Piercer", apply: (s, _t) => ({ ...s, pierce: 3 }) },
  },
  cannon: {
    A: { name: "Fragment", apply: (s, _t) => ({ ...s, splash: s.splash * 1.4 }) },
    B: { name: "Napalm", apply: (s, _t) => ({ ...s, napalm: true }) },
  },
  lightning: {
    A: { name: "Overload", apply: (s, tierIdx) => ({ ...s, chain: s.chain + 2 * tierIdx, damage: s.damage * 1.2 }) },
    B: { name: "Stormcall", apply: (s, _t) => ({ ...s, stormcall: true }) },
  },
  railgun: {
    A: { name: "Knockback", apply: (s, _t) => ({ ...s, knockback: true }) },
    B: { name: "Rail Lance", apply: (s, _t) => ({ ...s, pierceFalloff: 0 }) },
  },
};
