import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameState } from "@/game/Constants.js";
import { TowerIds } from "@/game/ConstantsTower.js";
import { useInput } from "@/game/Input.js";
import type { Grid } from "@/grid/Grid.js";
import type { GeneratedMap } from "@/grid/Map.js";
import type { Tower } from "@/towers/Tower.js";
import { createTestGameStore, createTestUiStore } from "../helpers/mock-stores";

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

function makeEngine() {
  return {
    togglePause: vi.fn(),
    upgradeSelected: vi.fn(),
    sellSelected: vi.fn(),
    downgradeSelected: vi.fn(),
    cancelBuildMode: vi.fn(),
    setTargeting: vi.fn(),
    handleClick: vi.fn(),
  };
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
      uiStore.openPauseMenu();
      useInput(gameStore, engine, uiStore);
      triggerInput(" ");
      expect(uiStore.showPauseMenu).toBe(false);
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

    it("opens pause menu when no dialog is open and no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(uiStore.showPauseMenu).toBe(true);
    });

    it("closes pause menu on second press", () => {
      gameStore.setState(GameState.PAUSED);
      uiStore.openPauseMenu();
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(uiStore.showPauseMenu).toBe(false);
    });

    it("closes debug panel when visible", () => {
      gameStore.setState(GameState.PLAYING);
      uiStore.debugPanelVisible = true;
      useInput(gameStore, engine, uiStore);
      triggerInput("Escape");
      expect(uiStore.debugPanelVisible).toBe(false);
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

  describe("Up Arrow (tower selection / build position)", () => {
    it("moves build position up when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 2 });
    });

    it("clamps build position to grid bounds on up", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 0 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 0 });
    });

    it("selects tower above when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const below = { tileX: 3, tileY: 4, id: "t-below" };
      const above = { tileX: 3, tileY: 2, id: "t-above" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [below, above] };
      gameStore.selectedTower = below as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.selectedTower).toEqual(above);
    });

    it("selects topmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const t1 = { tileX: 3, tileY: 4, id: "t1" };
      const t2 = { tileX: 5, tileY: 1, id: "t2" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [t1, t2] };
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.selectedTower).toEqual(t2);
    });
  });

  describe("s key (downgrade/sell)", () => {
    it("calls engine.downgradeSelected when tower level > 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1, level: 3 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("s");
      expect(engine.downgradeSelected).toHaveBeenCalled();
      expect(engine.sellSelected).not.toHaveBeenCalled();
    });

    it("calls engine.sellSelected when tower level === 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1, level: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("s");
      expect(engine.sellSelected).toHaveBeenCalled();
      expect(engine.downgradeSelected).not.toHaveBeenCalled();
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("s");
      expect(engine.sellSelected).not.toHaveBeenCalled();
      expect(engine.downgradeSelected).not.toHaveBeenCalled();
    });
  });

  describe("ArrowDown (tower selection / build position)", () => {
    it("moves build position down when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 4 });
    });

    it("clamps build position to grid bounds on down", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 9 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 9 });
    });

    it("selects tower below when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const above = { tileX: 3, tileY: 2, id: "t-above" };
      const below = { tileX: 3, tileY: 4, id: "t-below" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [above, below] };
      gameStore.selectedTower = above as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.selectedTower).toEqual(below);
    });

    it("selects bottommost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const t1 = { tileX: 3, tileY: 4, id: "t1" };
      const t2 = { tileX: 5, tileY: 1, id: "t2" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [t1, t2] };
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.selectedTower).toEqual(t1);
    });
  });

  describe("Right Arrow (tower selection / build position)", () => {
    it("moves build position right when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 3, tileY: 2 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 4, tileY: 2 });
    });

    it("clamps build position to grid bounds on right", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 9, tileY: 5 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 9, tileY: 5 });
    });

    it("starts from map center when hoverTile is null in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 5 });
    });

    it("selects tower to the right when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const left = { tileX: 2, tileY: 3, id: "t-left" };
      const right = { tileX: 4, tileY: 3, id: "t-right" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [left, right] };
      gameStore.selectedTower = left as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.selectedTower).toEqual(right);
    });

    it("selects rightmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const t1 = { tileX: 2, tileY: 3, id: "t1" };
      const t2 = { tileX: 5, tileY: 1, id: "t2" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [t1, t2] };
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.selectedTower).toEqual(t2);
    });

    it("prefers same row over diagonal when moving right", () => {
      gameStore.setState(GameState.PLAYING);
      const center = { tileX: 3, tileY: 3, id: "center" };
      const diagonal = { tileX: 4, tileY: 2, id: "diag" };
      const sameRow = { tileX: 5, tileY: 3, id: "sameRow" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [center, diagonal, sameRow] };
      gameStore.selectedTower = center as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.selectedTower).toEqual(sameRow);
    });
  });

  describe("Left Arrow (tower selection / build position)", () => {
    it("moves build position left when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.hoverTile).toEqual({ tileX: 4, tileY: 3 });
    });

    it("clamps build position to grid bounds on left", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 0, tileY: 5 };
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.hoverTile).toEqual({ tileX: 0, tileY: 5 });
    });

    it("selects tower to the left when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const left = { tileX: 2, tileY: 3, id: "t-left" };
      const right = { tileX: 4, tileY: 3, id: "t-right" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [left, right] };
      gameStore.selectedTower = right as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.selectedTower).toEqual(left);
    });

    it("selects leftmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const t1 = { tileX: 2, tileY: 3, id: "t1" };
      const t2 = { tileX: 5, tileY: 1, id: "t2" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [t1, t2] };
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.selectedTower).toEqual(t1);
    });
  });

  describe("Arrow key wrap-around (tower selection)", () => {
    it("wraps right from rightmost tower to leftmost tower on same row", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const rightmost = { tileX: 18, tileY: 5, id: "t-right" };
      const leftmost = { tileX: 2, tileY: 5, id: "t-left" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [rightmost, leftmost] };
      gameStore.selectedTower = rightmost as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.selectedTower).toEqual(leftmost);
    });

    it("wraps left from leftmost tower to rightmost tower on same row", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const rightmost = { tileX: 18, tileY: 5, id: "t-right" };
      const leftmost = { tileX: 2, tileY: 5, id: "t-left" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [rightmost, leftmost] };
      gameStore.selectedTower = leftmost as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.selectedTower).toEqual(rightmost);
    });

    it("wraps up from topmost tower to bottommost tower on same column", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const topmost = { tileX: 5, tileY: 1, id: "t-top" };
      const bottommost = { tileX: 5, tileY: 13, id: "t-bottom" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [topmost, bottommost] };
      gameStore.selectedTower = topmost as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.selectedTower).toEqual(bottommost);
    });

    it("wraps down from bottommost tower to topmost tower on same column", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const topmost = { tileX: 5, tileY: 1, id: "t-top" };
      const bottommost = { tileX: 5, tileY: 13, id: "t-bottom" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [topmost, bottommost] };
      gameStore.selectedTower = bottommost as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.selectedTower).toEqual(topmost);
    });

    it("finds tower at x+1,y-2 when pressing down from (x,y)", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const origin = { tileX: 5, tileY: 5, id: "t-origin" };
      const offAxis = { tileX: 6, tileY: 3, id: "t-offaxis" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [origin, offAxis] };
      gameStore.selectedTower = origin as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.selectedTower).toEqual(offAxis);
    });

    it("finds tower at x-2,y+1 when pressing left from (x,y)", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 20,
        height: 15,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      const origin = { tileX: 10, tileY: 7, id: "t-origin" };
      const offAxis = { tileX: 8, tileY: 8, id: "t-offaxis" };
      const storeRecord = gameStore as unknown as {
        towerManager: { towers: Array<{ tileX: number; tileY: number; id: string }> };
      };
      storeRecord.towerManager = { towers: [origin, offAxis] };
      gameStore.selectedTower = origin as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.selectedTower).toEqual(offAxis);
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

    it("cycles from last tower back to first in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.RAILGUN;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("cycles speed forward outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.timeScale).toBe(2);
    });

    it("cycles speed from 8x back to 1x outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 8;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("Shift+Tab key (reverse cycle)", () => {
    it("cycles build mode to previous tower type", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.ICE;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("cycles speed reverse outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.timeScale).toBe(8);
    });

    it("cycles speed reverse from 2x to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 2;
      useInput(gameStore, engine, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.timeScale).toBe(1);
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

    it("attempts to build at hoverTile when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, engine, uiStore);
      triggerInput("Enter");
      expect(engine.handleClick).toHaveBeenCalledWith(5 * 36 + 18, 3 * 36 + 18);
    });

    it("does nothing when in build mode but hoverTile is null", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("Enter");
      expect(engine.handleClick).not.toHaveBeenCalled();
    });

    it("does nothing when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = null;
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, engine, uiStore);
      triggerInput("Enter");
      expect(engine.handleClick).not.toHaveBeenCalled();
    });
  });

  describe("d key (cycle speed forward)", () => {
    it("cycles timeScale forward", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("d");
      expect(gameStore.timeScale).toBe(2);
    });

    it("cycles from 8x back to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 8;
      useInput(gameStore, engine, uiStore);
      triggerInput("d");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("w key (upgrade)", () => {
    it("calls engine.upgradeSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("w");
      expect(engine.upgradeSelected).toHaveBeenCalled();
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("w");
      expect(engine.upgradeSelected).not.toHaveBeenCalled();
    });
  });

  describe("a key (cycle speed reverse)", () => {
    it("cycles timeScale reverse", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, engine, uiStore);
      triggerInput("a");
      expect(gameStore.timeScale).toBe(8);
    });

    it("cycles from 2x to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 2;
      useInput(gameStore, engine, uiStore);
      triggerInput("a");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("f key (cycle targeting)", () => {
    it("cycles targeting mode on selected tower", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "first" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("f");
      expect(engine.setTargeting).toHaveBeenCalledWith("last");
    });

    it("cycles through all targeting modes", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "last" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("f");
      expect(engine.setTargeting).toHaveBeenCalledWith("closest");
    });

    it("wraps from furthest back to first", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "furthest" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("f");
      expect(engine.setTargeting).toHaveBeenCalledWith("first");
    });

    it("defaults to first when targeting is undefined", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1 } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, engine, uiStore);
      triggerInput("f");
      expect(engine.setTargeting).toHaveBeenCalledWith("last");
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, engine, uiStore);
      triggerInput("f");
      expect(engine.setTargeting).not.toHaveBeenCalled();
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
      expect(engine.downgradeSelected).not.toHaveBeenCalled();
    });
  });
});
