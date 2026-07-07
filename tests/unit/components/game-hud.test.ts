// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import GameHud from "@/components/GameHud.vue";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  engineMock: { togglePause: Mock };
}

function mountGameHud(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  const engineMock = { togglePause: vi.fn() };
  gameStore.engine = engineMock as never;
  return { pinia, gameStore, persistStore, uiStore, engineMock };
}

describe("GameHud", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("displays current lives", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.lives = 15;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("15");
  });

  it("displays current gold", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.gold = 250;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("250");
  });

  it("displays current wave", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.currentWave = 25;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("25");
  });

  it("displays current time scale", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.timeScale = 2;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("2×");
  });

  it("opens menu on menu button click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const menuBtn = wrapper.find("#menuBtn");
    await menuBtn.trigger("click");
    expect(uiStore.showPauseMenu).toBe(true);
  });

  it("cycles time scale on speed button", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountGameHud();
    gameStore.timeScale = 1;
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const speedBtn = wrapper.find("#speedBtn");
    await speedBtn.trigger("click");
    expect(gameStore.timeScale).toBe(2);
  });

  it("toggles pause on pause button click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, engineMock } = mountGameHud();
    gameStore.state = "playing";
    const wrapper = mount(GameHud, { global: { plugins: [pinia] } });
    const pauseBtn = wrapper.find("#pauseBtn");
    await pauseBtn.trigger("click");
    expect(engineMock.togglePause).toHaveBeenCalled();
  });
});
