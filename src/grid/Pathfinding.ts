// BFS shortest path on grid with dynamic tower obstacles.
// Ensures a valid path from each spawn to the base always exists.

export interface Point {
  x: number;
  y: number;
}

export interface GridShape {
  width: number;
  height: number;
  isPath(x: number, y: number): boolean;
  isBase(x: number, y: number): boolean;
  isSpawn(x: number, y: number): boolean;
}

export function bfsShortestPath(grid: GridShape, start: Point, goal: Point, blocked: Set<string>): Point[] | null {
  const W = grid.width;
  const H = grid.height;
  const key = (x: number, y: number): string => `${x},${y}`;
  const queue: Point[] = [{ x: start.x, y: start.y }];
  // Map keys are "x,y" strings, values are structured {x,y} parent references (or null for start)
  const prev = new Map<string, Point | null>();
  prev.set(key(start.x, start.y), null);
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let head = 0;

  while (head < queue.length) {
    const { x: centerX, y: centerY } = queue[head++]!;
    if (centerX === goal.x && centerY === goal.y) {
      // reconstruct path by following structured parent references
      const path: Point[] = [];
      let cur: Point | null = { x: centerX, y: centerY };
      while (cur) {
        path.unshift(cur);
        cur = prev.get(key(cur.x, cur.y)) ?? null;
      }
      return path;
    }
    for (const [deltaX, deltaY] of dirs) {
      const neighborX = centerX + deltaX;
      const neighborY = centerY + deltaY;
      if (neighborX < 0 || neighborY < 0 || neighborX >= W || neighborY >= H) continue;
      const nodeKey = key(neighborX, neighborY);
      if (prev.has(nodeKey)) continue;
      if (
        !grid.isPath(neighborX, neighborY) &&
        !grid.isBase(neighborX, neighborY) &&
        !grid.isSpawn(neighborX, neighborY)
      ) {
        continue;
      }
      if (blocked.has(nodeKey)) continue;
      prev.set(nodeKey, { x: centerX, y: centerY });
      queue.push({ x: neighborX, y: neighborY });
    }
  }
  return null;
}

// Single BFS from base outward. Returns the set of reachable tile keys.
// Stops early once all spawns have been discovered.
function bfsReverseFromBase(grid: GridShape, base: Point, spawns: Point[], blocked: Set<string>): Set<string> {
  const W = grid.width;
  const H = grid.height;
  const key = (x: number, y: number): string => `${x},${y}`;
  const queue: Point[] = [{ x: base.x, y: base.y }];
  const visited = new Set<string>();
  visited.add(key(base.x, base.y));
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let spawnsFound = 0;
  const totalSpawns = spawns.length;
  // Pre-check if base tile coincides with a spawn
  for (const spawn of spawns) {
    if (spawn.x === base.x && spawn.y === base.y) spawnsFound++;
  }
  let head = 0;

  while (head < queue.length) {
    if (spawnsFound >= totalSpawns) break;
    const { x: centerX, y: centerY } = queue[head++]!;
    for (const [deltaX, deltaY] of dirs) {
      const neighborX = centerX + deltaX;
      const neighborY = centerY + deltaY;
      if (neighborX < 0 || neighborY < 0 || neighborX >= W || neighborY >= H) continue;
      const nodeKey = key(neighborX, neighborY);
      if (visited.has(nodeKey)) continue;
      if (blocked.has(nodeKey)) continue;
      if (
        !grid.isPath(neighborX, neighborY) &&
        !grid.isBase(neighborX, neighborY) &&
        !grid.isSpawn(neighborX, neighborY)
      ) {
        continue;
      }
      visited.add(nodeKey);
      queue.push({ x: neighborX, y: neighborY });
      // Check if this neighbor is a spawn
      for (const spawn of spawns) {
        if (spawn.x === neighborX && spawn.y === neighborY) {
          spawnsFound++;
          break;
        }
      }
    }
  }
  return visited;
}

// Check whether placing a tower at (x,y) would still leave all spawns able to reach base.
// cachedPathTiles (optional): set of tile keys on any currently-cached path.
//   If the tower tile is not on any cached path, blocks it cannot disconnect anything — O(1) early-out.
export function canPlaceWithoutBlocking(
  grid: GridShape,
  spawns: Point[],
  base: Point,
  towerXY: Point,
  existingBlocked: Set<string>,
  cachedPathTiles?: Set<string>,
): boolean {
  const towerKey = `${towerXY.x},${towerXY.y}`;
  // Fast path: if the tile is not on any cached path, blocking it can't disconnect anything
  if (cachedPathTiles !== undefined && !cachedPathTiles.has(towerKey)) return true;

  const test = new Set(existingBlocked);
  test.add(towerKey);
  const reachable = bfsReverseFromBase(grid, base, spawns, test);
  for (const spawn of spawns) {
    if (!reachable.has(`${spawn.x},${spawn.y}`)) return false;
  }
  return true;
}
