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
  blocked: Set<string>;
  pathVersion: number;
  computeSurroundRoute(
    start: { x: number; y: number },
    goal: { x: number; y: number },
  ): { x: number; y: number }[] | null;
}

// A perimeter dock assignment: the exposed base edge (dockIndex into the base's
// exposed-edge list) plus how far outward (radial, in tiles) the enemy lines up,
// and the resolved outside target tile it routes to.
export interface BaseSlot {
  dockIndex: number;
  radial: number;
  targetTile: { x: number; y: number };
}

interface EnemyManagerRef {
  enemies: Enemy[];
  getEnemiesInRange(x: number, y: number, range: number): Enemy[];
  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void;
  towerAt(x: number, y: number): Tower | null;
  // Base-adjacent open tiles (the `baseTile` of every exposed dock), used by lateral
  // seeking so a blocked enemy can slip into an open tile still touching the base.
  baseDocks(): { x: number; y: number }[];
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
  // Perimeter dock assignment (load-balanced). Null until the EnemyManager assigns
  // one at spawn; non-null enemies route around the base to their dock target.
  baseSlot: BaseSlot | null = null;
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
    let defaultPath = this.grid.getPathFor(this.spawnIndex);
    // Prefer a base-avoiding route back to this enemy's assigned perimeter dock
    // so a released (e.g. commander-routed) enemy still rings the base instead
    // of cutting through the interior to the nearest ring/base tile.
    if (this.baseSlot) {
      const surround = this.grid.computeSurroundRoute(this.currentTile(), this.baseSlot.targetTile);
      if (surround && surround.length > 0) defaultPath = surround;
    }
    if (!defaultPath || defaultPath.length === 0) {
      this.path = null;
      return;
    }
    this.reanchorToPath(defaultPath);
    this.pathVersion = this.grid.pathVersion;
  }

  // Assigns a perimeter dock and routes the enemy around the base to it. Snaps the
  // path like reanchorToPath so a spawn-time enemy anchors at its current tile.
  setSurroundPath(route: { x: number; y: number }[], slot: BaseSlot): void {
    this.baseSlot = slot;
    this.routingMode = "default";
    this.arrived = false;
    this.reanchorToPath(route);
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
    // prematurely — so it is never an eligible anchor. A perimeter surround route
    // instead ends at the outside dock tile (not a base tile), which the enemy must
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
    // tower build/sell. A dock-assigned enemy re-anchors onto its base-avoiding
    // surround route so post-build reroutes still ring the base.
    const gridVersion = this.grid.pathVersion;
    if (this.routingMode === "default" && this.pathVersion !== gridVersion) {
      this.pathVersion = gridVersion;
      let newPath = this.grid.getPathFor(this.spawnIndex);
      if (this.baseSlot) {
        const surround = this.grid.computeSurroundRoute(this.currentTile(), this.baseSlot.targetTile);
        if (surround && surround.length > 0) newPath = surround;
      }
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
      !attackTarget
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
    if (this.routingMode === "default" && !attackTarget && this.detourTile) {
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
    } else if (this.attackingBase && !attackTarget) {
      // Press toward the base so collision piling forms a 2-D stack (front line on
      // the edge, further enemies filling rows behind within the arrival tile) and
      // overflows into neighbouring base-adjacent tiles via the lateral seek. We do
      // NOT pull every enemy onto the edge ring: that would flatten the pile to a
      // single line and prevent the "stacked behind" rows. The keep-out below only
      // projects an enemy out of the square when it actually penetrates, so a back
      // enemy held behind the front line by collision stays piled in the tile.
      const baseTile = this.grid.getBase();
      const baseCenter = this.grid.tileToWorld(baseTile.x, baseTile.y);
      const step = this.speed * this.slowFactor * this.grid.tileSize * dt;
      this.moveAngle = Math.atan2(baseCenter.y - this.centerY, baseCenter.x - this.centerX);
      const deltaX = baseCenter.x - this.centerX;
      const deltaY = baseCenter.y - this.centerY;
      const dist = Math.hypot(deltaX, deltaY);
      if (step >= dist) {
        this.centerX = baseCenter.x;
        this.centerY = baseCenter.y;
      } else {
        this.centerX += (deltaX / dist) * step;
        this.centerY += (deltaY / dist) * step;
      }
    } else if (moveMode === "approach" && this.blockedByTower && nextTile && !attackTarget) {
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
  }

  // The point every enemy is ultimately trying to reach: the base center. Used as
  // the objective for forward-progress and "closer to base" checks during piling.
  private objectiveCenter(): { x: number; y: number } {
    const base = this.grid.getBase();
    return this.grid.tileToWorld(base.x, base.y);
  }

  // True when another live enemy sits directly ahead (toward the base) within
  // touching distance. This distinguishes "blocked by a pile" from "arrived at the
  // edge and idle", so a lone front enemy never tries to wander off looking for a
  // detour.
  private isBlockedAhead(enemyManager: EnemyManagerRef | null): boolean {
    if (!enemyManager) return false;
    const objective = this.objectiveCenter();
    const headingX = objective.x - this.centerX;
    const headingY = objective.y - this.centerY;
    const headingLen = Math.hypot(headingX, headingY);
    if (headingLen < 1e-6) return false;
    const hx = headingX / headingLen;
    const hy = headingY / headingLen;
    let blocked = false;
    enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.grid.tileSize, (other) => {
      if (blocked || other === this || other.removed) return;
      const deltaX = other.centerX - this.centerX;
      const deltaY = other.centerY - this.centerY;
      const dist = Math.hypot(deltaX, deltaY);
      if (dist > this.radius + other.radius + 1e-3) return;
      if (dist > 1e-6) {
        const dot = (deltaX / dist) * hx + (deltaY / dist) * hy;
        if (dot > 0.3) blocked = true;
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
    enemyManager.forEachEnemyInRange(this.centerX, this.centerY, this.grid.tileSize, (other) => {
      if (other === this) return;
      const perpAx = -Math.sin(this.moveAngle);
      const perpAy = Math.cos(this.moveAngle);
      // A base-attacking enemy's pile is emergent: its separation moves the *centerline*
      // so the 2-D stack gains real extent in the position that drives `currentTile()`
      // and base-contact (its rendered lane offset is zeroed so it does not double-count).
      // A path-following enemy keeps its centerline intact (its spread is purely visual via
      // the lane offset) so path/tower logic and routing are undisturbed.
      const thisAttacks = this.attackingBase;
      const otherAttacks = other.attackingBase;
      const ax = thisAttacks ? this.centerX : this.centerX + this.laneOffsetX;
      const ay = thisAttacks ? this.centerY : this.centerY + this.laneOffsetY;
      const bx = otherAttacks ? other.centerX : other.centerX + other.laneOffsetX;
      const by = otherAttacks ? other.centerY : other.centerY + other.laneOffsetY;
      const deltaX = bx - ax;
      const deltaY = by - ay;
      const dist = Math.hypot(deltaX, deltaY);
      const overlap = this.radius + other.radius - dist;
      if (overlap <= 0) return;
      const separation = overlap / 2;
      // Use the true inter-enemy contact normal as the separation axis. A base-attacking
      // enemy's moveAngle points radially at the base and is recomputed every frame, so the
      // per-enemy heading-perpendiculars diverge when clustered at the base and the pair is
      // pushed along inconsistent, rotating axes (visible jitter). The shared normal keeps the
      // cluster stable. Fall back to this enemy's perpendicular only when coincident (dist 0)
      // so degenerate pairs still separate deterministically.
      let normalX: number;
      let normalY: number;
      if (dist > 1e-6) {
        normalX = deltaX / dist;
        normalY = deltaY / dist;
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
      if (thisAttacks) {
        this.centerX += separation * thisSign * normalX;
        this.centerY += separation * thisSign * normalY;
        this.laneOffsetX = 0;
        this.laneOffsetY = 0;
      } else {
        this.laneOffsetX += separation * thisSign * normalX;
        this.laneOffsetY += separation * thisSign * normalY;
      }
      if (otherAttacks) {
        other.centerX += separation * otherSign * normalX;
        other.centerY += separation * otherSign * normalY;
        other.laneOffsetX = 0;
        other.laneOffsetY = 0;
      } else {
        other.laneOffsetX += separation * otherSign * normalX;
        other.laneOffsetY += separation * otherSign * normalY;
      }
    });
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
  let normalX = pointX - closestX;
  let normalY = pointY - closestY;
  const distance = Math.hypot(normalX, normalY);
  let contactX: number;
  let contactY: number;
  if (distance > 1e-6) {
    // Point is outside the square: normalize the outward normal and place the
    // center a full `radius` beyond the nearest edge.
    normalX /= distance;
    normalY /= distance;
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
      normalX = 1;
      normalY = 0;
    } else if (minPen === penLeft) {
      contactX = baseCenterX - half - radius;
      contactY = pointY;
      normalX = -1;
      normalY = 0;
    } else if (minPen === penDown) {
      contactX = pointX;
      contactY = baseCenterY + half + radius;
      normalX = 0;
      normalY = 1;
    } else {
      contactX = pointX;
      contactY = baseCenterY - half - radius;
      normalX = 0;
      normalY = -1;
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
