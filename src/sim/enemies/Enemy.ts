import type RAPIER from "@dimforge/rapier2d-compat";
import type { CrowdAgent } from "recast-navigation";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "@/sim/ConstantsEnemy.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import type { Tower } from "@/sim/towers/Tower.js";

let nextId = 1;

export function resetEnemyId() {
  nextId = 1;
}

export interface AttackTarget {
  takeDamage(amount: number, attacker?: Enemy): void;
  readonly isGhost: boolean;
}

// Shared contact epsilon for the attack gate: an enemy damages a blocked tower or
// the base once its centerline is within `radius + ATTACK_CONTACT_EPSILON` of the
// objective square. Identical for towers and the base so the two attack paths cannot
// drift apart.
const ATTACK_CONTACT_EPSILON = 1e-6;

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
  spawns: { x: number; y: number }[];
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
  // DetourCrowd agent backing this enemy under RECAST_NAV; null otherwise. Stored
  // here so CrowdManager/enemy move code can drive/poke it; always null when the
  // flag is off, so the OFF path is byte-identical.
  agent: CrowdAgent | null = null;
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
  // Hold destination for `hold` mode (set by commander routing in a later batch).
  // Null until then; computeIntent falls back to the base when unset so a held
  // enemy simply parks where it is.
  holdWorld: { x: number; y: number } | null = null;
  // Route destination for `route` mode (set by commander routing under RECAST_NAV).
  // Null until then; computeIntent falls back to the base when unset.
  routeWorld: { x: number; y: number } | null = null;
  // True once a `hold` enemy has reached its hold tile (used only for hold mode).
  arrived: boolean = false;
  // Captured at preStep (before computeIntent) so postStep can detect the
  // attackingBase transition that may occur during the split without re-running
  // the whole frame comparison inside the EnemyManager loop.
  preStepAttackingBase: boolean = false;
  // Commander-assigned targeting preference (e.g. "first"/"strongest"); stored for
  // future logic and currently harmless.
  targetingMode: string | null = null;
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
    // Spawn at the spawn tile center; the crowd agent (added in EnemyManager.spawn)
    // drives motion toward the base. Under RECAST_NAV there is no grid path.
    const spawnPoint = grid.spawns[spawnIndex]!;
    const spawn = grid.tileToWorld(spawnPoint.x, spawnPoint.y);
    this.x = spawn.x;
    this.y = spawn.y;
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

  // Knockback shoves the enemy backward along its travel direction (away from the
  // base). The crowd agent owns the enemy's position under RECAST_NAV, so we
  // teleport both the agent and the Rapier body to a deterministic point stepped
  // backward along `moveAngle` and clamped to the map bounds. Writing x/y directly
  // is a no-op because the per-frame update derives them from the body.
  applyKnockback(amount: number): void {
    if (amount <= 0) return;
    if (!this.agent) return;
    const target = this.computeKnockbackTarget(amount);
    this.agent.teleport(toRecast(target));
    if (this.body) {
      this.body.setTranslation({ x: target.x, y: target.y }, true);
      this.body.setLinvel({ x: 0, y: 0 }, true);
    }
    this.x = target.x;
    this.y = target.y;
    this.centerX = target.x;
    this.centerY = target.y;
  }

  // Computes the world-space point an enemy is knocked back to: stepped backward
  // along `moveAngle` (its current travel heading) and clamped to the map bounds.
  // Pure (operates on locals) so applyKnockback can reposition without mutating
  // moveAngle.
  private computeKnockbackTarget(amount: number): { x: number; y: number } {
    const stepX = -Math.cos(this.moveAngle) * amount;
    const stepY = -Math.sin(this.moveAngle) * amount;
    const worldWidth = this.grid.width * this.grid.tileSize;
    const worldHeight = this.grid.height * this.grid.tileSize;
    const targetX = Math.max(0, Math.min(worldWidth, this.centerX + stepX));
    const targetY = Math.max(0, Math.min(worldHeight, this.centerY + stepY));
    return { x: targetX, y: targetY };
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

  // The enemy's current tile, derived from its world-space centerline (lane-offset
  // independent). The commander uses this as the start point for routing.
  currentTile(): { x: number; y: number } {
    return { x: Math.floor(this.centerX / this.grid.tileSize), y: Math.floor(this.centerY / this.grid.tileSize) };
  }

  // Routes the enemy to a waypoint chain in the given mode. The crowd agent owns
  // motion, so we only set the routing mode + hold/route target world point (from
  // the first tile for `hold`, the last for `route`) and request that move target.
  // A null/empty route falls back to releaseToDefault().
  applyRoute(routePath: { x: number; y: number }[] | null, mode: "hold" | "route"): void {
    if (!routePath || routePath.length === 0) {
      this.releaseToDefault();
      return;
    }
    this.routingMode = mode;
    this.arrived = false;
    this.attackingBase = false;

    const targetTile = mode === "hold" ? routePath[0]! : routePath[routePath.length - 1]!;
    const targetWorld = this.grid.tileToWorld(targetTile.x, targetTile.y);
    if (mode === "hold") this.holdWorld = targetWorld;
    else this.routeWorld = targetWorld;
    this.agent?.requestMoveTarget(toRecast(targetWorld));
  }

  // Reverts the enemy to its default routing: head straight for the base. Used by
  // empty-waypoint llm:routeGroup release and by the route-end fall through.
  releaseToDefault(): void {
    this.routingMode = "default";
    this.arrived = false;
    this.attackingBase = false;
    this.holdWorld = null;
    this.routeWorld = null;
    if (this.agent) {
      const baseWorld = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
      this.agent.requestMoveTarget(toRecast(baseWorld));
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

  // Decision + motion integration (RECAST_NAV). Sets the crowd agent's move target
  // from the routing mode but performs NO position integration — the crowd owns
  // motion and CrowdManager.update pushes the resulting velocity into the body.
  // Status timers run via the shared updateStatusTimers helper.
  computeIntent(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    this.updateStatusTimers(dt, enemyManager);
    if (this.removed) return;

    const baseWorld = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    switch (this.routingMode) {
      case "hold":
        // Park at the hold tile; CrowdManager zeroes velocity while held.
        this.agent?.requestMoveTarget(toRecast(this.holdWorld ?? baseWorld));
        break;
      case "route":
        // Follow the routed destination; fall back to the base if unspecified.
        this.agent?.requestMoveTarget(toRecast(this.routeWorld ?? baseWorld));
        break;
      default:
        this.agent?.requestMoveTarget(toRecast(baseWorld));
        break;
    }
  }

  // ON post-physics (RECAST_NAV): reads the stepped body back, re-syncs the crowd
  // agent to the physics-resolved position so the two never drift apart, then runs
  // the base proximity attack + world-bounds clamp + moveAngle. Tower-contact
  // attack is intentionally omitted here (towers are obstacles); Phase 4 may add
  // optional tower attack.
  postPhysics(dt: number, enemyManager: EnemyManagerRef | null): void {
    if (this.removed) return;
    const pos = this.body!.translation();
    this.centerX = pos.x;
    this.centerY = pos.y;
    this.x = pos.x;
    this.y = pos.y;

    // Re-align the crowd's internal position with Rapier's resolved body so the
    // crowd and the physics body stay on the same point (Rapier may shove the body
    // off the agent's path around a tower/base/wall).
    const crowdAgent = this.agent;
    if (crowdAgent) {
      const previousVelocity = crowdAgent.velocity();
      crowdAgent.teleport(toRecast({ x: this.x, y: this.y }));
      // `teleport` zeroes the agent's internal velocity, and because this runs
      // every frame that previously capped every enemy at one acceleration step
      // (~1/8 of its maxSpeed) and erased the forward momentum a faster enemy
      // needs to push past a slower one — so faster enemies rammed/crawled and
      // the front enemy got pulled back into the bumper behind it. Re-apply the
      // pre-teleport velocity so speed and momentum persist across the resync.
      crowdAgent.raw.set_vel(0, previousVelocity.x);
      crowdAgent.raw.set_vel(1, previousVelocity.y);
      crowdAgent.raw.set_vel(2, previousVelocity.z);
    }

    const baseCenter = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    const distanceToBase = distanceToBaseSquare(
      this.centerX,
      this.centerY,
      baseCenter.x,
      baseCenter.y,
      1.5 * this.grid.tileSize,
    );
    if (distanceToBase <= this.radius + ATTACK_CONTACT_EPSILON) {
      this.attackingBase = true;
      this.agent?.resetMoveTarget();
    }

    if (this.attackingBase && this.baseTarget && this.stunTimer <= 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.baseTarget.takeDamage(this.attackDamage, this);
        this.attackAnimTime = this._gameSeconds;
        this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
      }
    }

    // Optional tower-contact edge case (Phase 4). Towers are obstacles the crowd
    // routes around, so this only fires when an enemy is shoved against a live
    // tower (dead-end / avoidance failure). It never gates the base attack above.
    if (!this.attackingBase && enemyManager) {
      if (this.blockedByTower === null || this.blockedByTower.isGhost) {
        const candidate = this.findAdjacentLiveTowerInContact(enemyManager);
        if (candidate && !candidate.isGhost) this.blockedByTower = candidate;
      }
      if (this.blockedByTower) {
        const towerKey = `${this.blockedByTower.tileX},${this.blockedByTower.tileY}`;
        const towerGone = this.blockedByTower.isGhost || !this.grid.blocked.has(towerKey);
        if (towerGone) this.blockedByTower = null;
      }
      if (this.blockedByTower && !this.blockedByTower.isGhost && this.stunTimer <= 0) {
        const towerCenter = this.grid.tileToWorld(this.blockedByTower.tileX, this.blockedByTower.tileY);
        const towerContact = distanceToBaseSquare(
          this.centerX,
          this.centerY,
          towerCenter.x,
          towerCenter.y,
          this.grid.tileSize / 2,
        );
        if (towerContact <= this.radius + ATTACK_CONTACT_EPSILON) {
          this.attackTimer -= dt;
          if (this.attackTimer <= 0) {
            this.blockedByTower.takeDamage(this.attackDamage, this);
            this.attackAnimTime = this._gameSeconds;
            this.attackTimer = 1 / (this.attackSpeed * this.slowFactor);
          }
        }
      }
    }

    const worldWidth = this.grid.width * this.grid.tileSize;
    const worldHeight = this.grid.height * this.grid.tileSize;
    if (this.x < 0 || this.y < 0 || this.x > worldWidth || this.y > worldHeight) {
      this.x = Math.max(0, Math.min(worldWidth, this.x));
      this.y = Math.max(0, Math.min(worldHeight, this.y));
      this.centerX = this.x;
      this.centerY = this.y;
    }

    const linvel = this.body!.linvel();
    const moveSpeedEpsilon = 1e-4;
    if (Math.hypot(linvel.x, linvel.y) >= moveSpeedEpsilon) {
      this.moveAngle = Math.atan2(linvel.y, linvel.x);
    }
  }

  private findAdjacentLiveTowerInContact(enemyManager: EnemyManagerRef | null): Tower | null {
    if (!enemyManager) return null;
    const currentTile = this.currentTile();
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
