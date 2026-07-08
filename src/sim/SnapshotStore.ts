import type { GameStore } from "@/stores/game.js";
import type { Tower } from "@/towers/Tower.js";
import type { SimulationSnapshot } from "./SimulationSnapshot.js";

// Module-level mirror of the latest snapshot so non-reactive Vue components
// (e.g. StatsPanel) can read it without threading the SnapshotStore instance
// everywhere. Kept store-free to preserve the sim/main-thread boundary.
let latestSnapshot: SimulationSnapshot | null = null;

export function getLatestSnapshot(): SimulationSnapshot | null {
  return latestSnapshot;
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
      if (fresh) Object.assign(this.cachedSelectedTower, fresh);
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
