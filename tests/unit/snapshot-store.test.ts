/**
 * Regression test for SnapshotStore.selectedTower mirroring.
 *
 * The selected tower object reference is kept stable across ticks (to preserve
 * identity for TowerPanel's interval setup), but its mutable fields must be
 * refreshed through the reactive proxy so Vue dependency tracking fires. A raw
 * Object.assign on the cached underlying object updated the values but did NOT
 * trigger reactivity, leaving the Upgrade button (canUpgrade cost/level) stale
 * after an upgrade.
 */

import { describe, expect, it } from "vitest";
import { computed, nextTick, watch } from "vue";
import type { SimulationSnapshot, TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { createTestGameStore } from "../helpers/mock-stores";

function makeTowerSnapshot(id: string, level: number, cost: number, nextLevel: number, waveDamage = 0): TowerSnapshot {
  return {
    id,
    type: "basic",
    x: 0,
    y: 0,
    tileX: 0,
    tileY: 0,
    level,
    variant: null,
    angle: 0,
    cooldown: 0,
    targeting: "first",
    totalInvested: 0,
    waveDamage,
    totalDamageDealt: 0,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    health: 100,
    maxHealth: 100,
    sellValue: 10,
    color: "#fff",
    animation: null,
    canUpgrade: { ok: true, cost, nextLevel },
    upgradeCostAt5: 100,
    levelCosts: [0, 1, 2, 3, 4],
    milestoneBonus: { damagePct: 0, speedPct: 0, tiers: 0 },
    stats: { damage: 10, range: 3, fireRate: 1, splash: 0, chain: 0 },
    base: { fixedAim: false },
    placedAt: 0,
  };
}

function makeSnapshot(selectedTowerId: string | null, tower: TowerSnapshot | null): SimulationSnapshot {
  return {
    schemaVersion: 1,
    frameId: 1,
    lastAppliedCommandId: 0,
    meta: {
      state: "playing",
      mapIndex: 0,
      baseHealth: 20,
      maxBaseHealth: 100,
      gold: 100,
      currentWave: 1,
      waveCountdown: null,
      timeScale: 1,
      selectedTowerId,
      selectedTowerType: null,
      hoverTile: null,
      hoverUpgradeBtn: false,
      upgradeBtnClickAnim: 0,
      runGemsEarned: 0,
      bossesKilledThisRun: 0,
      bossesReachedBaseThisRun: 0,
      lastScaledDt: 0,
      endScreenData: null,
    },
    enemies: [],
    towers: tower ? [tower] : [],
    projectiles: [],
    particleSpawns: undefined,
    spawnStates: [],
    paths: [],
    pathsVersion: 0,
    waveGraphDots: [],
    waveGraphDotsGeneration: 0,
    lightningEffects: [],
    stunEffects: [],
  };
}

describe("SnapshotStore selectedTower mirroring", () => {
  it("refreshes mutable fields through the reactive proxy after an upgrade", async () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const selected = () => gameStore.selectedTower as unknown as TowerSnapshot | null;

    const towerId = "tower-1";

    // First snapshot: level 1, upgrade costs 50 → Lv 2.
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 1, 50, 2)));
    expect(selected()?.level).toBe(1);
    expect(selected()?.canUpgrade?.cost).toBe(50);
    expect(selected()?.canUpgrade?.nextLevel).toBe(2);

    // Track whether a dependent computed re-evaluates after the upgrade.
    let upgradeCostEvaluations = 0;
    const trackedUpgradeCost = computed(() => {
      upgradeCostEvaluations++;
      return selected()?.canUpgrade?.cost ?? null;
    });
    // Prime the computed + its reactive dependencies.
    expect(trackedUpgradeCost.value).toBe(50);
    const initialEvaluations = upgradeCostEvaluations;

    // Second snapshot (after upgrade): level 2, upgrade costs 80 → Lv 3.
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 2, 80, 3)));
    await nextTick();

    // Values must reflect the latest snapshot...
    expect(selected()?.level).toBe(2);
    expect(selected()?.canUpgrade?.cost).toBe(80);
    expect(selected()?.canUpgrade?.nextLevel).toBe(3);
    // ...and the dependent computed must have re-evaluated (reactivity fired),
    // not return the stale cached cost of 50.
    expect(trackedUpgradeCost.value).toBe(80);
    expect(upgradeCostEvaluations).toBeGreaterThan(initialEvaluations);
  });

  it("notifies watchers on selected tower field changes", async () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const towerId = "tower-2";

    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 1, 50, 2)));

    let sawLevel: number | null = null;
    const stop = watch(
      () => (gameStore.selectedTower as unknown as TowerSnapshot | null)?.level ?? null,
      (value) => {
        sawLevel = value;
      },
    );

    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 3, 120, 4)));
    await nextTick();

    expect(sawLevel).toBe(3);
    stop();
  });

  it("persists previousWaveDamage across frames, not just the reset frame", () => {
    const gameStore = createTestGameStore();
    const store = new SnapshotStore(gameStore as never);
    const towerId = "tower-3";
    const selected = () => gameStore.selectedTower as unknown as TowerSnapshot | null;

    // Frame A: tower deals 50 damage this wave. No reset yet → no previous wave.
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 1, 50, 2, 50)));
    expect(selected()?.previousWaveDamage).toBeUndefined();

    // Frame B: wave starts, engine resets waveDamage to 0. Transition captured.
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 1, 50, 2, 0)));
    expect(selected()?.previousWaveDamage).toBe(50);

    // Frame C: mid next wave (waveDamage climbing again). The value must persist
    // (previously it flashed 50 only on frame B, then reverted to 0).
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 1, 50, 2, 10)));
    expect(selected()?.previousWaveDamage).toBe(50);
  });
});
