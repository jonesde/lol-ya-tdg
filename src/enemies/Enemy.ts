import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import type { Tower } from "@/towers/Tower.js";
import { DIFFICULTY_MULT_TICK } from "../game/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "../game/ConstantsEnemy.js";

let nextId = 1;

export function resetEnemyId() {
  nextId = 1;
}

interface SlowEntry {
  eff: number;
  remaining: number;
}

interface EnemyMetaRef {
  baseHp: number;
  speed: number;
  bounty: number;
  radius: number;
  walking: unknown;
  hitReaction: unknown;
  resist?: number;
  slowResist?: number;
  shield?: number;
  heal?: number;
  healRange?: number;
  attackDamage: number;
  attackSpeed: number;
}

interface GridRef {
  tileSize: number;
  getPathFor(spawnIndex: number): { x: number; y: number }[] | null;
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  getBase(): { x: number; y: number };
  blocked: Set<string>;
  pathVersion: number;
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
  towerAt(x: number, y: number): Tower | null;
}

export class Enemy {
  id: number;
  type: string;
  level: number;
  meta: EnemyMetaRef;
  maxHp: number;
  hp: number;
  speed: number;
  bounty: number;
  color: string;
  radius: number;
  shape: unknown;
  walking: MapThemeAnimation | null;
  hitReaction: MapThemeAnimation | null;
  visualMeta: EnemyVisualMeta | null;
  theme: MapThemeData | null;
  resist: number;
  slowResist: number;
  shield: number;
  maxShield: number;
  heal: number;
  healRange: number;
  spawnIndex: number;
  grid: GridRef;
  path: { x: number; y: number }[] | null;
  pathIdx: number;
  x!: number;
  y!: number;
  worldPos!: { x: number; y: number };
  // Path centerline position (Phase 4). x/y are derived from centerline + the
  // perpendicular laneOffset each frame; centerX/centerY are the only state the
  // forward-step logic advances, so collisions never move the centerline.
  centerX: number = 0;
  centerY: number = 0;
  laneOffset: number = 0;
  slowFactor!: number;
  slowStack!: SlowEntry[];
  stunTimer!: number;
  reachedBase!: boolean;
  removed!: boolean;
  burnTimer!: number;
  burnDps!: number;
  hitAnimTime!: number;
  _gameSeconds: number = 0;

  get gameSeconds(): number {
    return this._gameSeconds;
  }
  onPathBlocked!: boolean;
  moveAngle!: number;
  // Tower the enemy is currently attacking/blocked by (live, non-ghost), or null.
  blockedByTower: Tower | null = null;
  // Attack ability (scaled per Phase 0; damage scales with wave/level like HP).
  attackDamage: number = 0;
  attackSpeed: number = 0;
  attackTimer: number = 0;
  attackAnimTime: number = 0;
  attackAnimation: MapThemeAnimation | null = null;
  // Version of the grid path this enemy is following; used to detect re-anchor needs.
  pathVersion: number = 0;
  markTargetMult!: number;
  markTargetTimer!: number;
  antiHealTimer!: number;
  lastCellX!: number;
  lastCellY!: number;

