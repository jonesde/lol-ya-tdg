import type { GameStore } from "@/stores/game.js";
import type { Tower } from "@/towers/Tower.js";
import { WAVE_GRAPH_DOT_SPACING, WAVE_GRAPH_WIDTH } from "@/game/Constants.js";
import type { SimulationSnapshot, WaveGraphDot } from "./SimulationSnapshot.js";

// Module-level mirror of the latest snapshot so non-reactive Vue components
// (e.g. StatsPanel) can read it without threading the SnapshotStore instance
// everywhere. Kept store-free to preserve the sim/main-thread boundary.
let latestSnapshot: SimulationSnapshot | null = null;

// Cache of the accumulated wave-graph dots. The worker only ships the most
// recent window (WAVE_GRAPH_MAX_SEND dots) when its generation changes, so the
// receiver merges each window into this accumulation to fill the screen — see
// the `paths`/`pathsVersion` gating pattern. Cap mirrors the worker's retained
// dot count so the accumulation never exceeds what can be displayed.
let latestWaveGraphDots: WaveGraphDot[] = [];
let latestWaveGraphGeneration = 0;

export function getLatestSnapshot(): SimulationSnapshot | null {
  return latestSnapshot;
}

// Maximum accumulated dots: enough to fill a wide screen at the dot spacing.
const WAVE_GRAPH_MAX_ACCUM = Math.ceil(WAVE_GRAPH_WIDTH / WAVE_GRAPH_DOT_SPACING);

function areDotsEqual(a: WaveGraphDot, b: WaveGraphDot): boolean {
  return (
    a.damage === b.damage &&
    a.peakEnemyHp === b.peakEnemyHp &&
    a.gold === b.gold &&
    a.gems === b.gems &&
    a.baseHealth === b.baseHealth &&
    a.baseHealthColor === b.baseHealthColor &&
    a.waveStart === b.waveStart
  );
}

// Merge an incoming window of (up to WAVE_GRAPH_MAX_SEND) dots into the
// accumulated array. The window is a contiguous suffix of the true dot
// sequence. Find the largest prefix of the window already present at the tail
// of the accumulation (so normally only the last dot is new), then append the
// remainder. If nothing overlaps (e.g. a long gap / "connection loss"), append
// the whole window. Returns a new array (never aliases the incoming window).
export function mergeWaveGraphDots(accumulated: WaveGraphDot[], window: WaveGraphDot[]): WaveGraphDot[] {
  if (accumulated.length === 0) return window.slice();
  const maxOverlap = Math.min(accumulated.length, window.length);
  let overlap = 0;
  for (let candidate = maxOverlap; candidate >= 1; candidate--) {
    let match = true;
    for (let i = 0; i < candidate; i++) {
      if (!areDotsEqual(window[i]!, accumulated[accumulated.length - candidate + i]!)) {
        match = false;
        break;
      }
    }
    if (match) {
      overlap = candidate;
      break;
    }
  }
  const merged = accumulated.slice();
  for (let i = overlap; i < window.length; i++) {
    merged.push(window[i]!);
  }
  if (merged.length > WAVE_GRAPH_MAX_ACCUM) {
    merged.splice(0, merged.length - WAVE_GRAPH_MAX_ACCUM);
  }
  return merged;
}

// Holds the latest snapshot and mirrors it into the Pinia gameStore for Vue
// reactivity. This is the "projection" layer — the snapshot is authoritative;
// gameStore is a cache updated by snapshot diffs. SnapshotStore lives on the
// main thread (imported by SvgGameRoot.vue), so it may reference the gameStore
// type; it is never imported by the worker entry.
export class SnapshotStore {
  private current: SimulationSnapshot | null = null;
  private gameStore: GameStore;
  private lastSelectedTowerId: string | null = null;
  private cachedSelectedTower: Tower | null = null;

  constructor(gameStore: GameStore) {
    this.gameStore = gameStore;
  }

  get(): SimulationSnapshot | null {
    return this.current;
  }

  apply(snapshot: SimulationSnapshot): void {
    this.current = snapshot;
    // The worker ships the wave-graph dots window only when its generation
    // changes (a dot was flushed/front-trimmed). Merge each window into the
    // accumulated cache; write the full cache back so every stored snapshot —
    // and thus getLatestSnapshot() readers (WaveGraph.vue) — always see the
    // complete dots even on frames where the worker omitted them.
    const incoming = snapshot.waveGraphDots;
    if (incoming) {
      const incomingGeneration = snapshot.waveGraphDotsGeneration;
      // A new run resets the worker's generation to 0, so a drop below the last
      // seen generation means the previous run ended — replace the cache rather
      // than merging (otherwise the new run's dots would append onto stale data).
      if (incomingGeneration < latestWaveGraphGeneration) {
        latestWaveGraphDots = incoming.slice();
      } else {
        latestWaveGraphDots = mergeWaveGraphDots(latestWaveGraphDots, incoming);
      }
      latestWaveGraphGeneration = incomingGeneration;
    }
    snapshot.waveGraphDots = latestWaveGraphDots;
    latestSnapshot = snapshot;
    this.mirrorToGameStore(snapshot);
  }

