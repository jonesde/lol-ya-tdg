// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import DebugPanel from "@/components/DebugPanel.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
}

function mountDebugPanel(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  return { pinia, gameStore, persistStore, uiStore };
}

describe("DebugPanel", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders when visible", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".debug-panel").exists()).toBe(true);
  });

  it("does not render when hidden", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".debug-panel.hidden").exists()).toBe(true);
  });

  it("injects gold on click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    gameStore.gold = 100;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    const buttons = wrapper.findAll("button");
    const goldBtn = buttons.find((button) => button.text().includes("Gold"))!;
    await goldBtn.trigger("click");
    expect(gameStore.gold).toBe(1100);
  });

  it("injects gems on click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    persistStore.gems = 50;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    const buttons = wrapper.findAll("button");
    const gemsBtn = buttons.find((button) => button.text().includes("Gems"))!;
    await gemsBtn.trigger("click");
    expect(persistStore.gems).toBe(150);
  });

  it("injects lives on click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    gameStore.lives = 10;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    const buttons = wrapper.findAll("button");
    const livesBtn = buttons.find((button) => button.text().includes("Lives"))!;
    await livesBtn.trigger("click");
    expect(gameStore.lives).toBe(20);
  });
});
