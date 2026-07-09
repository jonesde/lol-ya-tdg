// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import DebugPanel from "@/components/DebugPanel.vue";
import type { Command } from "@/sim/Command.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
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

// Records commands dispatched through the command seam so we can assert the
// DebugPanel routes its actions there (the worker is not present in this test).
function recordCommands(): Command[] {
  const commands: Command[] = [];
  setCommandDispatcher({ dispatch: (command: Command) => commands.push(command) });
  return commands;
}

function clickButton(wrapper: ReturnType<typeof mount>, label: string) {
  const buttons = wrapper.findAll("button");
  const target = buttons.find((button) => button.text().includes(label))!;
  return target.trigger("click");
}

describe("DebugPanel", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders with hidden class when debugPanelVisible is false", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    uiStore.debugPanelVisible = false;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".debug-panel.hidden").exists()).toBe(true);
  });

  it("renders without hidden class when debugPanelVisible is true", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    uiStore.debugPanelVisible = true;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".debug-panel.hidden").exists()).toBe(false);
  });

  it("closes panel when X button is clicked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountDebugPanel();
    uiStore.debugPanelVisible = true;
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    const closeBtn = wrapper.find(".debug-close");
    expect(closeBtn.exists()).toBe(true);
    await closeBtn.trigger("click");
    expect(uiStore.debugPanelVisible).toBe(false);
  });

  it("dispatches action:debug addGold on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Gold");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "addGold", amount: 1000 }));
  });

  it("dispatches action:debug addGems on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Gems");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "addGems", amount: 100 }));
  });

  it("dispatches action:debug addLives on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Lives");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "addLives", amount: 10 }));
  });

  it("dispatches action:debug setWave on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Set Wave");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "setWave", amount: 50 }));
  });

  it("dispatches action:debug setTimeScale toggle on click", async () => {
    const { pinia, gameStore } = mountDebugPanel();
    gameStore.timeScale = 16;
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Speed");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "setTimeScale", amount: 1 }));
  });

  it("dispatches action:debug skipWave on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Skip Wave");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "skipWave" }));
  });

  it("dispatches action:debug killAll on click", async () => {
    const { pinia } = mountDebugPanel();
    const commands = recordCommands();
    const wrapper = mount(DebugPanel, { global: { plugins: [pinia] } });
    await clickButton(wrapper, "Kill All");
    expect(commands).toContainEqual(expect.objectContaining({ type: "action:debug", kind: "killAll" }));
  });
});
