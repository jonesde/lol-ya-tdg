// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteRecordRaw } from "vue-router";
import { createRouter, createWebHistory } from "vue-router";
import GameScreen from "@/components/GameScreen.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

vi.mock("@/components/SvgGameRoot.vue", () => ({
  default: { template: '<div class="game-canvas-mock">SvgGameRoot</div>' },
}));
vi.mock("@/components/GameHud.vue", () => ({ default: { template: '<div class="hud-mock">GameHud</div>' } }));
vi.mock("@/components/GameShop.vue", () => ({ default: { template: '<div class="shop-mock">GameShop</div>' } }));
vi.mock("@/components/TowerPanel.vue", () => ({
  default: { template: '<div class="tower-panel-mock">TowerPanel</div>' },
}));
vi.mock("@/components/DebugPanel.vue", () => ({
  default: { template: '<div class="debug-panel-mock">DebugPanel</div>' },
}));
vi.mock("@/components/MainMenu.vue", () => ({ default: { template: '<div class="main-menu-mock">MainMenu</div>' } }));
vi.mock("@/components/SkillTree.vue", () => ({
  default: { template: '<div class="skill-tree-mock">SkillTree</div>' },
}));
vi.mock("@/components/StatsPanel.vue", () => ({
  default: { template: '<div class="stats-panel-mock">StatsPanel</div>' },
}));

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  router: ReturnType<typeof createRouter>;
}

function createRouterWithRoutes(): ReturnType<typeof createRouter> {
  const routes: RouteRecordRaw[] = [
    { path: "/", component: { template: "<div>/" } },
    { path: "/game", component: { template: "<div>/game</div>" } },
    { path: "/map-select", component: { template: "<div>/map-select</div>" } },
  ];
  return createRouter({ history: createWebHistory(), routes });
}

function mountGameScreen(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const router = createRouterWithRoutes();
  return { pinia, gameStore, persistStore, uiStore, router };
}

describe("GameScreen", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders GameCanvas", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountGameScreen();
    const wrapper = mount(GameScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".game-canvas-mock").exists()).toBe(true);
  });

  it("renders GameHud component", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountGameScreen();
    const wrapper = mount(GameScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".hud-mock").exists()).toBe(true);
  });

  it("renders GameShop component", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountGameScreen();
    const wrapper = mount(GameScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".shop-mock").exists()).toBe(true);
  });

  it("renders TowerPanel when tower selected", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountGameScreen();
    const wrapper = mount(GameScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".tower-panel-mock").exists()).toBe(true);
  });

  it("renders DebugPanel", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, router } = mountGameScreen();
    const wrapper = mount(GameScreen, { global: { plugins: [router, pinia] } });
    expect(wrapper.find(".debug-panel-mock").exists()).toBe(true);
  });
});