  constructor(
    type: string,
    level: number,
    spawnIndex: number,
    grid: GridRef,
    wave: number,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultVisual: EnemyVisualMeta | null = null,
  ) {
    const meta = ENEMY_TYPES[type] as unknown as EnemyMetaRef;
    this.id = nextId++;
    this.type = type;
    this.level = level;
    this.meta = meta;
    this.theme = theme;
    const enemyVisual = (theme?.enemies[type] ?? null) as EnemyVisualMeta | null;
    this.color = enemyVisual?.color || defaultVisual?.color || "#e85a6a";
    this.radius = meta.radius * grid.tileSize * 0.5;
    this.shape = enemyVisual?.shape || defaultVisual?.shape || "circle";
    this.walking = enemyVisual?.walking || null;
    this.hitReaction = enemyVisual?.hitReaction || null;
    this.attackAnimation = enemyVisual?.attack || null;
    this.visualMeta = enemyVisual;
    this.resist = meta.resist || 0;
    this.slowResist = meta.slowResist || 0;
    this.shield = meta.shield ? meta.shield * level : 0;
    this.maxShield = this.shield;
    this.heal = meta.heal || 0;
    this.healRange = (meta.healRange || 0) * grid.tileSize;

    const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
    const diffMult = (difficultyTick || 0) * DIFFICULTY_MULT_TICK + 1;
    this.maxHp = meta.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.hp = this.maxHp;
    this.speed = meta.speed;
    this.bounty = Math.ceil(meta.bounty * (1 + 0.5 * (level - 1)));
    this.attackDamage = meta.attackDamage * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
    this.attackSpeed = meta.attackSpeed;
    this.attackTimer = 0;
    this.blockedByTower = null;

    this.spawnIndex = spawnIndex;
    this.grid = grid;
    this.slowFactor = 1;
    this.slowStack = [];
    this.stunTimer = 0;
    this.burnTimer = 0;
    this.burnDps = 0;
    this.hitAnimTime = 0;
    this._gameSeconds = 0;
    this.moveAngle = 0;
    this.markTargetMult = 0;
    this.markTargetTimer = 0;
    this.antiHealTimer = 0;
    this.path = grid.getPathFor(spawnIndex);
    this.pathIdx = 0;
    this.pathVersion = grid.pathVersion;
    if (!this.path || this.path.length === 0) {
      this.removed = true;
      this.onPathBlocked = true;
      return;
    }
    const start = grid.tileToWorld(this.path[0]!.x, this.path[0]!.y);
    this.x = start.x;
    this.y = start.y;
    this.worldPos = { x: this.x, y: this.y };
    this.centerX = this.x;
    this.centerY = this.y;
    this.laneOffset = 0;
    this.lastCellX = -1;
    this.lastCellY = -1;

    this.reachedBase = false;
    this.removed = false;
  }

