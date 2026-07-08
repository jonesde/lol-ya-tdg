import type { Enemy } from "@/enemies/Enemy.js";
import type { GameEngine } from "@/game/GameEngine.js";
import type { Tower } from "@/towers/Tower.js";
import type { PersistState } from "./PersistState.js";
import type {
  EnemySnapshot,
  ParticleSnapshot,
  ProjectileSnapshot,
  SimulationSnapshot,
  SnapshotMeta,
  StatusEffectSnapshot,
  TowerSnapshot,
} from "./SimulationSnapshot.js";

let nextFrameId = 1;

export function buildSnapshot(engine: GameEngine, lastAppliedCommandId: number): SimulationSnapshot {
  const enemies = engine.enemyManager?.enemies ?? [];
  const towers = engine.towerManager?.towers ?? [];
  const persistState = engine.persistState;

  return {
    schemaVersion: 1,
    frameId: nextFrameId++,
    lastAppliedCommandId,
    meta: buildMeta(engine),
    enemies: enemies.map(snapshotEnemy),
    towers: towers.map((tower) => snapshotTower(tower, persistState)),
    projectiles: (engine.projectileManager?.getRenderData() ?? []) as ProjectileSnapshot[],
    particles: (engine.particleManager?.getRenderData() ?? []) as ParticleSnapshot[],
    spawnStates: (engine.waveManager?.spawnStates ?? []).map((state, spawnIndex) => ({
      ...state,
      pendingCount: engine.enemyManager?.getPendingCountForSpawn(spawnIndex) ?? 0,
    })),
    // Persist batching signal: the worker/host flush this to localStorage only
    // on significant events (wave change / game end / milestone claim / dispose).
    persistDirty: engine.persistDirty,
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
    gemBreakdown: rs.gemBreakdown,
    milestoneRewardsClaimed: rs.milestoneRewardsClaimed,
  };
}

function snapshotEnemy(e: Enemy): EnemySnapshot {
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
    slowTimer: e.slowStack?.reduce((max, s) => Math.max(max, s.remaining), 0) ?? 0,
    burnTimer: e.burnTimer,
    hitFlash: 0,
    gameSeconds: e.gameSeconds,
    hitAnimTime: e.hitAnimTime,
    walkingFrameIndex: 0,
    isBoss: e.type === "boss",
    statusEffects: buildEnemyStatusEffects(e),
    walking: e.walking,
    hitReaction: e.hitReaction,
  };
}

function buildEnemyStatusEffects(e: Enemy): StatusEffectSnapshot[] {
  const effects: StatusEffectSnapshot[] = [];
  if (e.slowFactor < 1) {
    const maxRemaining = e.slowStack?.reduce((max, s) => Math.max(max, s.remaining), 0) ?? 0;
    effects.push({ kind: "slow", remaining: maxRemaining, magnitude: 1 - e.slowFactor });
  }
  if (e.stunTimer > 0) effects.push({ kind: "stun", remaining: e.stunTimer, magnitude: 1 });
  if (e.burnTimer > 0) effects.push({ kind: "burn", remaining: e.burnTimer, magnitude: e.burnDps ?? 0 });
  if (e.shield > 0) effects.push({ kind: "shield", remaining: 0, magnitude: e.shield });
  if (e.markTargetMult > 0) effects.push({ kind: "mark", remaining: e.markTargetTimer, magnitude: e.markTargetMult });
  return effects;
}

function snapshotTower(t: Tower, persistState: PersistState): TowerSnapshot {
  return {
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
    sellValue: t.sellValue(),
    color: t.color,
    animation: t.animation,
    canUpgrade: t.canUpgrade(persistState),
    upgradeCostAt5: t.upgradeCost(5),
    levelCosts: [...t.levelCosts],
    canCancel: t.canCancel(),
    cancelRemainingMs: t.cancelRemainingMs(),
    milestoneBonus: t.currentMilestoneBonus(),
    stats: {
      damage: t.stats.damage,
      range: t.stats.range,
      fireRate: t.stats.fireRate,
      splash: t.stats.splash,
      chain: t.stats.chain,
    },
    base: { fixedAim: t.base.fixedAim ?? false },
  };
}
