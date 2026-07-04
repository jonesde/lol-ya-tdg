import type {
  MapThemeAnimation,
  MapThemeData,
  MapThemeEnemyVisual,
  MapThemeFrame,
  MapThemeRegionVisual,
  MapThemeTowerVisual,
} from "./index.js";

function stripSvgWrapper(svgContent: string): string {
  let cleaned = svgContent.trim();
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/<\?xml[^?]*\?>/g, "");
  cleaned = cleaned.replace(/^\s+|\s+$/g, "");
  return cleaned;
}

function isExternalImage(image: string): boolean {
  const trimmed = image.trim();
  if (trimmed.startsWith("<svg")) return false;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  )
    return true;
  return false;
}

async function fetchSvgText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch SVG from ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function resolveImage(image: string): Promise<string> {
  if (isExternalImage(image)) {
    return await fetchSvgText(image);
  }
  return image;
}

async function normalizeAnimation(raw: { duration: number; frames: { image: string }[] }): Promise<MapThemeAnimation> {
  const referenceImages: MapThemeFrame[] = [];
  for (const frame of raw.frames) {
    const svg = stripSvgWrapper(await resolveImage(frame.image));
    referenceImages.push({ svg });
  }
  return { duration: raw.duration, referenceImages };
}

async function normalizeTowerVisual(raw: {
  name: string;
  color: string;
  icon: string;
  animation: { duration: number; frames: { image: string }[] } | null;
  walking?: { duration: number; frames: { image: string }[] };
}): Promise<MapThemeTowerVisual> {
  const animation = raw.animation ? await normalizeAnimation(raw.animation) : null;
  const walking = raw.walking ? await normalizeAnimation(raw.walking) : null;
  return { name: raw.name, color: raw.color, icon: raw.icon, animation, walking };
}

async function normalizeEnemyVisual(raw: {
  name: string;
  color: string;
  shape: string;
  walking: { duration: number; frames: { image: string }[] };
  hitReaction?: { duration: number; frames: { image: string }[] };
}): Promise<MapThemeEnemyVisual> {
  const walking = await normalizeAnimation(raw.walking);
  const hitReaction = raw.hitReaction ? await normalizeAnimation(raw.hitReaction) : null;
  return { name: raw.name, color: raw.color, shape: raw.shape, walking, hitReaction };
}

async function normalizeRegionVisual(raw: {
  id: number;
  name: string;
  tiles: { path: string; terrain1: string; terrain2: string; terrain3: string; terrain4: string };
  base: string;
}): Promise<MapThemeRegionVisual> {
  const path = stripSvgWrapper(await resolveImage(raw.tiles.path));
  const terrain1 = stripSvgWrapper(await resolveImage(raw.tiles.terrain1));
  const terrain2 = stripSvgWrapper(await resolveImage(raw.tiles.terrain2));
  const terrain3 = stripSvgWrapper(await resolveImage(raw.tiles.terrain3));
  const terrain4 = stripSvgWrapper(await resolveImage(raw.tiles.terrain4));
  const base = stripSvgWrapper(await resolveImage(raw.base));
  return { id: raw.id, name: raw.name, tiles: { path, terrain1, terrain2, terrain3, terrain4 }, base };
}

export async function normalizeThemeImages(raw: {
  id: string;
  label: string;
  towers: Record<
    string,
    {
      name: string;
      color: string;
      icon: string;
      animation: { duration: number; frames: { image: string }[] } | null;
      walking?: { duration: number; frames: { image: string }[] };
    }
  >;
  enemies: Record<
    string,
    {
      name: string;
      color: string;
      shape: string;
      walking: { duration: number; frames: { image: string }[] };
      hitReaction?: { duration: number; frames: { image: string }[] };
    }
  >;
  regions: Array<{
    id: number;
    name: string;
    tiles: { path: string; terrain1: string; terrain2: string; terrain3: string; terrain4: string };
    base: string;
  }>;
}): Promise<MapThemeData> {
  const normalizedTowers: Record<string, MapThemeTowerVisual> = {};
  for (const [key, tower] of Object.entries(raw.towers)) {
    normalizedTowers[key] = await normalizeTowerVisual(tower);
  }

  const normalizedEnemies: Record<string, MapThemeEnemyVisual> = {};
  for (const [key, enemy] of Object.entries(raw.enemies)) {
    normalizedEnemies[key] = await normalizeEnemyVisual(enemy);
  }

  const normalizedRegions: MapThemeRegionVisual[] = await Promise.all(raw.regions.map(normalizeRegionVisual));

  return {
    id: raw.id,
    label: raw.label,
    towers: normalizedTowers,
    enemies: normalizedEnemies,
    regions: normalizedRegions,
  };
}
