// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import MinimapPanel from "@/components/MinimapPanel.vue";
import type { Grid } from "@/grid/Grid.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";

function makeFakeGrid(): Grid {
  return {
    width: 4,
    height: 3,
    isTerrain: () => false,
    isPath: () => true,
    isBase: () => false,
    isSpawn: () => false,
  } as unknown as Grid;
}

function setup(): void {
  const pinia = createPinia();
  setActivePinia(pinia);
  useGameStore().grid = makeFakeGrid();
  useUiStore().showMinimap = true;
}

describe("MinimapPanel", () => {
  it("renders a <pre> element for the static base grid", () => {
    setup();
    const wrapper = mount(MinimapPanel, { global: { plugins: [createPinia()] } });
    expect(wrapper.find("pre").exists()).toBe(true);
  });

  it("hides the panel via closeMinimap when the close button is clicked", async () => {
    setup();
    const pinia = createPinia();
    setActivePinia(pinia);
    const uiStore = useUiStore();
    uiStore.showMinimap = true;
    const wrapper = mount(MinimapPanel, { global: { plugins: [pinia] } });
    await wrapper.find(".close-btn").trigger("click");
    expect(uiStore.showMinimap).toBe(false);
  });

  it("updates gameStore.minimapPanelPos when dragged by the header", async () => {
    setup();
    const pinia = createPinia();
    setActivePinia(pinia);
    const gameStore = useGameStore();
    gameStore.minimapPanelPos = { x: 100, y: 100 };
    const wrapper = mount(MinimapPanel, { global: { plugins: [pinia] } });

    const header = wrapper.find(".panel-header");
    await header.trigger("mousedown", { button: 0, clientX: 0, clientY: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 25, clientY: 15 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 25, clientY: 15 }));

    expect(gameStore.minimapPanelPos).toEqual({ x: 125, y: 115 });
  });
});
