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

// tower display data: cost for purchase (Game.js), color/icon for rendering (Tower.js, Game.js)
export interface TowerAnimationConfig {
  referenceImages: Array<{ id: string; svgText: string }>;
  duration: number;
  color: string;
}

export interface TowerWalkingConfig {
  referenceImages: Array<{ id: string; svgText: string }>;
  duration: number;
  color: string;
}

export interface TowerMeta {
  name: string;
  cost: number;
  color: string;
  icon: string;
  animation?: TowerAnimationConfig;
  walking?: TowerWalkingConfig;
}

export const TOWER_META: Record<string, TowerMeta> = {
  basic: {
    name: "Rifle Tower",
    cost: 20,
    color: "#8fbc8f",
    icon: "\u2500",
    animation: {
      referenceImages: [
        {
          id: "basic_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="currentColor" fill="none" stroke-width="2"/><path d="M-10,-6 A12,12 0 0,0 -10,6" stroke="currentColor" fill="none" stroke-width="2"/><line x1="8" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "basic_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="currentColor" fill="none" stroke-width="2"/><path d="M-10,-6 A12,12 0 0,0 -10,6" stroke="#8fdd8f" fill="none" stroke-width="3"/><line x1="8" y1="0" x2="16" y2="0" stroke="#8fdd8f" fill="none" stroke-width="2.5"/></svg>',
        },
      ],
      duration: 0.3,
      color: "#8fbc8f",
    },
    walking: {
      referenceImages: [
        {
          id: "basic_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="currentColor" fill="none" stroke-width="2"/><path d="M-10,-6 A12,12 0 0,0 -10,6" stroke="currentColor" fill="none" stroke-width="2"/><line x1="8" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 0.6,
      color: "#8fbc8f",
    },
  },
  ice: {
    name: "Frost Pylon",
    cost: 35,
    color: "#9be7ff",
    icon: "\u2744",
    animation: {
      referenceImages: [
        {
          id: "ice_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-10 8.66,-5 8.66,5 0,10 -8.66,5 -8.66,-5" stroke="currentColor" fill="none" stroke-width="2"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "ice_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-10 8.66,-5 8.66,5 0,10 -8.66,5 -8.66,-5" stroke="#00BFFF" fill="none" stroke-width="2.5"/><line x1="10" y1="0" x2="16" y2="0" stroke="#00BFFF" fill="none" stroke-width="2.5"/></svg>',
        },
      ],
      duration: 0.3,
      color: "#9be7ff",
    },
    walking: {
      referenceImages: [
        {
          id: "ice_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-10 8.66,-5 8.66,5 0,10 -8.66,5 -8.66,-5" stroke="currentColor" fill="none" stroke-width="2"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 0.7,
      color: "#9be7ff",
    },
  },
  sniper: {
    name: "Sniper Nest",
    cost: 50,
    color: "#ffd84d",
    icon: "\u25CE",
    animation: {
      referenceImages: [
        {
          id: "sniper_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="4" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="8" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "sniper_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="#FFD700" fill="none" stroke-width="2.5"/><circle cx="0" cy="0" r="4" stroke="#FFD700" fill="none" stroke-width="2"/><line x1="8" y1="0" x2="16" y2="0" stroke="#FFD700" fill="none" stroke-width="2.5"/></svg>',
        },
      ],
      duration: 0.5,
      color: "#ffd84d",
    },
    walking: {
      referenceImages: [
        {
          id: "sniper_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="8" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="4" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="8" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 0.5,
      color: "#ffd84d",
    },
  },
  cannon: {
    name: "Mortar Launcher",
    cost: 60,
    color: "#ff8a4d",
    icon: "\u25CF",
    animation: {
      referenceImages: [
        {
          id: "cannon_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="10" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="6" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "cannon_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="10" stroke="#FF4500" fill="none" stroke-width="2.5"/><circle cx="0" cy="0" r="6" stroke="#FF4500" fill="none" stroke-width="2"/><line x1="10" y1="0" x2="16" y2="0" stroke="#FF4500" fill="none" stroke-width="2.5"/></svg>',
        },
      ],
      duration: 0.5,
      color: "#ff8a4d",
    },
    walking: {
      referenceImages: [
        {
          id: "cannon_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><circle cx="0" cy="0" r="10" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="6" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 0.8,
      color: "#ff8a4d",
    },
  },
  lightning: {
    name: "Stun Gun",
    cost: 70,
    color: "#205088",
    icon: "\u26A1",
    animation: {
      referenceImages: [
        {
          id: "lightning_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-12 12,0 0,12 -12,0" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="7" stroke="currentColor" fill="none" stroke-width="2"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "lightning_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-12 12,0 0,12 -12,0" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="6" stroke="#40a0ff" fill="none" stroke-width="3"/><line x1="12" y1="0" x2="16" y2="0" stroke="#40a0ff" fill="none" stroke-width="2.5"/></svg>',
        },
      ],
      duration: 0.5,
      color: "#40a0ff",
    },
    walking: {
      referenceImages: [
        {
          id: "lightning_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><polygon points="0,-10 10,0 0,10 -10,0" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="0" cy="0" r="3" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="10" y1="0" x2="16" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 0.8,
      color: "#40a0ff",
    },
  },
  railgun: {
    name: "Rail Cannon",
    cost: 90,
    color: "#c98aff",
    icon: "\u2550",
    animation: {
      referenceImages: [
        {
          id: "railgun_idle",
          svgText:
            '<svg viewBox="-16 -16 32 32"><line x1="-12" y1="-5" x2="12" y2="-5" stroke="currentColor" fill="none" stroke-width="2"/><line x1="-12" y1="5" x2="12" y2="5" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="-12" cy="-5" r="2" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="-12" cy="5" r="2" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="12" y1="0" x2="20" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
        {
          id: "railgun_fire",
          svgText:
            '<svg viewBox="-16 -16 32 32"><line x1="-12" y1="-5" x2="12" y2="-5" stroke="#00FF00" fill="none" stroke-width="3"/><line x1="-12" y1="5" x2="12" y2="5" stroke="#00FF00" fill="none" stroke-width="3"/><circle cx="-12" cy="-5" r="2.5" stroke="#00FF00" fill="none" stroke-width="2"/><circle cx="-12" cy="5" r="2.5" stroke="#00FF00" fill="none" stroke-width="2"/><line x1="12" y1="0" x2="20" y2="0" stroke="#00FF00" fill="none" stroke-width="3"/></svg>',
        },
      ],
      duration: 0.6,
      color: "#c98aff",
    },
    walking: {
      referenceImages: [
        {
          id: "railgun_walk",
          svgText:
            '<svg viewBox="-16 -16 32 32"><line x1="-12" y1="-5" x2="12" y2="-5" stroke="currentColor" fill="none" stroke-width="2"/><line x1="-12" y1="5" x2="12" y2="5" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="-12" cy="-5" r="2" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="-12" cy="5" r="2" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="12" y1="0" x2="20" y2="0" stroke="currentColor" fill="none" stroke-width="2"/></svg>',
        },
      ],
      duration: 1.0,
      color: "#c98aff",
    },
  },
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
