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

export function bfsShortestPath(
  grid: GridShape,
  start: Point,
  goal: Point | Point[],
  blocked: Set<string>,
): Point[] | null {
  const W = grid.width;
  const H = grid.height;
  const key = (x: number, y: number): string => `${x},${y}`;
  const goals = Array.isArray(goal) ? goal : [goal];
  const isGoalTile = (x: number, y: number): boolean => goals.some((g) => g.x === x && g.y === y);
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

  if (isGoalTile(start.x, start.y)) return [{ x: start.x, y: start.y }];

  while (head < queue.length) {
    const { x: centerX, y: centerY } = queue[head++]!;
    if (isGoalTile(centerX, centerY)) {
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
//
// Phase 2: tower tiles are traversable — the Dijkstra weakest-path fallback in
// `Grid.recomputePaths` routes enemies *through* towers (weighted by their remaining
// health), so placing a tower on a path tile can never disconnect spawns from the
// base. Path-tile placement is therefore always permitted. Non-path tiles keep the
// original reachability rejection unchanged.
export function canPlaceWithoutBlocking(
  grid: GridShape,
  spawns: Point[],
  base: Point,
  towerXY: Point,
  existingBlocked: Set<string>,
  cachedPathTiles?: Set<string>,
): boolean {
  if (grid.isPath(towerXY.x, towerXY.y)) return true;

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

interface HeapNode {
  key: string;
  x: number;
  y: number;
  dist: number;
  edgeWeight: number;
}

// Dijkstra weakest-path search used as a fallback when no open BFS route exists.
// Enemies route *through* tower tiles, so edges are weighted by the live tower's
// remaining health (weaker towers are cheaper to push through). Ghosted towers are
// free (weight 0); tiles with no tower are a small nominal weight (0.1).
//
// `towerHealthAt(x, y)` returns the live tower's remaining health (or `undefined`
// when no tower occupies the tile); `isGhostAt(x, y)` is true when a tower exists
// but is in the ghost (passable, harmless) state.
export function dijkstraWeakestPath(
  grid: GridShape,
  start: Point,
  goal: Point | Point[],
  towerHealthAt: (x: number, y: number) => number | undefined,
  isGhostAt: (x: number, y: number) => boolean,
): Point[] | null {
  const W = grid.width;
  const H = grid.height;
  const key = (x: number, y: number): string => `${x},${y}`;
  const goals = Array.isArray(goal) ? goal : [goal];
  const isGoalTile = (x: number, y: number): boolean => goals.some((g) => g.x === x && g.y === y);
  const dist = new Map<string, number>();
  const prev = new Map<string, Point | null>();
  const bestEdge = new Map<string, number>();
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const startKey = key(start.x, start.y);
  dist.set(startKey, 0);
  bestEdge.set(startKey, 0);
  prev.set(startKey, null);
  // Linear-scan min-heap keyed on (dist primary, edgeWeight secondary). Grid graphs
  // are small (~600 tiles), so an array PQ is sufficient; the tie-break on edgeWeight
  // means that among two equal-total-dist routes the path whose final edge crosses the
  // weaker tile is recorded first.
  const heap: HeapNode[] = [{ key: startKey, x: start.x, y: start.y, dist: 0, edgeWeight: 0 }];
  let reached: { x: number; y: number } | null = null;
  while (heap.length > 0) {
    let minIndex = 0;
    for (let i = 1; i < heap.length; i++) {
      if (
        heap[i]!.dist < heap[minIndex]!.dist ||
        (heap[i]!.dist === heap[minIndex]!.dist && heap[i]!.edgeWeight < heap[minIndex]!.edgeWeight)
      ) {
        minIndex = i;
      }
    }
    const current = heap.splice(minIndex, 1)[0]!;
    const curKey = current.key;
    if (isGoalTile(current.x, current.y)) {
      reached = { x: current.x, y: current.y };
      break;
    }
    const recorded = dist.get(curKey);
    if (recorded !== undefined && current.dist > recorded) continue;
    for (const [deltaX, deltaY] of dirs) {
      const neighborX = current.x + deltaX;
      const neighborY = current.y + deltaY;
      if (neighborX < 0 || neighborY < 0 || neighborX >= W || neighborY >= H) continue;
      if (
        !grid.isPath(neighborX, neighborY) &&
        !grid.isBase(neighborX, neighborY) &&
        !grid.isSpawn(neighborX, neighborY)
      ) {
        continue;
      }
      const edgeWeight = isGhostAt(neighborX, neighborY) ? 0 : (towerHealthAt(neighborX, neighborY) ?? 0.1);
      const neighborDist = current.dist + edgeWeight;
      const neighborKey = key(neighborX, neighborY);
      const existing = dist.get(neighborKey);
      if (
        existing === undefined ||
        neighborDist < existing ||
        (neighborDist === existing && edgeWeight < (bestEdge.get(neighborKey) ?? Infinity))
      ) {
        dist.set(neighborKey, neighborDist);
        bestEdge.set(neighborKey, edgeWeight);
        prev.set(neighborKey, { x: current.x, y: current.y });
        heap.push({ key: neighborKey, x: neighborX, y: neighborY, dist: neighborDist, edgeWeight });
      }
    }
  }
  if (!reached) return null;
  const path: Point[] = [];
  let cur: Point | null = reached;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(key(cur.x, cur.y)) ?? null;
  }
  return path;
}
