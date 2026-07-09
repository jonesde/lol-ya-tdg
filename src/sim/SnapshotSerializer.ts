import type { Enemy } from "@/enemies/Enemy.js";
import { UPGRADE_COST_REDUCTION_PCT } from "@/game/Constants.js";
import type { GameEngine } from "@/game/GameEngine.js";
import type { Tower } from "@/towers/Tower.js";
import type { PersistState } from "./PersistState.js";
import type {
  EnemySnapshot,
  ProjectileSnapshot,
  SimulationSnapshot,
  SnapshotMeta,
  StatusEffectSnapshot,
  TowerSnapshot,
} from "./SimulationSnapshot.js";

let nextFrameId = 1;

const EMPTY_STATUS_EFFECTS: StatusEffectSnapshot[] = Object.freeze([]) as unknown as StatusEffectSnapshot[];

export function buildSnapshot(engine: GameEngine, lastAppliedCommandId: number): SimulationSnapshot {
  const enemies = engine.enemyManager?.enemies ?? [];
  const towers = engine.towerManager?.towers ?? [];
  const persistState = engine.persistState;
  const visualEffects = engine.projectileManager?.consumeRenderVisualEffects() ?? { lightning: [], stuns: [] };

  // Paths only change on tower build/sell/ghost (event-driven, versioned by
  // grid.pathVersion). Ship the full path arrays only when the version changed
  // since the last posted snapshot; the main thread keeps its cached copy on
  // frames where `paths` is omitted. The version is always included so a reroute
  // is still detectable even if this gating is reverted.
  const grid = engine.grid;
  let paths: SimulationSnapshot["paths"];
  let pathsVersion = 0;
  if (grid) {
    pathsVersion = grid.pathVersion;
    if (grid.pathVersion !== engine.lastPostedPathVersion) {
      paths = grid.paths;
      engine.lastPostedPathVersion = grid.pathVersion;
    }
  }

  const selectedTowerId = engine.runState.selectedTowerId;

  return {
    schemaVersion: 1,
    frameId: nextFrameId++,
    lastAppliedCommandId,
    meta: buildMeta(engine),
    enemies: enemies.map(snapshotEnemy),
    towers: towers.map((tower) => snapshotTower(tower, persistState, tower.id === selectedTowerId)),
    projectiles: (engine.projectileManager?.getRenderData() ?? []) as ProjectileSnapshot[],
    // Particles are a render-only main-thread effect (see Optimize.md Finding 7):
    // the worker no longer simulates them. It only buffers sparse spawn requests
    // and ships them when non-empty, so quiet ticks send nothing.
    particleSpawns: engine.particleSpawner?.consumeSpawns?.() ?? undefined,
    spawnStates: (engine.waveManager?.spawnStates ?? []).map((state, spawnIndex) => ({
      ...state,
      pendingCount: engine.enemyManager?.getPendingCountForSpawn(spawnIndex) ?? 0,
    })),
    paths,
    pathsVersion,
    lightningEffects: visualEffects.lightning,
    stunEffects: visualEffects.stuns,
  };
}

function buildMeta(engine: GameEngine): SnapshotMeta {
  const rs = engine.runState;
  return {
    state: rs.state,
    mapIndex: rs.mapIndex,
    lives: rs.lives,
    gold: rs.gold,
    currentWave: rs.currentWave,
    waveCountdown: rs.waveCountdown,
    timeScale: rs.timeScale,
    selectedTowerId: rs.selectedTowerId,
    selectedTowerType: rs.selectedTowerType,
    hoverTile: rs.hoverTile,
    hoverUpgradeBtn: rs.hoverUpgradeBtn,
    upgradeBtnClickAnim: rs.upgradeBtnClickAnim,
    runGemsEarned: rs.runGemsEarned,
    bossesKilledThisRun: rs.bossesKilledThisRun,
    bossesReachedBaseThisRun: rs.bossesReachedBaseThisRun,
    lastScaledDt: engine.lastScaledDt,
    endScreenData: rs.endScreenData,
  };
}

