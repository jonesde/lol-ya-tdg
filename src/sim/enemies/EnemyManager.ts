import { ENEMY_POOL_SIZE } from "@/render/svg/types.js";
import type { EnemyVisualMeta, MapThemeData } from "@/render/themes/index.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { AttackTarget, BaseSlot } from "./Enemy.js";
import { Enemy, resetEnemyId } from "./Enemy.js";

interface PendingEnemyEntry {
  type: string;
  level: number;
  wave: number;
}

// How far outward (in tiles) enemies may line up from an exposed base edge before
// the formation is treated as full for that dock.
const MAX_PERIMETER_RADIAL = 4;

// One exposed outer edge-segment of the 3x3 base. `baseTile` is the base tile
// whose outer face is the dock; `outwardNormal` points away from the base center
// to the traversable tile just outside it.
interface BaseDock {
  dockIndex: number;
  baseTile: { x: number; y: number };
  outwardNormal: { dx: number; dy: number };
}

// Smallest absolute angle between two directions, in [0, PI].
function angularDistance(a: number, b: number): number {
  let delta = Math.abs(a - b) % (2 * Math.PI);
  if (delta > Math.PI) delta = 2 * Math.PI - delta;
  return delta;
}

const SpatialCellSize = 100;

// Spatial-hash cell coordinates can be negative (enemies can briefly leave the
// map bounds during collision separation). Offset each coordinate by a power of
// two well beyond any map's cell range so the packed key stays a positive
// integer, and use a stride of 2*offset so every (cellX, cellY) pair maps to a
// unique key. Map cell coords top out around a few dozen, far below 1<<16.
const SPATIAL_AXIS_OFFSET = 1 << 16;
function spatialCellKey(cellX: number, cellY: number): number {
  return (cellX + SPATIAL_AXIS_OFFSET) * (2 * SPATIAL_AXIS_OFFSET) + (cellY + SPATIAL_AXIS_OFFSET);
}

export class EnemyManager {
  grid: Grid;
  particles: ParticleSpawner;
  enemies: Enemy[];
  difficultyTick: number;
  theme: MapThemeData | null;
  defaultEnemyVisuals: Record<string, EnemyVisualMeta>;
  towerManager: TowerManager | null = null;
  baseTarget: AttackTarget | null = null;
  private spatialHash: Map<number, Enemy[]>;
  private idToEnemy: Map<number, Enemy>;
  private pendingQueues: Map<number, PendingEnemyEntry[]>;
  // Count of enemies occupying each perimeter slot, keyed by `${dockIndex},${radial}`.
  // Decremented as enemies die so new spawns load-balance onto the least-occupied dock.
  private perimeterOccupancy: Map<string, number>;

  constructor(
    grid: Grid,
    particles: ParticleSpawner,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {},
  ) {
    this.grid = grid;
    this.particles = particles;
    this.enemies = [];
    this.difficultyTick = difficultyTick;
    this.theme = theme;
    this.defaultEnemyVisuals = defaultEnemyVisuals;
    this.spatialHash = new Map();
    this.idToEnemy = new Map();
    this.pendingQueues = new Map();
    this.perimeterOccupancy = new Map();
  }

  // Phase 1.5 plumbing: lets enemies resolve the tower (if any) on a tile. The
  // Engine wires the live TowerManager here after both managers are constructed.
  setTowerManager(towerManager: TowerManager | null): void {
    this.towerManager = towerManager;
  }

  towerAt(tileX: number, tileY: number): Tower | null {
    return this.towerManager?.towerAt(tileX, tileY) ?? null;
  }

  clear(): void {
    this.enemies = [];
    this.spatialHash.clear();
    this.idToEnemy.clear();
    this.pendingQueues.clear();
    this.perimeterOccupancy.clear();
    resetEnemyId();
  }

  spawn(type: string, level: number, spawnIndex: number, wave: number): Enemy | null {
    const enemy = new Enemy(
      type,
      level,
      spawnIndex,
      this.grid,
      wave,
      this.difficultyTick,
      this.theme,
      this.defaultEnemyVisuals[type] ?? null,
      this.baseTarget,
    );
    if (!enemy.path) {
      return null;
    }
    this.assignPerimeterSlot(enemy);
    this.enemies.push(enemy);
    this.idToEnemy.set(enemy.id, enemy);
    this.addToSpatialHash(enemy);
    return enemy;
  }

