import { describe, expect, it } from "vitest";
import type { Grid } from "@/grid/Grid.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import { DEFAULT_THEME_ID, MAP_THEME_MANIFEST, type MapThemeData } from "@/render/themes/index.js";
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

function buildCustomTheme(overrides?: {
  regionBase?: string;
  pathColor?: string;
  terrainColors?: string[];
}): MapThemeData {
  const pathColor = overrides?.pathColor ?? "#abcdef";
  const terrainColors = overrides?.terrainColors ?? ["#111111", "#222222", "#333333", "#444444"];
  const regionBase = overrides?.regionBase ?? "";
  const makeTileSvg = (color: string, withCrossHatch: boolean): string => {
    const crossHatch = withCrossHatch
      ? '<path d="M7.2,7.2 L28.8,28.8 M28.8,7.2 L7.2,28.8" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>'
      : "";
    return `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="${color}"/>${crossHatch}</svg>`;
  };
  return {
    id: "custom",
    label: "Custom Theme",
    towers: {
      basic: {
        name: "Basic Tower",
        color: "#8fbc8f",
        icon: "\u2500",
        animation: {
          duration: 0.3,
          referenceImages: [
            { svg: "<svg viewBox='-16 -16 32 32'><rect/></svg>" },
            { svg: "<svg viewBox='-16 -16 32 32'><circle/></svg>" },
            { svg: "<svg viewBox='-16 -16 32 32'><path/></svg>" },
          ],
        },
        walking: { duration: 0.6, referenceImages: [{ svg: "<svg viewBox='-16 -16 32 32'><rect/></svg>" }] },
      },
    },
    enemies: {
      minion: {
        name: "Minion",
        color: "#e85a6a",
        shape: "circle",
        walking: {
          duration: 0.5,
          referenceImages: [
            { svg: "<svg viewBox='-1 -1 2 2'><rect/></svg>" },
            { svg: "<svg viewBox='-1 -1 2 2'><circle/></svg>" },
          ],
        },
        hitReaction: { duration: 0.1, referenceImages: [{ svg: "<svg viewBox='-1 -1 2 2'><path/></svg>" }] },
      },
    },
    regions: [
      {
        id: 0,
        name: "Test Region",
        tiles: {
          path: makeTileSvg(pathColor, false),
          terrain1: makeTileSvg(terrainColors[0]!, true),
          terrain2: makeTileSvg(terrainColors[1]!, true),
          terrain3: makeTileSvg(terrainColors[2]!, true),
          terrain4: makeTileSvg(terrainColors[3]!, true),
        },
        base: regionBase,
      },
    ],
  };
}

function makeMinimalMap(baseX: number, baseY: number) {
  return {
    width: 2,
    height: 1,
    tiles: [
      [
        { type: "terrain" as const, height: 2 },
        { type: "path" as const, height: 0 },
      ],
    ],
    spawns: [],
    base: { x: baseX, y: baseY },
    regionId: 0,
  };
}

function makeFakeGrid(): Grid {
  return { regionId: 0, blocked: new Set<string>(), paths: [] } as unknown as Grid;
}

describe("SVG Static Content Render Placement", () => {
  describe("Symbol ID generation", () => {
    it("should generate symbol IDs matching the frame counts in the theme", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme();
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: null };
      const gridRef = { value: null };
      const { staticDefsContent } = useSvgStaticContent(mapRef as never, gridRef as never);
      const defs = staticDefsContent.value;

      expect(defs).toContain('<symbol id="tower-basic-f0"');
      expect(defs).toContain('<symbol id="tower-basic-f1"');
      expect(defs).toContain('<symbol id="tower-basic-f2"');
      expect(defs).toContain('<symbol id="enemy-minion-f0"');
      expect(defs).toContain('<symbol id="enemy-minion-f1"');
      expect(defs).toContain('<symbol id="enemy-minion-hit-f0"');
      expect(defs).not.toContain('<symbol id="tower-basic-f3"');
      expect(defs).not.toContain('<symbol id="enemy-minion-f2"');
      expect(defs).toContain('viewBox="-16 -16 32 32"');
      expect(defs).toContain('viewBox="-1 -1 2 2"');
    });
  });

  describe("Tile placement", () => {
    it("should render tile rects with region path/terrain colors and overlays", () => {
      const store = createTestMapThemeStore();
      const pathColor = "#abcdef";
      const terrainColors = ["#aabbcc", "#bbccdd", "#ccddee", "#ddeeff"];
      const customTheme = buildCustomTheme({ pathColor, terrainColors });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const gridRef = { value: makeFakeGrid() };
      const { gridContent } = useSvgStaticContent(mapRef as never, gridRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<use href="#tile-r0-terrain2"');
      expect(svg).toContain('<use href="#tile-r0-path"');
      expect(svg).toContain('stroke="rgba(0,0,0,0.15)"');
      expect(svg).toContain(">2</text>");
    });
  });

  describe("Base placement", () => {
    it("places themed base SVG inside base-structure group when region.base is non-empty", () => {
      const store = createTestMapThemeStore();
      const regionBase = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#f0f"/></svg>';
      const customTheme = buildCustomTheme({ regionBase });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const gridRef = { value: makeFakeGrid() };
      const { gridContent } = useSvgStaticContent(mapRef as never, gridRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<g id="base-structure"');
      const groupStart = svg.indexOf('<g id="base-structure"');
      const groupEnd = svg.indexOf("</g>", groupStart);
      const groupContent = svg.slice(groupStart, groupEnd);
      expect(groupContent).toContain('<rect width="10" height="10" fill="#f0f"/>');
      expect(groupContent).not.toContain("url(#base-gradient)");
    });

    it("uses procedural fallback when region.base is empty", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme({ regionBase: "" });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const gridRef = { value: makeFakeGrid() };
      const { gridContent } = useSvgStaticContent(mapRef as never, gridRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<g id="base-structure"');
      const groupStart = svg.indexOf('<g id="base-structure"');
      const groupEnd = svg.indexOf("</g>", groupStart);
      const groupContent = svg.slice(groupStart, groupEnd);
      expect(groupContent).toContain("url(#base-gradient)");
    });
  });
});
