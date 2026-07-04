import { computed } from "vue";
import type { Grid } from "@/grid/Grid.js";
import type { MapThemeData } from "@/render/themes/index.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";

interface BaseSvgParams {
  x: number;
  y: number;
  size: number;
  regionId?: number;
}

function renderBaseSvg(params: BaseSvgParams): string {
  const { x, y, size } = params;
  const padding = size * 0.15;
  const cornerR = size * 0.6;
  const width = size * 2.7;
  const height = size * 2.7;
  const centerX = x + padding + width / 2;
  const centerY = y + padding + height / 2;

  const mainPath = [
    `M${x + padding + cornerR},${y + padding}`,
    `L${x + padding + width - cornerR},${y + padding}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + width},${y + padding + cornerR}`,
    `L${x + padding + width},${y + padding + height - cornerR}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + width - cornerR},${y + padding + height}`,
    `L${x + padding + cornerR},${y + padding + height}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding},${y + padding + height - cornerR}`,
    `L${x + padding},${y + padding + cornerR}`,
    `A${cornerR},${cornerR} 0 0 1 ${x + padding + cornerR},${y + padding}`,
    "Z",
  ].join(" ");

  const innerStrokePath = [
    `M${x + padding + cornerR + 3},${y + padding + 4}`,
    `L${x + padding + width - cornerR - 3},${y + padding + 4}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + width - 3},${y + padding + cornerR + 3}`,
    `L${x + padding + width - 3},${y + padding + height - cornerR - 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + width - cornerR - 3},${y + padding + height - 3}`,
    `L${x + padding + cornerR + 3},${y + padding + height - 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + 3},${y + padding + height - cornerR - 3}`,
    `L${x + padding + 3},${y + padding + cornerR + 3}`,
    `A${cornerR - 6},${cornerR - 6} 0 0 1 ${x + padding + cornerR + 3},${y + padding + 3}`,
    "Z",
  ].join(" ");

  const gemSize = size * 0.12;
  const gems: [number, number][] = [
    [x + padding + cornerR + 2, y + padding + cornerR + 2],
    [x + padding + width - cornerR - 2, y + padding + cornerR + 2],
    [x + padding + cornerR + 2, y + padding + height - cornerR - 2],
    [x + padding + width - cornerR - 2, y + padding + height - cornerR - 2],
  ];

  const gemCircles = gems
    .map(([gemX, gemY]) => {
      const highlightR = gemSize * 0.4;
      const highlightX = gemX - gemSize * 0.25;
      const highlightY = gemY - gemSize * 0.25;
      return (
        `<circle cx="${gemX}" cy="${gemY}" r="${gemSize}" fill="#5fd0ff" stroke="rgba(95,208,255,0.6)" stroke-width="1"/>` +
        `<circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="rgba(255,255,255,0.5)"/>`
      );
    })
    .join("\n      ");

  const emblemR = size * 0.55;
  const hexPointsMain: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 6;
    const emblemX = centerX + Math.cos(angle) * emblemR;
    const emblemY = centerY + Math.sin(angle) * emblemR;
    hexPointsMain.push(`${emblemX},${emblemY}`);
  }

  const innerR = emblemR * 0.55;
  const hexPointsInner: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const emblemX = centerX + Math.cos(angle) * innerR;
    const emblemY = centerY + Math.sin(angle) * innerR;
    hexPointsInner.push(`${emblemX},${emblemY}`);
  }

  const highlightR = innerR * 0.35;
  const highlightX = centerX - innerR * 0.15;
  const highlightY = centerY - innerR * 0.15;

  return (
    `<g id="base-structure">` +
    `<path d="${mainPath}" fill="url(#base-gradient)" stroke="#5fd0ff" stroke-width="2.5"/>` +
    `<path d="${innerStrokePath}" fill="none" stroke="rgba(95,208,255,0.3)" stroke-width="1"/>` +
    gemCircles +
    `<polygon points="${hexPointsMain.join(" ")}" fill="rgba(95,208,255,0.15)" stroke="#5fd0ff" stroke-width="1.5"/>` +
    `<polygon points="${hexPointsInner.join(" ")}" fill="#5fd0ff"/>` +
    `<circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="rgba(255,255,255,0.45)"/>` +
    `</g>`
  );
}

interface TileInfo {
  type: "terrain" | "path" | "base" | "spawn";
  height: number;
}

interface RegionInfo {
  pathColor: string;
  heightColors: readonly string[];
  base: string;
}

interface MapInfo {
  width: number;
  height: number;
  tiles: TileInfo[][];
  spawns: { x: number; y: number }[];
  base: { x: number; y: number };
  regionId?: number;
}

const TILE_SIZE = 36;

