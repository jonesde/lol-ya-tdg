// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import MapSelect from "@/components/MapSelect.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  router: ReturnType<typeof createRouter>;
}

function createRouterWithRoutes(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", name: "main-menu", component: { template: "<div>MainMenu</div>" } },
    { path: "/map-select", name: "map-select", component: { template: "<div>MapSelect</div>" } },
    { path: "/game", name: "game", component: { template: "<div>Game</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountMapSelect(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("MapSelect", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders 36 map buttons", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const mapCards = wrapper.findAll(".map-card");
    expect(mapCards.length).toBe(36);
  });

  it("shows locked state for unlocked maps", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
  });

  it("shows best wave for completed maps", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.bestWaves.best_0 = 15;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Best Wave: 15");
  });

  it("displays region name for each map", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Verdant Marches");
    expect(wrapper.text()).toContain("Sunscorch Coast");
    expect(wrapper.text()).toContain("Thornpeak Wilds");
  });

  it("shows region headers", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const regionHeaders = wrapper.findAll(".region-label");
    expect(regionHeaders.length).toBe(3);
  });

  it("navigates to /game on map select", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const firstCard = wrapper.findAll(".map-card")[0];
    await firstCard.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/game");
  });

  it("does not navigate when clicking locked map", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    await router.replace("/map-select");
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
    await lockedCards[0].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("displays gem reward multiplier for each map", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("💎");
  });

  it("reactively updates locked status when highestUnlockedMap changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMapSelect();
    persistStore.highestUnlockedMap = 0;
    const wrapper = mount(MapSelect, { global: { plugins: [router, pinia] } });
    const lockedCards = wrapper.findAll(".map-card.locked");
    expect(lockedCards.length).toBeGreaterThan(0);
    persistStore.highestUnlockedMap = 5;
    await wrapper.vm.$nextTick();
    const mapCards = wrapper.findAll(".map-card");
    expect(mapCards[1].classes("locked")).toBe(false);
    expect(mapCards[6].classes("locked")).toBe(true);
  });
});
