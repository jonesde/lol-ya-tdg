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

// Lateral-seeking tuning. An enemy is treated as "blocked" only after it makes
// little forward progress toward the base for BLOCKED_TIME seconds while another
// enemy sits directly ahead of it. Once blocked it picks an open adjacent tile
// (one that gets it closer to the base, or — at the base — an open base-adjacent
// tile) and steers there, then re-evaluates after DETOUR_COOLDOWN seconds.
const BLOCKED_PROGRESS_FACTOR = 0.3;
const BLOCKED_TIME = 0.15;
const DETOUR_COOLDOWN = 0.4;

// Pile-smoothing tuning. resolveCollisions applies a hard overlap/2 correction in a
// single pass. A front enemy pinned on the base keep-out gets shoved laterally by the
// press from behind and re-projected by the keep-out each frame, producing the "pushed
// aside, then a back enemy fills the gap" popping. The hard correction is what gives the
// pile its desired multi-tile overflow, so it is kept at 1.0. Base-pile separation uses
// the true inter-enemy contact normal (tangential separation allowed) so enemies pack
// 2D against the base instead of collapsing into a single-file column.
const COLLISION_STIFFNESS = 1.0; // <1 softens per-frame correction (1 = current hard behavior)
const COLLISION_ITERATIONS = 1; // resolve the spatial-hash pairs this many times per frame (cheap convergence)

// Polite yielding: when two enemies overlap at a contact line (both attacking base or
// both blocked by the same tower), the separation is weighted by attack priority so a
// higher-damage enemy (boss, shielded, tank) takes less of the push and the lower-
// priority enemy (minion, runner) slides aside. This keeps the contact line accessible
// to threats that matter most without shoving anyone through the square.
const PRIORITY_YIELD_MIN = 0.1; // min fraction the higher-priority enemy takes (never zero)
const PRIORITY_YIELD_MAX = 0.9; // max fraction the lower-priority enemy takes (never 100%)

