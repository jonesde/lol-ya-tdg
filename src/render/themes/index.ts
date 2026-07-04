export const DEFAULT_THEME_ID = "default";

export interface MapThemeManifestEntry {
  id: string;
  label: string;
  file: string;
}

export const MAP_THEME_MANIFEST: MapThemeManifestEntry[] = [
  { id: DEFAULT_THEME_ID, label: "Polygon (Default)", file: "./data/default-map-theme.json" },
];

export const MAP_THEME_LOADERS: Record<string, MapThemeLoader> = {};

export type MapThemeId = string;

export interface MapTheme {
  id: string;
  label: string;
}

export interface MapThemeFrame {
  svg: string;
}

export interface MapThemeAnimation {
  duration: number;
  referenceImages: MapThemeFrame[];
}

export interface MapThemeTowerVisual {
  name: string;
  color: string;
  icon: string;
  animation: MapThemeAnimation | null;
  walking: MapThemeAnimation | null;
}

export interface MapThemeEnemyVisual {
  name: string;
  color: string;
  shape: string;
  walking: MapThemeAnimation;
  hitReaction: MapThemeAnimation | null;
}

export interface MapThemeRegionVisual {
  id: number;
  name: string;
  tiles: { path: string; terrain1: string; terrain2: string; terrain3: string; terrain4: string };
  base: string;
}

export interface MapThemeData {
  id: string;
  label: string;
  towers: Record<string, MapThemeTowerVisual>;
  enemies: Record<string, MapThemeEnemyVisual>;
  regions: MapThemeRegionVisual[];
}

export interface MapThemeLoader {
  load(): Promise<MapThemeData>;
}

export function registerThemeLoader(themeId: string, loaderFn: () => Promise<MapThemeData>): void {
  MAP_THEME_LOADERS[themeId] = {
    async load(): Promise<MapThemeData> {
      return loaderFn();
    },
  };
}
