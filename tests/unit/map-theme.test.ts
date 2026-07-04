import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, MAP_THEME_MANIFEST } from "@/render/themes/index.js";
import { normalizeThemeImages } from "@/render/themes/normalize.js";
import { createTestMapThemeStore } from "../helpers/mock-stores";

describe("Map Theme System", () => {
  describe("Theme Manifest", () => {
    it("should have a default theme in the manifest", () => {
      const theme = MAP_THEME_MANIFEST.find((e) => e.id === DEFAULT_THEME_ID);
      expect(theme).toBeDefined();
      expect(theme!.id).toBe(DEFAULT_THEME_ID);
      expect(theme!.label).toBe("Polygon (Default)");
    });

    it("should have a file path for the default theme", () => {
      const defaultTheme = MAP_THEME_MANIFEST.find((e) => e.id === DEFAULT_THEME_ID);
      expect(defaultTheme).toBeDefined();
      expect(defaultTheme!.file).toContain("default-map-theme.json");
    });
  });

  describe("Theme Normalization", () => {
    it("should normalize tower visuals", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: {
          archer: {
            name: "Archer Tower",
            color: "#ff0000",
            icon: "🏹",
            animation: { duration: 1000, frames: [{ image: "<svg></svg>" }] },
            walking: { duration: 500, frames: [{ image: "<svg></svg>" }] },
          },
        },
        enemies: {
          goblin: {
            name: "Goblin",
            color: "#00ff00",
            shape: "circle",
            walking: { duration: 300, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [
          {
            id: 0,
            name: "Forest",
            tiles: {
              path: "<svg></svg>",
              terrain1: "<svg></svg>",
              terrain2: "<svg></svg>",
              terrain3: "<svg></svg>",
              terrain4: "<svg></svg>",
            },
            base: "<svg></svg>",
          },
        ],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.id).toBe("test");
      expect(normalized.label).toBe("Test Theme");
      const archer = normalized.towers.archer!;
      expect(archer).toBeDefined();
      expect(archer.name).toBe("Archer Tower");
      expect(archer.animation).toBeDefined();
      expect(archer.animation!.duration).toBe(1000);
      expect(archer.walking).toBeDefined();
      const goblin = normalized.enemies.goblin!;
      expect(goblin).toBeDefined();
      expect(goblin.name).toBe("Goblin");
      expect(normalized.regions).toHaveLength(1);
      expect(normalized.regions[0]!.name).toBe("Forest");
    });

    it("should handle null animations", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      const basic = normalized.towers.basic!;
      expect(basic).toBeDefined();
      expect(basic.animation).toBeNull();
      expect(basic.walking).toBeNull();
    });
  });

  describe("Theme Store", () => {
    it("should initialize with default theme", () => {
      const store = createTestMapThemeStore();
      expect(store.activeThemeId).toBe(DEFAULT_THEME_ID);
    });

    it("should have manifest available", () => {
      const store = createTestMapThemeStore();
      expect(store.availableThemes).toBeDefined();
      expect(store.availableThemes.length).toBeGreaterThan(0);
    });

    it("should provide getters for tower/enemy/region visuals", () => {
      const store = createTestMapThemeStore();
      expect(store.getDefaultTowerVisual).toBeInstanceOf(Function);
      expect(store.getDefaultEnemyVisual).toBeInstanceOf(Function);
      expect(store.getRegionVisual).toBeInstanceOf(Function);
    });

    it("should provide loadActive function", () => {
      const store = createTestMapThemeStore();
      expect(store.loadActive).toBeInstanceOf(Function);
    });

    it("should provide preloadDefault and reset functions", () => {
      const store = createTestMapThemeStore();
      expect(store.preloadDefault).toBeInstanceOf(Function);
      expect(store.reset).toBeInstanceOf(Function);
    });
  });
});