// Contact-line lateral slide speed multiplier. A contact-line enemy's only job
// is to slide along the face to an open spot; a larger per-frame step lets a
// packed pile flow instead of deadlocking in a 1-D packed column. Tune via
// PoliteMotion.md §6 if the pile deadlocks or zips.
const LATERAL_SPEED_MULT = 3;

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
  getBaseEdgeNearestPoint(pointX: number, pointY: number): { x: number; y: number };
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
  // Base-adjacent open tiles (the `baseTile` of every exposed dock), used by lateral
  // seeking so a blocked enemy can slip into an open tile still touching the base.
  baseDocks(): { x: number; y: number }[];
  // Every exposed dock, with its base-adjacent `baseTile` and the `outwardNormal`
  // pointing away from the base. Used to spread the front line across a base face.
  getBaseDocks(): { baseTile: { x: number; y: number }; outwardNormal: { dx: number; dy: number } }[];
  // Count of live enemies standing on a tile, used to pick the least-occupied detour.
  enemiesInTile(tileX: number, tileY: number): number;
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
  // Path centerline position (Phase 4). x/y are derived from centerline + the
  // lateral lane offset each frame; centerX/centerY are the only state the
  // forward-step logic advances, so collisions never move the centerline.
  // The lane offset is stored as a WORLD-SPACE vector (laneOffsetX/Y), not as a
  // scalar relative to moveAngle: because moveAngle flips 90 deg at every
  // right-angle turn, a scalar offset would rotate with it and make the enemy
  // jump sideways at each corner. A world vector is turn-invariant, so the
  // rendered position stays continuous through turns.
  centerX: number = 0;
  centerY: number = 0;
  laneOffsetX: number = 0;
  laneOffsetY: number = 0;
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
  // Face tangent (unit) for the contact line this enemy is currently steering along,
  // set by contactLineSteer. Used by resolveCollisions to separate contact-line pairs
  // ALONG the face (so they spread across the entry) instead of radially into the base.
  contactTangentX: number = 0;
  contactTangentY: number = 0;
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
  // Commander-assigned targeting preference (e.g. "first"/"strongest"); stored for
  // future logic and currently harmless.
  targetingMode: string | null = null;
  // Version of the grid path this enemy is following; used to detect re-anchor needs.
  pathVersion: number = 0;
  markTargetMult!: number;
  markTargetTimer!: number;
  antiHealTimer!: number;
  lastCellX!: number;
  lastCellY!: number;
  // Lateral-seeking state: time spent stalled against another enemy, the previous
  // frame's distance to the base (to measure forward progress), the tile currently
  // being steered toward as a detour, and a cooldown between detour re-evaluations.
  private blockedTimer: number = 0;
  private lastObjectiveDist: number = 0;
  private detourTile: { x: number; y: number } | null = null;
  private detourCooldown: number = 0;
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
    this.laneOffsetX = 0;
    this.laneOffsetY = 0;
    this.lastCellX = -1;
    this.lastCellY = -1;

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
    this.x = this.centerX + this.laneOffsetX;
    this.y = this.centerY + this.laneOffsetY;
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
    this.laneOffsetX = 0;
    this.laneOffsetY = 0;
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
    this.pathIdx = snapPathIndex(routePath, this.currentTile());
    this.arrived = false;
  }

  // Reverts the enemy to its default grid path for its spawn and re-anchors onto
  // it. Used by empty-waypoint llm:routeGroup release and by the route-end fall
  // through. Also the safe fallback for any un-honorable (null/empty) command.
  releaseToDefault(): void {
    this.routingMode = "default";
    this.arrived = false;
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
    // be allowed to reach, so the last tile is only excluded when it is a base tile.
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
    // waypoint ahead so the enemy reaches base via normal movement.
    if (anchorIdx >= lastPathIdx) {
      anchorIdx = Math.max(0, lastPathIdx - 1);
    }
    this.pathIdx = anchorIdx;
    const anchorTile = newPath[this.pathIdx]!;
    const anchorWorld = this.grid.tileToWorld(anchorTile.x, anchorTile.y);
    this.x = anchorWorld.x;
    this.y = anchorWorld.y;
    this.centerX = anchorWorld.x;
    this.centerY = anchorWorld.y;
    this.laneOffsetX = 0;
    this.laneOffsetY = 0;
  }

  update(dt: number, enemyManager: EnemyManagerRef | null) {
    if (this.removed) return;

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

    if (this.stunTimer > 0) {
      return;
    }
    if (!this.path || this.pathIdx >= this.path.length - 1) {
      if (this.routingMode === "default") {
        this.attackingBase = true;
      }
      if (this.routingMode === "hold") {
        // Stay put at the hold tile; the attack resolution below still runs so a
        // tower on (or adjacent to) the tile is attacked via the forward/adjacent logic.
        this.arrived = true;
      } else if (this.routingMode === "route") {
        // route mode: the command is complete — revert to the default grid path and
        // fall through so the enemy immediately starts heading for the base. From
        // here it behaves like a default-mode enemy that reached the base: it sets
        // attackingBase and attacks the base rather than being culled.
        this.releaseToDefault();
        if (!this.path || this.pathIdx >= this.path.length - 1) {
          this.attackingBase = true;
        }
      }
    }

    // Re-anchor to the latest grid path when it has changed since last frame (a tower
    // was added/removed, ghosted, or restored). Gated to default-mode enemies: a
    // hold/route enemy's path is commander-owned and must not be clobbered on a
    // tower build/sell.
    const gridVersion = this.grid.pathVersion;
    if (this.routingMode === "default" && this.pathVersion !== gridVersion) {
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

    // Early edge-stop (Issue 1 backstop): before any forward step, if the enemy's
    // centerline already contacts the base square, mark it attacking the base so it
    // clamps to the edge on this side instead of walking into the interior. Hold-mode
    // enemies are excluded so a commander hold tile inside the base footprint stays
    // reachable.
    if (this.routingMode !== "hold" && !this.attackingBase) {
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

    // Attack-target resolution: the forward path tile may hold a live (non-ghost)
    // tower. Because the weakest-path route deliberately crosses tower tiles, the
    // enemy must decide whether to walk through (ghost/none), approach (live, not
    // yet in contact), or attack (live, in contact). A pile-up against an adjacent
    // tower also resolves to an attack (Phase 4 fallback).
    const hasNextTile = this.path != null && this.pathIdx < this.path.length - 1;
    const nextTile = hasNextTile ? this.path![this.pathIdx + 1]! : null;
    const forwardTower =
      enemyManager && nextTile && this.grid.blocked.has(`${nextTile.x},${nextTile.y}`)
        ? enemyManager.towerAt(nextTile.x, nextTile.y)
        : null;
    const liveForwardTower = forwardTower && !forwardTower.isGhost ? forwardTower : null;

    let attackTarget: Tower | AttackTarget | null = null;
    let moveMode: "walk" | "approach" = "walk";

    if (liveForwardTower && nextTile) {
      const towerCenter = this.grid.tileToWorld(nextTile.x, nextTile.y);
      // Gate the attack on square distance to the tower tile (mirrors the base path
      // below, which uses distanceToBaseSquare <= radius). The center-to-center test
      // here was only true when dead-head-on a face center; contactLineSteer spreads
      // enemies tangentially along the face, increasing the center distance past the
      // contact threshold, so on the next frame attackTarget became null and the tower
      // stopped taking damage even though the enemy stayed in contact. Square distance
      // stays true for any position along the exposed perimeter, so the attack persists
      // through lateral spread.
      const towerContact = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        towerCenter.x,
        towerCenter.y,
        this.grid.tileSize / 2,
      );
      this.blockedByTower = liveForwardTower;
      if (towerContact <= this.radius + 1e-3) {
        attackTarget = liveForwardTower;
      } else {
        moveMode = "approach";
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

    if (this.attackingBase && this.baseTarget) {
      // Only an enemy actually in contact with the base square may damage it.
      // Back-row (radial > 0) enemies hold their layer but do not attack the
      // base until the front line clears and they collapse forward into it.
      const attackBaseTile = this.grid.getBase();
      const attackBaseCenter = this.grid.tileToWorld(attackBaseTile.x, attackBaseTile.y);
      const attackDistToSquare = distanceToBaseSquare(
        this.centerX,
        this.centerY,
        attackBaseCenter.x,
        attackBaseCenter.y,
        1.5 * this.grid.tileSize,
      );
      if (attackDistToSquare <= this.radius + 1e-6) attackTarget = this.baseTarget;
    }

    // Lateral seeking: a blocked enemy (another enemy directly ahead, with little
    // forward progress) steers into an open adjacent tile that gets it closer to the
    // base. This spreads a pile across a tile's width and overflows it into
    // neighbouring base-adjacent tiles instead of stacking one-deep or drifting out.
    // Only default-mode enemies pile and seek; held/route enemies keep their own logic.
    this.updateBlockedState(dt, enemyManager);
    if (this.detourCooldown > 0) this.detourCooldown -= dt;
    if (
      this.routingMode === "default" &&
      this.blockedTimer > BLOCKED_TIME &&
      !this.detourTile &&
      this.detourCooldown <= 0 &&
      (!attackTarget || this.attackingBase)
    ) {
      const detour = this.chooseDetourTile(enemyManager);
      if (detour) {
        this.detourTile = detour;
        this.detourCooldown = DETOUR_COOLDOWN;
      }
    }

    // Advance only the path centerline; x/y are derived after collision resolution.
    // A committed detour overrides the normal path/tower target so the enemy slips
    // into the open tile it selected.
    if (this.routingMode === "default" && (!attackTarget || this.attackingBase) && this.detourTile) {
      const target = this.grid.tileToWorld(this.detourTile.x, this.detourTile.y);
      const deltaX = target.x - this.centerX;
      const deltaY = target.y - this.centerY;
      const dist = Math.hypot(deltaX, deltaY);
      const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
      this.moveAngle = Math.atan2(deltaY, deltaX);
      if (step >= dist) {
        this.centerX = target.x;
        this.centerY = target.y;
      } else {
        this.centerX += (deltaX / dist) * step;
        this.centerY += (deltaY / dist) * step;
      }
      const tile = this.currentTile();
      if (tile.x === this.detourTile.x && tile.y === this.detourTile.y) {
        this.detourTile = null;
        if (!this.attackingBase && this.path) {
          this.pathIdx = snapPathIndex(this.path, tile, 0, false);
        }
      }
    } else if (hasNextTile && nextTile && moveMode === "walk" && !attackTarget) {
      // Walk the path (default or commander route) toward the next tile. This must
      // run before the base-perimeter pull so a "route" enemy keeps following its
      // route to the end (and reverts via releaseToDefault) instead of being held at
      // the edge the moment it first touches the square.
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
      // Contact-line steering: the enemy treats the base edge as a line, not a
      // point. It presses forward when unobstructed, redirects laterally to an
      // open spot when blocked or on the line, and holds when the line is packed.
      // This is the real in-game path (baseTarget is always set), so the unified
      // steer handles both the "in contact and attacking" and "near base but not
      // yet in contact" cases. See contactLineSteer for the full decision logic.
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

    // Enemy-enemy collision: push overlapping neighbors apart via the world-space
    // lane offset vector (slower enemy to the right, faster to the left). See
    // resolveCollisions.
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

    // Derive the real engine position from the centerline plus the world-space
    // lane offset. The offset vector is turn-invariant (it is not derived from
    // moveAngle), so no lateral jump occurs when rounding a right-angle corner.
    // Clamp only the component perpendicular to the current heading so the enemy
    // stays within the path tile bounds; the along-corridor component is left
    // untouched so the position stays continuous through turns.
    const perpX = -Math.sin(this.moveAngle);
    const perpY = Math.cos(this.moveAngle);
    const maxLaneOffset = this.grid.tileSize / 2 - this.radius;
    const laneProjection = this.laneOffsetX * perpX + this.laneOffsetY * perpY;
    const clampedProjection = Math.max(-maxLaneOffset, Math.min(maxLaneOffset, laneProjection));
    const tangentialX = this.laneOffsetX - laneProjection * perpX;
    const tangentialY = this.laneOffsetY - laneProjection * perpY;
    this.laneOffsetX = tangentialX + clampedProjection * perpX;
    this.laneOffsetY = tangentialY + clampedProjection * perpY;
    this.x = this.centerX + this.laneOffsetX;
    this.y = this.centerY + this.laneOffsetY;

    // Keep every enemy's rendered position outside the base square. A default-mode base
    // enemy (or any base enemy that has reached its path end) also has its centerline kept
    // out so the pile collides correctly even though it contacts the square before its
    // path ends; a route/hold enemy mid-route keeps its centerline so it can reach the
    // route end and revert via releaseToDefault. Projection only happens while actually
    // overlapping the square, so a back enemy held behind the front line by collision stays
    // piled in the tile instead of being yanked to the edge.
    const keepOutTile = this.grid.getBase();
    const keepOutCenter = this.grid.tileToWorld(keepOutTile.x, keepOutTile.y);
    const keepOutContact = baseSquareContact(
      keepOutCenter.x,
      keepOutCenter.y,
      1.5 * this.grid.tileSize,
      this.x,
      this.y,
      this.radius,
    );
    if (keepOutContact.overlapping) {
      this.x = keepOutContact.contactX;
      this.y = keepOutContact.contactY;
      this.laneOffsetX = this.x - this.centerX;
      this.laneOffsetY = this.y - this.centerY;
    }
    if (this.attackingBase && (!hasNextTile || this.routingMode === "default")) {
      const centerContact = baseSquareContact(
        keepOutCenter.x,
        keepOutCenter.y,
        1.5 * this.grid.tileSize,
        this.centerX,
        this.centerY,
        this.radius,
      );
      if (centerContact.overlapping) {
        this.centerX = centerContact.contactX;
        this.centerY = centerContact.contactY;
      }
    }
    // Keep contact-line enemies (base or tower) on their face span so the tangential
    // collision push cannot shove them sideways into terrain flanking the entry/corridor.
    if (this.attackingBase || this.blockedByTower !== null) {
      this.clampContactToSpan();
    }
  }

  // Nearest point on a set of axis-aligned segments to (pointX, pointY). Mirrors
  // Grid.getBaseEdgeNearestPoint but works for arbitrary segment lists (tower edges).
  // Returns the clamped point and the segment it lies on so the caller can derive the
  // face-aligned tangent. Falls back to (pointX, pointY) with a null segment when the
  // list is empty so the caller still has a valid anchor point.
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
        const otherDeltaX = other.centerX - candidateX;
        const otherDeltaY = other.centerY - candidateY;
        const otherDist = Math.hypot(otherDeltaX, otherDeltaY);
        if (!checkForwardClearance) {
          if (otherDist < this.radius + other.radius - 1e-3) blocked = true;
          clearance = Math.min(clearance, otherDist);
        } else {
          const candidateToObjective = Math.hypot(objectiveX - candidateX, objectiveY - candidateY);
          const otherToObjective = Math.hypot(objectiveX - other.centerX, objectiveY - other.centerY);
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
        const otherDeltaX = other.centerX - candidateX;
        const otherDeltaY = other.centerY - candidateY;
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

  // Re-project the enemy onto the objective's exposed face span AFTER collision
  // resolution. Collision separates contact-line pairs ALONG the shared face tangent
  // (resolveCollisions:1487-1519) and applies that push straight to the centerline with
  // no span re-clamp, so a pile pressed sideways can be shoved past the entry/corridor
  // span into the terrain tiles flanking it (enemies visibly drift off the path tile when
  // blocked by a tower in a 1-tile corridor or piled against the base). This clamps the
  // tangential coordinate to [span.minT + radius, span.maxT - radius] — mirroring the
  // lateral-search spanPad in contactLineSteer — so the enemy's whole body stays on the
  // path tile it is attacking from. The normal (distance-from-objective) component is
  // preserved untouched, so forward advance and the keep-out projection are unaffected.
  private clampContactToSpan(): void {
    let objectiveX: number;
    let objectiveY: number;
    let segments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    if (this.attackingBase) {
      const base = this.grid.getBase();
      const baseCenter = this.grid.tileToWorld(base.x, base.y);
      objectiveX = baseCenter.x;
      objectiveY = baseCenter.y;
      segments = this.grid.getBaseEdgeSegments();
    } else if (this.blockedByTower) {
      const towerCenter = this.grid.tileToWorld(this.blockedByTower.tileX, this.blockedByTower.tileY);
      objectiveX = towerCenter.x;
      objectiveY = towerCenter.y;
      segments = this.grid.getTowerEdgeSegments(this.blockedByTower.tileX, this.blockedByTower.tileY, this.radius);
    } else {
      return;
    }
    if (segments.length === 0) return;
    const contact = this.nearestPointOnSegments(segments, this.centerX, this.centerY);
    const faceSegment = contact.segment;
    // Face-aligned tangent/normal, identical to the derivation in contactLineSteer.
    let tangentX: number;
    let tangentY: number;
    let normalX: number;
    let normalY: number;
    if (faceSegment && faceSegment.y1 === faceSegment.y2) {
      tangentX = 1;
      tangentY = 0;
      normalY = contact.y >= objectiveY ? 1 : -1;
      normalX = 0;
    } else if (faceSegment) {
      tangentX = 0;
      tangentY = 1;
      normalX = contact.x >= objectiveX ? 1 : -1;
      normalY = 0;
    } else {
      const normalLen = Math.hypot(contact.x - objectiveX, contact.y - objectiveY) || 1;
      normalX = (contact.x - objectiveX) / normalLen;
      normalY = (contact.y - objectiveY) / normalLen;
      tangentX = -normalY;
      tangentY = normalX;
    }
    const span = this.computeExposedSpan(segments, objectiveX, objectiveY, tangentX, tangentY, normalX, normalY);
    if (!Number.isFinite(span.minT) || !Number.isFinite(span.maxT)) return;
    // Pad by the full radius plus a small epsilon so the body edge stays strictly
    // inside the tile (a center clamped to `span.maxT - radius` would put the body
    // edge exactly on the tile boundary, which floors into the flanking terrain tile).
    const spanPad = this.radius + 1e-3;
    const minT = span.minT + spanPad;
    const maxT = span.maxT - spanPad;
    // A fixed perpendicular to the tangent makes the decomposition/reconstruction exact
    // regardless of which side of the objective the enemy sits on (sign is preserved).
    const reconstructX = -tangentY;
    const reconstructY = tangentX;
    const clampPoint = (pointX: number, pointY: number): { x: number; y: number } => {
      const deltaX = pointX - objectiveX;
      const deltaY = pointY - objectiveY;
      const tComp = deltaX * tangentX + deltaY * tangentY;
      const nComp = deltaX * reconstructX + deltaY * reconstructY;
      const clampedT = Math.max(minT, Math.min(maxT, tComp));
      return {
        x: objectiveX + tangentX * clampedT + reconstructX * nComp,
        y: objectiveY + tangentY * clampedT + reconstructY * nComp,
      };
    };
    const center = clampPoint(this.centerX, this.centerY);
    this.centerX = center.x;
    this.centerY = center.y;
    const rendered = clampPoint(this.x, this.y);
    this.x = rendered.x;
    this.y = rendered.y;
  }

  // Unified contact-line steering for base and tower attacks. The enemy wants to be
  // ON the contact line (the exposed perimeter offset by its radius), not at a point.
  // When not yet on the line and not blocked, it presses forward. When blocked ahead
  // or already on the line, it searches laterally for open space along the tangent and
  // slides there (pure tangential move preserves distance to the square, so it stays
  // in contact). When the line is fully packed, it holds position. This eliminates the
  // reactive push: a blocked enemy redirects instead of pressing into the blocker.
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
    this.contactTangentX = tangentX;
    this.contactTangentY = tangentY;
    const distToSquare = distanceToBaseSquare(this.centerX, this.centerY, objectiveX, objectiveY, half);
    const onLine = distToSquare <= this.radius + 1e-3;
    const blocked = this.isBlockedAhead(enemyManager, objectiveX, objectiveY);
    if (!onLine && !blocked) {
      // Press forward toward the contact point. This is the only case where the
      // enemy moves inward: it has not reached the line yet and nothing is in the way.
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
    // If on the line and not blocked, hold position as long as the enemy's actual
    // position isn't overlapping another enemy. This prevents on-line enemies from
    // shuffling every frame (the contact-point probe in findLateralOpenSpot checks the
    // nearest point on the line, not the enemy's real position, so it would find a
    // "better" spot even when the enemy is fine where it is). Only when actually
    // overlapping someone do we search laterally.
    if (onLine && !blocked) {
      let overlapping = false;
      if (enemyManager) {
        enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.radius * 2 + 0.5, (other) => {
          if (overlapping || other === this || other.removed) return;
          const otherDist = Math.hypot(other.centerX - this.centerX, other.centerY - this.centerY);
          if (otherDist < this.radius + other.radius - 1e-3) overlapping = true;
        });
      }
      if (!overlapping) return;
    }
    // Search for an open lateral spot. Probe from the enemy's own body position
    // (centerX/centerY) so the overlap checks in findLateralOpenSpot compare
    // candidate points against other enemies' bodies in the same depth frame. The
    // previous code probed on-line enemies at the contact point on the square edge
    // — a full `radius` closer to the base than their actual body — which
    // systematically over-estimated separation by up to `radius` and let enemies
    // move into spots that actually overlapped, then get shoved apart by collision
    // every frame (jitter). Probing at the body keeps the frame consistent for both
    // on-line and back-row enemies.
    const probeX = this.centerX;
    const probeY = this.centerY;
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
    if (!open) {
      // Line is fully packed: no lateral position has a clear forward path. Instead of
      // holding in a single column (which produces the T-formation), slide toward the
      // least-blocked lateral position — the tangent offset where the fewest enemies
      // block the forward path. This aligns enemies with gaps between front-row enemies,
      // producing a staggered/hexagonal pile rather than a single column. It applies to
      // on-line enemies too: a packed front line should actively re-spread rather than
      // just hold in overlap and rely on collision to separate them.
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
    enemyManager.forEachEnemyInRange(this.centerX, this.centerY, searchRange, (other) => {
      if (blocked || other === this || other.removed) return;
      const deltaX = other.centerX - this.centerX;
      const deltaY = other.centerY - this.centerY;
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

  // Tracks forward progress toward the base. An enemy counts as blocked only when it
  // has made little progress for a sustained moment AND another enemy is directly
  // ahead of it. Pure no-progress (e.g. arrived at the edge) does not. Sets
  // `blockedTimer`, which the lateral-seeking branch reads. `detourCooldown` is
  // decremented here so re-evaluation pauses briefly after a detour is chosen.
  private updateBlockedState(dt: number, enemyManager: EnemyManagerRef | null): void {
    const objective = this.objectiveCenter();
    const dist = Math.hypot(this.centerX - objective.x, this.centerY - objective.y);
    const stepDist = this.speed * this.slowFactor * this.grid.tileSize * dt;
    const progress = this.lastObjectiveDist - dist;
    this.lastObjectiveDist = dist;
    const stalled = progress < stepDist * BLOCKED_PROGRESS_FACTOR;
    const ahead = this.isBlockedAhead(enemyManager);
    if (stalled && ahead) this.blockedTimer += dt;
    else this.blockedTimer = 0;
  }

  // Picks an open adjacent tile for a blocked enemy to slip into. A candidate must
  // be in bounds, not terrain, not tower-blocked, and not the base itself. It must
  // either get the enemy closer to the base, or — once at the base — be another
  // open base-adjacent tile (so the pile spreads around the perimeter). Among valid
  // candidates the least-occupied tile wins, tie-broken by closeness to the base.
  private chooseDetourTile(enemyManager: EnemyManagerRef | null): { x: number; y: number } | null {
    if (!enemyManager) return null;
    const current = this.currentTile();
    const objective = this.objectiveCenter();
    const tileSize = this.grid.tileSize;
    const currentWorld = this.grid.tileToWorld(current.x, current.y);
    const currentDist = Math.hypot(currentWorld.x - objective.x, currentWorld.y - objective.y);
    const baseAdjacent = new Set(enemyManager.baseDocks().map((dock) => `${dock.x},${dock.y}`));
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (const neighbor of neighbors) {
      if (this.grid.isBase(neighbor.x, neighbor.y)) continue;
      if (!this.grid.inBounds(neighbor.x, neighbor.y)) continue;
      if (this.grid.isTerrain(neighbor.x, neighbor.y)) continue;
      if (this.grid.blocked.has(`${neighbor.x},${neighbor.y}`)) continue;
      const neighborWorld = this.grid.tileToWorld(neighbor.x, neighbor.y);
      const neighborDist = Math.hypot(neighborWorld.x - objective.x, neighborWorld.y - objective.y);
      const reducesDistance = neighborDist < currentDist - 1e-3;
      const isBaseAdjacent = baseAdjacent.has(`${neighbor.x},${neighbor.y}`);
      if (!reducesDistance && !(this.attackingBase && isBaseAdjacent)) continue;
      const occupancy = enemyManager.enemiesInTile(neighbor.x, neighbor.y);
      const score = neighborDist + occupancy * (tileSize * 2);
      if (score < bestScore) {
        bestScore = score;
        best = neighbor;
      }
    }
    return best;
  }

  // Lateral collision separation against nearby enemies using the spatial hash.
  // Each overlapping pair is pushed apart along each enemy's own perpendicular; the
  // slower enemy moves right (+offset), the faster left (-offset). With a screen
  // Y-down coordinate system and moveAngle = atan2(dy, dx), the forward unit vector
  // is (cos, sin) and the right-perpendicular (clockwise) is (-sin, cos). The
  // separation is accumulated into each enemy's WORLD-SPACE lane offset vector so
  // the offset stays continuous through right-angle turns (it does not rotate with
  // moveAngle).
  private resolveCollisions(enemyManager: EnemyManagerRef | null): void {
    if (!enemyManager) return;
    for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
      enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.grid.tileSize, (other) => {
        if (other === this) return;
        const perpAx = -Math.sin(this.moveAngle);
        const perpAy = Math.cos(this.moveAngle);
        // A base- or tower-attacking enemy's pile is emergent: its separation moves the
        // *centerline* so the 2-D stack gains real extent in the position that drives
        // `currentTile()` and contact checks (its rendered lane offset is zeroed so it
        // does not double-count). A path-following enemy keeps its centerline intact
        // (its spread is purely visual via the lane offset) so path/tower logic and
        // routing are undisturbed. Tower attackers use centerline too so contactLineSteer
        // (which steers centerX/Y) and collision (which corrects centerX/Y) operate in
        // the same position space — mixing centerline steering with lane-offset collisions
        // would cause visual jitter as the two fight over the rendered position.
        const thisUsesCenter = this.attackingBase || this.blockedByTower !== null;
        const otherUsesCenter = other.attackingBase || other.blockedByTower !== null;
        const thisAttacks = this.attackingBase;
        const otherAttacks = other.attackingBase;
        // Polite yielding applies when both enemies are at a contact line — either the
        // base (attackingBase) or the same tower (blockedByTower references match).
        const thisAtTower = this.blockedByTower !== null;
        const otherAtTower = other.blockedByTower !== null;
        const sameTower = thisAtTower && otherAtTower && this.blockedByTower === other.blockedByTower;
        const bothAtLine = (thisAttacks && otherAttacks) || sameTower;
        const ax = thisUsesCenter ? this.centerX : this.centerX + this.laneOffsetX;
        const ay = thisUsesCenter ? this.centerY : this.centerY + this.laneOffsetY;
        const bx = otherUsesCenter ? other.centerX : other.centerX + other.laneOffsetX;
        const by = otherUsesCenter ? other.centerY : other.centerY + other.laneOffsetY;
        const deltaX = bx - ax;
        const deltaY = by - ay;
        const dist = Math.hypot(deltaX, deltaY);
        const overlap = this.radius + other.radius - dist;
        if (overlap <= 0) return;
        // Polite yielding: when both enemies are at a contact line, weight the
        // separation by attack priority so higher-damage enemies (boss, shielded,
        // tank) take less of the push and lower-priority enemies (minion, runner)
        // slide aside. This keeps the contact line accessible to threats that
        // matter most. For non-contact-line pairs the symmetric 50/50 split is kept.
        let thisFraction: number;
        let otherFraction: number;
        if (bothAtLine) {
          const totalPriority = this.attackDamage + other.attackDamage;
          if (totalPriority < 1e-6) {
            thisFraction = 0.5;
            otherFraction = 0.5;
          } else {
            // Higher priority takes less of the push: its fraction is the other's
            // priority / total. Clamp so neither side gets 0% or 100%.
            const thisRaw = other.attackDamage / totalPriority;
            const otherRaw = this.attackDamage / totalPriority;
            thisFraction = Math.max(PRIORITY_YIELD_MIN, Math.min(PRIORITY_YIELD_MAX, thisRaw));
            otherFraction = Math.max(PRIORITY_YIELD_MIN, Math.min(PRIORITY_YIELD_MAX, otherRaw));
          }
        } else {
          thisFraction = 0.5;
          otherFraction = 0.5;
        }
        const thisSeparation = overlap * thisFraction * COLLISION_STIFFNESS;
        const otherSeparation = overlap * otherFraction * COLLISION_STIFFNESS;
        // Separation axis. For two enemies at a contact line (both attacking the base
        // or both blocked by the same tower) that share a face, separate them ALONG the
        // shared face tangent so they spread laterally across the exposed entry width
        // instead of stacking in a single column. A pile's depth (rows behind the front
        // line) is provided by the funnel/arrival geometry and the keep-out clamp, not by
        // a radial collision push — a radial push just re-clumps enemies at one lateral
        // spot. For pairs on different faces (or non-contact-line pairs) the inter-center
        // normal is kept. The tangent is oriented from the other enemy toward this one.
        let normalX: number;
        let normalY: number;
        const tangentDot = this.contactTangentX * other.contactTangentX + this.contactTangentY * other.contactTangentY;
        if (bothAtLine && tangentDot > 0.5 && dist > 1e-6) {
          let tx = this.contactTangentX;
          let ty = this.contactTangentY;
          const toward = (this.centerX - other.centerX) * tx + (this.centerY - other.centerY) * ty;
          if (toward < 0) {
            tx = -tx;
            ty = -ty;
          }
          normalX = tx;
          normalY = ty;
        } else if (dist > 1e-6) {
          // Inter-center normal, oriented from the other enemy toward this one so it
          // matches the tangent branch's convention (which is already `other→this`).
          // The previous `this→other` orientation made the pair converge (move into
          // each other) instead of separating — a latent bug that also affected the
          // path-following lane-offset spread.
          normalX = -deltaX / dist;
          normalY = -deltaY / dist;
        } else {
          normalX = perpAx;
          normalY = perpAy;
        }
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
        if (thisUsesCenter) {
          this.centerX += thisSeparation * thisSign * normalX;
          this.centerY += thisSeparation * thisSign * normalY;
          this.laneOffsetX = 0;
          this.laneOffsetY = 0;
        } else {
          this.laneOffsetX += thisSeparation * thisSign * normalX;
          this.laneOffsetY += thisSeparation * thisSign * normalY;
        }
        if (otherUsesCenter) {
          other.centerX += otherSeparation * otherSign * normalX;
          other.centerY += otherSeparation * otherSign * normalY;
          other.laneOffsetX = 0;
          other.laneOffsetY = 0;
        } else {
          other.laneOffsetX += otherSeparation * otherSign * normalX;
          other.laneOffsetY += otherSeparation * otherSign * normalY;
        }
      });
    }
  }

  // Returns the lowest-health adjacent live (non-ghost) tower this enemy is in
  // contact with, or null. Handles the pile-up / junction case where an enemy is
  // blocked by other enemies and ends up against a tower tile. Contact uses the
  // square-distance-to-tile test shared with the forward-tower path, so an enemy
  // touching any exposed face of an adjacent tower qualifies, not just one dead-
  // center on a face.
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
      if (squareContact > this.radius + 1e-3) continue;
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
