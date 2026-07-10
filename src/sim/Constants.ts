// ===== Core Settings =====

// ===== Feature Flags =====
export const ENABLE_SPRITE_INTERPOLATION = false;

// UI state strings, referenced in Game.js
export const GameState = {
  MENU: "menu",
  MAP_SELECT: "map_select",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "game_over",
  VICTORY: "victory",
  SKILL_TREE: "skill_tree",
} as const;

export type GameStateValue = (typeof GameState)[keyof typeof GameState];

// 3 region definitions; regionId===2 adds +1 to height noise (Map.js)
export const Regions = [{ id: 0 }, { id: 1 }, { id: 2 }] as const;

export type Region = (typeof Regions)[number];
export type RegionId = 0 | 1 | 2;

// starting gold for regions 0, 1, 2 (Game.js)
export const StartingGold = [80, 70, 60] as const;

export {
  BOSS_CADENCE,
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  type EnemyMeta,
  type EnemyType,
  MIN_SLOW_FACTOR,
  WAVE_COUNT_BASE,
  WAVE_COUNT_SCALE,
} from "./ConstantsEnemy.js";
// ===== Re-exports =====
export {
  ANTI_HEAL_DURATION,
  BOUNCE_DAMAGE_FALLOFF,
  BURN_CIRCUIT_DMG_MULT,
  BURN_CIRCUIT_DURATION,
  CANCEL_BUILD_WINDOW_MS,
  CHAIN_DAMAGE_FALLOFF,
  CHAIN_RANGE,
  CHARGE_SHOT_COUNT,
  CHARGE_SHOT_MULT,
  CRIT_CHANCE,
  DEEP_FREEZE_SLOW_MULT,
  DOUBLE_DISCHARGE_CHANCE,
  GOLD_PER_CRIT,
  ICE_AURA_DURATION,
  ICE_AURA_RANGE,
  ICE_AURA_SLOW_MULT,
  ICE_BURST_INTERVAL,
  ICE_BURST_RANGE,
  ICE_BURST_STUN_DURATION,
  KNOCKBACK_HP_DIVISOR,
  MARK_TARGET_DMG_PCT,
  MARK_TARGET_DURATION,
  MULTI_PIERCE_COUNT,
  NAPALM_BURN_DPS_RATIO,
  NAPALM_BURN_DURATION,
  SELL_VALUE_RATIO,
  SPLASH_DAMAGE_RATIO,
  STATIC_FIELD_RANGE,
  STATIC_FIELD_SLOW_AMT,
  STATIC_FIELD_SLOW_DUR,
  STUN_SHELL_DURATION,
  TOWER_ADDON_EFFECTS,
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_LEVEL_SPLASH_MULT,
  TOWER_META,
  TOWER_VARIANTS,
  type TowerAddonEffect,
  type TowerBase,
  type TowerId,
  TowerIds,
  type TowerMeta,
  type TowerVariantConfig,
  TRUE_SHOT_CHANCE,
  UPGRADE_COST_BASE,
} from "./ConstantsTower.js";

// ===== Game Flow =====

// fixed timestep for physics updates: 1/60s (Game.js)
export const FIXED_DT = 1 / 60;
// hit detection radius tolerance for circle projectiles (ProjectileManager.js)
export const PROJECTILE_HIT_THRESHOLD = 8;
// max lifetime (seconds) of a projectile before it is force-expired to avoid stale accumulation
export const MAX_PROJECTILE_AGE = 12;
// max accumulated time before skipping updates to prevent spiral-of-death: Math.min(MAX_ACCUM, acc) (Game.js)
export const MAX_ACCUM = 0.1;
// Max fixed steps processed in a single worker frame. Caps the post-timescale
// accumulator so a slow frame can't burst dozens of steps (spiral-of-death).
// timeScale 8 at 60fps naturally needs 8 steps/frame, so 12 leaves headroom.
export const MAX_STEPS_PER_FRAME = 12;
// boss reaching base costs BOSS_LIFE_LOSS lives instead of 1 (Game.js)
export const BOSS_LIFE_LOSS = 5;
// wave at which victory is triggered (Game.js, WaveManager.js)
export const VICTORY_WAVE = 100;
// waves with milestone gem rewards, checked via wave >= m (Game.js)
export const MILESTONE_WAVES = [15, 30, 50] as const;
// gem rewards per milestone wave (Game.js)
export const MILESTONE_GEMS = { 15: 1, 30: 2, 50: 4 } as const;
// run bonus gems: BONUS_GEM_BASE^floor(wave/10) (Game.js)
export const BONUS_GEM_BASE = 1.12;
// blocked enemy bounty: ceil(base_bounty * BOUNTY_BLOCKED_RATIO) (Game.js)
export const BOUNTY_BLOCKED_RATIO = 0.5;
// seconds between waves before next spawn (WaveManager.js)
export const BETWEEN_WAVES_TIMER = 3;
// game-seconds after wave start before next wave countdown begins, regardless of alive enemies (WaveManager.js)
export const PRE_EMPTIVE_WAVE_TIMER = 90;