function snapshotEnemy(e: Enemy): EnemySnapshot {
  const maxSlowRemaining = e.slowStack?.reduce((max, s) => Math.max(max, s.remaining), 0) ?? 0;
  const maxBurnRemaining = e.burnStack?.reduce((max, burnEntry) => Math.max(max, burnEntry.timer), 0) ?? 0;
  const totalBurnDps = e.burnStack?.reduce((sum, burnEntry) => sum + burnEntry.dps, 0) ?? 0;
  return {
    id: e.id,
    type: e.type,
    x: e.x,
    y: e.y,
    radius: e.radius,
    hp: e.hp,
    maxHp: e.maxHp,
    shield: e.shield,
    maxShield: e.maxShield,
    angle: e.moveAngle,
    level: e.level,
    reachedBase: e.reachedBase,
    onPathBlocked: e.onPathBlocked,
    removed: e.removed,
    slowFactor: e.slowFactor,
    slowTimer: maxSlowRemaining,
    burnTimer: maxBurnRemaining,
    hitFlash: 0,
    gameSeconds: e.gameSeconds,
    hitAnimTime: e.hitAnimTime,
    attackAnimTime: e.attackAnimTime,
    walkingFrameIndex: 0,
    isBoss: e.type === "boss",
    statusEffects: buildEnemyStatusEffects(e, maxSlowRemaining, maxBurnRemaining, totalBurnDps),
    walking: e.walking,
    hitReaction: e.hitReaction,
    attackAnimation: e.attackAnimation,
  };
}

function buildEnemyStatusEffects(
  e: Enemy,
  maxSlowRemaining: number,
  maxBurnRemaining: number,
  totalBurnDps: number,
): StatusEffectSnapshot[] {
  const hasEffects =
    e.slowFactor < 1 || e.stunTimer > 0 || maxBurnRemaining > 0 || e.shield > 0 || e.markTargetMult > 0;
  if (!hasEffects) return EMPTY_STATUS_EFFECTS;
  const effects: StatusEffectSnapshot[] = [];
  if (e.slowFactor < 1) {
    effects.push({ kind: "slow", remaining: maxSlowRemaining, magnitude: 1 - e.slowFactor });
  }
  if (e.stunTimer > 0) effects.push({ kind: "stun", remaining: e.stunTimer, magnitude: 1 });
  if (maxBurnRemaining > 0) effects.push({ kind: "burn", remaining: maxBurnRemaining, magnitude: totalBurnDps });
  if (e.shield > 0) effects.push({ kind: "shield", remaining: 0, magnitude: e.shield });
  if (e.markTargetMult > 0) effects.push({ kind: "mark", remaining: e.markTargetTimer, magnitude: e.markTargetMult });
  return effects;
}

function snapshotTower(t: Tower, persistState: PersistState, isSelected: boolean): TowerSnapshot {
  // Cheap per-tower path: only the visual/structural fields the render managers
  // and selection logic read every frame. The derived UI-decision fields
  // (sellValue, canUpgrade, levelCosts, milestoneBonus, upgradeCostAt5, stats)
  // are consumed ONLY by TowerPanel for the *selected* tower, so we compute them
  // once per tick for the single selected tower instead of every tower on the map.
  const base: TowerSnapshot = {
    id: t.id,
    type: t.type,
    x: t.x,
    y: t.y,
    tileX: t.tileX,
    tileY: t.tileY,
    level: t.level,
    variant: t.variant,
    angle: t.angle,
    cooldown: t.cooldown,
    targeting: t.targeting,
    totalInvested: t.totalInvested,
    waveDamage: t.waveDamage,
    totalDamageDealt: t.totalDamageDealt,
    fireAnimTime: t.fireAnimTime,
    fixedAimDir: t.fixedAimDir,
    isGhost: t.isGhost,
    health: t.health,
    maxHealth: t.maxHealth,
    color: t.color,
    animation: t.animation,
    base: { fixedAim: t.base.fixedAim ?? false },
    placedAt: t.placedAt,
  };

  if (!isSelected) return base;

  return {
    ...base,
    sellValue: t.sellValue(),
    canUpgrade: t.canUpgrade(persistState),
    levelCosts: [...t.levelCosts],
    milestoneBonus: t.currentMilestoneBonus(),
    upgradeCostAt5: (() => {
      const lv5Cost = t.upgradeCost(5);
      const ucrTier = persistState.generalAddons.upgradeCostReduction;
      if (ucrTier !== null && ucrTier !== undefined) {
        const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
        return Math.floor(lv5Cost * (1 - reduction));
      }
      return lv5Cost;
    })(),
    stats: {
      damage: t.stats.damage,
      range: t.stats.range,
      fireRate: t.stats.fireRate,
      splash: t.stats.splash,
      chain: t.stats.chain,
    },
  };
}
