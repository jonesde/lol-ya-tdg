import {
  BETWEEN_WAVES_TIMER,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  PRE_EMPTIVE_WAVE_TIMER,
} from "@/sim/Constants.js";
import { TOWER_BASE, TOWER_META } from "@/sim/ConstantsTower.js";
import type { LlmCommanderConfig } from "./types.js";

function describeEnemyTypes(): string {
  const lines: string[] = [];
  for (const [typeName, meta] of Object.entries(ENEMY_TYPES)) {
    lines.push(
      `- ${typeName}: baseHp=${meta.baseHp}, speed=${meta.speed}, bounty=${meta.bounty}, attackDamage=${meta.attackDamage}, attackSpeed=${meta.attackSpeed}` +
        (meta.shield ? `, shield=${meta.shield}` : "") +
        (meta.heal ? `, heal=${meta.heal}` : ""),
    );
  }
  return lines.join("\n");
}

function describeTowerTypes(): string {
  const lines: string[] = [];
  for (const [towerName, meta] of Object.entries(TOWER_META)) {
    const base = TOWER_BASE[towerName];
    if (!base) continue;
    lines.push(
      `- ${towerName}: cost=${meta.cost}, range=${base.range}, damage=${base.damage}, fireRate=${base.fireRate}, health=${base.health}`,
    );
  }
  return lines.join("\n");
}

// Assembles the system prompt at runtime from real constants so the numbers the
// model sees can never drift from the engine. The data-stream + command sections
// describe the exact JSON the brain sends/accepts.
export function buildSystemPrompt(config: LlmCommanderConfig, instructionsOverride?: string): string {
  const commanderInstructions =
    instructionsOverride && instructionsOverride.length > 0 ? instructionsOverride : config.commanderInstructions;

  const prompt = `${config.systemPrompt}

# World

You command the enemy army in a tile-based tower-defense game. Your objective is to destroy the defender base (tile value 2) by routing enemies to it. Enemies spawn from spawn tiles (tile value 3) and travel along path tiles (tile value 1); terrain tiles (value 0) are impassable. Pathing uses BFS with dynamic tower avoidance, so you can route enemies around newly-built towers.

- Grid layout semantics: 0 = terrain, 1 = path, 2 = base, 3 = spawn.
- Coordinates are TILE coordinates (column x, row y). The map is delivered to you as a 2D array map[y][x] of these values. Do NOT convert between tile and world space; every coordinate you emit is a tile.
- 'meta.tileSize' defaults to 36 (world units per tile); you only need tile coordinates.

# Enemy types (base stats)

${describeEnemyTypes()}

Enemy HP scales by level and wave: hp = baseHp * ${ENEMY_LEVEL_HP_MULT}(level) * (1 + ${ENEMY_WAVE_DAMAGE_MULT} * (wave - 1)).

# Tower types (base level 1 stats)

${describeTowerTypes()}

Towers scale per level: damage * 1.8^(level-1), fireRate * 1.4^(level-1), range * 1.1^(level-1).

# Waves

Enemies spawn from a QUEUE. Between waves there is a ${BETWEEN_WAVES_TIMER}s inter-wave timer, and a preemptive next-wave timer of ${PRE_EMPTIVE_WAVE_TIMER} game-seconds after a wave starts (regardless of survivors). Reaching wave ${100} triggers victory. There is NO hard cap on simultaneously-active enemies — concurrency is implicitly bounded by spawn pacing, not a fixed limit.

# Data stream

Each 'decide' call sends you a JSON block describing the current state:
- On the first call (and whenever the prompt is rebuilt) you receive a FULL snapshot: every enemy (id, x, y, level, hp, maxHp), every tower (x, y, level, hp, maxHp), and a wave summary.
- On later calls you receive a DELTA: only newly-spawned enemies (full entry), known enemies whose position (tile) or hp/maxHp changed, newly-built/towered-changed towers, and the wave summary.
- Wave summary fields: currentWave, pendingEnemyCount, remainingScheduledSpawns, active.

# Commands

You may emit ONLY the following commands as a JSON array (or { "commands": [...], "chat": "..." }). Coordinates are TILE coordinates.

1. routeGroup — route a group of enemies:
   { "type": "llm:routeGroup", "enemyIds": [number], "hold": boolean, "holdTile": { "x": number, "y": number }, "waypoints": [ { "x": number, "y": number } ] }
   - hold=true parks the enemies at holdTile (or their current tile if omitted). hold=false releases them along waypoints (tile path) toward the base. waypoints may be empty to release to default pathing.
2. setTargeting — change how enemies engage towers:
   { "type": "llm:setTargeting", "enemyIds": [number], "mode": string }

You MUST NOT emit any other command type (e.g. gridLayoutToggle). All coordinates are tiles.

Return ONLY the JSON command block (optionally with a "chat" field for a short message to the player).`;

  if (commanderInstructions && commanderInstructions.length > 0) {
    return `${prompt}

# Commander Instructions

${commanderInstructions}`;
  }
  return prompt;
}
