// ===== Enemy Types =====
// - base stats per enemy type, used as foundation for HP/bounty calculations

export interface EnemyMeta {
  baseHp: number;
  speed: number;
  bounty: number;
  radius: number;
  shield?: number;
  heal?: number;
  healRange?: number;
  resist?: number;
  slowResist?: number;
  attackDamage: number;
  attackSpeed: number;
}

export type EnemyType = "minion" | "runner" | "tank" | "shielded" | "healer" | "boss";

// referenced in Enemy.js for meta lookup, Game.js for bounty, ProjectileManager.js for type checks
export const ENEMY_TYPES: Record<string, EnemyMeta> = {
  minion: { baseHp: 8, speed: 1.0, bounty: 2, radius: 0.14, attackDamage: 3, attackSpeed: 0.5 },
  runner: { baseHp: 8, speed: 2.5, bounty: 4, radius: 0.1, attackDamage: 2, attackSpeed: 1.0 },
  tank: { baseHp: 32, speed: 0.4, bounty: 5, radius: 0.24, attackDamage: 10, attackSpeed: 0.35 },
  shielded: { baseHp: 16, speed: 0.7, bounty: 6, radius: 0.16, shield: 32, attackDamage: 10, attackSpeed: 0.5 },
  healer: {
    baseHp: 16,
    speed: 0.8,
    bounty: 7,
    radius: 0.16,
    heal: 0.03,
    healRange: 2.5,
    attackDamage: 3,
    attackSpeed: 0.5,
  },
  boss: {
    baseHp: 256,
    speed: 0.5,
    bounty: 100,
    radius: 0.33,
    resist: 0.3,
    slowResist: 0.8,
    attackDamage: 20,
    attackSpeed: 0.5,
  },
};

// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + 0.2*(wave-1)) (Enemy.js)

// level HP multiplier: 1 + 0.6*(level-1) (Enemy.js)
export const ENEMY_LEVEL_HP_MULT = (level: number): number => 1 + 0.6 * (level - 1);
// wave HP/damage multiplier: 1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1) (Enemy.js)
export const ENEMY_WAVE_DAMAGE_MULT = 0.2;
// boss stun duration reduced to 30% of normal (Enemy.js)
export const BOSS_STUN_REDUCTION = 0.3;
// minimum speed factor, prevents infinite slow stacking: Math.max(MIN_SLOW_FACTOR, slowFactor) (Enemy.js)
export const MIN_SLOW_FACTOR = 0.1;

// ===== Wave Generation =====

// base enemy count per wave: WAVE_COUNT_BASE + floor(n * WAVE_COUNT_SCALE) (WaveManager.js)
export const WAVE_COUNT_BASE = 5;
// wave count scale: WAVE_COUNT_BASE + floor(wave * WAVE_COUNT_SCALE) enemies (WaveManager.js)
export const WAVE_COUNT_SCALE = 1.3;
// boss spawn every N waves per region: n % cadence === 0 (Map.js, WaveManager.js)
export const BOSS_CADENCE = [10, 8, 5] as const;
