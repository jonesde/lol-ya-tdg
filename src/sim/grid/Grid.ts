import { bfsShortestPath, canPlaceWithoutBlocking, dijkstraWeakestPath } from "./Pathfinding.js";

// Minimal structural view of a tower needed by the weakest-path routing fallback.
// `TowerManager.towerAt` is adapted to this shape when it is wired into the grid.
export interface TowerLookup {
  towerAt(x: number, y: number): { health: number; isGhost: boolean } | null;
}

interface Tile {
  type: "terrain" | "path" | "base" | "spawn";
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface MapData {
  regionId?: number;
  level?: number;
  bossCadence?: number;
  width: number;
  height: number;
  tiles: unknown[][];
  spawns: { x: number; y: number }[];
  base: { x: number; y: number };
}

export class Grid {
  width: number;
  height: number;
  tileSize: number;
  tiles: Tile[][];
  spawns: Point[];
  base: Point;
  blocked: Set<string>;
  terrainTowers: Set<string>;
  ghostTowers: Set<string>;
  paths: (Point[] | null)[] = [];
  regionId: number = 0;
  // Bumped on every path recompute so enemies can cheaply detect when their cached
  // path has changed (tower added/removed, ghosted, or restored) and re-anchor.
  pathVersion: number = 0;
  // Optional lookup used by the weakest-path Dijkstra fallback to weight edges by
  // live tower health. Wired by the GameEngine after both managers are constructed.
  towerLookup: TowerLookup | null = null;
  private _blockCount: number = 0;
  private _cachedPathTiles: Set<string> | null = null;

  towerHealthAt(x: number, y: number): number | undefined {
    return this.towerLookup?.towerAt(x, y)?.health;
  }

  isGhostAt(x: number, y: number): boolean {
    return this.towerLookup?.towerAt(x, y)?.isGhost ?? false;
  }

  constructor(map: MapData) {
    this.width = map.width;
    this.height = map.height;
    this.tileSize = 36;
    this.tiles = map.tiles as Tile[][];
    this.spawns = map.spawns as Point[];
    this.base = map.base as Point;
    this.blocked = new Set();
    this.terrainTowers = new Set();
    this.ghostTowers = new Set();
    this.regionId = map.regionId ?? 0;
    this.recomputePaths();
  }

  get blockCount(): number {
    return this._blockCount;
  }

  isPath(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "path";
  }

  isTerrain(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "terrain";
  }

  isBase(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "base";
  }

  isSpawn(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y]![x]!.type === "spawn";
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getHeight(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.tiles[y]![x]!.height;
  }

  canBuild(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "base") return false;
    if (tileType.type === "terrain") return !this.terrainTowers.has(`${x},${y}`);
    if (tileType.type === "path") {
      if (this.blocked.has(`${x},${y}`)) return false;
      if (this.ghostTowers.has(`${x},${y}`)) return false;
      const cachedPathTiles = this.paths.length > 0 ? this.buildCachedPathTiles() : undefined;
      return canPlaceWithoutBlocking(this, this.spawns, this.base, { x, y }, this.blocked, cachedPathTiles);
    }
    if (tileType.type === "spawn") return false;
    return false;
  }

  buildCachedPathTiles(): Set<string> {
    if (this._cachedPathTiles !== null) return this._cachedPathTiles;
    const pathTiles = new Set<string>();
    for (const path of this.paths) {
      if (path) {
        for (const tile of path) {
          pathTiles.add(`${tile.x},${tile.y}`);
        }
      }
    }
    this._cachedPathTiles = pathTiles;
    return pathTiles;
  }