function stripSvgWrapper(svgText: string): string {
  const openTagMatch = svgText.match(/^<svg[^>]*>/);
  const closeTagMatch = svgText.match(/<\/svg>\s*$/);
  if (openTagMatch && closeTagMatch) {
    return svgText.slice(openTagMatch[0].length, svgText.length - closeTagMatch[0].length);
  }
  return svgText;
}

function buildSymbolsFromConstants(themeOverride?: MapThemeData | null): string {
  const symbolParts: string[] = [];
  const activeTheme = themeOverride ?? useMapThemeStore().activeTheme ?? useMapThemeStore().defaultTheme;
  if (!activeTheme) return "";

  for (const [typeId, enemyVisual] of Object.entries(activeTheme.enemies)) {
    const walking = enemyVisual.walking;
    if (!walking) continue;
    for (let frameIndex = 0; frameIndex < walking.referenceImages.length; frameIndex++) {
      const frame = walking.referenceImages[frameIndex]!;
      const innerContent = stripSvgWrapper(frame.svg);
      symbolParts.push(`<symbol id="enemy-${typeId}-f${frameIndex}" viewBox="-1 -1 2 2">${innerContent}</symbol>`);
    }
    const hitReaction = enemyVisual.hitReaction;
    if (hitReaction) {
      for (let frameIndex = 0; frameIndex < hitReaction.referenceImages.length; frameIndex++) {
        const frame = hitReaction.referenceImages[frameIndex]!;
        const innerContent = stripSvgWrapper(frame.svg);
        symbolParts.push(
          `<symbol id="enemy-${typeId}-hit-f${frameIndex}" viewBox="-1 -1 2 2">${innerContent}</symbol>`,
        );
      }
    }
  }

  for (const [typeId, towerVisual] of Object.entries(activeTheme.towers)) {
    const animation = towerVisual.animation;
    if (!animation) continue;
    for (let frameIndex = 0; frameIndex < animation.referenceImages.length; frameIndex++) {
      const frame = animation.referenceImages[frameIndex]!;
      const innerContent = stripSvgWrapper(frame.svg);
      symbolParts.push(`<symbol id="tower-${typeId}-f${frameIndex}" viewBox="-16 -16 32 32">${innerContent}</symbol>`);
    }
  }

  return symbolParts.join("\n");
}

function buildStaticFiltersContent(): string {
  const glowFilter = `<filter id="glow"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blurred" /><feMerge><feMergeNode in="blurred" /><feMergeNode in="SourceGraphic" /></feMerge></filter>`;

  const slowFilters: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const saturateValue = 0.1 + i * 0.1;
    const slowFilter = `<filter id="slow-${i}"><feColorMatrix type="saturate" values="${saturateValue}" /></filter>`;
    slowFilters.push(slowFilter);
  }

  return `${glowFilter}\n${slowFilters.join("\n")}`;
}

/**
 * Ported from Shapes.ts drawTile() — computes fill color based on tile type
 * and region, returning the SVG fill attribute value.
 */
function getTileFill(tile: TileInfo, region: RegionInfo): string {
  const tileType = tile.type;
  if (tileType === "path" || tileType === "spawn") return region.pathColor;
  if (tileType === "base") return "#3a3f55";
  const heightIdx = Math.min(3, tile.height - 1);
  return region.heightColors[heightIdx]!;
}

/**
 * Ported from Shapes.ts drawTile() — returns SVG elements for a single tile
 * including fill rect, border stroke, height cross-hatch, spawn marker,
 * and blocked-tile cross-hatch indicator.
 */
function getTileSvg(tile: TileInfo, x: number, y: number, region: RegionInfo, isBlocked: boolean): string {
  const fill = getTileFill(tile, region);
  const size = TILE_SIZE;

  let svg = `<g transform="translate(${x}, ${y})">`;

  // Main fill rect
  svg += `<rect width="${size}" height="${size}" fill="${fill}" />`;

  // Subtle border (port of canvas strokeRect)
  svg += `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1" />`;

  // Terrain: cross-hatch pattern + height number (port of canvas drawTile terrain logic)
  if (tile.type === "terrain") {
    const h = tile.height;
    svg += `<path d="M${size * 0.2},${size * 0.2} L${size * 0.8},${size * 0.8} M${size * 0.8},${size * 0.2} L${size * 0.2},${size * 0.8}" stroke="rgba(0,0,0,0.12)" stroke-width="0.5" />`;
    svg += `<text x="${size / 2}" y="${size / 2}" font-size="9" text-anchor="middle" dominant-baseline="middle" fill="rgba(0,0,0,0.35)">${h}</text>`;
  }

  // Spawn: red center square (port of canvas drawTile spawn logic)
  if (tile.type === "spawn") {
    svg += `<rect x="${size * 0.3}" y="${size * 0.3}" width="${size * 0.4}" height="${size * 0.4}" fill="#ff5a6e" />`;
  }

  // Blocked path tiles: white cross-hatch indicator
  if (isBlocked) {
    svg += `<path d="M6,6 L30,30 M30,6 L6,30" stroke="rgba(255,255,255,0.2)" stroke-width="1" />`;
  }

  svg += `</g>`;
  return svg;
}

