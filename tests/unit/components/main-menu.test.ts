// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createMemoryHistory, createRouter } from "vue-router";
import MainMenu from "@/components/MainMenu.vue";
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
    { path: "/skill-tree", name: "skill-tree", component: { template: "<div>SkillTree</div>" } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

function mountMainMenu(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  gameStore.resetToMenu();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("MainMenu", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders new game button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("New Game");
  });

  it("renders skill tree button", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("Upgrades!");
  });

  it("renders difficulty slider", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    expect(slider.exists()).toBe(true);
  });

  it("displays current difficulty value", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.setDifficultyTick(4);
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("×2.00");
  });

  it("updates difficulty on slider change", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    await slider.setValue(6);
    expect(persistStore.difficulty.multiplierTick).toBe(6);
  });

  it("slider reflects store difficulty changes from outside", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.setDifficultyTick(8);
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const slider = wrapper.find('input[type="range"]');
    expect(parseInt((slider.element as HTMLInputElement).value, 10)).toBe(8);
  });

  it("displays gem count", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    persistStore.gems = 250;
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    expect(wrapper.text()).toContain("250");
  });

  it("navigates to /map-select on new game click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const newGameBtn = wrapper.findAll("button").find((button) => button.text().includes("New Game"))!;
    await newGameBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/map-select");
  });

  it("navigates to /skill-tree on skill tree click when not in game", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountMainMenu();
    const wrapper = mount(MainMenu, { global: { plugins: [router, pinia] } });
    const skillBtn = wrapper.findAll("button").find((button) => button.text().includes("Upgrades"))!;
    await skillBtn.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.currentRoute.value.path).toBe("/skill-tree");
  });
});