// ===== Difficulty & Gem Multipliers =====

// Difficulty slider range: 1.0 to 4.0 in 0.25 increments (13 tick positions)
export const DIFFICULTY_MULT_MIN = 1.0;
export const DIFFICULTY_MULT_MAX = 4.0;
export const DIFFICULTY_MULT_TICK = 0.25;
// Gem multiplier formula: difficultyMultiplier × 1.5
export const DIFFICULTY_MULT_GEM_BASE = 1.5;

// Fixed gem reward multipliers per region (difficulty scale)
// region 0 = x1, region 1 = x2, region 2 = x4
export const REGION_GEM_REWARDS = [1, 2, 4] as const;

// Per-map gem multipliers (36 maps)
export const MAP_GEM_MULTIPLIERS = [
  // Region 0: maps 1-12
  1,
  1,
  1,
  1, // maps 1-4
  2,
  2,
  2,
  2, // maps 5-8
  3,
  3,
  3,
  3, // maps 9-12
  // Region 1: maps 13-24
  4,
  4,
  4,
  4, // maps 13-16
  5,
  5,
  5,
  5, // maps 17-20
  6,
  6,
  6,
  6, // maps 21-24
  // Region 2: maps 25-36
  7,
  7,
  7,
  7, // maps 25-28
  8,
  8,
  8,
  8, // maps 29-32
  10,
  10,
  10,
  10, // maps 33-36
] as const;

// First-time bonuses (per-map)
export const FIRST_TIME_MILESTONE_MULT = 2; // 2× milestone gems on first milestone hit per map
export const FIRST_FULL_CLEAR_MULT = 2; // 2× all gems on first wave-100 clear per map

// ===== Map Generation =====

// base map dimension at level 1: MAP_BASE_SIZE + floor((level-1) * MAP_SIZE_SCALE) (Map.js)
export const MAP_BASE_SIZE = 20;
// map size scale per level (Map.js)
export const MAP_SIZE_SCALE = 2.5;
// maximum map width/height clamped to MAX_MAP_DIM (Map.js)
export const MAX_MAP_DIM = 50;
// height noise frequency: sin(x * HEIGHT_NOISE_FREQ) + cos(y * HEIGHT_NOISE_FREQ) (Map.js)
export const HEIGHT_NOISE_FREQ = 0.3;
// height noise divisor to normalize variation range: / HEIGHT_NOISE_DIVISOR (Map.js)
export const HEIGHT_NOISE_DIVISOR = 1.5;
// serpentine path horizontal sweep step size (Map.js)
export const SERPENTINE_STEP = 4;
// serpentine path vertical descent cap per step (Map.js)
export const SERPENTINE_DOWN_CAP = 3;
// maps per region, used to derive regionId/level from map index (Map.js)
export const MAPS_PER_REGION = 12;

// ===== Map Level Configuration =====
// Each entry: { width, height, regionId, level, style, seed }
// style: 'open'|'canyon'|'serpentine'|'split'|'bastion'|'battlefield'
export type MapStyle = "open" | "canyon" | "serpentine" | "split" | "bastion" | "battlefield";

export interface MapLevelConfig {
  width: number;
  height: number;
  regionId: number;
  level: number;
  style: MapStyle;
  seed: number;
}

