import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  MapThemeData,
  MapThemeEnemyVisual,
  MapThemeId,
  MapThemeManifestEntry,
  MapThemeRegionVisual,
  MapThemeTowerVisual,
} from "../render/themes/index.js";
import { DEFAULT_THEME_ID, MAP_THEME_LOADERS, MAP_THEME_MANIFEST } from "../render/themes/index.js";
import { normalizeThemeImages } from "../render/themes/normalize.js";

export const useMapThemeStore = defineStore("mapTheme", () => {
  const activeThemeId = ref<MapThemeId>(DEFAULT_THEME_ID);
  const activeTheme = ref<MapThemeData | null>(null);
  const defaultTheme = ref<MapThemeData | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function preloadDefault(): Promise<void> {
    try {
      const mod = await import("../render/themes/data/default-map-theme.json");
      const rawData = mod.default as Record<string, unknown>;
      const normalized = await normalizeThemeImages(rawData as never);
      defaultTheme.value = normalized;
      activeTheme.value = normalized;
      activeThemeId.value = DEFAULT_THEME_ID;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to preload default theme";
      throw err;
    }
  }

  async function loadActive(id: MapThemeId): Promise<MapThemeData> {
    isLoading.value = true;
    error.value = null;
    activeThemeId.value = id;
    try {
      const loader = MAP_THEME_LOADERS[id];
      if (!loader) {
        throw new Error(`Unknown theme ID: ${id}`);
      }
      const data = await loader.load();
      activeTheme.value = data;
      return data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load theme";
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  const availableThemes = computed<MapThemeManifestEntry[]>(() => MAP_THEME_MANIFEST);
  const activeThemeLabel = computed(() => {
    return MAP_THEME_MANIFEST.find((e) => e.id === activeThemeId.value)?.label || "Unknown";
  });

  function getTowerVisual(typeId: string): MapThemeTowerVisual | undefined {
    return activeTheme.value?.towers[typeId] ?? defaultTheme.value?.towers[typeId];
  }

  function getEnemyVisual(typeId: string): MapThemeEnemyVisual | undefined {
    return activeTheme.value?.enemies[typeId] ?? defaultTheme.value?.enemies[typeId];
  }

  function getDefaultTowerVisual(typeId: string): MapThemeTowerVisual | undefined {
    return defaultTheme.value?.towers[typeId];
  }

  function getDefaultEnemyVisual(typeId: string): MapThemeEnemyVisual | undefined {
    return defaultTheme.value?.enemies[typeId];
  }

  function getRegionVisual(regionId: number): MapThemeRegionVisual | undefined {
    return (
      activeTheme.value?.regions.find((r) => r.id === regionId) ??
      defaultTheme.value?.regions.find((r) => r.id === regionId)
    );
  }

  function reset(): void {
    activeThemeId.value = DEFAULT_THEME_ID;
    activeTheme.value = defaultTheme.value;
    error.value = null;
  }

  return {
    activeThemeId,
    activeTheme,
    defaultTheme,
    isLoading,
    error,
    preloadDefault,
    loadActive,
    availableThemes,
    activeThemeLabel,
    getTowerVisual,
    getEnemyVisual,
    getDefaultTowerVisual,
    getDefaultEnemyVisual,
    getRegionVisual,
    reset,
  };
});
