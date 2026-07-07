// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import TowerPanel from "@/components/TowerPanel.vue";
import type { GameEngine } from "@/game/GameEngine.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import type { Tower } from "@/towers/Tower.js";

interface TowerStats {
  damage: number;
  range: number;
  fireRate: number;
  splash: number;
}

interface MockTower {
  type: string;
  level: number;
  color: string;
  targeting: string;
  variant: string | null;
  stats: TowerStats;
  totalDamageDealt: number;
  waveDamage: number;
  canUpgrade: () => Record<string, unknown>;
  upgradeCost: () => number;
  sellValue: () => number;
  currentMilestoneBonus: () => unknown;
  canCancel: () => boolean;
  cancelRemainingMs: () => number;
  totalInvested: number;
  levelCosts: number[];
}

interface EngineMock extends GameEngine {
  upgradeSelected: Mock;
  sellSelected: Mock;
  downgradeSelected: Mock;
  specializeSelected: Mock;
  setTargeting: Mock;
  getUpgradeCost: () => number;
  cancelSelected: Mock;
}

function makeMockTower(overrides: Partial<MockTower> = {}): MockTower {
  const level = overrides.level ?? 1;
  const levelCosts = overrides.levelCosts ?? Array.from({ length: level }, (_, i) => 20 + i * 10);
  return {
    type: "basic",
    level,
    color: "#8fbc8f",
    targeting: "first",
    variant: null,
    stats: { damage: 8, range: 3.5, fireRate: 1.2, splash: 0 },
    totalDamageDealt: 100,
    waveDamage: 50,
    canUpgrade: () => ({ ok: true, nextLevel: 2 }),
    upgradeCost: () => 20,
    sellValue: () => 12,
    currentMilestoneBonus: () => null,
    canCancel: () => false,
    cancelRemainingMs: () => 0,
    totalInvested: 20,
    levelCosts,
    ...overrides,
  };
}

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  themeStore: ReturnType<typeof useMapThemeStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
  engineMock: EngineMock;
}

function mountTowerPanel(tower: MockTower | null = null): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const themeStore = useMapThemeStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  themeStore.defaultTheme = {
    id: "default",
    towers: {
      basic: { name: "Rifle Tower" },
      ice: { name: "Frost Pylon" },
      power: { name: "Power Tower" },
      sniper: { name: "Sniper Nest" },
      poison: { name: "Poison Tower" },
      splash: { name: "Splash Tower" },
      railgun: { name: "Rail Cannon" },
    },
    enemies: {},
    regions: [],
  } as never;
  themeStore.activeTheme = themeStore.defaultTheme;
  gameStore.selectedTower = tower as unknown as Tower;
  gameStore.gold = 500;
  const engineMock = {
    upgradeSelected: vi.fn(),
    sellSelected: vi.fn(),
    downgradeSelected: vi.fn(),
    specializeSelected: vi.fn(),
    setTargeting: vi.fn(),
    getUpgradeCost: () => 20,
    cancelSelected: vi.fn(),
  } as unknown as EngineMock;
  gameStore.engine = engineMock;
  return { pinia, gameStore, themeStore, persistStore, uiStore, engineMock };
}

describe("TowerPanel", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  it("renders when a tower is selected", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".tower-panel").exists()).toBe(true);
  });

  it("does not render when no tower is selected", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(null);
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".tower-panel").exists()).toBe(false);
  });

  it("displays tower name and level", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, themeStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Lv 3");
    expect(wrapper.text()).toContain("Rifle Tower");
  });

  it("displays tower stats (damage, fireRate, range)", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Damage");
    expect(wrapper.text()).toContain("Range");
    expect(wrapper.text()).toContain("Fire Rate");
  });

  it("shows upgrade button with cost", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower());
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Upgrade");
  });

  it("disables upgrade when cannot afford", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, engineMock } = mountTowerPanel(makeMockTower());
    gameStore.gold = 0;
    engineMock.getUpgradeCost = () => 100;
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const upgradeBtn = wrapper.find("button.action-btn:not(.sell-btn)");
    expect(upgradeBtn.attributes("disabled")).toBeDefined();
  });

  it("shows sell button with refund value", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ sellValue: () => 12 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Sell");
    expect(wrapper.text()).toContain("12g");
  });

  it("shows downgrade button with level info and refund", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Downgrade");
    expect(wrapper.text()).toContain("Lv 3");
    expect(wrapper.text()).toContain("Lv 2");
  });

  it("disables downgrade button when tower is level 1", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ level: 1 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const downgradeBtn = wrapper.findAll("button.action-btn").find((btn) => btn.text().includes("Downgrade"));
    expect(downgradeBtn).toBeDefined();
    expect(downgradeBtn!.attributes("disabled")).toBeDefined();
  });

  it("calls engine.downgradeSelected when downgrade button is clicked", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, engineMock } = mountTowerPanel(makeMockTower({ level: 3 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const downgradeBtn = wrapper.findAll("button.action-btn").find((btn) => btn.text().includes("Downgrade"));
    await downgradeBtn?.trigger("click");
    expect(engineMock.downgradeSelected).toHaveBeenCalled();
  });

  it("shows specialization options at level 4", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 4, canUpgrade: () => ({ needVariant: true }) }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Choose Specialization");
  });

  it("updates targetingMode ref when select changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ targeting: "first" }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const select = wrapper.find(".target-select");
    await select.setValue("last");
    expect((select.element as HTMLOptionElement).value).toBe("last");
  });

  it("calls engine.setTargeting when targeting changes", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore, engineMock } = mountTowerPanel(
      makeMockTower({ targeting: "first" }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    const select = wrapper.find(".target-select");
    await select.setValue("closest");
    expect(engineMock.setTargeting).toHaveBeenCalledWith("closest");
  });

  it("displays wave damage stat", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ waveDamage: 50 }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Wave Damage");
  });

  it("shows cancel build button when tower can be canceled", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 1, canCancel: () => true, cancelRemainingMs: () => 45000, totalInvested: 20 }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain("Cancel Build");
  });

  it("does not show cancel build button when tower cannot be canceled", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ canCancel: () => false }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.text()).not.toContain("Cancel Build");
  });

  it("shows specialization badge for specialized tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(
      makeMockTower({ level: 5, variant: "A", canUpgrade: () => ({ ok: true, nextLevel: 6 }) }),
    );
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".spec-badge").exists()).toBe(true);
  });

  it("does not show specialization badge for non-specialized tower", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountTowerPanel(makeMockTower({ variant: null }));
    const wrapper = mount(TowerPanel, { global: { plugins: [pinia] } });
    expect(wrapper.find(".spec-badge").exists()).toBe(false);
  });
});