export const MAP_LEVELS: MapLevelConfig[] = [
  // Region 0 — Verdant Marches (levels 1–12)
  { width: 15, height: 15, regionId: 0, level: 1, style: "serpentine", seed: 7777 },
  { width: 20, height: 10, regionId: 0, level: 2, style: "canyon", seed: 15554 },
  { width: 10, height: 20, regionId: 0, level: 3, style: "serpentine", seed: 23331 },
  { width: 18, height: 18, regionId: 0, level: 4, style: "split", seed: 31108 },
  { width: 20, height: 20, regionId: 0, level: 5, style: "bastion", seed: 38885 },
  { width: 20, height: 20, regionId: 0, level: 6, style: "battlefield", seed: 46662 },
  { width: 25, height: 25, regionId: 0, level: 7, style: "open", seed: 54439 },
  { width: 25, height: 25, regionId: 0, level: 8, style: "canyon", seed: 62216 },
  { width: 30, height: 20, regionId: 0, level: 9, style: "serpentine", seed: 7777 },
  { width: 30, height: 20, regionId: 0, level: 10, style: "split", seed: 77770 },
  { width: 30, height: 30, regionId: 0, level: 11, style: "bastion", seed: 85547 },
  { width: 30, height: 30, regionId: 0, level: 12, style: "battlefield", seed: 93324 },
  // Region 1 — Sunscorch Coast (levels 1–12)
  { width: 20, height: 20, regionId: 1, level: 1, style: "serpentine", seed: 100777 },
  { width: 22, height: 22, regionId: 1, level: 2, style: "split", seed: 108554 },
  { width: 25, height: 15, regionId: 1, level: 3, style: "bastion", seed: 116331 },
  { width: 25, height: 15, regionId: 1, level: 4, style: "battlefield", seed: 124108 },
  { width: 25, height: 25, regionId: 1, level: 5, style: "open", seed: 131885 },
  { width: 30, height: 15, regionId: 1, level: 6, style: "canyon", seed: 139662 },
  { width: 30, height: 20, regionId: 1, level: 7, style: "serpentine", seed: 147439 },
  { width: 30, height: 30, regionId: 1, level: 8, style: "split", seed: 155216 },
  { width: 32, height: 20, regionId: 1, level: 9, style: "bastion", seed: 162993 },
  { width: 32, height: 20, regionId: 1, level: 10, style: "battlefield", seed: 170770 },
  { width: 35, height: 22, regionId: 1, level: 11, style: "open", seed: 178547 },
  { width: 35, height: 22, regionId: 1, level: 12, style: "canyon", seed: 186324 },
  // Region 2 — Thornpeak Wilds (levels 1–12)
  { width: 25, height: 15, regionId: 2, level: 1, style: "bastion", seed: 207777 },
  { width: 15, height: 25, regionId: 2, level: 2, style: "battlefield", seed: 215554 },
  { width: 25, height: 25, regionId: 2, level: 3, style: "open", seed: 223331 },
  { width: 25, height: 15, regionId: 2, level: 4, style: "canyon", seed: 231108 },
  { width: 30, height: 15, regionId: 2, level: 5, style: "serpentine", seed: 238885 },
  { width: 30, height: 20, regionId: 2, level: 6, style: "split", seed: 246662 },
  { width: 30, height: 20, regionId: 2, level: 7, style: "bastion", seed: 254439 },
  { width: 35, height: 35, regionId: 2, level: 8, style: "open", seed: 269993 },
  { width: 42, height: 25, regionId: 2, level: 9, style: "canyon", seed: 277770 },
  { width: 45, height: 20, regionId: 2, level: 10, style: "serpentine", seed: 285547 },
  { width: 45, height: 30, regionId: 2, level: 11, style: "split", seed: 293324 },
  { width: 45, height: 30, regionId: 2, level: 12, style: "battlefield", seed: 262216 },
];

export const TOTAL_MAPS = MAP_LEVELS.length;

// ===== General Add-ons (Skill Tree) =====

// gem costs per tier for each general add-on: [tier0, tier1, tier2]
// extraHealth: +10, +20, +50 lives
// startingGold: +50g, +100g, +200g
// upgradeCostReduction: -10%, -25%, -50%
// terrainHeightBonus: +5%, +10%, +20% per height level (1-4)
// damageMilestoneBonus: +5%/+2%, +10%/+5%, +20%/+10% per 1M damage
export const GENERAL_ADDON_GEM_COSTS = {
  extraHealth: [30, 60, 100],
  startingGold: [30, 60, 100],
  slowHealing: [30, 60, 100],
  upgradeCostReduction: [40, 80, 150],
  terrainHeightBonus: [40, 80, 150],
  terrainHeightRangeBonus: [50, 100, 200],
  damageMilestoneBonus: [50, 100, 180],
} as const;

