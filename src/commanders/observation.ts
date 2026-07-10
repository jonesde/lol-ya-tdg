import type { SpawnStateSnapshot } from "@/sim/SimulationSnapshot.js";
import type { CommanderSnapshotSlice } from "./protocol.js";

export interface ObservationEnemy {
  id: number;
  tileX: number;
  tileY: number;
  level: number;
  hp: number;
  maxHp: number;
}

export interface ObservationTower {
  tileX: number;
  tileY: number;
  level: number;
  hp: number;
  maxHp: number;
}

export interface ObservationWave {
  currentWave: number;
  pendingEnemyCount: number;
  spawnStates: SpawnStateSnapshot[];
  remainingScheduledSpawns: number;
  active: boolean;
}

// The abstracted semantic view the brain consumes. Field names are intentionally
// stable for a future LLM commander (see ArchitecturePlan §4.3).
export interface CommanderObservation {
  map: number[][] | undefined;
  enemies: ObservationEnemy[];
  towers: ObservationTower[];
  wave: ObservationWave;
}

function worldToTile(worldCoordinate: number, tileSize: number): number {
  return Math.floor(worldCoordinate / tileSize);
}

// Pure projection from a throttled snapshot slice into the brain's semantic view.
// Enemy world x/y → tile via meta.tileSize; tower health/maxHealth are renamed to
// hp/maxHp (the brain reads hp/maxHp); pendingEnemyCount is summed across spawnStates.
export function buildObservation(slice: CommanderSnapshotSlice): CommanderObservation {
  const tileSize = slice.meta.tileSize ?? 36;
  const enemies: ObservationEnemy[] = slice.enemies.map((enemy) => ({
    id: enemy.id,
    tileX: worldToTile(enemy.x, tileSize),
    tileY: worldToTile(enemy.y, tileSize),
    level: enemy.level,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
  }));
  const towers: ObservationTower[] = slice.towers.map((tower) => ({
    tileX: tower.tileX,
    tileY: tower.tileY,
    level: tower.level,
    hp: tower.health,
    maxHp: tower.maxHealth,
  }));
  const pendingEnemyCount = slice.spawnStates.reduce((sum, spawnState) => sum + spawnState.pendingCount, 0);
  const wave: ObservationWave = {
    currentWave: slice.meta.currentWave,
    pendingEnemyCount,
    spawnStates: slice.spawnStates,
    remainingScheduledSpawns: slice.meta.remainingScheduledSpawns ?? 0,
    active: slice.meta.waveActive ?? false,
  };
  return { map: slice.gridLayout, enemies, towers, wave };
}
