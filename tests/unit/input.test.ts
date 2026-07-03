// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameState } from "@/game/Constants.js";
import { TowerIds } from "@/game/ConstantsTower.js";
import { useInput } from "@/game/Input.js";
import type { Tower } from "@/towers/Tower.js";
import { createTestGameStore, createTestUiStore } from "../helpers/mock-stores";

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

function makeEngine() {
  return { togglePause: vi.fn(), upgradeSelected: vi.fn(), sellSelected: vi.fn(), cancelBuildMode: vi.fn() };
}

function makeEvent(key: string, opts: Record<string, unknown> = {}) {
  const event = new KeyboardEvent("keydown", { key, ...opts });
  return event;
}

describe("useInput", () => {
  let gameStore: ReturnType<typeof createTestGameStore>;
  let uiStore: ReturnType<typeof createTestUiStore>;
  let engine: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    gameStore = createTestGameStore();
    uiStore = createTestUiStore();
    engine = makeEngine();
  });

  afterEach(() => {
    window.removeEventListener("keydown", () => {});
    warnSpy.mockRestore();
  });

  function triggerInput(key: string, opts: Record<string, unknown> = {}) {
    window.dispatchEvent(makeEvent(key, opts));
  }

  describe("returns early in non-play states", () => {
    it("returns early in MENU state", () => {
      gameStore.setState(GameState.MENU);
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(engine.togglePause).not.toHaveBeenCalled();
    });

    it("returns early in GAME_OVER state", () => {
      gameStore.setState(GameState.GAME_OVER);
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(engine.togglePause).not.toHaveBeenCalled();
    });

    it("returns early in VICTORY state", () => {
      gameStore.setState(GameState.VICTORY);
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(engine.togglePause).not.toHaveBeenCalled();
    });
  });

  describe("Space bar", () => {
    it("toggles pause via engine", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(engine.togglePause).toHaveBeenCalled();
    });

    it("calls preventDefault", () => {
      gameStore.setState(GameState.PLAYING);
      let capturedHandler: ((event: KeyboardEvent) => void) | null = null;
      const originalAddEventListener = window.addEventListener;
      window.addEventListener = vi.fn((event: string, handler: (e: KeyboardEvent) => void) => {
        if (event === "keydown") capturedHandler = handler;
        originalAddEventListener.call(window, event, handler as unknown as EventListener);
      }) as never;
      useInput(gameStore, engine, uiStore);
      window.addEventListener = originalAddEventListener;
      expect(capturedHandler).toBeDefined();
      const testEvent = makeEvent(" ");
      testEvent.preventDefault = vi.fn();
      (capturedHandler as ((e: KeyboardEvent) => void) | null)?.(testEvent);
      expect(testEvent.preventDefault).toHaveBeenCalled();
    });

    it("closes pause menu and unpauses when menu is open", () => {
      gameStore.setState(GameState.PAUSED);
      uiStore.openMenuFromGame();
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(uiStore.showMainMenu).toBe(false);
    });
  });

  describe("Escape key", () => {
    it("closes all dialogs when a dialog is open", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      uiStore.showConfirm({ title: "T", message: "M" });
      triggerInput("Escape");
      expect(uiStore.confirmDialog).toBeNull();
    });

    it("cancels build mode when build mode is active", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = "cannon";
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(engine.cancelBuildMode).toHaveBeenCalled();
    });

    it("deselects tower when a tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(gameStore.selectedTower).toBeNull();
    });

    it("opens menu when no dialog is open and no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(uiStore.showMainMenu).toBe(true);
    });

    it("closes menu on second press", () => {
      gameStore.setState(GameState.PAUSED);
      uiStore.openMenuFromGame();
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(uiStore.showMainMenu).toBe(false);
    });
  });

  describe("u key (upgrade)", () => {
    it("calls engine.upgradeSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("u");
      expect(engine.upgradeSelected).toHaveBeenCalled();
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("u");
      expect(engine.upgradeSelected).not.toHaveBeenCalled();
    });
  });

  describe("Up Arrow (upgrade)", () => {
    it("calls engine.upgradeSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(engine.upgradeSelected).toHaveBeenCalled();
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(engine.upgradeSelected).not.toHaveBeenCalled();
    });
  });

  describe("s key (sell)", () => {
    it("calls engine.sellSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("s");
      expect(engine.sellSelected).toHaveBeenCalled();
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("s");
      expect(engine.sellSelected).not.toHaveBeenCalled();
    });
  });

  describe("Right Arrow (cycle speed forward)", () => {
    it("cycles timeScale forward", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.timeScale).toBe(2);
    });

    it("cycles from 8 back to 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 8;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("Left Arrow (cycle speed reverse)", () => {
    it("cycles timeScale reverse", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.timeScale).toBe(8);
    });

    it("cycles from 1 back to 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 2;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("number keys 1-9 (build mode)", () => {
    it("key 1 activates first tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("1");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("key 2 activates second tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("2");
      expect(gameStore.selectedTowerType).toBe(TowerIds.ICE);
    });

    it("key 6 activates sixth tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("6");
      expect(gameStore.selectedTowerType).toBe(TowerIds.RAILGUN);
    });

    it("key 7 wraps to first tower", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("7");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("key 9 wraps to third tower", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("9");
      expect(gameStore.selectedTowerType).toBe(TowerIds.SNIPER);
    });

    it("non-digit keys are ignored", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("x");
      expect(gameStore.selectedTowerType).toBeNull();
    });
  });

  describe("Tab key (cycle)", () => {
    it("cycles build mode to next tower type", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.BASIC;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTowerType).toBe(TowerIds.ICE);
    });

    it("cycles from last tower back to first", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.RAILGUN;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("selects first tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = {
        towers: [
          { tileX: 3, tileY: 2, id: "tower-1" },
          { tileX: 5, tileY: 2, id: "tower-2" },
        ],
      };
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTower).toEqual({ tileX: 3, tileY: 2, id: "tower-1" });
    });

    it("selects next tower when one is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { tileX: 3, tileY: 2, id: "tower-1" } as unknown as Tower;
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = {
        towers: [
          { tileX: 3, tileY: 2, id: "tower-1" },
          { tileX: 5, tileY: 2, id: "tower-2" },
        ],
      };
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTower).toEqual({ tileX: 5, tileY: 2, id: "tower-2" });
    });

    it("wraps from last tower back to first", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { tileX: 5, tileY: 2, id: "tower-2" } as unknown as Tower;
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = {
        towers: [
          { tileX: 3, tileY: 2, id: "tower-1" },
          { tileX: 5, tileY: 2, id: "tower-2" },
        ],
      };
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTower).toEqual({ tileX: 3, tileY: 2, id: "tower-1" });
    });

    it("does nothing when no towers have been built", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [] };
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTower).toBeNull();
    });

    it("selects first tower in row-major order (right then down)", () => {
      gameStore.setState(GameState.PLAYING);
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = {
        towers: [
          { tileX: 5, tileY: 3, id: "tower-right" },
          { tileX: 2, tileY: 1, id: "tower-first" },
          { tileX: 4, tileY: 1, id: "tower-second" },
        ],
      };
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTower).toEqual({ tileX: 2, tileY: 1, id: "tower-first" });
    });
  });

  describe("Enter key (confirm dialog)", () => {
    it("executes confirm when dialog is active", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      uiStore.showConfirm({ title: "T", message: "M", onConfirm: () => {} });
      triggerInput("Enter");
      expect(uiStore.confirmDialog).toBeNull();
    });

    it("does nothing when no confirm dialog is active", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("Enter");
      expect(gameStore.state).toBe(GameState.PLAYING);
    });
  });

  describe("unknown keys", () => {
    it("does nothing for unknown keys", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("x");
      expect(engine.togglePause).not.toHaveBeenCalled();
      expect(engine.upgradeSelected).not.toHaveBeenCalled();
      expect(engine.sellSelected).not.toHaveBeenCalled();
    });
  });
});