  enqueueOrSpawn(type: string, level: number, spawnIndex: number, wave: number): void {
    if (this.enemies.length < ENEMY_POOL_SIZE) {
      this.spawn(type, level, spawnIndex, wave);
      return;
    }
    if (!this.pendingQueues.has(spawnIndex)) {
      this.pendingQueues.set(spawnIndex, []);
    }
    this.pendingQueues.get(spawnIndex)!.push({ type, level, wave });
  }

  releaseOnePending(spawnIndex: number): void {
    const queue = this.pendingQueues.get(spawnIndex);
    if (!queue || queue.length === 0) return;
    if (this.enemies.length >= ENEMY_POOL_SIZE) return;
    const entry = queue.shift()!;
    this.spawn(entry.type, entry.level, spawnIndex, entry.wave);
  }

  // Returns the exposed outer edge-segments of the 3x3 base. A segment is exposed
  // only when its outward-adjacent tile is in bounds and not terrain (i.e. not a
  // terrain tile or the map edge), so enemies can stand on the tile just outside it.
  // The 3x3 yields up to 12 segments (3 per cardinal side); corner base tiles
  // contribute one segment per adjacent side, giving the formation room to spread to
  // both sides as a side fills.
  getBaseDocks(): BaseDock[] {
    const base = this.grid.getBase();
    const sides: { dx: number; dy: number }[] = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
    ];
    const offsets = [-1, 0, 1];
    const docks: BaseDock[] = [];
    for (const side of sides) {
      for (const offset of offsets) {
        const baseTile =
          side.dx === 0 ? { x: base.x + offset, y: base.y + side.dy } : { x: base.x + side.dx, y: base.y + offset };
        const outwardX = baseTile.x + side.dx;
        const outwardY = baseTile.y + side.dy;
        if (!this.grid.inBounds(outwardX, outwardY)) continue;
        if (this.grid.isTerrain(outwardX, outwardY)) continue;
        docks.push({ dockIndex: docks.length, baseTile, outwardNormal: side });
      }
    }
    return docks;
  }

  // Assigns the enemy to the least-occupied perimeter slot (load-balanced) and routes
  // it around the base to that slot's outside dock tile. Enemies fill inward rings
  // first (radial, "moving out one tile at a time") and spread laterally to both
  // sides as each dock saturates, nearest the spawn-facing side first. Capacity per
  // dock/radial slot is the count of enemies that fit along one tile edge using the
  // enemy's own configured radius (consistent with collision overlap math). Falls back
  // to the shared grid path (the enemy's constructor default) when no slot is free or
  // reachable.
  assignPerimeterSlot(enemy: Enemy): void {
    if (!enemy.path) return;
    const docks = this.getBaseDocks();
    if (docks.length === 0) return;

    const base = this.grid.getBase();
    const baseCenter = this.grid.tileToWorld(base.x, base.y);
    const spawn = this.grid.spawns[enemy.spawnIndex] ?? this.grid.spawns[0]!;
    const spawnWorld = this.grid.tileToWorld(spawn.x, spawn.y);
    const spawnFacingAngle = Math.atan2(spawnWorld.y - baseCenter.y, spawnWorld.x - baseCenter.x);

    const capacity = this.perimeterCapacityFor(enemy);
    let best: { dock: BaseDock; radial: number; score: number } | null = null;
    for (const dock of docks) {
      const dockAngle = Math.atan2(dock.outwardNormal.dy, dock.outwardNormal.dx);
      const angular = angularDistance(dockAngle, spawnFacingAngle);
      for (let radial = 0; radial <= MAX_PERIMETER_RADIAL; radial++) {
        const targetTile = {
          x: dock.baseTile.x + dock.outwardNormal.dx * (radial + 1),
          y: dock.baseTile.y + dock.outwardNormal.dy * (radial + 1),
        };
        const targetKey = `${targetTile.x},${targetTile.y}`;
        if (!this.grid.inBounds(targetTile.x, targetTile.y)) continue;
        if (this.grid.isTerrain(targetTile.x, targetTile.y)) continue;
        if (this.grid.blocked.has(targetKey)) continue;
        const occupancyCount = this.perimeterOccupancy.get(`${dock.dockIndex},${radial}`) ?? 0;
        if (occupancyCount >= capacity) continue;
        // Load-balanced primary; radial (fill inward first) secondary; angular spread to
        // both sides (nearest the spawn-facing side) tertiary; dock index final tiebreak.
        const score = occupancyCount * 1e9 + radial * 1e6 + angular * 1e3 + dock.dockIndex;
        if (!best || score < best.score) best = { dock, radial, score };
      }
    }
    if (!best) return;

    const slotTile = {
      x: best.dock.baseTile.x + best.dock.outwardNormal.dx * (best.radial + 1),
      y: best.dock.baseTile.y + best.dock.outwardNormal.dy * (best.radial + 1),
    };
    const surroundRoute = this.grid.computeSurroundRoute(enemy.currentTile(), slotTile);
    if (!surroundRoute) return;

    const slotKey = `${best.dock.dockIndex},${best.radial}`;
    this.perimeterOccupancy.set(slotKey, (this.perimeterOccupancy.get(slotKey) ?? 0) + 1);
    const slot: BaseSlot = { dockIndex: best.dock.dockIndex, radial: best.radial, targetTile: slotTile };
    enemy.setSurroundPath(surroundRoute, slot);
  }

  // How many enemies fit along one tile edge for this enemy: the count whose
  // diameters (2*radius, consistent with collision overlap math) tile the edge.
  private perimeterCapacityFor(enemy: Enemy): number {
    return Math.max(1, Math.floor(this.grid.tileSize / (2 * enemy.radius)));
  }

  // When a front-row (radial 0) enemy dies and frees its slot, held back-row
  // (radial > 0) enemies collapse forward into the opened slot rather than
  // lingering out of reach. Re-runs load-balanced assignment for every back-row
  // enemy (closest to the front first) after clearing their old occupancy, so each
  // takes the lowest free slot — "moving out one tile at a time" becomes
  // "collapse inward when space opens." No-op when nothing is parked outward.
  private compactPerimeterSlots(): void {
    const backRows = this.enemies.filter((enemy) => enemy.baseSlot && enemy.baseSlot.radial > 0);
    if (backRows.length === 0) return;
    for (const enemy of backRows) {
      const slotKey = `${enemy.baseSlot!.dockIndex},${enemy.baseSlot!.radial}`;
      const occupancy = this.perimeterOccupancy.get(slotKey) ?? 0;
      if (occupancy <= 1) this.perimeterOccupancy.delete(slotKey);
      else this.perimeterOccupancy.set(slotKey, occupancy - 1);
      enemy.baseSlot = null;
    }
    backRows.sort((a, b) => (a.baseSlot?.radial ?? 0) - (b.baseSlot?.radial ?? 0) || a.id - b.id);
    for (const enemy of backRows) {
      this.assignPerimeterSlot(enemy);
    }
  }

  removeDeadEnemy(i: number): void {
    const enemy = this.enemies[i]!;
    this.particles.spawn(enemy.x, enemy.y, enemy.color, 12, { speed: 80, life: 0.5 });
    if (enemy.baseSlot) {
      const slotKey = `${enemy.baseSlot.dockIndex},${enemy.baseSlot.radial}`;
      const occupancy = this.perimeterOccupancy.get(slotKey) ?? 0;
      if (occupancy <= 1) this.perimeterOccupancy.delete(slotKey);
      else this.perimeterOccupancy.set(slotKey, occupancy - 1);
    }
    this.removeFromSpatialHash(enemy);
    this.idToEnemy.delete(enemy.id);
    const removedSpawnIndex = enemy.spawnIndex;
    this.enemies.splice(i, 1);
    this.compactPerimeterSlots();
    this.releaseOnePending(removedSpawnIndex);
  }

  hasPendingEnemies(): boolean {
    for (const queue of this.pendingQueues.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  getPendingCountForSpawn(spawnIndex: number): number {
    const queue = this.pendingQueues.get(spawnIndex);
    return queue ? queue.length : 0;
  }

  getActiveEnemyCountForSpawn(spawnIndex: number): number {
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.spawnIndex === spawnIndex) count++;
    }
    return count;
  }

  update(
    dt: number,
    onEnemyKill: ((enemy: Enemy) => void) | null,
    onEnemyBeginAttackBase?: ((enemy: Enemy) => void) | null,
  ): void {
    // Guards against the kill callback firing more than once for a single enemy
    // (e.g. if an enemy is already terminal at loop entry and the loop is later
    // refactored to not `continue`). The callback must run at most once per enemy.
    const handledEnemyIds = new Set<number>();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
        this.removeDeadEnemy(i);
        continue;
      }
      const wasAttackingBase = enemy.attackingBase;
      enemy.update(dt, this);
      if (enemy.removed) {
        if (onEnemyKill && !handledEnemyIds.has(enemy.id)) {
          onEnemyKill(enemy);
          handledEnemyIds.add(enemy.id);
        }
        this.removeDeadEnemy(i);
        continue;
      }
      if (!wasAttackingBase && enemy.attackingBase) {
        onEnemyBeginAttackBase?.(enemy);
      }
    }
    this.updateSpatialHash();
  }

  rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const cellX = Math.floor(enemy.x / SpatialCellSize);
      const cellY = Math.floor(enemy.y / SpatialCellSize);
      const cellKey = spatialCellKey(cellX, cellY);
      const bucket = this.spatialHash.get(cellKey);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.spatialHash.set(cellKey, [enemy]);
      }
    }
  }

  addToSpatialHash(enemy: Enemy): void {
    const cellX = Math.floor(enemy.x / SpatialCellSize);
    const cellY = Math.floor(enemy.y / SpatialCellSize);
    const cellKey = spatialCellKey(cellX, cellY);
    const bucket = this.spatialHash.get(cellKey);
    if (bucket) {
      bucket.push(enemy);
    } else {
      this.spatialHash.set(cellKey, [enemy]);
    }
    enemy.lastCellX = cellX;
    enemy.lastCellY = cellY;
  }

  removeFromSpatialHash(enemy: Enemy): void {
    const cellKey = spatialCellKey(enemy.lastCellX, enemy.lastCellY);
    const bucket = this.spatialHash.get(cellKey);
    if (!bucket) return;
    const index = bucket.indexOf(enemy);
    if (index !== -1) bucket.splice(index, 1);
    if (bucket.length === 0) this.spatialHash.delete(cellKey);
  }

  updateSpatialHash(): void {
    for (const enemy of this.enemies) {
      const currentCellX = Math.floor(enemy.x / SpatialCellSize);
      const currentCellY = Math.floor(enemy.y / SpatialCellSize);
      if (currentCellX === enemy.lastCellX && currentCellY === enemy.lastCellY) continue;
      this.removeFromSpatialHash(enemy);
      const cellKey = spatialCellKey(currentCellX, currentCellY);
      const bucket = this.spatialHash.get(cellKey);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.spatialHash.set(cellKey, [enemy]);
      }
      enemy.lastCellX = currentCellX;
      enemy.lastCellY = currentCellY;
    }
  }

  // Allocation-free range query. Iterates the same buckets and applies the same
  // distance filter as getEnemiesInRange, but invokes `cb` per surviving enemy
  // instead of building a result array — eliminating per-call array allocation
  // (and the GC churn it causes under heavy waves / lightning usage).
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void {
    const rangeSquared = range * range;
    const cellRadius = Math.ceil(range / SpatialCellSize);
    const centerCellX = Math.floor(x / SpatialCellSize);
    const centerCellY = Math.floor(y / SpatialCellSize);

    for (let cellX = centerCellX - cellRadius; cellX <= centerCellX + cellRadius; cellX++) {
      for (let cellY = centerCellY - cellRadius; cellY <= centerCellY + cellRadius; cellY++) {
        const bucket = this.spatialHash.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const enemy of bucket) {
          if (enemy.removed) continue;
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) cb(enemy);
        }
      }
    }
  }

  getEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const rangeSquared = range * range;
    const cellRadius = Math.ceil(range / SpatialCellSize);
    const centerCellX = Math.floor(x / SpatialCellSize);
    const centerCellY = Math.floor(y / SpatialCellSize);
    const result: Enemy[] = [];

    for (let cellX = centerCellX - cellRadius; cellX <= centerCellX + cellRadius; cellX++) {
      for (let cellY = centerCellY - cellRadius; cellY <= centerCellY + cellRadius; cellY++) {
        const bucket = this.spatialHash.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const enemy of bucket) {
          if (enemy.removed) continue;
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) {
            result.push(enemy);
          }
        }
      }
    }
    return result;
  }

  getEnemyById(id: number): Enemy | null {
    return this.idToEnemy.get(id) || null;
  }
}
