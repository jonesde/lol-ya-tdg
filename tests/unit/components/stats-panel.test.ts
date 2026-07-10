// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { computed, nextTick } from "vue";
import StatsPanel from "@/components/StatsPanel.vue";
import type { SimulationSnapshot, TowerSnapshot } from "@/sim/SimulationSnapshot.js";
import { getLatestSnapshot, SnapshotStore } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";

function makeTower(id: string, totalDamageDealt: number): TowerSnapshot {
  return {
    id,
    type: "basic",
    x: 0,
    y: 0,
    tileX: 0,
    tileY: 0,
    level: 1,
    variant: null,
    angle: 0,
    cooldown: 0,
    targeting: "first",
    totalInvested: 0,
    waveDamage: 0,
    totalDamageDealt,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    health: 0,
    maxHealth: 0,
    sellValue: 0,
    color: "#fff",
    animation: null,
    canUpgrade: { ok: true, cost: 1, nextLevel: 2 },
    upgradeCostAt5: 0,
    levelCosts: [0, 1],
    milestoneBonus: { damagePct: 0, speedPct: 0, tiers: 0 },
    stats: { damage: 1, range: 1, fireRate: 1, splash: 0, chain: 0 },
    base: { fixedAim: false },
  };
}

function makeEnemy(id: number, type: string): never {
  return {
    id,
    type,
    x: 0,
    y: 0,
    radius: 1,
    hp: 50,
    maxHp: 100,
    shield: 0,
    maxShield: 0,
    angle: 0,
    level: 1,
    onPathBlocked: false,
    removed: false,
    slowFactor: 1,
    slowTimer: 0,
    burnTimer: 0,
    hitFlash: 0,
    gameSeconds: 0,
    hitAnimTime: 0,
    walkingFrameIndex: 0,
    isBoss: false,
    statusEffects: [],
    walking: null,
    hitReaction: null,
  };
}

function makeSnapshot(frameId: number, towers: TowerSnapshot[], enemies: unknown[]): SimulationSnapshot {
  return {
    schemaVersion: 1,
    frameId,
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
      selectedTowerId: null,
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
        bossKills: { base: 0 },
        milestones: { base: 0 },
        waveCompletion: { base: 0 },
        firstClearBonus: 0,
      },
      milestoneRewardsClaimed: {},
    },
    enemies: enemies as never,
    towers,
    projectiles: [],
    particles: [],
    spawnStates: [],
    paths: [],
    lightningEffects: [],
    stunEffects: [],
  } as SimulationSnapshot;
}

describe("StatsPanel snapshot reactivity", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("re-reads getLatestSnapshot on each frame via gameStore.frameId", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    const uiStore = useUiStore();
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = { id: "default", towers: {}, enemies: {}, regions: [] } as never;
    themeStore.activeTheme = themeStore.defaultTheme;
    uiStore.showStatsPanel = true;

    const store = new SnapshotStore(gameStore as never);
    store.apply(makeSnapshot(1, [makeTower("t1", 100)], []));

    const wrapper = mount(StatsPanel, { global: { plugins: [pinia] }, attachTo: document.body });
    await nextTick();

    // Damage Dealt reflects snapshot frame 1.
    expect(document.body.textContent).toContain("100");

    // A new snapshot arrives (frameId advances) — the read-only module variable
    // changes, but StatsPanel must re-evaluate because it depends on frameId.
    store.apply(makeSnapshot(2, [makeTower("t1", 250)], [makeEnemy(1, "minion")]));
    await nextTick();

    expect(document.body.textContent).toContain("250");
    expect(document.body.textContent).toContain("Active Enemies");

    wrapper.unmount();
  });

  it("verifies the frameId mirror advances so non-reactive readers can react", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    const store = new SnapshotStore(gameStore as never);
    expect(gameStore.frameId).toBe(0);
    store.apply(makeSnapshot(7, [], []));
    expect(gameStore.frameId).toBe(7);

    // The same pattern StatsPanel uses must re-evaluate on frameId change.
    let reads = 0;
    const reactiveSnapshot = computed(() => {
      void gameStore.frameId;
      reads++;
      return getLatestSnapshot();
    });
    expect(reactiveSnapshot.value?.frameId).toBe(7);
    const before = reads;
    store.apply(makeSnapshot(8, [], []));
    expect(gameStore.frameId).toBe(8);
    expect(reactiveSnapshot.value?.frameId).toBe(8);
    expect(reads).toBeGreaterThan(before);
  });
});
