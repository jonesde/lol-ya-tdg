import { enemyLevelHpMult as computeEnemyLevelHpMult } from "@/content/formulas.js";
import { getGameContent } from "@/content/gameContent.js";

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

const enemies = getGameContent().enemies;

export const ENEMY_TYPES: Record<string, EnemyMeta> = enemies.types as Record<string, EnemyMeta>;

// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + waveDamageMult*(wave-1))
export const ENEMY_LEVEL_HP_MULT = (level: number): number =>
  computeEnemyLevelHpMult(level, getGameContent().enemies.levelHpMult);

export const ENEMY_WAVE_DAMAGE_MULT = enemies.waveDamageMult;
export const BOSS_STUN_REDUCTION = enemies.bossStunReduction;
export const MIN_SLOW_FACTOR = enemies.minSlowFactor;
export const MAX_BURN_STACKS = enemies.maxBurnStacks;
export const KNOCKBACK_BALLISTIC_SECONDS = enemies.knockbackBallisticSeconds;
export const AGENT_RESYNC_RADIUS_FRACTION = enemies.agentResyncRadiusFraction;
export const SIEGE_STUCK_SECONDS = enemies.siegeStuckSeconds;
export const WAVE_COUNT_BASE = enemies.waveCountBase;
export const WAVE_COUNT_SCALE = enemies.waveCountScale;
export const BOSS_CADENCE = enemies.bossCadence;
