import { bfsShortestPath, canPlaceWithoutBlocking } from "./Pathfinding.js";

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
  paths: (Point[] | null)[] = [];
  pathCache: Point[] | null = null;
  regionId: number = 0;
  private _blockCount: number = 0;

  constructor(map: MapData) {
    this.width = map.width;
    this.height = map.height;
    this.tileSize = 36;
    this.tiles = map.tiles as Tile[][];
    this.spawns = map.spawns as Point[];
    this.base = map.base as Point;
    this.blocked = new Set();
    this.terrainTowers = new Set();
    this.pathCache = null;
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
    return this.tiles[y]![x]!.height;
  }

  canBuild(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "base") return false;
    if (tileType.type === "terrain") return !this.terrainTowers.has(`${x},${y}`);
    if (tileType.type === "path") {
      if (this.blocked.has(`${x},${y}`)) return false;
      return canPlaceWithoutBlocking(this, this.spawns, this.base, { x, y }, this.blocked);
    }
    if (tileType.type === "spawn") return false;
    return false;
  }

  registerTower(x: number, y: number): boolean {
    const tileType = this.tiles[y]![x]!;
    if (tileType.type === "path") {
      const towerKey = `${x},${y}`;
      if (this.blocked.has(towerKey)) return false;
      this.blocked.add(towerKey);
      this._blockCount++;
      this.recomputePathsForTile(x, y, true);
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
      if (!this.blocked.has(towerKey)) return false;
      this.blocked.delete(towerKey);
      this._blockCount--;
      this.recomputePathsForTile(x, y, false);
      return true;
    } else {
      const towerKey = `${x},${y}`;
      if (!this.terrainTowers.has(towerKey)) return false;
      this.terrainTowers.delete(towerKey);
      return true;
    }
  }

  recomputePathsForTile(x: number, y: number, isBlocking: boolean) {
    if (isBlocking) {
      if (!this.paths) return;
      for (let i = 0; i < this.paths.length; i++) {
        const path = this.paths[i];
        if (path?.some((p) => p.x === x && p.y === y)) {
          this.paths[i] = bfsShortestPath(this, this.spawns[i]!, this.base, this.blocked);
        }
      }
    }
    this.pathCache = this.paths?.[0] || null;
  }

  recomputePaths() {
    this.paths = [];
    for (const spawn of this.spawns) {
      const path = bfsShortestPath(this, spawn, this.base, this.blocked);
      this.paths.push(path);
    }
    this.pathCache = this.paths[0] ?? null;
  }

  getPathFor(spawnIndex: number): Point[] | null {
    const paths = this.paths;
    return paths && spawnIndex >= 0 && spawnIndex < paths.length ? (paths[spawnIndex] ?? null) : null;
  }

  worldToTile(wx: number, wy: number): Point {
    return { x: Math.floor(wx / this.tileSize), y: Math.floor(wy / this.tileSize) };
  }

  tileToWorld(tx: number, ty: number): Point {
    return { x: tx * this.tileSize + this.tileSize / 2, y: ty * this.tileSize + this.tileSize / 2 };
  }
}
