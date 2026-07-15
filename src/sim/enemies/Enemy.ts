import type RAPIER from "@dimforge/rapier2d-compat";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "@/sim/ConstantsEnemy.js";
import type { Tower } from "@/sim/towers/Tower.js";

let nextId = 1;

export function resetEnemyId() {
  nextId = 1;
}

export interface AttackTarget {
  takeDamage(amount: number, attacker?: Enemy): void;
  readonly isGhost: boolean;
}

// Returns the index in `path` whose tile is closest to `tile`, searching forward
// from `fromIndex` so the result is never behind the caller's current progress.
// Used by both applyRoute (custom commander routes) and reanchorToPath (grid
// re-anchoring) so the two share one forward-snap implementation. The last path
// tile (the base) is excluded by default because snapping onto it would mark the
// enemy attackingBase prematurely.
function snapPathIndex(
  path: { x: number; y: number }[],
  tile: { x: number; y: number },
  fromIndex: number = 0,
  excludeLast: boolean = true,
): number {
  const upper = excludeLast ? path.length - 1 : path.length;
  let bestIdx = fromIndex;
  let bestDistSq = Infinity;
  for (let index = fromIndex; index < upper; index++) {
    const node = path[index]!;
    const distSq = (node.x - tile.x) ** 2 + (node.y - tile.y) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = index;
    }
  }
  return bestIdx;
}

// Shared contact epsilon for the attack gate: an enemy damages a blocked tower or
// the base once its centerline is within `radius + ATTACK_CONTACT_EPSILON` of the
// objective square. Identical for towers and the base so the two attack paths cannot
// drift apart.
const ATTACK_CONTACT_EPSILON = 1e-6;

// Contact-line lateral slide speed multiplier. A contact-line enemy's only job
// is to slide along the face to an open spot; a larger per-frame step lets a
// packed pile flow instead of deadlocking in a 1-D packed column.
const LATERAL_SPEED_MULT = 3;

// Pile depth cap (standoff) for the contact-line steering regime, shared by both
// tower and base attackers. An enemy in the steering regime only presses forward
// when it is within STANDOFF_TILES of the objective square; beyond that it queues
// at the standoff line instead of cramming forever down a 1-wide corridor. This
// bounds the active pile depth so neither a tower nor the base over-stacks. Tune
// with the other pile constants above.
export const STANDOFF_TILES = 2;

interface SlowEntry {
  eff: number;
  remaining: number;
}

interface BurnEntry {
  dps: number;
  timer: number;
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
  width: number;
  height: number;
  getPathFor(spawnIndex: number): { x: number; y: number }[] | null;
  tileToWorld(tx: number, ty: number): { x: number; y: number };
  getBase(): { x: number; y: number };
  isBase(x: number, y: number): boolean;
  isTerrain(x: number, y: number): boolean;
  inBounds(x: number, y: number): boolean;
  getBaseEdgeSegments(): Array<{ x1: number; y1: number; x2: number; y2: number }>;
  getTowerEdgeSegments(
    tileX: number,
    tileY: number,
    radius: number,
  ): Array<{ x1: number; y1: number; x2: number; y2: number }>;
  blocked: Set<string>;
  pathVersion: number;
  computeSurroundRoute(
    start: { x: number; y: number },
    goal: { x: number; y: number },
  ): { x: number; y: number }[] | null;
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void;
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
  // Rapier rigid body backing this enemy; assigned by PhysicsWorld.addEnemy /
  // cleared by removeEnemy.
  body: RAPIER.RigidBody | null = null;
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
  // Path centerline position. Under physics the rigid body owns the live position;
  // centerX/centerY are mirrored from the body each frame so gameplay logic
  // (re-anchor, contact checks, currentTile) reads one source.
  centerX: number = 0;
  centerY: number = 0;
  slowFactor!: number;
  slowStack!: SlowEntry[];
  stunTimer!: number;
  removed!: boolean;
  burnStack!: BurnEntry[];
  hitAnimTime!: number;
  _gameSeconds: number = 0;

