import type { ParticleSystem } from "@/game/ParticleSystem.js";
import type { ProjectileManager } from "@/game/ProjectileManager.js";
import type { MapThemeAnimation, SpawnState } from "@/render/themes/index.js";
import type { GameRunState } from "./GameRunState.js";

export interface SimulationSnapshot {
  schemaVersion: number; // bump on incompatible schema changes; consumers reject mismatches
  frameId: number; // monotonic per-tick counter
  lastAppliedCommandId: number; // host uses this to confirm command application
  meta: SnapshotMeta;
  enemies: EnemySnapshot[];
  towers: TowerSnapshot[];
  projectiles: ProjectileSnapshot[];
  particles: ParticleSnapshot[];
  spawnStates: SpawnStateSnapshot[]; // for spawn-queue overlay renderer
  // Authoritative enemy paths (tile coords), rerouted by the worker when a tower
  // blocks a path. The main thread renders path highlights from this rather than
  // its own Grid copy, so the highlight stays in sync with the simulation.
  paths: Array<Array<{ x: number; y: number }> | null>;
}

export interface SnapshotMeta {
  // Scalar state from GameRunState. Subset that the renderer/UI need.
  state: GameRunState["state"];
  mapIndex: number;
  lives: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  selectedTowerId: string | null;
  selectedTowerType: string | null;
  hoverTile: { tileX: number; tileY: number } | null;
  hoverUpgradeBtn: boolean;
  upgradeBtnClickAnim: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  // camera is excluded — main-thread-only UI state, read from gameStore.camera directly
  lastScaledDt: number; // renderer uses this for animation interpolation
  endScreenData: GameRunState["endScreenData"];
  gemBreakdown: GameRunState["gemBreakdown"];
  milestoneRewardsClaimed: Record<number, boolean>;
}

// Entity snapshots — plain data only, no methods, no closures.
// Field set is the union of everything the render managers currently read
// off the live entity objects.

export interface EnemySnapshot {
  id: number;
  type: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  angle: number; // moveAngle
  level: number;
  reachedBase: boolean;
  onPathBlocked: boolean;
  removed: boolean;
  slowFactor: number; // 1.0 = not slowed
  slowTimer: number;
  burnTimer: number;
  hitFlash: number; // 0..1 visual hit-reaction intensity
  gameSeconds: number;
  hitAnimTime: number;
  walkingFrameIndex: number;
  isBoss: boolean;
  statusEffects: StatusEffectSnapshot[];
  // Theme-derived visual config needed by the render proxy to compute frames.
  // Shared by reference on the main thread; acceptable overhead for Phase 5.
  walking: MapThemeAnimation | null;
  hitReaction: MapThemeAnimation | null;
}

export interface StatusEffectSnapshot {
  kind: "slow" | "stun" | "burn" | "shield" | "heal" | "mark";
  remaining: number;
  magnitude: number;
}

// Result of Tower.canUpgrade — precomputed by the serializer (in the worker,
// where the live Tower and PersistState live) so the render/UI path can only
// *read* the decision without calling a method on the snapshot.
export interface TowerUpgradeCheck {
  ok: boolean;
  cost?: number;
  nextLevel?: number;
  reason?: string;
  needVariant?: boolean;
}

// Subset of Tower.stats the UI binds to. Plain data only.
export interface TowerStatsSnapshot {
  damage: number;
  range: number;
  fireRate: number;
  splash: number;
  chain: number;
}

export interface TowerSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  level: number;
  variant: "A" | "B" | null;
  angle: number;
  cooldown: number;
  targeting: string;
  totalInvested: number;
  waveDamage: number;
  totalDamageDealt: number;
  fireAnimTime: number;
  fixedAimDir: "N" | "E" | "S" | "W" | null;
  sellValue: number;
  color: string;
  animation: MapThemeAnimation | null;
  // Precomputed UI-decision fields (Phase 8 — replace method calls on the
  // selectedTower snapshot, which would break since it is a plain data object).
  canUpgrade: TowerUpgradeCheck;
  upgradeCostAt5: number; // cost to specialize to level 5
  levelCosts: number[];
  canCancel: boolean;
  cancelRemainingMs: number;
  milestoneBonus: { damagePct: number; speedPct: number; tiers: number };
  stats: TowerStatsSnapshot;
  base: { fixedAim: boolean };
}

// Projectile and Particle snapshots: REUSE the existing DTO types.
//   - ProjectileManager.getRenderData() returns Array<{ id, x, y, radius, color }>
//   - ParticleSystem.getRenderData() returns RenderParticle[]
export type ProjectileSnapshot = ReturnType<ProjectileManager["getRenderData"]>[number];
export type ParticleSnapshot = ReturnType<ParticleSystem["getRenderData"]>[number];

export type SpawnStateSnapshot = SpawnState & { pendingCount: number };
