import type RAPIER from "@dimforge/rapier2d-compat";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { isColliderTag, type ColliderTag } from "./ColliderUserData.js";

export interface ProjectileHitEvent {
  projectileId: number;
  enemyId: number;
}

export interface ContactProcessorHooks {
  getEnemyById(enemyId: number): Enemy | null | undefined;
  getTowerById(towerId: string): Tower | null | undefined;
  onProjectileHit?(projectileId: number, enemyId: number): void;
}

// Drains Rapier collision events into gameplay flags: enemy↔base, enemy↔tower,
// projectile↔enemy. Maintains active contact sets so attack ticks only run while
// contact is live.
export class ContactProcessor {
  private hooks: ContactProcessorHooks;
  // enemyId → true while overlapping base collider
  private enemyBaseContact = new Set<number>();
  // enemyId → towerId while overlapping that tower
  private enemyTowerContact = new Map<number, string>();
  // Accumulated projectile hits this step (consumed by ProjectileManager)
  private projectileHits: ProjectileHitEvent[] = [];

  constructor(hooks: ContactProcessorHooks) {
    this.hooks = hooks;
  }

  setHooks(hooks: ContactProcessorHooks): void {
    this.hooks = hooks;
  }

  clear(): void {
    this.enemyBaseContact.clear();
    this.enemyTowerContact.clear();
    this.projectileHits = [];
  }

  // Process one collision event pair. `started` true = begin contact.
  handleCollision(
    body1: RAPIER.RigidBody | null,
    body2: RAPIER.RigidBody | null,
    started: boolean,
  ): void {
    const tag1 = tagFromBody(body1);
    const tag2 = tagFromBody(body2);
    if (!tag1 || !tag2) return;

    this.handlePair(tag1, tag2, started);
    this.handlePair(tag2, tag1, started);
  }

  private handlePair(tagA: ColliderTag, tagB: ColliderTag, started: boolean): void {
    if (tagA.kind === "enemy" && tagB.kind === "base") {
      if (started) this.enemyBaseContact.add(tagA.enemyId);
      else this.enemyBaseContact.delete(tagA.enemyId);
      return;
    }
    if (tagA.kind === "enemy" && tagB.kind === "tower") {
      if (started) this.enemyTowerContact.set(tagA.enemyId, tagB.towerId);
      else {
        if (this.enemyTowerContact.get(tagA.enemyId) === tagB.towerId) {
          this.enemyTowerContact.delete(tagA.enemyId);
        }
      }
      return;
    }
    if (tagA.kind === "projectile" && tagB.kind === "enemy" && started) {
      this.projectileHits.push({ projectileId: tagA.projectileId, enemyId: tagB.enemyId });
      this.hooks.onProjectileHit?.(tagA.projectileId, tagB.enemyId);
    }
  }

  isEnemyTouchingBase(enemyId: number): boolean {
    return this.enemyBaseContact.has(enemyId);
  }

  getEnemyTowerContact(enemyId: number): string | null {
    return this.enemyTowerContact.get(enemyId) ?? null;
  }

  // Apply contact state onto enemies after physics step (sets attackingBase /
  // blockedByTower from live contacts). Returns projectile hits for this step.
  applyToEnemies(enemies: Enemy[]): ProjectileHitEvent[] {
    for (const enemy of enemies) {
      if (enemy.removed) continue;
      if (this.enemyBaseContact.has(enemy.id)) {
        enemy.attackingBase = true;
        enemy.motionLock = "park";
      }
      const towerId = this.enemyTowerContact.get(enemy.id);
      if (towerId) {
        const tower = this.hooks.getTowerById(towerId);
        if (tower && !tower.isGhost) {
          enemy.blockedByTower = tower;
          if (enemy.routingMode === "siege" || enemy.attackingBase === false) {
            // Park while sieging or path-blocked against a tower.
            if (enemy.routingMode === "siege" || !enemy.attackingBase) {
              if (enemy.routingMode === "siege") enemy.motionLock = "park";
            }
          }
        } else {
          enemy.blockedByTower = null;
        }
      }
    }
    const hits = this.projectileHits;
    this.projectileHits = [];
    return hits;
  }

  drainProjectileHits(): ProjectileHitEvent[] {
    const hits = this.projectileHits;
    this.projectileHits = [];
    return hits;
  }
}

function tagFromBody(body: RAPIER.RigidBody | null): ColliderTag | null {
  if (!body) return null;
  const userData = body.userData;
  return isColliderTag(userData) ? userData : null;
}
