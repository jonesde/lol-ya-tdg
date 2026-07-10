import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import type { CommanderObservation } from "../observation.js";

// Sergeant Stubby — hold-then-rush. While the current wave is still emerging he
// holds each newly-seen enemy at its current tile; once the whole wave has emerged
// (no scheduled spawns and no overflow-pending enemies) he releases just that
// wave's held enemies in one rush to the base. State keyed by wave number so a
// next-wave spillover (PRE_EMPTIVE_WAVE_TIMER) never dilutes a prior wave's rush.
export function createStubbyBrain(): CommanderBrain {
  return {
    decide(observation: CommanderObservation, memory: CommanderMemory): Command[] {
      const commands: Command[] = [];
      const currentWave = observation.wave.currentWave;
      const remainingScheduledSpawns = observation.wave.remainingScheduledSpawns;
      const pendingEnemyCount = observation.wave.pendingEnemyCount;

      let seenIds = memory.seenByWave.get(currentWave);
      if (!seenIds) {
        seenIds = new Set<number>();
        memory.seenByWave.set(currentWave, seenIds);
        if (memory.lastRushWaveNumber !== currentWave) {
          memory.phase = "idle";
        }
      }

      const waveStillEmerging = remainingScheduledSpawns > 0 || pendingEnemyCount > 0;

      if (waveStillEmerging) {
        for (const enemy of observation.enemies) {
          if (seenIds.has(enemy.id)) continue;
          seenIds.add(enemy.id);
          commands.push({
            commandId: 0,
            type: "llm:holdFormation",
            enemyIds: [enemy.id],
            holdTile: { x: enemy.tileX, y: enemy.tileY },
          });
        }
        memory.phase = "holding";
        return commands;
      }

      if (memory.phase !== "rushing" && seenIds.size > 0) {
        commands.push({ commandId: 0, type: "llm:routeGroup", enemyIds: Array.from(seenIds), waypoints: [] });
        memory.lastRushWaveNumber = currentWave;
        memory.phase = "rushing";
        memory.seenByWave.delete(currentWave);
      }
      return commands;
    },
  };
}
