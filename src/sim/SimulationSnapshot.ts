import type { ParticleSpawnRequest } from "@/game/ParticleSystem.js";
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
  // Sparse particle spawn requests emitted this tick. Present ONLY when the
  // worker's spawn buffer is non-empty, so quiet ticks send nothing — unlike
  // lightning/stun effects which always ship []. The main thread spawns each
  // request into its own ParticleSystem and consumes the array exactly once.
  particleSpawns: ParticleSpawnRequest[] | undefined;
  spawnStates: SpawnStateSnapshot[]; // for spawn-queue overlay renderer
  // Authoritative enemy paths (tile coords), rerouted by the worker when a tower
  // blocks a path. The main thread renders path highlights from this rather than
  // its own Grid copy, so the highlight stays in sync with the simulation.
  // `undefined` on ticks where the path version has not changed since the last
  // posted snapshot — the main thread keeps its cached copy (see SnapshotSerializer).
  // Typed as `| undefined` (not `?`) so it can be assigned undefined under
  // exactOptionalPropertyTypes; the main thread treats undefined/null identically.
  paths: Array<Array<{ x: number; y: number }> | null> | undefined;
  // Path version accompanying `paths`. Present every tick so the main thread can
  // detect a reroute even if a future refactor re-adds per-tick paths.
  pathsVersion: number;
  // Per-interval wave-graph dots (damage/gold/gems/peak enemy HP). The full
  // array is shipped ONLY when `waveGraphDotsGeneration` changed since the last
  // posted snapshot (a dot is flushed roughly every WAVE_GRAPH_INTERVAL_SECONDS,
  // so most posted frames omit it); the main thread keeps its cached copy on
  // frames where it is omitted. Typed `| undefined` (not `?`) so it can be
  // assigned undefined under exactOptionalPropertyTypes — the main thread treats
  // undefined as "unchanged, use cache".
  waveGraphDots: WaveGraphDot[] | undefined;
  // Monotonic counter bumped whenever the dots array's shape changes
  // (push/front-trim/dispose). Always included so a change is still detectable
  // even when the array itself is omitted.
  waveGraphDotsGeneration: number;
  // Ephemeral visual effects generated this tick: lightning bolt segments and
  // stun aura positions. Populated by the simulation during update() and
  // consumed (cleared) when this snapshot is built, so the main thread renders
  // each effect exactly once; effects from a paused/empty tick are blank.
  lightningEffects: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  stunEffects: Array<{ x: number; y: number }>;
}

// Per-interval wave-graph data point (damage/gold/gems/peak enemy HP for a
// WAVE_GRAPH_INTERVAL_SECONDS window). Produced by WaveGraphTracker in the
// worker; serialized into the snapshot so the main-thread WaveGraph.vue can
// render without reaching into the engine. Kept here (not in game/) so the sim
// layer stays free of a sim→game dependency.
export interface WaveGraphDot {
  damage: number;
  peakEnemyHp: number;
  gold: number;
  gems: number;
  baseHealth: number;
  baseHealthColor: string;
  waveStart: boolean;
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
  // NOTE: gemBreakdown and milestoneRewardsClaimed are intentionally NOT mirrored
  // into the snapshot. `gemBreakdown` is delivered to the UI via
  // `endScreenData` (set on triggerEnd), and `milestoneRewardsClaimed` is only
  // read worker-side for persist-flush decisions (directly from runState). Both
  // were previously deep-cloned every postMessage for no consumer on the main thread.
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
  attackAnimTime: number;
  walkingFrameIndex: number;
  isBoss: boolean;
  statusEffects: StatusEffectSnapshot[];
  // Theme-derived visual config needed by the render proxy to compute frames.
  // Shared by reference on the main thread; acceptable overhead for Phase 5.
  walking: MapThemeAnimation | null;
  hitReaction: MapThemeAnimation | null;
  attackAnimation: MapThemeAnimation | null;
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
  isGhost: boolean;
  health: number;
  maxHealth: number;
  color: string;
  animation: MapThemeAnimation | null;
  // Cheap per-tower fields (always present).
  base: { fixedAim: boolean };
  placedAt: number; // build timestamp (ms); TowerPanel derives cancel window locally
  // Derived UI-decision fields — COMPUTED ONLY for the selected tower (see
  // SnapshotSerializer.snapshotTower). They are optional here because
  // non-selected towers omit them to avoid per-tower recompute every tick.
  canUpgrade?: TowerUpgradeCheck;
  upgradeCostAt5?: number; // cost to specialize to level 5
  levelCosts?: number[];
  sellValue?: number;
  milestoneBonus?: { damagePct: number; speedPct: number; tiers: number };
  stats?: TowerStatsSnapshot;
}

// Projectile and Particle snapshots: REUSE the existing DTO types.
//   - ProjectileManager.getRenderData() returns Array<{ id, x, y, radius, color }>
export type ProjectileSnapshot = ReturnType<ProjectileManager["getRenderData"]>[number];

export type SpawnStateSnapshot = SpawnState & { pendingCount: number };
