import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import type { CommanderObservation, ObservationEnemy, ObservationTower } from "../observation.js";

interface GridCoordinate {
  x: number;
  y: number;
}

const PATH_TILE_VALUES = [1, 2, 3];

function isPathTile(tileValue: number): boolean {
  return PATH_TILE_VALUES.includes(tileValue);
}

// Single BFS from every base tile (value 2) over path/spawn/base tiles (1/2/3),
// ignoring towers — the authoritative "between enemies and base" measure reused
// for both the ahead-filter and the waypoint snap. Unreachable tiles stay -1.
function computeDistancesToBase(gridLayout: number[][]): number[][] {
  const rowCount = gridLayout.length;
  const columnCount = gridLayout[0]?.length ?? 0;
  const distances: number[][] = gridLayout.map((row) => row.map(() => -1));
  const distanceQueue: GridCoordinate[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const gridRow = gridLayout[rowIndex];
    const distanceRow = distances[rowIndex];
    if (!gridRow || !distanceRow) continue;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      if (gridRow[columnIndex] === 2) {
        distanceRow[columnIndex] = 0;
        distanceQueue.push({ x: columnIndex, y: rowIndex });
      }
    }
  }
  const directionOffsets = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  let queueHead = 0;
  while (queueHead < distanceQueue.length) {
    const currentTile = distanceQueue[queueHead];
    queueHead += 1;
    if (!currentTile) break;
    const currentDistance = distances[currentTile.y]?.[currentTile.x];
    if (currentDistance === undefined) continue;
    for (const offset of directionOffsets) {
      const nextX = currentTile.x + offset.x;
      const nextY = currentTile.y + offset.y;
      if (nextX < 0 || nextY < 0 || nextX >= columnCount || nextY >= rowCount) continue;
      const tileValue = gridLayout[nextY]?.[nextX];
      if (tileValue === undefined || !isPathTile(tileValue)) continue;
      const nextDistanceRow = distances[nextY];
      if (!nextDistanceRow || nextDistanceRow[nextX] !== -1) continue;
      nextDistanceRow[nextX] = currentDistance + 1;
      distanceQueue.push({ x: nextX, y: nextY });
    }
  }
  return distances;
}

// Nearest path/spawn/base tile (Euclidean) to an arbitrary tile — towers may sit
// on terrain, so the waypoint must snap to a tile the engine can route through.
function nearestPathTileTo(tileX: number, tileY: number, gridLayout: number[][]): GridCoordinate | null {
  const rowCount = gridLayout.length;
  const columnCount = gridLayout[0]?.length ?? 0;
  if (rowCount === 0 || columnCount === 0) return null;
  let bestTile: GridCoordinate | null = null;
  let bestSquaredDistance = Infinity;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const gridRow = gridLayout[rowIndex];
    if (!gridRow) continue;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const tileValue = gridRow[columnIndex];
      if (tileValue === undefined || !isPathTile(tileValue)) continue;
      const deltaX = columnIndex - tileX;
      const deltaY = rowIndex - tileY;
      const squaredDistance = deltaX * deltaX + deltaY * deltaY;
      if (squaredDistance < bestSquaredDistance) {
        bestSquaredDistance = squaredDistance;
        bestTile = { x: columnIndex, y: rowIndex };
      }
    }
  }
  return bestTile;
}

// Representative enemy position: mean of current-wave enemy tiles, snapped to the
// nearest path tile so a distance lookup is always defined.
function representativeEnemyTile(enemies: ObservationEnemy[], gridLayout: number[][]): GridCoordinate | null {
  if (enemies.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  for (const enemy of enemies) {
    sumX += enemy.tileX;
    sumY += enemy.tileY;
  }
  const meanX = Math.floor(sumX / enemies.length);
  const meanY = Math.floor(sumY / enemies.length);
  return nearestPathTileTo(meanX, meanY, gridLayout);
}

function computeTowerSignature(liveTowers: ObservationTower[]): string {
  return liveTowers
    .map((tower) => `${tower.tileX},${tower.tileY}:${Math.round(tower.hp)}`)
    .sort()
    .join("|");
}

// Commander Stubbs — aggressive, never holds. He routes every newly-seen enemy
// straight at the highest-hp live tower that is *ahead* (closer to base) of the
// group, and re-routes whenever the tower set changes. Pure function of the
// observation + worker-owned memory; the engine does all pathing.
export function createStubbsBrain(): CommanderBrain {
  return {
    decide(observation: CommanderObservation, memory: CommanderMemory): Command[] {
      const commands: Command[] = [];
      const currentWave = observation.wave.currentWave;

      let seenIds = memory.seenByWave.get(currentWave);
      if (!seenIds) {
        seenIds = new Set<number>();
        memory.seenByWave.set(currentWave, seenIds);
      }

      const aliveIds = new Set<number>(observation.enemies.map((enemy) => enemy.id));
      const newlySeenIds: number[] = [];
      for (const enemy of observation.enemies) {
        if (seenIds.has(enemy.id)) continue;
        seenIds.add(enemy.id);
        newlySeenIds.push(enemy.id);
      }

      const gridLayout = observation.map;
      if (!gridLayout) {
        // No map this tick — can't choose a target; ids are already recorded.
        return commands;
      }

      const distancesToBase = computeDistancesToBase(gridLayout);
      const liveTowers = observation.towers.filter((tower) => tower.hp > 0);
      const towerSignature = computeTowerSignature(liveTowers);

      const enemyTile = representativeEnemyTile(observation.enemies, gridLayout);
      const enemyDistance = enemyTile ? distancesToBase[enemyTile.y]?.[enemyTile.x] : undefined;

      let targetTower: ObservationTower | null = null;
      for (const tower of liveTowers) {
        const towerDistance = distancesToBase[tower.tileY]?.[tower.tileX];
        if (towerDistance === undefined || towerDistance < 0) continue;
        if (enemyDistance !== undefined && enemyDistance >= 0 && !(towerDistance < enemyDistance)) continue;
        if (!targetTower || tower.hp > targetTower.hp) {
          targetTower = tower;
        }
      }

      if (targetTower) {
        const targetWaypoint = nearestPathTileTo(targetTower.tileX, targetTower.tileY, gridLayout);
        if (targetWaypoint) {
          const signatureChanged = towerSignature !== memory.lastRoutedTowerSignature;
          const shouldEmit = newlySeenIds.length > 0 || signatureChanged;
          if (shouldEmit) {
            const routableIds = signatureChanged ? Array.from(seenIds).filter((id) => aliveIds.has(id)) : newlySeenIds;
            if (routableIds.length > 0) {
              commands.push({
                commandId: 0,
                type: "llm:routeGroup",
                enemyIds: routableIds,
                waypoints: [{ x: targetWaypoint.x, y: targetWaypoint.y }],
              });
            }
          }
        }
      }

      memory.lastRoutedTowerSignature = towerSignature;
      return commands;
    },
  };
}