  private mirrorToGameStore(snapshot: SimulationSnapshot): void {
    const meta = snapshot.meta;
    const gs = this.gameStore;
    // Diff-and-write — only update fields that changed, to minimize Vue
    // reactivity overhead. Pinia reactivity is fine-grained per field.
    if (gs.gold !== meta.gold) gs.gold = meta.gold;
    if (gs.lives !== meta.lives) gs.lives = meta.lives;
    if (gs.currentWave !== meta.currentWave) gs.currentWave = meta.currentWave;
    if (gs.waveCountdown !== meta.waveCountdown) gs.waveCountdown = meta.waveCountdown;
    if (gs.timeScale !== meta.timeScale) gs.timeScale = meta.timeScale;
    if (gs.state !== meta.state) gs.setState(meta.state);
    if (gs.runGemsEarned !== meta.runGemsEarned) gs.runGemsEarned = meta.runGemsEarned;
    // frameId increments every tick, so the reactive mirror always advances.
    // Non-reactive snapshot readers (e.g. StatsPanel via getLatestSnapshot)
    // depend on it to re-evaluate each frame.
    gs.frameId = snapshot.frameId;
    if (gs.bossesKilledThisRun !== meta.bossesKilledThisRun) {
      gs.bossesKilledThisRun = meta.bossesKilledThisRun;
    }
    if (gs.bossesReachedBaseThisRun !== meta.bossesReachedBaseThisRun) {
      gs.bossesReachedBaseThisRun = meta.bossesReachedBaseThisRun;
    }
    if (gs.endScreenData !== meta.endScreenData) gs.endScreenData = meta.endScreenData;
    // selectedTowerType: the worker clears runState.selectedTowerType on
    // off-grid / existing-tower clicks and on cancelBuildMode, and those
    // clears must reach gameStore so the build preview turns off. The main
    // thread sets the value locally for immediate feedback on every
    // user-initiated build-type change (Input.selectBuildType / GameShop), so
    // we must NOT let a lagging snapshot overwrite a freshly-set non-null
    // local value (that causes a 1-frame flicker). Mirror only the CLEAR:
    // when the worker has nulled it, null the preview; never overwrite a
    // non-null local value from the snapshot.
    if (meta.selectedTowerType === null) gs.selectedTowerType = null;
    // hoverTile / upgradeBtnClickAnim are host-authoritative (updated directly on
    // gameStore by Input.ts / SvgGameRoot.vue) — do NOT mirror them or they would
    // clobber the main-thread values. camera is main-thread-only — NOT mirrored.
    //
    // selectedTower IS mirrored: it is the projection of the worker-authorized
    // meta.selectedTowerId. TowerPanel keys its interval setup on the selected
    // *id*, so a per-frame reassignment would not tear that interval down, but
    // it would still produce a brand-new object reference each tick (defeating
    // Vue identity stability) and the object is a snapshot cast as Tower (any
    // method call would throw). Keep the reference stable and refresh the
    // tower's mutable fields in place instead.
    if (this.lastSelectedTowerId !== meta.selectedTowerId || !this.cachedSelectedTower) {
      this.cachedSelectedTower = this.resolveSelectedTower();
      this.lastSelectedTowerId = meta.selectedTowerId;
      gs.selectedTower = this.cachedSelectedTower;
    } else if (this.cachedSelectedTower) {
      const fresh = this.resolveSelectedTower();
      if (fresh) {
        // Mutate through the reactive proxy (gs.selectedTower) rather than the
        // raw cachedSelectedTower. Object.assign on the raw target updates the
        // values Vue reads, but does NOT fire the proxy's set traps, so dependent
        // computeds (e.g. TowerPanel's `upgradeCheck` driving the Upgrade button's
        // cost/level) never re-evaluate and the panel stays stale after an
        // upgrade. Writing via the proxy triggers reactivity and keeps the cached
        // raw object in sync (proxy and raw share the same target).
        const proxy = gs.selectedTower;
        if (proxy) Object.assign(proxy, fresh);
      }
    }
    // hoverUpgradeBtn is intentionally NOT mirrored here — the engine no longer
    // writes it (GameEngine.setHover was removed in Phase 7), so mirroring would
    // clobber the main-thread value with the engine's always-false default.
  }

  // Resolve selectedTowerId → Tower object for components that bind to the live
  // object. This is a temporary bridge until those components are refactored to
  // read from the snapshot directly (Phase 9). It returns a TowerSnapshot cast
  // to Tower; components that only read fields work; components that call
  // methods will break — those code paths are routed through commands.
  resolveSelectedTower(): Tower | null {
    const id = this.current?.meta.selectedTowerId;
    if (!id || !this.current) return null;
    return (this.current.towers.find((tower) => tower.id === id) as unknown as Tower) ?? null;
  }
}