  applySlow(amount: number, duration: number) {
    const eff = amount * (1 - this.slowResist);
    if (eff <= 0) return;
    const existing = this.slowStack.find((slowEntry) => slowEntry.eff === eff && slowEntry.remaining > 0);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
    } else {
      this.slowStack.push({ eff, remaining: duration });
    }
    this.recalcSlow();
  }

  recalcSlow() {
    this.slowFactor = 1;
    for (const slowEntry of this.slowStack) this.slowFactor *= 1 - slowEntry.eff;
    this.slowFactor = Math.max(MIN_SLOW_FACTOR, this.slowFactor);
  }

  applyStun(duration: number) {
    if (this.type === "boss") duration *= BOSS_STUN_REDUCTION;
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  applyBurn(dps: number, duration: number) {
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnTimer = Math.max(this.burnTimer, duration);
  }

  applyMarkTarget(mult: number, duration: number) {
    this.markTargetMult = Math.max(this.markTargetMult, mult);
    this.markTargetTimer = Math.max(this.markTargetTimer, duration);
  }

  applyAntiHeal(duration: number) {
    this.antiHealTimer = Math.max(this.antiHealTimer, duration);
  }

  takeDamage(amount: number, armorPiercing: boolean = false) {
    if (this.shield > 0 && !armorPiercing) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return 0;
    let dmg = amount * (1 - this.resist);
    if (this.markTargetMult > 0) {
      dmg *= 1 + this.markTargetMult;
    }
    this.hp -= dmg;
    this.hitAnimTime = this._gameSeconds;
    if (this.hp <= 0) this.removed = true;
    return dmg;
  }

  // Called when a previously-ghosted tower is restored (re-blocking its tile) at
  // wave start, in case this enemy is physically standing on that tile. Walk the
  // path backward from the current index to the largest tile that is not blocked,
  // snap the enemy there, and recompute its heading toward the next waypoint.
  repositionBeforeBlockedTile(): void {
    if (!this.path || this.path.length === 0) return;
    let foundIndex = -1;
    for (let index = this.pathIdx; index >= 0; index--) {
      const tile = this.path[index]!;
      if (!this.grid.blocked.has(`${tile.x},${tile.y}`)) {
        foundIndex = index;
        break;
      }
    }
    const safeIndex = foundIndex >= 0 ? foundIndex : 0;
    this.pathIdx = safeIndex;
    const safeWorld = this.grid.tileToWorld(this.path[safeIndex]!.x, this.path[safeIndex]!.y);
    this.x = safeWorld.x;
    this.y = safeWorld.y;
    this.centerX = safeWorld.x;
    this.centerY = safeWorld.y;
    this.laneOffset = 0;
    this.worldPos = { x: this.x, y: this.y };
    if (safeIndex + 1 < this.path.length) {
      const nextTile = this.path[safeIndex + 1]!;
      const nextWorld = this.grid.tileToWorld(nextTile.x, nextTile.y);
      this.moveAngle = Math.atan2(nextWorld.y - this.y, nextWorld.x - this.x);
    }
  }

  // Re-anchors the enemy onto a freshly recomputed grid path (after a tower was
  // added/removed, ghosted, or restored). Snaps to the nearest path tile that is
  // still forward of the enemy's current position relative to the base, so the
  // enemy never teleports backward toward the spawn.
  reanchorToPath(newPath: { x: number; y: number }[]): void {
    this.path = newPath;
    const baseTile = this.grid.getBase();
    const baseWorldPos = this.grid.tileToWorld(baseTile.x, baseTile.y);
    const currentDistSqToBase = (this.x - baseWorldPos.x) ** 2 + (this.y - baseWorldPos.y) ** 2;
    // The last path index is the base tile. Snapping to it would place the enemy on
    // the base and (next frame) trigger reachedBase prematurely, so it is never an
    // eligible anchor.
    const lastPathIdx = newPath.length - 1;
    let minDist = Infinity;
    let nearestIdx = 0;
    let bestForwardIdx = -1;
    let bestForwardDist = Infinity;
    for (let i = 0; i < newPath.length; i++) {
      if (i === lastPathIdx) continue;
      const worldPos = this.grid.tileToWorld(newPath[i]!.x, newPath[i]!.y);
      const distSq = (worldPos.x - this.x) ** 2 + (worldPos.y - this.y) ** 2;
      if (distSq < minDist) {
        minDist = distSq;
        nearestIdx = i;
      }
      const distSqToBase = (worldPos.x - baseWorldPos.x) ** 2 + (worldPos.y - baseWorldPos.y) ** 2;
      if (distSqToBase < currentDistSqToBase && distSq < bestForwardDist) {
        bestForwardDist = distSq;
        bestForwardIdx = i;
      }
    }
    if (bestForwardIdx >= 0) {
      this.pathIdx = bestForwardIdx;
    } else {
      let forwardFallbackIdx = -1;
      for (let i = nearestIdx; i < newPath.length; i++) {
        if (i === lastPathIdx) break;
        const worldPos = this.grid.tileToWorld(newPath[i]!.x, newPath[i]!.y);
        const distSqToBase = (worldPos.x - baseWorldPos.x) ** 2 + (worldPos.y - baseWorldPos.y) ** 2;
        if (distSqToBase <= currentDistSqToBase) {
          forwardFallbackIdx = i;
          break;
        }
      }
      this.pathIdx = forwardFallbackIdx >= 0 ? forwardFallbackIdx : nearestIdx;
    }
    // Final guard: never park on the base tile via a snap — always leave at least one
    // waypoint ahead so the enemy reaches base via normal movement.
    if (this.pathIdx >= lastPathIdx) {
      this.pathIdx = Math.max(0, lastPathIdx - 1);
    }
    const anchorTile = newPath[this.pathIdx]!;
    const anchorWorld = this.grid.tileToWorld(anchorTile.x, anchorTile.y);
    this.x = anchorWorld.x;
    this.y = anchorWorld.y;
    this.centerX = anchorWorld.x;
    this.centerY = anchorWorld.y;
    this.laneOffset = 0;
  }

  update(dt: number, enemyManager: EnemyManagerRef | null) {
    if (this.removed || this.reachedBase) return;

    this._gameSeconds += dt;

    for (let i = this.slowStack.length - 1; i >= 0; i--) {
      const slowEntry = this.slowStack[i]!;
      slowEntry.remaining -= dt;
      if (slowEntry.remaining <= 0) {
        this.slowStack.splice(i, 1);
      }
    }
    if (this.slowStack.length === 0) this.slowFactor = 1;
    else this.recalcSlow();
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
    }
    if (this.burnTimer > 0 && !this.removed) {
      this.burnTimer -= dt;
      this.takeDamage(this.burnDps * dt, true);
    }
    if (this.removed) return;
    if (this.markTargetTimer > 0) {
      this.markTargetTimer -= dt;
      if (this.markTargetTimer <= 0) {
        this.markTargetTimer = 0;
        this.markTargetMult = 0;
      }
    }
    if (this.antiHealTimer > 0) {
      this.antiHealTimer -= dt;
      if (this.antiHealTimer <= 0) {
        this.antiHealTimer = 0;
      }
    }

    if (this.heal > 0 && this.antiHealTimer <= 0 && enemyManager) {
      const nearbyAllies = enemyManager.getEnemiesInRange(this.x, this.y, this.healRange);
      for (const ally of nearbyAllies) {
        if (ally === this) continue;
        if (ally.antiHealTimer > 0) continue;
        ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * this.heal * dt);
      }
    }

    if (this.stunTimer > 0) {
      return;
    }
    if (!this.path || this.pathIdx >= this.path.length - 1) {
      this.reachedBase = true;
      return;
    }

    // Re-anchor to the latest grid path when it has changed since last frame (a tower
    // was added/removed, ghosted, or restored). This replaces the old "next tile
    // blocked → recompute BFS" check, which is no longer correct now that paths may
    // legitimately include (passable) tower tiles.
    const gridVersion = this.grid.pathVersion;
    if (this.pathVersion !== gridVersion) {
      this.pathVersion = gridVersion;
      const newPath = this.grid.getPathFor(this.spawnIndex);
      if (newPath) {
        this.reanchorToPath(newPath);
      } else {
        this.onPathBlocked = true;
        this.removed = true;
        return;
      }
    }

    // Attack-target resolution: the forward path tile may hold a live (non-ghost)
    // tower. Because the weakest-path route deliberately crosses tower tiles, the
    // enemy must decide whether to walk through (ghost/none), approach (live, not
    // yet in contact), or attack (live, in contact). A pile-up against an adjacent
    // tower also resolves to an attack (Phase 4 fallback).
    const nextTile = this.path[this.pathIdx + 1]!;
    const forwardTower =
      enemyManager && this.grid.blocked.has(`${nextTile.x},${nextTile.y}`)
        ? enemyManager.towerAt(nextTile.x, nextTile.y)
        : null;
    const liveForwardTower = forwardTower && !forwardTower.isGhost ? forwardTower : null;

    let attackTarget: Tower | null = null;
    let moveMode: "walk" | "approach" = "walk";

    if (liveForwardTower) {
      const towerCenter = this.grid.tileToWorld(nextTile.x, nextTile.y);
      const distToTower = Math.hypot(towerCenter.x - this.centerX, towerCenter.y - this.centerY);
      const contactDistance = this.grid.tileSize / 2 + this.radius;
      this.blockedByTower = liveForwardTower;
      if (distToTower > contactDistance) {
        moveMode = "approach";
      } else {
        attackTarget = liveForwardTower;
      }
    } else {
      const adjacentTower = this.findAdjacentLiveTowerInContact(enemyManager);
      if (adjacentTower) {
        attackTarget = adjacentTower;
        this.blockedByTower = adjacentTower;
      } else {
        this.blockedByTower = null;
      }
    }

    // Advance only the path centerline; x/y are derived after collision resolution.
    if (moveMode === "walk" && !attackTarget) {
      const target = this.grid.tileToWorld(nextTile.x, nextTile.y);
      const deltaX = target.x - this.centerX;
      const deltaY = target.y - this.centerY;
      const dist = Math.hypot(deltaX, deltaY);
      const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
      this.moveAngle = Math.atan2(deltaY, deltaX);
      if (step >= dist) {
        this.centerX = target.x;
        this.centerY = target.y;
        this.pathIdx++;
        if (this.pathIdx < this.path.length - 1) {
          const nextWaypoint = this.grid.tileToWorld(this.path[this.pathIdx + 1]!.x, this.path[this.pathIdx + 1]!.y);
          this.moveAngle = Math.atan2(nextWaypoint.y - this.centerY, nextWaypoint.x - this.centerX);
        }
      } else {
        this.centerX += (deltaX / dist) * step;
        this.centerY += (deltaY / dist) * step;
      }
    } else if (moveMode === "approach" && this.blockedByTower) {
      const towerCenter = this.grid.tileToWorld(nextTile.x, nextTile.y);
      const deltaToTowerX = towerCenter.x - this.centerX;
      const deltaToTowerY = towerCenter.y - this.centerY;
      const distToTower = Math.hypot(deltaToTowerX, deltaToTowerY);
      const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
      this.moveAngle = Math.atan2(deltaToTowerY, deltaToTowerX);
      if (step < distToTower) {
        this.centerX += (deltaToTowerX / distToTower) * step;
        this.centerY += (deltaToTowerY / distToTower) * step;
      } else {
        this.centerX = towerCenter.x;
        this.centerY = towerCenter.y;
      }
    }

    // Enemy-enemy collision: push overlapping neighbors apart via a signed laneOffset
    // (slower enemy to the right, faster to the left). See resolveCollisions.
    this.resolveCollisions(enemyManager);

    // Attack tick. Stun already returned above, so this only runs while unstunned;
    // the timer is paused (not reset) during stun and slowed while slowed.
    if (attackTarget) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        attackTarget.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    }

    // Derive the real engine position from the centerline plus the perpendicular
    // lane offset, clamped so the enemy stays within the current path tile bounds.
    const perpX = -Math.sin(this.moveAngle);
    const perpY = Math.cos(this.moveAngle);
    const maxLaneOffset = this.grid.tileSize / 2 - this.radius;
    if (this.laneOffset > maxLaneOffset) this.laneOffset = maxLaneOffset;
    else if (this.laneOffset < -maxLaneOffset) this.laneOffset = -maxLaneOffset;
    this.x = this.centerX + perpX * this.laneOffset;
    this.y = this.centerY + perpY * this.laneOffset;
    this.worldPos = { x: this.x, y: this.y };
  }

  // Lateral collision separation against nearby enemies using the spatial hash.
  // Each overlapping pair is pushed apart along each enemy's own perpendicular; the
  // slower enemy moves right (+offset), the faster left (-offset). With a screen
  // Y-down coordinate system and moveAngle = atan2(dy, dx), the forward unit vector
  // is (cos, sin) and the right-perpendicular (clockwise) is (-sin, cos).
  private resolveCollisions(enemyManager: EnemyManagerRef | null): void {
    if (!enemyManager) return;
    const neighbors = enemyManager.getEnemiesInRange(this.centerX, this.centerY, this.grid.tileSize);
    for (const other of neighbors) {
      if (other === this) continue;
      const perpA = { x: -Math.sin(this.moveAngle), y: Math.cos(this.moveAngle) };
      const perpB = { x: -Math.sin(other.moveAngle), y: Math.cos(other.moveAngle) };
      const ax = this.centerX + perpA.x * this.laneOffset;
      const ay = this.centerY + perpA.y * this.laneOffset;
      const bx = other.centerX + perpB.x * other.laneOffset;
      const by = other.centerY + perpB.y * other.laneOffset;
      const deltaX = bx - ax;
      const deltaY = by - ay;
      const dist = Math.hypot(deltaX, deltaY);
      const overlap = this.radius + other.radius - dist;
      if (overlap <= 0) continue;
      const separation = overlap / 2;
      let thisSign: number;
      let otherSign: number;
      if (this.speed < other.speed) {
        thisSign = 1;
        otherSign = -1;
      } else if (this.speed > other.speed) {
        thisSign = -1;
        otherSign = 1;
      } else if (this.id <= other.id) {
        thisSign = 1;
        otherSign = -1;
      } else {
        thisSign = -1;
        otherSign = 1;
      }
      this.laneOffset += separation * thisSign;
      other.laneOffset += separation * otherSign;
    }
  }

  // Returns the lowest-health adjacent live (non-ghost) tower this enemy is in
  // contact with, or null. Handles the pile-up / junction case where an enemy is
  // blocked by other enemies and ends up against a tower tile. Side towers are
  // ignored because contact only occurs when the enemy is near the tower's center.
  private findAdjacentLiveTowerInContact(enemyManager: EnemyManagerRef | null): Tower | null {
    if (!enemyManager || !this.path) return null;
    const contactDistance = this.grid.tileSize / 2 + this.radius;
    const currentTile = this.path[this.pathIdx]!;
    const candidateTiles = [
      { x: currentTile.x + 1, y: currentTile.y },
      { x: currentTile.x - 1, y: currentTile.y },
      { x: currentTile.x, y: currentTile.y + 1 },
      { x: currentTile.x, y: currentTile.y - 1 },
    ];
    let lowestTower: Tower | null = null;
    for (const tile of candidateTiles) {
      const tower = enemyManager.towerAt(tile.x, tile.y);
      if (!tower || tower.isGhost) continue;
      const towerCenter = this.grid.tileToWorld(tile.x, tile.y);
      const dist = Math.hypot(towerCenter.x - this.centerX, towerCenter.y - this.centerY);
      if (dist > contactDistance) continue;
      if (!lowestTower || tower.health < lowestTower.health) lowestTower = tower;
    }
    return lowestTower;
  }
}
