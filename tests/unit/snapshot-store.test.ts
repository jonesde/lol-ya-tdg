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

function makeTowerSnapshot(id: string, level: number, cost: number, nextLevel: number): TowerSnapshot {
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
    waveDamage: 0,
    totalDamageDealt: 0,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    sellValue: 10,
    color: "#fff",
    animation: null,
    canUpgrade: { ok: true, cost, nextLevel },
    upgradeCostAt5: 100,
    levelCosts: [0, 1, 2, 3, 4],
    canCancel: false,
    cancelRemainingMs: 0,
    milestoneBonus: { damagePct: 0, speedPct: 0, tiers: 0 },
    stats: { damage: 10, range: 3, fireRate: 1, splash: 0, chain: 0 },
    base: { fixedAim: false },
  };
}

function makeSnapshot(selectedTowerId: string | null, tower: TowerSnapshot | null): SimulationSnapshot {
  const emptyBreakdown = { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 };
  return {
    schemaVersion: 1,
    frameId: 1,
    lastAppliedCommandId: 0,
    meta: {
      state: "playing",
      mapIndex: 0,
      lives: 20,
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
      gemBreakdown: {
        bossKills: { ...emptyBreakdown },
        milestones: { ...emptyBreakdown },
        waveCompletion: { ...emptyBreakdown },
        firstClearBonus: 0,
      },
      milestoneRewardsClaimed: {},
    },
    enemies: [],
    towers: tower ? [tower] : [],
    projectiles: [],
    particles: [],
    spawnStates: [],
    paths: [],
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
    expect(selected()?.canUpgrade.cost).toBe(50);
    expect(selected()?.canUpgrade.nextLevel).toBe(2);

    // Track whether a dependent computed re-evaluates after the upgrade.
    let upgradeCostEvaluations = 0;
    const trackedUpgradeCost = computed(() => {
      upgradeCostEvaluations++;
      return selected()?.canUpgrade.cost ?? null;
    });
    // Prime the computed + its reactive dependencies.
    expect(trackedUpgradeCost.value).toBe(50);
    const initialEvaluations = upgradeCostEvaluations;

    // Second snapshot (after upgrade): level 2, upgrade costs 80 → Lv 3.
    store.apply(makeSnapshot(towerId, makeTowerSnapshot(towerId, 2, 80, 3)));
    await nextTick();

    // Values must reflect the latest snapshot...
    expect(selected()?.level).toBe(2);
    expect(selected()?.canUpgrade.cost).toBe(80);
    expect(selected()?.canUpgrade.nextLevel).toBe(3);
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
});
