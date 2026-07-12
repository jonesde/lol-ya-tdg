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

  // Computes a route to `goal` that avoids the base interior: every base tile is
  // added to the blocked set (except `goal` itself, if it happens to be a base
  // tile) so BFS/Dijkstra hug the outside of the 3x3 and reach `goal` from its
  // outer side. Used to route perimeter enemies around the base to their assigned
  // dock instead of cutting through the interior to the nearest ring tile.
  computeSurroundRoute(start: Point, goal: Point): Point[] | null {
    const blocked = new Set(this.blocked);
    for (const baseTile of this.getBaseGoalTiles()) {
      if (baseTile.x === goal.x && baseTile.y === goal.y) continue;
      blocked.add(`${baseTile.x},${baseTile.y}`);
    }
    const openPath = bfsShortestPath(this, start, goal, blocked);
    if (openPath) return openPath;
    return dijkstraWeakestPath(
      this,
      start,
      goal,
      (tileX, tileY) => this.towerHealthAt(tileX, tileY),
      (tileX, tileY) => this.isGhostAt(tileX, tileY),
    );
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

  // Exposed base-edge segments in world coordinates: one 1-tile-wide axis-aligned
  // segment per base perimeter tile whose outward-adjacent tile is traversable (in
  // bounds and not terrain). Enemies can only reach the base across path/spawn tiles,
  // so the targetable edge is exactly this subset. This is the single source of truth
  // for both the red target-edge overlay and enemy attack-targeting (see Enemy.ts).
  getBaseEdgeSegments(): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    return this.getSquareEdgeSegments(this.base, 1.5 * this.tileSize);
  }

  // Exposed edge segments for a single tower tile, offset by the enemy radius (the
  // contact line enemies press toward when attacking a tower in the path). Only sides
  // whose outward-adjacent tile is traversable are included, mirroring
  // getBaseEdgeSegments so enemies never aim at a terrain-backed face.
  getTowerEdgeSegments(
    tileX: number,
    tileY: number,
    radius: number,
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const half = this.tileSize / 2;
    const tileCenter = this.tileToWorld(tileX, tileY);
    const sides = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ];
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const side of sides) {
      const outwardX = tileX + side.dx;
      const outwardY = tileY + side.dy;
      if (!this.inBounds(outwardX, outwardY)) continue;
      if (this.isTerrain(outwardX, outwardY)) continue;
      const offset = half + radius;
      if (side.dx !== 0) {
        const edgeX = tileCenter.x + side.dx * offset;
        const y1 = tileY * this.tileSize;
        const y2 = (tileY + 1) * this.tileSize;
        segments.push({ x1: edgeX, y1, x2: edgeX, y2 });
      } else {
        const edgeY = tileCenter.y + side.dy * offset;
        const x1 = tileX * this.tileSize;
        const x2 = (tileX + 1) * this.tileSize;
        segments.push({ x1, y1: edgeY, x2, y2: edgeY });
      }
    }
    return segments;
  }

  // Shared implementation for getBaseEdgeSegments: computes axis-aligned 1-tile edge
  // segments around a square centered at `centerTile` with the given half-extent,
  // including only sides whose outward-adjacent tile is traversable.
  private getSquareEdgeSegments(
    centerTile: { x: number; y: number },
    half: number,
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const center = this.tileToWorld(centerTile.x, centerTile.y);
    const sides = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ];
    const offsets = [-1, 0, 1];
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const side of sides) {
      for (const offset of offsets) {
        const tile =
          side.dx === 0
            ? { x: centerTile.x + offset, y: centerTile.y + side.dy }
            : { x: centerTile.x + side.dx, y: centerTile.y + offset };
        const outwardX = tile.x + side.dx;
        const outwardY = tile.y + side.dy;
        if (!this.inBounds(outwardX, outwardY)) continue;
        if (this.isTerrain(outwardX, outwardY)) continue;
        if (side.dx !== 0) {
          const edgeX = center.x + side.dx * half;
          const y1 = tile.y * this.tileSize;
          const y2 = (tile.y + 1) * this.tileSize;
          segments.push({ x1: edgeX, y1, x2: edgeX, y2 });
        } else {
          const edgeY = center.y + side.dy * half;
          const x1 = tile.x * this.tileSize;
          const x2 = (tile.x + 1) * this.tileSize;
          segments.push({ x1, y1: edgeY, x2, y2: edgeY });
        }
      }
    }
    return segments;
  }
}