/**
 * Ported from Shapes.ts drawBase() via SvgBaseRenderer.ts renderBaseSvg().
 * Renders the base structure as an SVG string with rounded corners,
 * gradient fill, gem decorations, and hexagonal emblem.
 */
function renderBaseStructure(base: { x: number; y: number }, regionBaseSvg: string): string {
  const translateX = (base.x - 1) * TILE_SIZE;
  const translateY = (base.y - 1) * TILE_SIZE;
  if (regionBaseSvg) {
    return `<g id="base-structure" transform="translate(${translateX}, ${translateY})">${stripSvgWrapper(regionBaseSvg)}</g>`;
  }
  return renderBaseSvg({ x: translateX, y: translateY, size: TILE_SIZE });
}

export function useSvgStaticContent(
  currentMap: { value: MapInfo | null },
  currentGrid: { value: Grid | null },
  currentTheme?: { value: MapThemeData | null },
) {
  const staticFiltersContent = computed(() => buildStaticFiltersContent());
  const staticSymbolsContent = computed(() => buildSymbolsFromConstants(currentTheme?.value));
  const staticDefsContent = computed(() => `${staticFiltersContent.value}\n${staticSymbolsContent.value}`);

  const mapDefsContent = computed(() => {
    const map = currentMap.value;
    if (!map) return "";
    return (
      `<linearGradient id="base-gradient" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="#2a3a4a" />` +
      `<stop offset="100%" stop-color="#1a2a3a" />` +
      `</linearGradient>`
    );
  });

  // Grid.blocked is a Set<string> mutated directly (via registerTower /
  // unregisterTower), NOT a reactive ref. Vue's computed won't track Set
  // mutations. This computed signal forces gridContent to re-evaluate when
  // towers are placed or removed.
  const gridBlockCount = computed(() => currentGrid.value?.blocked?.size ?? 0);

  const gridContent = computed(() => {
    const map = currentMap.value;
    if (!map) return "";

    // Depend on gridBlockCount to invalidate when blocked set changes size.
    const _invalidate = gridBlockCount.value;
    void _invalidate;

    const grid = currentGrid.value;
    const activeTheme = currentTheme?.value ?? useMapThemeStore().activeTheme;
    const regionId = grid?.regionId ?? 0;
    const regionVisual = activeTheme?.regions.find((r) => r.id === regionId);
    const region: RegionInfo = {
      pathColor: regionVisual?.tiles.path || "#4a3d28",
      heightColors: [
        regionVisual?.tiles.terrain1 || "#4e824e",
        regionVisual?.tiles.terrain2 || "#427542",
        regionVisual?.tiles.terrain3 || "#366836",
        regionVisual?.tiles.terrain4 || "#2a5a2a",
      ],
      base: regionVisual?.base || "",
    };
    let svg = "";

    // Background rect
    svg += `<rect x="0" y="0" width="${map.width * TILE_SIZE}" height="${map.height * TILE_SIZE}" fill="#0a0d12" />`;

    // Tiles — iterate 2D array, check blocked status from Grid.blocked Set
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty]![tx] as TileInfo;
        const isBlocked = grid?.blocked.has(`${tx},${ty}`) ?? false;
        svg += getTileSvg(tile, tx * TILE_SIZE, ty * TILE_SIZE, region, isBlocked);
      }
    }

    // Spawn markers
    for (const spawn of map.spawns) {
      svg += `<rect x="${spawn.x * TILE_SIZE + 4}" y="${spawn.y * TILE_SIZE + 4}" width="28" height="28" fill="rgba(255,50,50,0.5)" />`;
    }

    // Base structure (port of drawBase from Shapes.ts)
    if (map.base) {
      svg += renderBaseStructure(map.base, region.base);
    }

    // Path highlights — Grid.paths is (Point[] | null)[], each path IS a Point[]
    for (const path of grid?.paths ?? []) {
      if (!path) continue;
      const points = path.map((t) => `${t.x * TILE_SIZE + TILE_SIZE / 2},${t.y * TILE_SIZE + TILE_SIZE / 2}`).join(" ");
      svg += `<polyline points="${points}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4" />`;
    }

    return svg;
  });

  return { staticDefsContent, mapDefsContent, gridContent };
}
