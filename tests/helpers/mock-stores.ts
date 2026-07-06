// @ts-nocheck
import { createPinia, setActivePinia } from "pinia";
import { type GameState, StartingGold } from "@/game/Constants.js";
import type { Grid } from "@/grid/Grid.js";
import type { GeneratedMap } from "@/grid/Map.js";
import type { MapThemeData } from "@/render/themes/index.js";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

type GameStore = ReturnType<typeof useGameStore>;
type PersistStore = ReturnType<typeof usePersistStore>;
type UiStore = ReturnType<typeof useUiStore>;
type MapThemeStore = ReturnType<typeof useMapThemeStore>;
type GameStateValue = (typeof GameState)[keyof typeof GameState];

export const mockDefaultTheme: MapThemeData = {
  id: DEFAULT_THEME_ID,
  label: "Default",
  towers: {
    basic: {
      name: "Rifle Tower",
      color: "#8fbc8f",
      icon: "\u2500",
      animation: {
        duration: 0.3,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
      walking: {
        duration: 0.6,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
    },
  },
  enemies: {
    minion: {
      name: "Minion",
      color: "#e85a6a",
      shape: "circle",
      walking: {
        duration: 0.784,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
      hitReaction: {
        duration: 0.12,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
    },
  },
  spawns: { closed: "<svg></svg>", open: "<svg></svg>", transition: "<svg></svg>" },
  regions: [
    {
      id: 0,
      name: "Verdant Marches",
      tiles: {
        path: "<svg></svg>",
        terrain1: "<svg></svg>",
        terrain2: "<svg></svg>",
        terrain3: "<svg></svg>",
        terrain4: "<svg></svg>",
      },
      base: "",
    },
    {
      id: 1,
      name: "Sunscorch Coast",
      tiles: {
        path: "<svg></svg>",
        terrain1: "<svg></svg>",
        terrain2: "<svg></svg>",
        terrain3: "<svg></svg>",
        terrain4: "<svg></svg>",
      },
      base: "",
    },
    {
      id: 2,
      name: "Thornpeak Wilds",
      tiles: {
        path: "<svg></svg>",
        terrain1: "<svg></svg>",
        terrain2: "<svg></svg>",
        terrain3: "<svg></svg>",
        terrain4: "<svg></svg>",
      },
      base: "",
    },
  ],
};

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

export function createTestMapThemeStore(): MapThemeStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useMapThemeStore();
  store.activeThemeId = DEFAULT_THEME_ID as MapThemeStore["activeThemeId"];
  store.defaultTheme = mockDefaultTheme;
  store.activeTheme = mockDefaultTheme;
  return store;
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