export type GeneralAddonId = keyof typeof GENERAL_ADDON_GEM_COSTS;

// slow healing per round values: +1, +2, +4 HP at wave start
export const SLOW_HEALING_PER_ROUND = [1, 2, 4] as const;

// gem cost per sell option sub-choice (one-time purchase, then free switching)
export const SELL_OPTION_GEM_COST = 50;

// sell discount: reduce upgrade cost by 25% (rounded down) when discount option is active
export const SELL_DISCOUNT_PCT = 0.25;

// terrain height damage bonus per height level per tier: base * (1 + bonusPct * height)
// tier values: 0.05, 0.10, 0.20
export const TERRAIN_HEIGHT_BONUS_PCT = [0.05, 0.1, 0.2] as const;

// terrain height range bonus per height level per tier: flat tiles added
// tier values: 0.25, 0.5, 1.0
export const TERRAIN_HEIGHT_RANGE_BONUS = [0.25, 0.5, 1.0] as const;

// upgrade cost reduction per tier: fraction subtracted
// tier values: 0.10, 0.25, 0.50
export const UPGRADE_COST_REDUCTION_PCT = [0.1, 0.25, 0.5] as const;

// starting gold bonus per tier: flat gold added
// tier values: 50, 100, 200
export const STARTING_GOLD_BONUS = [50, 100, 200] as const;

// starting health bonus per tier: flat lives added
// tier values: 10, 20, 50 (total 100 if all 3 unlocked)
export const STARTING_HEALTH_BONUS = [10, 20, 50] as const;

// damage/speed milestone bonus per tier per 1M damage threshold
// [damagePct, speedPct]
// tier values: [0.05, 0.02], [0.10, 0.05], [0.20, 0.10]
export const MILESTONE_BONUS_PCT = [
  [0.05, 0.02],
  [0.1, 0.05],
  [0.2, 0.1],
] as const;

// total damage threshold for each milestone tier (1M, 2M, 3M...)
export const MILESTONE_THRESHOLD = 1000000;

// ===== UI Layout =====

// build bar header height in pixels (GameShop.vue)
export const HEADER_HEIGHT = 20;
// build bar shop/footer height in pixels (GameShop.vue)
export const FOOTER_HEIGHT = 64;

// ===== Wave Graph =====

// Wave Graph — real-time metric chart overlay
export const WAVE_GRAPH_INTERVAL_SECONDS = 5;
export const WAVE_GRAPH_HEIGHT = 60;
// Maximum retained dot count (in ticks of WAVE_GRAPH_INTERVAL_SECONDS). This
// used to be the on-screen pixel width fed into the tracker via
// setContainerWidth; in the worker model there is no main-thread caller, so it
// now serves as a generous cap sized to fill a wide screen at WAVE_GRAPH_DOT_SPACING
// (2000 / 8 = 250 dots ≈ 21 min of history before old points cycle off).
export const WAVE_GRAPH_WIDTH = 2000;
export const WAVE_GRAPH_DOT_SIZE = 2;
export const WAVE_GRAPH_DOT_SPACING = 8;
// Max dots shipped per snapshot. The worker retains far more (WAVE_GRAPH_WIDTH)
// but only streams the most recent window so the main thread can merge and
// refill the screen; keeps each posted frame's payload tiny.
export const WAVE_GRAPH_MAX_SEND = 8;
export const WAVE_GRAPH_DOT_OPACITY = 0.2;
export const WAVE_GRAPH_DOT_OPACITY_WAVE_START = 0.5;
export const WAVE_GRAPH_MAIN_OPACITY = 0.3;

export const WAVE_GRAPH_COLOR_DAMAGE = "#aaaaff";
export const WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH = "#ff4444";
export const WAVE_GRAPH_COLOR_GOLD_EARNED = "#ffd700";
export const WAVE_GRAPH_COLOR_GEMS_EARNED = "#4488ff";

// Base health dynamic colors
export const WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN = "#5fff8a";
export const WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW = "#ffd84d";
export const WAVE_GRAPH_COLOR_BASE_HEALTH_RED = "#ff4444";
