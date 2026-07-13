import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { computed, nextTick } from "vue";
import StatsPanel from "@/components/StatsPanel.vue";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { getLatestSnapshot, SnapshotStore } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { useUiStore } from "@/stores/ui.js";
import { buildTestTower, createTestEngine } from "../../helpers/engine-snapshot";
import { mockDefaultTheme } from "../../helpers/mock-stores";

let nextCommandId = 0;

// StatsPanel renders via <Teleport to="body">, so query the document, not the
// wrapper subtree.
function statCardValue(label: string): string | null {
  for (const card of document.body.querySelectorAll(".stat-card")) {
    if (card.querySelector(".stat-card-label")?.textContent === label) {
      return card.querySelector(".stat-card-value")?.textContent ?? null;
    }
  }
  return null;
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
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    uiStore.showStatsPanel = true;

    const engine = createTestEngine();
    const tower = buildTestTower(engine);
    tower.totalDamageDealt = 100;

    const store = new SnapshotStore(gameStore as never);
    store.apply(buildSnapshot(engine, nextCommandId++));

    const wrapper = mount(StatsPanel, { global: { plugins: [pinia] }, attachTo: document.body });
    await nextTick();

    // Damage Dealt reflects the first snapshot.
    expect(statCardValue("Damage Dealt")).toBe("100");

    // A new snapshot arrives (frameId advances) — the read-only module variable
    // changes, but StatsPanel must re-evaluate because it depends on frameId.
    tower.totalDamageDealt = 250;
    engine.enemyManager!.spawn("minion", 1, 0, 1);
    store.apply(buildSnapshot(engine, nextCommandId++));
    await nextTick();

    expect(statCardValue("Damage Dealt")).toBe("250");
    expect(document.body.textContent).toContain("Active Enemies");
    expect(document.body.querySelector(".enemy-count")?.textContent).toContain("1");

    wrapper.unmount();
  });

  it("verifies the frameId mirror advances so non-reactive readers can react", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    const store = new SnapshotStore(gameStore as never);
    const engine = createTestEngine();

    expect(gameStore.frameId).toBe(0);
    const first = buildSnapshot(engine, nextCommandId++);
    store.apply(first);
    expect(gameStore.frameId).toBe(first.frameId);

    // The same pattern StatsPanel uses must re-evaluate on frameId change.
    let reads = 0;
    const reactiveSnapshot = computed(() => {
      void gameStore.frameId;
      reads++;
      return getLatestSnapshot();
    });
    expect(reactiveSnapshot.value?.frameId).toBe(first.frameId);
    const before = reads;
    const second = buildSnapshot(engine, nextCommandId++);
    store.apply(second);
    expect(second.frameId).toBeGreaterThan(first.frameId);
    expect(gameStore.frameId).toBe(second.frameId);
    expect(reactiveSnapshot.value?.frameId).toBe(second.frameId);
    expect(reads).toBeGreaterThan(before);
  });
});
