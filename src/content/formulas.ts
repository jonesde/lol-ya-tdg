import type { EnemiesContent } from "./schemas/enemies.js";

export function enemyLevelHpMult(level: number, coeffs: EnemiesContent["levelHpMult"]): number {
  return coeffs.intercept + coeffs.slopePerLevel * (level - 1);
}

export function formatEnemyLevelHpMult(coeffs: EnemiesContent["levelHpMult"]): string {
  return `${coeffs.intercept} + ${coeffs.slopePerLevel}*(level-1)`;
}