  registerTower(x: number, y: number): boolean {
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "path") {
      const towerKey = `${x},${y}`;
      if (this.blocked.has(towerKey)) return false;
      this.blocked.add(towerKey);
      this._blockCount++;
      this.recomputePathsForTile(x, y);
      return true;
    } else {
      const towerKey = `${x},${y}`;
      if (this.terrainTowers.has(towerKey)) return false;
      this.terrainTowers.add(towerKey);
      return true;
    }
  }

  unregisterTower(x: number, y: number): boolean {
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "path") {
      const towerKey = `${x},${y}`;
      // The tower may be live (in `blocked`) or already destroyed/ghosted (in
      // `ghostTowers`); resolve from whichever holds it so a ghosted tower can
      // still be sold/unregistered instead of leaking forever.
      if (!this.blocked.has(towerKey) && !this.ghostTowers.has(towerKey)) return false;
      this.blocked.delete(towerKey);
      this.ghostTowers.delete(towerKey);
      this._blockCount--;
      this.recomputePaths();
      return true;
    } else {
      const towerKey = `${x},${y}`;
      if (!this.terrainTowers.has(towerKey)) return false;
      this.terrainTowers.delete(towerKey);
      return true;
    }
  }

  // A path-tile tower that has been destroyed becomes a ghost: it no longer
  // blocks routing, so the key moves from `blocked` to `ghostTowers` and paths
  // are recomputed so enemies may route through the (now passable) tile.
  setTowerGhost(x: number, y: number): void {
    const towerKey = `${x},${y}`;
    this.blocked.delete(towerKey);
    this.ghostTowers.add(towerKey);
    this._blockCount--;
    this.recomputePaths();
  }

  // A ghosted tower is restored to a live (blocking) state: the key moves back
  // into `blocked` and paths are recomputed.
  clearTowerGhost(x: number, y: number): void {
    const towerKey = `${x},${y}`;
    this.ghostTowers.delete(towerKey);
    this.blocked.add(towerKey);
    this._blockCount++;
    this.recomputePaths();
  }

  // Bulk restore of every ghosted tower, recomputing paths exactly once. Used by
  // the wave-start bulk restore so N ghost towers do not trigger N recomputes.
  batchClearGhosts(): void {
    if (this.ghostTowers.size === 0) return;
    for (const key of this.ghostTowers) {
      this.blocked.add(key);
    }
    this._blockCount += this.ghostTowers.size;
    this.ghostTowers.clear();
    this.recomputePaths();
  }

  recomputePathsForTile(x: number, y: number) {
    for (let i = 0; i < this.paths.length; i++) {
      const path = this.paths[i];
      if (path?.some((p) => p.x === x && p.y === y)) {
        const openPath = bfsShortestPath(this, this.spawns[i]!, this.getBaseGoalTiles(), this.blocked);
        this.paths[i] =
          openPath ??
          dijkstraWeakestPath(
            this,
            this.spawns[i]!,
            this.getBaseGoalTiles(),
            (tileX, tileY) => this.towerHealthAt(tileX, tileY),
            (tileX, tileY) => this.isGhostAt(tileX, tileY),
          );
      }
    }
    this._cachedPathTiles = null;
    this.pathVersion++;
  }

  recomputePaths() {
    this.paths = [];
    this._cachedPathTiles = null;
    this.pathVersion++;
    for (const spawn of this.spawns) {
      const openPath = bfsShortestPath(this, spawn, this.getBaseGoalTiles(), this.blocked);
      if (openPath) {
        this.paths.push(openPath);
      } else {
        // No open route: fall back to the weakest-path Dijkstra search, which routes
        // enemies *through* live towers (weighted by remaining health) and treats
        // ghosted tiles as free. The returned path may include tower tiles; enemies
        // decide whether to walk through (ghost/none) or attack (live) per the Enemy.
        this.paths.push(
          dijkstraWeakestPath(
            this,
            spawn,
            this.getBaseGoalTiles(),
            (tileX, tileY) => this.towerHealthAt(tileX, tileY),
            (tileX, tileY) => this.isGhostAt(tileX, tileY),
          ),
        );
      }
    }
  }

  getPathFor(spawnIndex: number): Point[] | null {
    const paths = this.paths;
    return paths && spawnIndex >= 0 && spawnIndex < paths.length ? (paths[spawnIndex] ?? null) : null;
  }

  // Computes a route from `start` to `goal` (defaulting to the base), mirroring
  // recomputePaths' routing policy: prefer the open BFS path, falling back to the
  // weakest-path Dijkstra search (which routes *through* live towers) when no open
  // route exists. Used by the enemy-commander `applyCommand` leg chains so a custom
  // route honors the same tower-crossing behavior as the default grid path.
  computeRoute(start: Point, goal: Point | Point[] = this.base): Point[] | null {
    const openPath = bfsShortestPath(this, start, goal, this.blocked);
    if (openPath) return openPath;
    return dijkstraWeakestPath(
      this,
      start,
      goal,
      (tileX, tileY) => this.towerHealthAt(tileX, tileY),
      (tileX, tileY) => this.isGhostAt(tileX, tileY),
    );
  }

  computeRouteToBase(start: Point): Point[] | null {
    return this.computeRoute(start, this.base);
  }

  worldToTile(wx: number, wy: number): Point {
    return { x: Math.floor(wx / this.tileSize), y: Math.floor(wy / this.tileSize) };
  }

  tileToWorld(tx: number, ty: number): Point {
    return { x: tx * this.tileSize + this.tileSize / 2, y: ty * this.tileSize + this.tileSize / 2 };
  }

  getBase(): Point {
    return this.base;
  }

  getBaseGoalTiles(): Point[] {
    const { x, y } = this.base;
    const goalTiles: Point[] = [{ x, y }];
    const ring = [
      { x: x - 1, y: y - 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x: x - 1, y: y + 1 },
      { x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ];
    for (const tile of ring) {
      if (this.inBounds(tile.x, tile.y)) goalTiles.push(tile);
    }
    return goalTiles;
  }
}