  get gameSeconds(): number {
    return this._gameSeconds;
  }
  onPathBlocked!: boolean;
  moveAngle!: number;
  // Tower the enemy is currently attacking/blocked by (live, non-ghost), or null.
  blockedByTower: Tower | null = null;
  // True once the enemy has reached the base and is now attacking it (does not despawn).
  attackingBase: boolean = false;
  // The base attack target, wired by the EnemyManager/engine. Null until set at spawn.
  baseTarget: AttackTarget | null = null;
  // Attack ability (scaled per Phase 0; damage scales with wave/level like HP).
  attackDamage: number = 0;
  attackSpeed: number = 0;
  attackTimer: number = 0;
  attackAnimTime: number = 0;
  attackAnimation: MapThemeAnimation | null = null;
  // Commander routing mode. `default` follows the grid path; `hold` parks at a
  // target tile (never auto-completes); `route` follows a custom waypoint chain and
  // reverts to `default` once it reaches the base. Set by applyRoute/releaseToDefault.
  routingMode: "default" | "hold" | "route" = "default";
  // True once a `hold` enemy has reached its hold tile (used only for hold mode).
  arrived: boolean = false;
  // Captured at preStep (before computeIntent) so postStep can detect the
  // attackingBase transition that may occur during the split without re-running
  // the whole frame comparison inside the EnemyManager loop.
  preStepAttackingBase: boolean = false;
  // Commander-assigned targeting preference (e.g. "first"/"strongest"); stored for
  // future logic and currently harmless.
  targetingMode: string | null = null;
  // Version of the grid path this enemy is following; used to detect re-anchor needs.
  pathVersion: number = 0;
  markTargetMult!: number;
  markTargetTimer!: number;
  antiHealTimer!: number;
  private healTickDt: number = 0;
  private applyHealAura = (ally: Enemy): void => {
    if (ally === this) return;
    if (ally.antiHealTimer > 0) return;
    ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * this.heal * this.healTickDt);
  };

  constructor(
    type: string,
    level: number,
    spawnIndex: number,
    grid: GridRef,
    wave: number,
    difficultyTick: number = 0,
    theme: MapThemeData | null = null,
    defaultVisual: EnemyVisualMeta | null = null,
    baseTarget: AttackTarget | null = null,
  ) {
    const meta = ENEMY_TYPES[type] as unknown as EnemyMetaRef;
    this.id = nextId++;
    this.body = null;
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
    this.baseTarget = baseTarget;

    this.spawnIndex = spawnIndex;
    this.grid = grid;
    this.slowFactor = 1;
    this.slowStack = [];
    this.stunTimer = 0;
    this.burnStack = [];
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
    this.centerX = this.x;
    this.centerY = this.y;

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
    // Each burn is tracked independently and stacks until its own timer expires,
    // so a short high-DPS burn cannot extend a weaker long-duration burn (and
    // multiple burns apply their full combined DPS).
    this.burnStack.push({ dps, timer: duration });
  }

  // Knockback pushes the enemy backward along the path centerline (toward the
  // spawn). The displacement is written to centerX/centerY — the only positional
  // state the per-frame update derives x/y from — so it survives the next update
  // tick (writing x/y directly was a no-op because update recomputes x/y every
  // frame). The push is clamped to the path: it cannot move before the first
  // waypoint, so a knocked-back enemy never leaves the corridor.
  applyKnockback(amount: number): void {
    if (amount <= 0 || !this.path || this.path.length === 0 || this.pathIdx <= 0) return;
    let remaining = amount;
    while (remaining > 0 && this.pathIdx > 0) {
      const waypoint = this.grid.tileToWorld(this.path[this.pathIdx]!.x, this.path[this.pathIdx]!.y);
      const deltaX = this.centerX - waypoint.x;
      const deltaY = this.centerY - waypoint.y;
      const dist = Math.hypot(deltaX, deltaY);
      if (dist >= remaining) {
        this.centerX -= (deltaX / dist) * remaining;
        this.centerY -= (deltaY / dist) * remaining;
        remaining = 0;
      } else {
        this.centerX = waypoint.x;
        this.centerY = waypoint.y;
        remaining -= dist;
        this.pathIdx--;
        if (this.pathIdx + 1 < this.path.length) {
          const prevWaypoint = this.grid.tileToWorld(this.path[this.pathIdx]!.x, this.path[this.pathIdx]!.y);
          const nextWaypoint = this.grid.tileToWorld(this.path[this.pathIdx + 1]!.x, this.path[this.pathIdx + 1]!.y);
          this.moveAngle = Math.atan2(nextWaypoint.y - prevWaypoint.y, nextWaypoint.x - prevWaypoint.x);
        }
      }
    }
    if (this.body === null) {
      this.x = this.centerX;
      this.y = this.centerY;
    } else {
      // ON: teleport the body to the path-clamped centerline with zero velocity so
      // the knockback is deterministic and stays on the corridor (lane offset is
      // unused in ON). postPhysics will read the body back into x/y/centerX/centerY.
      this.x = this.centerX;
      this.y = this.centerY;
      this.body.setTranslation({ x: this.centerX, y: this.centerY }, true);
      this.body.setLinvel({ x: 0, y: 0 }, true);
    }
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
    if (safeIndex + 1 < this.path.length) {
      const nextTile = this.path[safeIndex + 1]!;
      const nextWorld = this.grid.tileToWorld(nextTile.x, nextTile.y);
      this.moveAngle = Math.atan2(nextWorld.y - this.y, nextWorld.x - this.x);
    }
  }

  // The enemy's current tile, derived from its world-space centerline (lane-offset
  // independent). The commander uses this as the start point for computeRoute.
  currentTile(): { x: number; y: number } {
    return { x: Math.floor(this.centerX / this.grid.tileSize), y: Math.floor(this.centerY / this.grid.tileSize) };
  }

  // Routes the enemy along `routePath` in the given mode. A null route cannot be
  // honored, so it falls back to releaseToDefault() (a safe, non-freezing default
  // — see §1.3.1 of the commander plan). `pathIdx` is snapped to the nearest
  // forward tile within the route so a mid-corridor enemy does not backtrack.
  applyRoute(routePath: { x: number; y: number }[] | null, mode: "hold" | "route"): void {
    if (!routePath || routePath.length === 0) {
      this.releaseToDefault();
      return;
    }
    this.path = routePath;
    this.routingMode = mode;
    this.pathIdx = snapPathIndex(routePath, this.currentTile(), 0, mode !== "hold");
    if (this.pathIdx + 1 < routePath.length) {
      const anchorWorld = this.grid.tileToWorld(routePath[this.pathIdx]!.x, routePath[this.pathIdx]!.y);
      const nextWorld = this.grid.tileToWorld(routePath[this.pathIdx + 1]!.x, routePath[this.pathIdx + 1]!.y);
      this.moveAngle = Math.atan2(nextWorld.y - anchorWorld.y, nextWorld.x - anchorWorld.x);
    }
    this.arrived = false;
    this.attackingBase = false;
  }

  // Reverts the enemy to its default grid path for its spawn and re-anchors onto
  // it. Used by empty-waypoint llm:routeGroup release and by the route-end fall
  // through. Also the safe fallback for any un-honorable (null/empty) command.
  releaseToDefault(): void {
    this.routingMode = "default";
    this.arrived = false;
    this.attackingBase = false;
    const defaultPath = this.grid.getPathFor(this.spawnIndex);
    if (!defaultPath || defaultPath.length === 0) {
      this.path = null;
      return;
    }
    this.reanchorToPath(defaultPath);
    this.pathVersion = this.grid.pathVersion;
  }

  // Re-anchors the enemy onto a freshly recomputed grid path (after a tower was
  // added/removed, ghosted, or restored). Snaps to the nearest path tile that is
  // still forward of the enemy's current position relative to the base, so the
  // enemy never teleports backward toward the spawn.
  reanchorToPath(newPath: { x: number; y: number }[]): void {
    this.path = newPath;
    // The last path index is the base tile for the default grid path, and snapping
    // to it would place the enemy on the base and (next frame) trigger attackingBase
    // prematurely — so it is never an eligible anchor.
    const lastTile = newPath[newPath.length - 1]!;
    const lastTileIsBase = this.grid.isBase(lastTile.x, lastTile.y);
    const lastPathIdx = lastTileIsBase ? newPath.length - 1 : newPath.length;

    // A live (blocking) tower tile must never be an anchor: snapping an enemy onto
    // (or past) it lets the enemy teleport across the tower instead of attacking it.
    // This is what broke the "two towers, one around a corner" case — when the first
    // tower became a ghost, the old straight-line-distance "forward" pick landed the
    // enemy on the second tower's tile and it walked straight through.
    const isPassableTile = (tileX: number, tileY: number): boolean => !this.grid.blocked.has(`${tileX},${tileY}`);

    // Locate the enemy's current tile within the new path using its world-space
    // centerline (lane-offset independent) so the anchor selection follows the path
    // order rather than a straight line to the base (which is wrong around corners).
    const referenceTileX = Math.floor(this.centerX / this.grid.tileSize);
    const referenceTileY = Math.floor(this.centerY / this.grid.tileSize);
    const referenceTile = { x: referenceTileX, y: referenceTileY };
    const currentIdx = snapPathIndex(newPath, referenceTile, 0, lastTileIsBase);

    // Anchor at the nearest *forward* passable tile (index >= currentIdx). Preferring
    // forward keeps the enemy advancing without ever skipping a live tower that lies
    // between it and the candidate tile. A backward passable tile is only used as a
    // last resort (no forward passable tile exists), heavily penalized so it is never
    // chosen over a valid forward one.
    let anchorIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < newPath.length; i++) {
      if (i === lastPathIdx) continue;
      const tile = newPath[i]!;
      if (!isPassableTile(tile.x, tile.y)) continue;
      const worldPos = this.grid.tileToWorld(tile.x, tile.y);
      const distSq = (worldPos.x - this.centerX) ** 2 + (worldPos.y - this.centerY) ** 2;
      const isForward = currentIdx >= 0 ? i >= currentIdx : true;
      const score = isForward ? distSq : distSq + 1e12;
      if (score < bestScore) {
        bestScore = score;
        anchorIdx = i;
      }
    }
    // Last-resort fallback: if absolutely no passable tile was found (should not
    // happen), anchor on the nearest non-base tile to avoid leaving pathIdx unset.
    if (anchorIdx < 0) {
      let nearestDistSq = Infinity;
      for (let i = 0; i < newPath.length; i++) {
        if (i === lastPathIdx) continue;
        const worldPos = this.grid.tileToWorld(newPath[i]!.x, newPath[i]!.y);
        const distSq = (worldPos.x - this.centerX) ** 2 + (worldPos.y - this.centerY) ** 2;
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          anchorIdx = i;
        }
      }
    }
    // Final guard: never park on the base tile via a snap — always leave at least one
    // waypoint ahead so the enemy reaches base via normal movement. Also covers the
    // degenerate "every tile was excluded" case (e.g. a 1-tile path whose only tile is
    // the base), where the anchor loops above never set anchorIdx and it stays -1.
    if (anchorIdx < 0 || anchorIdx >= lastPathIdx) {
      anchorIdx = Math.max(0, lastPathIdx - 1);
    }
    this.pathIdx = anchorIdx;
    const anchorTile = newPath[this.pathIdx]!;
    const anchorWorld = this.grid.tileToWorld(anchorTile.x, anchorTile.y);
    this.x = anchorWorld.x;
    this.y = anchorWorld.y;
    this.centerX = anchorWorld.x;
    this.centerY = anchorWorld.y;
    if (this.pathIdx + 1 < this.path.length) {
      const nextWorld = this.grid.tileToWorld(this.path[this.pathIdx + 1]!.x, this.path[this.pathIdx + 1]!.y);
      this.moveAngle = Math.atan2(nextWorld.y - anchorWorld.y, nextWorld.x - anchorWorld.x);
    }
  }

  // Per-frame update: run the intent pass (decision + steering, seeding the rigid
  // body velocity) then the post-physics pass (read back the stepped position,
  // acquire/run attacks, cull). Rapier owns integration, separation, and containment.
  update(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    this.computeIntent(dt, enemyManager);
    this.postPhysics(dt, enemyManager);
  }

  // Status timers shared by both OFF and ON modes: slow/burn/mark/anti-heal
  // bookkeeping plus the heal aura. Runs unconditionally at the very start of
  // computeIntent so both branches share one timer source.
  private updateStatusTimers(dt: number, enemyManager: EnemyManagerRef | null): void {
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
    if (!this.removed) {
      for (let burnIndex = this.burnStack.length - 1; burnIndex >= 0; burnIndex--) {
        const burnEntry = this.burnStack[burnIndex]!;
        burnEntry.timer -= dt;
        this.takeDamage(burnEntry.dps * dt, true);
        if (burnEntry.timer <= 0) {
          this.burnStack.splice(burnIndex, 1);
        }
      }
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
      this.healTickDt = dt;
      enemyManager.forEachEnemyInRange(this.x, this.y, this.healRange, this.applyHealAura);
    }
  }

  // Decision + motion integration. Branches on whether a Rapier body backs this
  // enemy (ON) or not (OFF). Both branches run the identical steering/movement
  // code; the difference is purely how the resulting centerline is applied (OFF
  // keeps it for the manual clamp, ON converts it to a body velocity).
  computeIntent(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    this.updateStatusTimers(dt, enemyManager);
    if (this.removed) return;
    const pos = this.body!.translation();
    this.centerX = pos.x;
    this.centerY = pos.y;
    if (this.stunTimer > 0) {
      this.body!.setLinvel({ x: 0, y: 0 }, true);
      return;
    }
    if (!this.path || this.pathIdx >= this.path.length - 1) {
      if (this.routingMode === "default") {
        this.attackingBase = true;
      }
      if (this.routingMode === "hold") {
        this.arrived = true;
      } else if (this.routingMode === "route") {
        this.releaseToDefault();
        if (!this.path || this.pathIdx >= this.path.length - 1) {
          this.attackingBase = true;
        }
      }
    }

    const gridVersion = this.grid.pathVersion;
    if (this.routingMode === "default" && !this.attackingBase && this.pathVersion !== gridVersion) {
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

    if (this.routingMode === "default" && !this.attackingBase) {
      const contactBaseTile = this.grid.getBase();
      const contactBaseCenter = this.grid.tileToWorld(contactBaseTile.x, contactBaseTile.y);
      const contact = baseSquareContact(
        contactBaseCenter.x,
        contactBaseCenter.y,
        1.5 * this.grid.tileSize,
        this.centerX,
        this.centerY,
        this.radius,
      );
      if (contact.overlapping) this.attackingBase = true;
    }

    const hasNextTile = this.path != null && this.pathIdx < this.path.length - 1;
    const nextTile = hasNextTile ? this.path![this.pathIdx + 1]! : null;
    const forwardTower =
      enemyManager && nextTile && this.grid.blocked.has(`${nextTile.x},${nextTile.y}`)
        ? enemyManager.towerAt(nextTile.x, nextTile.y)
        : null;
    const liveForwardTower = forwardTower && !forwardTower.isGhost ? forwardTower : null;

    let attackTarget: Tower | AttackTarget | null = null;

    if (this.blockedByTower === null || this.blockedByTower.isGhost) {
      const candidate = liveForwardTower ?? this.findAdjacentLiveTowerInContact(enemyManager);
      if (candidate && !candidate.isGhost) this.blockedByTower = candidate;
    }
    if (this.blockedByTower) {
      const towerKey = `${this.blockedByTower.tileX},${this.blockedByTower.tileY}`;
      const towerGone = this.blockedByTower.isGhost || !this.grid.blocked.has(towerKey);
      if (towerGone) this.blockedByTower = null;
    }

    if (this.blockedByTower && !this.blockedByTower.isGhost) {
      const towerCenter = this.grid.tileToWorld(this.blockedByTower.tileX, this.blockedByTower.tileY);
      const towerContact = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        towerCenter.x,
        towerCenter.y,
        this.grid.tileSize / 2,
      );
      if (towerContact <= this.radius + ATTACK_CONTACT_EPSILON) {
        attackTarget = this.blockedByTower;
      }
    }

    if (this.attackingBase && this.baseTarget) {
      const attackBaseTile = this.grid.getBase();
      const attackBaseCenter = this.grid.tileToWorld(attackBaseTile.x, attackBaseTile.y);
      const attackDistToSquare = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        attackBaseCenter.x,
        attackBaseCenter.y,
        1.5 * this.grid.tileSize,
      );
      if (attackDistToSquare <= this.radius + ATTACK_CONTACT_EPSILON) attackTarget = this.baseTarget;
    }

    if (hasNextTile && nextTile && !this.blockedByTower && !this.attackingBase && !attackTarget) {
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
        if (this.path && this.pathIdx < this.path.length - 1) {
          const nextWaypoint = this.grid.tileToWorld(this.path[this.pathIdx + 1]!.x, this.path[this.pathIdx + 1]!.y);
          this.moveAngle = Math.atan2(nextWaypoint.y - this.centerY, nextWaypoint.x - this.centerX);
        }
      } else {
        this.centerX += (deltaX / dist) * step;
        this.centerY += (deltaY / dist) * step;
      }
    } else if (this.attackingBase) {
      const baseTile = this.grid.getBase();
      const baseCenter = this.grid.tileToWorld(baseTile.x, baseTile.y);
      this.contactLineSteer(
        enemyManager,
        baseCenter.x,
        baseCenter.y,
        1.5 * this.grid.tileSize,
        this.grid.getBaseEdgeSegments(),
        dt,
      );
    } else if (this.blockedByTower) {
      const towerCenter = this.grid.tileToWorld(this.blockedByTower.tileX, this.blockedByTower.tileY);
      this.contactLineSteer(
        enemyManager,
        towerCenter.x,
        towerCenter.y,
        this.grid.tileSize / 2,
        this.grid.getTowerEdgeSegments(this.blockedByTower.tileX, this.blockedByTower.tileY, this.radius),
        dt,
      );
    }

    const velocityX = (this.centerX - pos.x) / dt;
    const velocityY = (this.centerY - pos.y) / dt;
    this.body!.setLinvel({ x: velocityX, y: velocityY }, true);
  }

  // OFF intent: the original monolithic update minus the final clamp (which moves
  // to postPhysics). Status timers already ran in computeIntent; the stun early
  // return here skips movement/attack but NOT the clamp (postPhysics applies it).

  // Reads back the post-physics position and applies the mode-specific finishing
  // (clamps, acquisition, attack, cull-trigger). Branches on body to mirror the
  // intent split so the OFF path remains byte-identical to the original clamp.
  postPhysics(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    const pos = this.body!.translation();
    this.centerX = pos.x;
    this.centerY = pos.y;
    this.x = pos.x;
    this.y = pos.y;

    const worldWidth = this.grid.width * this.grid.tileSize;
    const worldHeight = this.grid.height * this.grid.tileSize;
    if (this.x < 0 || this.y < 0 || this.x > worldWidth || this.y > worldHeight) {
      this.x = Math.max(0, Math.min(worldWidth, this.x));
      this.y = Math.max(0, Math.min(worldHeight, this.y));
      this.centerX = this.x;
      this.centerY = this.y;
    }

    const hasNextTile = this.path != null && this.pathIdx < this.path.length - 1;
    const nextTile = hasNextTile ? this.path![this.pathIdx + 1]! : null;
    const forwardTower =
      enemyManager && nextTile && this.grid.blocked.has(`${nextTile.x},${nextTile.y}`)
        ? enemyManager.towerAt(nextTile.x, nextTile.y)
        : null;
    const liveForwardTower = forwardTower && !forwardTower.isGhost ? forwardTower : null;

    let attackTarget: Tower | AttackTarget | null = null;

    if (this.blockedByTower === null || this.blockedByTower.isGhost) {
      const candidate = liveForwardTower ?? this.findAdjacentLiveTowerInContact(enemyManager);
      if (candidate && !candidate.isGhost) this.blockedByTower = candidate;
    }
    if (this.blockedByTower) {
      const towerKey = `${this.blockedByTower.tileX},${this.blockedByTower.tileY}`;
      const towerGone = this.blockedByTower.isGhost || !this.grid.blocked.has(towerKey);
      if (towerGone) this.blockedByTower = null;
    }

    if (this.blockedByTower && !this.blockedByTower.isGhost) {
      const towerCenter = this.grid.tileToWorld(this.blockedByTower.tileX, this.blockedByTower.tileY);
      const towerContact = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        towerCenter.x,
        towerCenter.y,
        this.grid.tileSize / 2,
      );
      if (towerContact <= this.radius + ATTACK_CONTACT_EPSILON) {
        attackTarget = this.blockedByTower;
      }
    }

    if (this.attackingBase && this.baseTarget) {
      const attackBaseTile = this.grid.getBase();
      const attackBaseCenter = this.grid.tileToWorld(attackBaseTile.x, attackBaseTile.y);
      const attackDistToSquare = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        attackBaseCenter.x,
        attackBaseCenter.y,
        1.5 * this.grid.tileSize,
      );
      if (attackDistToSquare <= this.radius + ATTACK_CONTACT_EPSILON) attackTarget = this.baseTarget;
    }

    if (attackTarget && this.stunTimer <= 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        attackTarget.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    }

    const linvel = this.body!.linvel();
    const moveSpeedEpsilon = 1e-4;
    if (Math.hypot(linvel.x, linvel.y) >= moveSpeedEpsilon) {
      this.moveAngle = Math.atan2(linvel.y, linvel.x);
    }
  }

  private nearestPointOnSegments(
    segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
    pointX: number,
    pointY: number,
  ): { x: number; y: number; segment: { x1: number; y1: number; x2: number; y2: number } | null } {
    if (segments.length === 0) return { x: pointX, y: pointY, segment: null };
    let bestX = segments[0]!.x1;
    let bestY = segments[0]!.y1;
    let bestSegment = segments[0]!;
    let bestDistance = Infinity;
    for (const segment of segments) {
      const minX = Math.min(segment.x1, segment.x2);
      const maxX = Math.max(segment.x1, segment.x2);
      const minY = Math.min(segment.y1, segment.y2);
      const maxY = Math.max(segment.y1, segment.y2);
      const clampedX = Math.max(minX, Math.min(maxX, pointX));
      const clampedY = Math.max(minY, Math.min(maxY, pointY));
      const distance = (clampedX - pointX) ** 2 + (clampedY - pointY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestX = clampedX;
        bestY = clampedY;
        bestSegment = segment;
      }
    }
    return { x: bestX, y: bestY, segment: bestSegment };
  }

  // Continuous-space lateral open-spot search along a contact line. Probes left and
  // right along the tangent from the enemy's current position, checking each candidate
  // against the spatial hash. For on-line enemies, "open" means no overlapping enemy at
  // the candidate. For back-row enemies (not on the line), "open" means the forward path
  // from the candidate toward the objective is clear — no enemy sits between the candidate
  // and the contact line within touching distance. This is the key difference: a back
  // enemy directly behind a front enemy has no overlapping neighbors at its own depth, but
  // its forward path is blocked. The forward-clearance check finds a lateral position
  // aligned with a gap in the front row so the back enemy can advance through it.
  // Widens the search in iterations if nothing is found in the initial reach. Candidates
  // are clamped to the exposed span (minT..maxT) so enemies never drift into terrain.
  // Returns the first open point, or null when the line is fully packed.
  private findLateralOpenSpot(
    enemyManager: EnemyManagerRef | null,
    originX: number,
    originY: number,
    tangentX: number,
    tangentY: number,
    minT: number,
    maxT: number,
    originT: number,
    objectiveX: number,
    objectiveY: number,
    checkForwardClearance: boolean,
  ): { x: number; y: number } | null {
    if (!enemyManager) return null;
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;
    const tileSize = this.grid.tileSize;
    const probeStep = this.radius * 1.5;
    const probeRadius = this.radius * 2 + tileSize;
    // Pick the OPEN lateral spot that is farthest from the existing crowd (maximin),
    // not merely the nearest open spot. The nearest-spot search biased every enemy to
    // the same side of the face, so a pile cascaded to one corner and never filled the
    // exposed width. Maximin fills the largest gap first, which spreads enemies evenly
    // across the whole face. Tiny per-enemy position differences (from collision) break
    // left/right symmetry deterministically so enemies at the same spot do not all pick
    // the same extreme and oscillate.
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    const considerOffset = (offsetT: number): void => {
      const clampedT = Math.max(minT, Math.min(maxT, offsetT));
      const candidateX = originX + tangentX * (clampedT - originT);
      const candidateY = originY + tangentY * (clampedT - originT);
      let blocked = false;
      let clearance = Infinity;
      enemyManager.forEachEnemyInRange(candidateX, candidateY, probeRadius, (other) => {
        if (other === this || other.removed) return;
        const otherDeltaX = other.x - candidateX;
        const otherDeltaY = other.y - candidateY;
        const otherDist = Math.hypot(otherDeltaX, otherDeltaY);
        if (!checkForwardClearance) {
          if (otherDist < this.radius + other.radius - 1e-3) blocked = true;
          clearance = Math.min(clearance, otherDist);
        } else {
          const candidateToObjective = Math.hypot(objectiveX - candidateX, objectiveY - candidateY);
          const otherToObjective = Math.hypot(objectiveX - other.x, objectiveY - other.y);
          if (otherToObjective < candidateToObjective - 1e-3) {
            const lateralDist = Math.abs(otherDeltaX * tangentX + otherDeltaY * tangentY);
            if (lateralDist < this.radius + other.radius - 1e-3) blocked = true;
            clearance = Math.min(clearance, lateralDist);
          }
        }
      });
      if (!blocked || checkForwardClearance) {
        // Maximin fills the largest gap first. When several open spots are equally
        // clear (e.g. both ends of a face from a centered clump), prefer the one
        // FARTHEST from the enemy's current position so the clump migrates outward
        // and fills both ends of the entry rather than cascading to one corner. The
        // distance term is tiny vs clearance so it only breaks ties, never overrides
        // a genuinely clearer spot.
        // For back-row enemies, unblocked positions (clear forward path) are scored
        // with a huge base so they always outrank blocked positions. Among equally
        // clear unblocked positions the NEAREST is preferred — the enemy slides to
        // the closest gap it can advance through, not to the farthest extreme.
        const distanceFromCurrent = Math.hypot(candidateX - originX, candidateY - originY);
        let score: number;
        if (!blocked && checkForwardClearance) {
          score = tileSize * 100 - distanceFromCurrent * 1e-3;
        } else {
          score = clearance + distanceFromCurrent * 1e-3;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x: candidateX, y: candidateY };
        }
      }
    };
    // The enemy's own position is a valid target only for on-line enemies (a back-row
    // enemy that is blocked should always try to relocate, never accept its spot).
    if (!checkForwardClearance) considerOffset(originT);
    // Scan across the full exposed span at a step that guarantees interior coverage.
    // For narrow spans (1-tile entry) the probe step may exceed the span width, causing
    // all candidates to collapse to the boundaries and leaving the center unevaluated.
    // Using spanWidth/3 as the step floor ensures at least 4 sample points regardless
    // of span size, so the center and intermediate positions participate in scoring.
    const spanWidth = maxT - minT;
    const coverageStep = spanWidth > 1e-6 ? Math.min(probeStep, spanWidth / 3) : probeStep;
    for (let offsetT = minT; offsetT <= maxT + 1e-6; offsetT += coverageStep) {
      considerOffset(offsetT);
    }
    return best;
  }

  // Fallback for when findLateralOpenSpot returns null (line is fully packed). Samples
  // lateral positions and counts how many enemies block the forward path at each, then
  // returns the position with the minimum count. Ties are broken by proximity to the
  // enemy's current position (nearest first). This aligns back-row enemies with gaps
  // between front-row enemies, producing a staggered pile instead of a single column.
  private findLeastBlockedLateral(
    enemyManager: EnemyManagerRef | null,
    originX: number,
    originY: number,
    tangentX: number,
    tangentY: number,
    minT: number,
    maxT: number,
    originT: number,
  ): { x: number; y: number } | null {
    if (!enemyManager) return null;
    const probeStep = this.radius * 1.5;
    const probeRadius = this.radius * 2 + this.grid.tileSize;
    let best: { x: number; y: number } | null = null;
    let bestCount = Infinity;
    let bestDistance = Infinity;
    // Scan across the full exposed span so interior positions (center, between
    // boundaries) participate even when the span is narrower than probeStep.
    const spanWidth = maxT - minT;
    const coverageStep = spanWidth > 1e-6 ? Math.min(probeStep, spanWidth / 3) : probeStep;
    for (let offsetT = minT; offsetT <= maxT + 1e-6; offsetT += coverageStep) {
      const candidateX = originX + tangentX * (offsetT - originT);
      const candidateY = originY + tangentY * (offsetT - originT);
      let count = 0;
      enemyManager.forEachEnemyInRange(candidateX, candidateY, probeRadius, (other) => {
        if (other === this || other.removed) return;
        const otherDeltaX = other.x - candidateX;
        const otherDeltaY = other.y - candidateY;
        const lateralDist = Math.abs(otherDeltaX * tangentX + otherDeltaY * tangentY);
        if (lateralDist < this.radius + other.radius - 1e-3) count++;
      });
      const distanceFromCurrent = Math.hypot(candidateX - originX, candidateY - originY);
      if (count < bestCount || (count === bestCount && distanceFromCurrent < bestDistance)) {
        bestCount = count;
        bestDistance = distanceFromCurrent;
        best = { x: candidateX, y: candidateY };
      }
    }
    return best;
  }

  // Compute the exposed span (minT..maxT) along the tangent for a set of segments,
  // expressed in tangent coordinates relative to a center point. Used to clamp lateral
  // search candidates so enemies never drift past the exposed face into terrain.
  // Only segments on the same face as the enemy's contact normal (same dominant axis
  // and sign) are included, so an enemy on the north face doesn't get a span that
  // extends across the east/west faces — which would let it drift onto terrain.
  private computeExposedSpan(
    segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
    centerX: number,
    centerY: number,
    tangentX: number,
    tangentY: number,
    normalX: number,
    normalY: number,
  ): { minT: number; maxT: number } {
    let minT = Infinity;
    let maxT = -Infinity;
    for (const segment of segments) {
      // Each segment's own outward normal is derived from its orientation and which
      // side of the objective it sits on — independent of the (now face-aligned)
      // enemy normal passed in. A segment belongs to the enemy's face only when its
      // outward normal matches the enemy's outward normal. The old filter keyed off
      // the radial vector (seg midpoint minus objective) and, once the tangent became
      // face-aligned (pure horizontal/vertical normal), would have wrongly excluded
      // the offset tiles of a multi-tile face and collapsed the span to one tile.
      let segmentNormalX = 0;
      let segmentNormalY = 0;
      if (segment.y1 === segment.y2) {
        segmentNormalY = segment.y1 >= centerY ? 1 : -1;
      } else {
        segmentNormalX = segment.x1 >= centerX ? 1 : -1;
      }
      if (Math.abs(segmentNormalX - normalX) > 1e-6 || Math.abs(segmentNormalY - normalY) > 1e-6) continue;
      const t1 = (segment.x1 - centerX) * tangentX + (segment.y1 - centerY) * tangentY;
      const t2 = (segment.x2 - centerX) * tangentX + (segment.y2 - centerY) * tangentY;
      minT = Math.min(minT, t1, t2);
      maxT = Math.max(maxT, t1, t2);
    }
    return { minT, maxT };
  }

  private contactLineSteer(
    enemyManager: EnemyManagerRef | null,
    objectiveX: number,
    objectiveY: number,
    half: number,
    segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
    dt: number,
  ): void {
    const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
    const contactResult = this.nearestPointOnSegments(segments, this.centerX, this.centerY);
    const contact = { x: contactResult.x, y: contactResult.y };
    // The lateral (tangent) axis is the segment's own orientation, NOT the radial
    // vector from the contact point to the objective. For a multi-tile face (e.g. a
    // 2-wide entryway) the exposed edge segments sit left/right of the base center,
    // so a radial normal would be diagonal and the "lateral" move would spiral the
    // enemy toward the base corner instead of spreading it cleanly across the face.
    // Using the segment's axis keeps the tangent horizontal/vertical and the outward
    // normal perpendicular to the face, so a spread enemy stays in contact (its
    // distance to the square is preserved by the purely-tangential move).
    let tangentX: number;
    let tangentY: number;
    let normalX: number;
    let normalY: number;
    const faceSegment = contactResult.segment;
    if (faceSegment && faceSegment.y1 === faceSegment.y2) {
      tangentX = 1;
      tangentY = 0;
      normalY = contact.y >= objectiveY ? 1 : -1; // outward normal perpendicular to a horizontal face
      normalX = 0;
    } else if (faceSegment) {
      tangentX = 0;
      tangentY = 1;
      normalX = contact.x >= objectiveX ? 1 : -1; // outward normal perpendicular to a vertical face
      normalY = 0;
    } else {
      // No exposed segment (degenerate): fall back to the radial normal.
      const normalLen = Math.hypot(contact.x - objectiveX, contact.y - objectiveY) || 1;
      normalX = (contact.x - objectiveX) / normalLen;
      normalY = (contact.y - objectiveY) / normalLen;
      tangentX = -normalY;
      tangentY = normalX;
    }
    const distToSquare = distanceToBaseSquare(this.centerX, this.centerY, objectiveX, objectiveY, half);
    const onLine = distToSquare <= this.radius + 1e-3;
    const blocked = this.isBlockedAhead(enemyManager, objectiveX, objectiveY);
    // Pile depth cap (standoff): an enemy in the steering regime only
    // presses forward while it is still within STANDOFF_TILES of the objective
    // square. Beyond that it queues at the standoff line instead of cramming
    // forever down a 1-wide corridor. Shared by both tower and base
    // attackers, so the active pile depth is bounded on both sides.
    const standoff = STANDOFF_TILES * this.grid.tileSize;
    const withinStandoff = distToSquare <= standoff;
    if (!onLine && !blocked && withinStandoff) {
      // Press forward toward the contact point. This is the only case where the
      // enemy moves inward: it has not reached the line yet, nothing is in the way,
      // and it is still within the standoff depth.
      const deltaX = contact.x - this.centerX;
      const deltaY = contact.y - this.centerY;
      const dist = Math.hypot(deltaX, deltaY);
      this.moveAngle = Math.atan2(deltaY, deltaX);
      if (step >= dist) {
        this.centerX = contact.x;
        this.centerY = contact.y;
      } else if (dist > 1e-6) {
        this.centerX += (deltaX / dist) * step;
        this.centerY += (deltaY / dist) * step;
      }
      return;
    }
    if (!onLine && !blocked && !withinStandoff) {
      // Beyond the standoff depth: queue at the standoff line rather than
      // pressing into the pile. No forward move, no lateral spread, so the
      // column cannot extend forever down the corridor.
      return;
    }
    // If on the line and not blocked, hold position as long as the enemy's actual
    // position isn't overlapping another enemy. This prevents on-line enemies from
    // shuffling every frame (the contact-point probe in findLateralOpenSpot checks the
    // nearest point on the line, not the enemy's real position, so it would find a
    // "better" spot even when the enemy is fine where it is). Only when actually
    // overlapping someone do we search laterally.
    if (onLine && !blocked) {
      let overlapping = false;
      if (enemyManager) {
        enemyManager.forEachEnemyInRange(this.x, this.y, this.radius * 2 + 0.5, (other) => {
          if (overlapping || other === this || other.removed) return;
          const otherDist = Math.hypot(other.x - this.x, other.y - this.y);
          if (otherDist < this.radius + other.radius - 1e-3) overlapping = true;
        });
      }
      if (!overlapping) return;
    }
    // Search for an open lateral spot. Probe from the enemy's own body position
    // (x/y, the derived value the spatial hash is keyed on) so the overlap checks in
    // findLateralOpenSpot compare candidate points against other enemies' bodies in
    // the same frame the hash was built from. The
    // previous code probed on-line enemies at the contact point on the square edge
    // — a full `radius` closer to the base than their actual body — which
    // systematically over-estimated separation by up to `radius` and let enemies
    // move into spots that actually overlapped, then get shoved apart by collision
    // every frame (jitter). Probing at the body keeps the frame consistent for both
    // on-line and back-row enemies.
    const probeX = this.x;
    const probeY = this.y;
    const probeT = (probeX - objectiveX) * tangentX + (probeY - objectiveY) * tangentY;
    const span = this.computeExposedSpan(segments, objectiveX, objectiveY, tangentX, tangentY, normalX, normalY);
    // Clamp the span inward by the enemy's radius so the enemy center stays fully within
    // the traversable tile — its body doesn't extend into terrain at the segment endpoints
    // (which sit at tile boundaries).
    const spanPad = this.radius;
    const minT = Number.isFinite(span.minT) ? span.minT + spanPad : probeT;
    const maxT = Number.isFinite(span.maxT) ? span.maxT - spanPad : probeT;
    const open = this.findLateralOpenSpot(
      enemyManager,
      probeX,
      probeY,
      tangentX,
      tangentY,
      minT,
      maxT,
      probeT,
      objectiveX,
      objectiveY,
      !onLine,
    );
    // Line is fully packed: no lateral position has a clear forward path. Instead of
    // holding in a single column (which produces the T-formation), slide toward the
    // least-blocked lateral position — the tangent offset where the fewest enemies
    // block the forward path. This aligns enemies with gaps between front-row enemies,
    // producing a staggered/hexagonal pile rather than a single column. It applies to
    // on-line enemies too: a packed front line should actively re-spread rather than
    // just hold in overlap and rely on collision to separate them. Cross-face perimeter
    // spill (around a base corner onto an adjacent face) is handled by the legacy
    // tile-detour, which is scoped to path-following enemies (PoliteMotion.md §3.7);
    // contact-line enemies are steered here and spread within the current face.
    if (!open) {
      if (enemyManager) {
        const fallback = this.findLeastBlockedLateral(
          enemyManager,
          probeX,
          probeY,
          tangentX,
          tangentY,
          minT,
          maxT,
          probeT,
        );
        if (fallback) {
          const along = (fallback.x - this.centerX) * tangentX + (fallback.y - this.centerY) * tangentY;
          const alongAbs = Math.abs(along);
          if (alongAbs > 1e-3) {
            const sign = Math.sign(along);
            this.moveAngle = Math.atan2(tangentY * sign, tangentX * sign);
            const move = Math.min(step, alongAbs);
            this.centerX += tangentX * sign * move;
            this.centerY += tangentY * sign * move;
          }
        }
      }
      return;
    }
    // Move purely along the tangent toward the open spot. Projecting the direction
    // onto the tangent and moving only that component preserves the enemy's distance
    // from the square: on-line enemies stay on the line (still in contact, still
    // attacking); back-row enemies slide sideways around the blocker without pressing
    // into it. Once a back enemy reaches a lateral position with nobody ahead, the
    // "not blocked, not on line" branch takes over and advances it forward.
    const toOpenX = open.x - this.centerX;
    const toOpenY = open.y - this.centerY;
    const along = toOpenX * tangentX + toOpenY * tangentY;
    const alongAbs = Math.abs(along);
    if (alongAbs < 1e-6) return; // Already at the open spot: hold.
    const sign = Math.sign(along);
    this.moveAngle = Math.atan2(tangentY * sign, tangentX * sign);
    // A contact-line enemy is already in contact, so its only job is to slide along
    // the face to an open spot. Allow a larger per-frame lateral step than the forward
    // walk speed so a pile can flow (the bottom edge of a clump slides into empty space
    // and the clump shifts) instead of deadlocking in a 1-D packed column. The
    // multiplier is high enough to cross the span in a few frames but not so high that
    // enemies visibly teleport; tune via the TUNING KNOBS in PoliteMotion.md if the
    // pile still deadlocks or zips.
    const move = Math.min(step * LATERAL_SPEED_MULT, alongAbs);
    this.centerX += tangentX * sign * move;
    this.centerY += tangentY * sign * move;
  }

  // The point every enemy is ultimately trying to reach: the base center. Used as
  // the objective for forward-progress and "closer to base" checks during piling.
  private objectiveCenter(): { x: number; y: number } {
    const base = this.grid.getBase();
    return this.grid.tileToWorld(base.x, base.y);
  }

  // True when another live enemy sits ahead (toward the objective) and blocks the
  // forward path. An enemy blocks if it is ahead (dot > 0.3 along the heading) AND
  // within touching distance laterally — i.e., the back enemy can't pass without
  // overlapping it. The forward distance doesn't matter: an enemy 30px ahead but
  // directly in the corridor blocks just as much as one 5px ahead, because the back
  // enemy will walk into it. This prevents the reactive press: the back enemy starts
  // lateral-seeking before it steps into the blocker, not after.
  // The objective defaults to the base center (the common path-following case) but is
  // passed explicitly so tower-blocked enemies check toward the tower instead.
  private isBlockedAhead(enemyManager: EnemyManagerRef | null, objectiveX?: number, objectiveY?: number): boolean {
    if (!enemyManager) return false;
    let objective: { x: number; y: number };
    if (objectiveX !== undefined && objectiveY !== undefined) {
      objective = { x: objectiveX, y: objectiveY };
    } else {
      objective = this.objectiveCenter();
    }
    const headingX = objective.x - this.centerX;
    const headingY = objective.y - this.centerY;
    const headingLen = Math.hypot(headingX, headingY);
    if (headingLen < 1e-6) return false;
    const hx = headingX / headingLen;
    const hy = headingY / headingLen;
    const searchRange = this.grid.tileSize + this.radius * 2;
    let blocked = false;
    enemyManager.forEachEnemyInRange(this.x, this.y, searchRange, (other) => {
      if (blocked || other === this || other.removed) return;
      const deltaX = other.x - this.x;
      const deltaY = other.y - this.y;
      const dist = Math.hypot(deltaX, deltaY);
      if (dist < 1e-6) {
        blocked = true;
        return;
      }
      const dot = (deltaX / dist) * hx + (deltaY / dist) * hy;
      if (dot <= 0.3) return;
      // Decompose into forward (along heading) and lateral (perpendicular to heading).
      // An enemy blocks if it's within touching distance laterally — the back enemy
      // can't squeeze past it in the corridor regardless of forward distance.
      // Exception: a higher-priority enemy (boss, tank) does not yield to a lower-
      // priority one (minion, runner) — it presses forward and collision yielding
      // pushes the lower-priority enemy aside.
      const forwardDist = deltaX * hx + deltaY * hy;
      const lateralX = deltaX - forwardDist * hx;
      const lateralY = deltaY - forwardDist * hy;
      const lateralDist = Math.hypot(lateralX, lateralY);
      if (lateralDist < this.radius + other.radius - 1e-3) {
        if (this.attackDamage > other.attackDamage) return;
        blocked = true;
      }
    });
    return blocked;
  }

  private findAdjacentLiveTowerInContact(enemyManager: EnemyManagerRef | null): Tower | null {
    if (!enemyManager || !this.path) return null;
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
      const squareContact = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        towerCenter.x,
        towerCenter.y,
        this.grid.tileSize / 2,
      );
      if (squareContact > this.radius + ATTACK_CONTACT_EPSILON) continue;
      if (!lowestTower || tower.health < lowestTower.health) lowestTower = tower;
    }
    return lowestTower;
  }
}

