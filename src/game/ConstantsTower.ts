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
// gold granted per critical hit when basic tower has Gold Rush addon (GameEngine.js)
export const GOLD_PER_CRIT = 1;
// ice tower Deep Freeze addon: increases slow strength by this factor
export const DEEP_FREEZE_SLOW_MULT = 1.25;
// ice tower Ice Burst addon: stun duration in seconds
export const ICE_BURST_STUN_DURATION = 0.5;
// ice tower Ice Burst addon: interval between bursts in seconds
export const ICE_BURST_INTERVAL = 3;
// ice tower Ice Burst addon: burst range in tiles
export const ICE_BURST_RANGE = 2;
// cannon tower Stun Shell addon: stun duration applied by splash damage
export const STUN_SHELL_DURATION = 0.3;
// lightning tower Static Field addon: slow amount (15%)
export const STATIC_FIELD_SLOW_AMT = 0.15;
// lightning tower Static Field addon: slow duration in seconds
export const STATIC_FIELD_SLOW_DUR = 0.5;
// lightning tower Static Field addon: field range in tiles
export const STATIC_FIELD_RANGE = 2;
// lightning tower Double Discharge addon: chance for second bolt
export const DOUBLE_DISCHARGE_CHANCE = 0.1;
// lightning tower Burn Circuit addon: burn damage multiplier on chained targets
export const BURN_CIRCUIT_DMG_MULT = 1.2;
// lightning tower Burn Circuit addon: burn duration in seconds
export const BURN_CIRCUIT_DURATION = 2;
// sniper tower True Shot addon: instant-kill chance on non-boss enemies
export const TRUE_SHOT_CHANCE = 0.2;
// sniper tower Mark Target addon: damage increase percentage for marked target
export const MARK_TARGET_DMG_PCT = 0.25;
// sniper tower Mark Target addon: duration of the mark in seconds
export const MARK_TARGET_DURATION = 3;
// railgun tower Charge Shot addon: damage multiplier on charged shot
export const CHARGE_SHOT_MULT = 3;
// railgun tower Charge Shot addon: shot count required for charge
export const CHARGE_SHOT_COUNT = 5;
// railgun tower Multi-Pierce addon: additional pierce count
export const MULTI_PIERCE_COUNT = 2;
// basic tower Bounce Shot addon: damage multiplier per bounce
export const BOUNCE_DAMAGE_FALLOFF = 0.8;
// railgun tower Anti-Heal addon: duration in seconds
export const ANTI_HEAL_DURATION = 2;
// marksman variant instant-kill chance (ProjectileManager.js)
export const MARKSMAN_CHANCE = 0.2;
// marksman knockback multiplier for railgun variant A (ProjectileManager.js)
export const RAILGUN_KNOCKBACK_MULT = 3;

// ===== Tower Variant Definitions =====
// Applied when a tower reaches level 4 and is specialized (Tower.js)

export type TowerVariantStats = {
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
};

export interface TowerVariantConfig {
  name: string;
  apply: (stats: TowerVariantStats, tierIdx: number) => TowerVariantStats;
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
    A: {
      name: "Overload",
      apply: (s, tierIdx) => ({ ...s, chain: s.chain + 2 * tierIdx, damage: s.damage * 1.2 ** tierIdx }),
    },
    B: { name: "Stormcall", apply: (s, _t) => ({ ...s, stormcall: true }) },
  },
  railgun: {
    A: { name: "Knockback", apply: (s, _t) => ({ ...s, knockback: true }) },
    B: { name: "Rail Lance", apply: (s, _t) => ({ ...s, pierceFalloff: 0 }) },
  },
};

// ===== Tower Addon Effects =====
// Data-driven definitions for all tower addon effects. Each addon maps to stat
// modifiers and/or behavior flags applied in Tower._computeStats. Effects that
// require per-frame behavior (frostAura, staticField, iceBurst) are flagged here
// and handled in Tower.update(). Effects that modify projectile behavior are
// flagged here and passed to ProjectileManager via Tower.fire().

export interface TowerAddonEffect {
  // Stat multipliers (applied multiplicatively after base stats)
  damageMult?: number;
  splashMult?: number;
  slowMult?: number;
  // Stat additions
  rangeAdd?: number;
  chainAdd?: number;
  stunAdd?: number;
  pierceAdd?: number;
  // Behavior flags (handled in Tower.fire() or ProjectileManager)
  critChance?: number;
  goldOnCrit?: number;
  bounceShot?: boolean;
  splashStun?: number;
  antiAir?: boolean;
  doubleDischarge?: number;
  burnCircuit?: boolean;
  trueShot?: number;
  markTarget?: number;
  chargeShot?: boolean;
  antiHeal?: boolean;
  // Per-frame behavior flags (handled in Tower.update())
  frostAura?: boolean;
  staticField?: boolean;
  iceBurst?: boolean;
}

export const TOWER_ADDON_EFFECTS: Record<TowerId, TowerAddonEffect[]> = {
  basic: [
    // 0: Critical Hit - 15% chance for ×2 damage
    { critChance: CRIT_CHANCE },
    // 1: Gold Rush - +1 gold per crit
    { goldOnCrit: GOLD_PER_CRIT },
    // 2: Bounce Shot - bullets bounce to 1 nearby enemy
    { bounceShot: true },
  ],
  ice: [
    // 0: Frost Aura - permanent slow aura on adjacent tiles
    { frostAura: true },
    // 1: Deep Freeze - +25% slow strength
    { slowMult: DEEP_FREEZE_SLOW_MULT },
    // 2: Ice Burst - periodic freeze burst stuns nearby enemies
    { iceBurst: true },
  ],
  sniper: [
    // 0: True Shot - 20% chance to instant-kill non-boss enemies
    { trueShot: TRUE_SHOT_CHANCE },
    // 1: Mark Target - target takes +25% damage from all sources
    { markTarget: MARK_TARGET_DMG_PCT },
    // 2: Long Range - +2 range
    { rangeAdd: 2 },
  ],
  cannon: [
    // 0: Wide Blast - +50% splash radius
    { splashMult: 1.5 },
    // 1: Stun Shell - splash damage applies 0.3s stun
    { splashStun: STUN_SHELL_DURATION },
    // 2: Anti-Air - shots hit air units and ignore shields
    { antiAir: true },
  ],
  lightning: [
    // 0: Static Field - slows nearby enemies by 15%
    { staticField: true },
    // 1: Double Discharge - 10% chance to fire a second bolt
    { doubleDischarge: DOUBLE_DISCHARGE_CHANCE },
    // 2: Burn Circuit - chained enemies take +20% damage for 2s
    { burnCircuit: true },
  ],
  railgun: [
    // 0: Charge Shot - every 5th shot deals ×3 damage
    { chargeShot: true },
    // 1: Anti-Heal - disables enemy healer auras for 2s
    { antiHeal: true },
    // 2: Multi-Pierce - beams pierce 2 additional enemies
    { pierceAdd: MULTI_PIERCE_COUNT },
  ],
};
