// @ts-nocheck
import { createPinia, setActivePinia } from "pinia";
import { type GameState, StartingGold } from "@/game/Constants.js";
import type { Grid } from "@/grid/Grid.js";
import type { GeneratedMap } from "@/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

type GameStore = ReturnType<typeof useGameStore>;
type PersistStore = ReturnType<typeof usePersistStore>;
type UiStore = ReturnType<typeof useUiStore>;
type GameStateValue = (typeof GameState)[keyof typeof GameState];

export function createTestGameStore(): GameStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useGameStore();
}

export function createTestPersistStore(): PersistStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = usePersistStore();
  store.$reset();
  return store;
}

export function createTestUiStore(): UiStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useUiStore();
}

export function createTestStores(): { game: GameStore; persist: PersistStore; ui: UiStore } {
  const pinia = createPinia();
  setActivePinia(pinia);
  const game = useGameStore();
  (game as unknown as Record<string, unknown>).initMap = vi.fn(
    (mapIndex: number, mapData: GeneratedMap, grid: Grid | null) => {
      game.mapIndex = mapIndex;
      game.map = mapData;
      game.grid = grid;
      game.lives = 20;
      game.gold = StartingGold[mapData.regionId];
      game.currentWave = 0;
      game.milestoneRewardsClaimed = {};
      game.selectedTower = null;
      game.selectedTowerType = null;
    },
  );
  (game as unknown as Record<string, unknown>).cycleSpeed = vi.fn((): number => {
    const speeds = [1, 2, 4, 8] as const;
    const idx = speeds.indexOf(game.timeScale as (typeof speeds)[number]);
    game.timeScale = speeds[(idx + 1) % speeds.length];
    return game.timeScale;
  });
  (game as unknown as Record<string, unknown>).togglePause = vi.fn(() => {
    if (game.state === "playing") game.state = "paused";
    else if (game.state === "paused") game.state = "playing";
  });
  (game as unknown as Record<string, unknown>).setState = vi.fn((newState: GameStateValue) => {
    game.state = newState;
  });
  return { game: game as GameStore, persist: usePersistStore(), ui: useUiStore() };
}