// Closest point on the 3x3 base square (centered at baseCenter, half-extent `half`)
// to the point (pointX, pointY), and the contact center that places a circle of the
// given `radius` just outside the square along the outward normal. `overlapping` is
// true when the point is inside (or touching) the square, so the caller can push the
// enemy out to `contactX/contactY`. Using square distance (not distance-to-center)
// lets enemies ring the base's outline, including the corners.
function baseSquareContact(
  baseCenterX: number,
  baseCenterY: number,
  half: number,
  pointX: number,
  pointY: number,
  radius: number,
): { contactX: number; contactY: number; overlapping: boolean } {
  const deltaX = pointX - baseCenterX;
  const deltaY = pointY - baseCenterY;
  const closestX = baseCenterX + Math.max(-half, Math.min(half, deltaX));
  const closestY = baseCenterY + Math.max(-half, Math.min(half, deltaY));
  let normalX: number;
  let normalY: number;
  const distance = Math.hypot(pointX - closestX, pointY - closestY);
  let contactX: number;
  let contactY: number;
  if (distance > 1e-6) {
    // Point is outside the square: normalize the outward normal and place the
    // center a full `radius` beyond the nearest edge.
    normalX = (pointX - closestX) / distance;
    normalY = (pointY - closestY) / distance;
    contactX = closestX + normalX * radius;
    contactY = closestY + normalY * radius;
  } else {
    // Point is inside the square. Collision can shove a centerline deep past the
    // base center, so a plain `radius` push along the radial would still leave it
    // inside. Eject it to `radius` outside the *nearest* edge instead.
    const penRight = half - deltaX;
    const penLeft = half + deltaX;
    const penDown = half - deltaY;
    const penUp = half + deltaY;
    const minPen = Math.min(penRight, penLeft, penDown, penUp);
    if (minPen === penRight) {
      contactX = baseCenterX + half + radius;
      contactY = pointY;
    } else if (minPen === penLeft) {
      contactX = baseCenterX - half - radius;
      contactY = pointY;
    } else if (minPen === penDown) {
      contactX = pointX;
      contactY = baseCenterY + half + radius;
    } else {
      contactX = pointX;
      contactY = baseCenterY - half - radius;
    }
  }
  return { contactX, contactY, overlapping: distance < radius };
}

// Distance from (pointX, pointY) to the nearest point on the 3x3 base square
// (centered at baseCenter, half-extent `half`). Zero when inside the square.
function distanceToBaseSquare(
  pointX: number,
  pointY: number,
  baseCenterX: number,
  baseCenterY: number,
  half: number,
): number {
  const deltaX = pointX - baseCenterX;
  const deltaY = pointY - baseCenterY;
  const closestX = baseCenterX + Math.max(-half, Math.min(half, deltaX));
  const closestY = baseCenterY + Math.max(-half, Math.min(half, deltaY));
  return Math.hypot(pointX - closestX, pointY - closestY);
}
