// Procedural map definitions for 3 regions × 12 maps each = 36 maps.
import {
  HEIGHT_NOISE_DIVISOR,
  HEIGHT_NOISE_FREQ,
  MAP_LEVELS,
  SERPENTINE_DOWN_CAP,
  SERPENTINE_STEP,
} from "../game/Constants.js";
import { BOSS_CADENCE } from "../game/ConstantsEnemy.js";
import type { MapThemeData } from "../render/themes/index.js";

export function getMapDisplayName(map: GeneratedMap | null, theme: MapThemeData | null): string {
  if (!map) return "";
  if (!theme) return map.name || "Random Map";
  const region = theme.regions.find((r) => r.id === map.regionId);
  if (region && map.level !== undefined) {
    return `${region.name} Map ${map.level}`;
  }
  return map.name || "Random Map";
}

interface Tile {
  type: "terrain" | "path" | "base" | "spawn";
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface GeneratedMap {
  regionId: number;
  level: number;
  style: string;
  width: number;
  height: number;
  tiles: Tile[][];
  spawns: Point[];
  base: Point;
  name: string;
  bossCadence: number;
  seed: number;
}

function _carveStraight(tiles: Tile[][], from: Point, nextWaypoint: Point) {
  let curX = from.x;
  let curY = from.y;
  while (curY !== nextWaypoint.y) {
    tiles[curY]![curX]!.type = "path";
    tiles[curY]![curX]!.height = 1;
    curY += Math.sign(nextWaypoint.y - curY);
  }
  while (curX !== nextWaypoint.x) {
    tiles[curY]![curX]!.type = "path";
    tiles[curY]![curX]!.height = 1;
    curX += Math.sign(nextWaypoint.x - curX);
  }
  tiles[curY]![curX]!.type = "path";
}

function carveWidePath(tiles: Tile[][], from: Point, nextWaypoint: Point, width: number = 1) {
  const pts: Point[] = [];
  let curX = from.x;
  let curY = from.y;
  pts.push({ x: curX, y: curY });
  while (curX !== nextWaypoint.x) {
    curX += Math.sign(nextWaypoint.x - curX);
    pts.push({ x: curX, y: curY });
  }
  while (curY !== nextWaypoint.y) {
    curY += Math.sign(nextWaypoint.y - curY);
    pts.push({ x: curX, y: curY });
  }
  for (const pt of pts) {
    const halfW = Math.ceil(width / 2);
    for (let deltaY = -halfW; deltaY <= halfW; deltaY++) {
      for (let deltaX = -halfW; deltaX <= halfW; deltaX++) {
        const neighborX = pt.x + deltaX;
        const neighborY = pt.y + deltaY;
        if (
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < tiles[0]!.length &&
          neighborY < tiles.length &&
          tiles[neighborY]![neighborX]!.type !== "base"
        ) {
          tiles[neighborY]![neighborX]!.type = "path";
          tiles[neighborY]![neighborX]!.height = 1;
        }
      }
    }
  }
}

interface SerpentineConfig {
  phase: "cross" | "drift" | "down";
  crossTargetX?: number;
  downStepMultiplier?: number;
}

function carveSerpentine(
  tiles: Tile[][],
  from: Point,
  nextWaypoint: Point,
  _width: number = 1,
  config: SerpentineConfig = { phase: "cross" },
) {
  const W = tiles[0]!.length;
  let curX = from.x;
  let curY = from.y;
  let dir = from.x < nextWaypoint.x ? 1 : -1;
  const step = SERPENTINE_STEP;
  const downCap =
    config.phase === "down" ? Math.floor(SERPENTINE_DOWN_CAP * (config.downStepMultiplier ?? 2)) : SERPENTINE_DOWN_CAP;
  const crossTarget = config.crossTargetX ?? Math.floor(W / 2) + 2;
  const carved: number[][] = [];

  while (curY < nextWaypoint.y) {
    let targetX: number;
    if (config.phase === "cross") {
      targetX = dir > 0 ? Math.min(crossTarget, curX + step) : Math.max(1, curX - step);
    } else if (config.phase === "drift") {
      targetX = dir > 0 ? Math.min(W - 2, curX + step) : Math.max(1, curX - step);
    } else {
      targetX = dir > 0 ? Math.min(W - 2, curX + step) : Math.max(1, curX - step);
    }
    while (curX !== targetX) {
      if (tiles[curY]![curX]!.type !== "base") {
        tiles[curY]![curX]!.type = "path";
        tiles[curY]![curX]!.height = 1;
        carved.push([curX, curY]);
      }
      curX += dir;
    }
    const downSteps = Math.min(downCap, nextWaypoint.y - curY);
    for (let i = 0; i < downSteps; i++) {
      if (tiles[curY]?.[curX] && tiles[curY]![curX]!.type !== "base") {
        tiles[curY]![curX]!.type = "path";
        tiles[curY]![curX]!.height = 1;
        carved.push([curX, curY]);
      }
      curY++;
    }
    dir *= -1;
  }
  while (curX !== nextWaypoint.x) {
    if (tiles[curY]![curX]!.type !== "base") {
      tiles[curY]![curX]!.type = "path";
      tiles[curY]![curX]!.height = 1;
      carved.push([curX, curY]);
    }
    curX += Math.sign(nextWaypoint.x - curX);
  }
  while (curY !== nextWaypoint.y) {
    if (tiles[curY]![curX]!.type !== "base") {
      tiles[curY]![curX]!.type = "path";
      tiles[curY]![curX]!.height = 1;
      carved.push([curX, curY]);
    }
    curY += Math.sign(nextWaypoint.y - curY);
  }
}

function carveCanyon(tiles: Tile[][], from: Point, nextWaypoint: Point, rng: () => number) {
  const W = tiles[0]!.length;
  const H = tiles.length;
  const targetY = nextWaypoint.y - 1;
  let curX = from.x;
  let curY = from.y;
  let segmentCount = 0;
  const maxSegments = H * 3;

  const carveAt = (x: number, y: number, width: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const halfW = Math.floor(width / 2);
    for (let deltaY = -halfW; deltaY <= halfW; deltaY++) {
      for (let deltaX = -halfW; deltaX <= halfW; deltaX++) {
        const neighborX = x + deltaX;
        const neighborY = y + deltaY;
        if (
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < W &&
          neighborY < H &&
          tiles[neighborY]![neighborX]!.type !== "base"
        ) {
          tiles[neighborY]![neighborX]!.type = "path";
          tiles[neighborY]![neighborX]!.height = 1;
        }
      }
    }
  };

  while (curY < targetY && segmentCount < maxSegments) {
    const segmentLength = 6 + Math.floor(rng() * 5);
    const currentWidth = rng() > 0.5 ? 3 : 1;

    let targetX: number;
    if (segmentCount % 2 === 0) {
      targetX = Math.floor(W / 2) + Math.floor(rng() * 4 - 2);
    } else {
      targetX = curX > Math.floor(W / 2) ? 1 : W - 2;
    }

    const xDir = targetX > curX ? 1 : targetX < curX ? -1 : 0;
    const yDir = 1;

    for (let step = 0; step < segmentLength; step++) {
      carveAt(curX, curY, currentWidth);

      const xRemaining = targetX - curX;
      const yRemaining = targetY - curY;

      const moveX = xRemaining !== 0 && (yRemaining === 0 || Math.abs(xRemaining) >= yRemaining * 2);
      const moveY = yRemaining > 0 && (xRemaining === 0 || Math.abs(yRemaining) > Math.abs(xRemaining) * 0.5);

      if (moveX) curX += xDir;
      if (moveY) curY += yDir;
      curX = Math.max(1, Math.min(W - 2, curX));
      curY = Math.max(0, Math.min(H - 1, curY));

      if (curY >= targetY && Math.abs(targetX - curX) <= 1) break;
    }
    carveAt(curX, curY, currentWidth);

    segmentCount++;
  }

  let horizontalSteps = 0;
  while (curX !== nextWaypoint.x && horizontalSteps < W) {
    carveAt(curX, curY, 1);
    curX += Math.sign(nextWaypoint.x - curX);
    horizontalSteps++;
  }

  while (curY !== nextWaypoint.y) {
    carveAt(curX, curY, 1);
    curY += Math.sign(nextWaypoint.y - curY);
  }

  carveAt(curX, curY, 1);
}

function carveOpenArea(
  tiles: Tile[][],
  base: Point,
  openAreaHeight: number,
  openAreaWidth: number,
  shapeIndex: number,
) {
  const halfW = Math.floor(openAreaWidth / 2);
  const topEdge = base.y - openAreaHeight;
  const W = tiles[0]!.length;

  for (let cy = Math.max(0, topEdge); cy <= Math.min(tiles.length - 1, base.y); cy++) {
    for (let cx = Math.max(0, base.x - halfW); cx <= Math.min(W - 1, base.x + halfW); cx++) {
      const dx = cx - base.x;
      const dy = cy - base.y;
      let inside = false;

      switch (shapeIndex) {
        case 0:
          inside = Math.abs(dx) <= halfW && Math.abs(dy) <= openAreaHeight;
          break;
        case 1:
          if (halfW > 0 && openAreaHeight > 0)
            inside = (dx * dx) / (halfW * halfW) + (dy * dy) / (openAreaHeight * openAreaHeight) <= 1;
          break;
        case 2:
          if (halfW > 0 && openAreaHeight > 0) inside = Math.abs(dx) / halfW + Math.abs(dy) / openAreaHeight <= 1;
          break;
        case 3: {
          const rowY = cy - topEdge;
          const rowMaxHalfW = Math.floor((halfW * rowY) / openAreaHeight);
          inside = Math.abs(dx) <= rowMaxHalfW;
          break;
        }
        default:
          inside = Math.abs(dx) <= halfW && Math.abs(dy) <= openAreaHeight;
          break;
      }

      if (inside && tiles[cy]![cx]!.type !== "base") {
        tiles[cy]![cx]!.type = "path";
        tiles[cy]![cx]!.height = 1;
      }
    }
  }
}

const mapCache = new Map<number, GeneratedMap>();

export function getMap(index: number): GeneratedMap {
  const cached = mapCache.get(index);
  if (cached) return cached;
  const config = MAP_LEVELS[index]!;
  const map = generateRandomMap(config.width, config.height, config.style, config.regionId, config.level, config.seed);
  mapCache.set(index, map);
  return map;
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let hash = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    hash = (hash + Math.imul(hash ^ (hash >>> 7), 61 | hash)) ^ hash;
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRandomMap(
  width: number,
  height: number,
  style: string,
  regionId: number,
  level: number,
  seed: number,
): GeneratedMap {
  const rng = mulberry32(seed);

  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const heightVal = Math.max(
        1,
        Math.min(
          4,
          1 +
            Math.floor(
              (Math.sin(x * HEIGHT_NOISE_FREQ) + Math.cos(y * HEIGHT_NOISE_FREQ) + 2 + (regionId === 2 ? 1 : 0)) /
                HEIGHT_NOISE_DIVISOR,
            ),
        ),
      );
      row.push({ type: "terrain", height: heightVal });
    }
    tiles.push(row);
  }

  const base: Point = { x: Math.floor(width / 2), y: height - 2 };
  const spawns: Point[] = [];

  switch (style) {
    case "battlefield": {
      const spawn = { x: Math.floor(width / 2), y: 1 };
      spawns.push(spawn);
      const waypoints: Point[] = [
        { x: Math.floor(width / 2), y: 1 },
        { x: Math.floor(width / 2), y: 4 },
        { x: 3, y: 4 },
        { x: 3, y: 7 },
        { x: width - 3, y: 7 },
        { x: width - 3, y: 10 },
        { x: 4, y: 10 },
        { x: 4, y: 13 },
        { x: width - 4, y: 13 },
        { x: width - 4, y: 16 },
        { x: Math.floor(width / 2), y: 16 },
        { x: Math.floor(width / 2), y: height - 2 },
      ];

      const pathWidths = [2, 3, 1, 2, 1, 3, 2, 1, 2, 3, 2];
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]!;
        const nextWaypoint = waypoints[i + 1]!;
        const pathWidth = pathWidths[i] || 2;
        let curX = from.x;
        let curY = from.y;
        while (curX !== nextWaypoint.x || curY !== nextWaypoint.y) {
          for (let deltaY = -Math.floor(pathWidth / 2); deltaY <= Math.floor(pathWidth / 2); deltaY++) {
            for (let deltaX = -Math.floor(pathWidth / 2); deltaX <= Math.floor(pathWidth / 2); deltaX++) {
              const neighborX = curX + deltaX;
              const neighborY = curY + deltaY;
              if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height) {
                if (tiles[neighborY]![neighborX]!.type !== "base") {
                  tiles[neighborY]![neighborX]!.type = "path";
                  tiles[neighborY]![neighborX]!.height = 1;
                }
              }
            }
          }
          if (curX !== nextWaypoint.x) curX += Math.sign(nextWaypoint.x - curX);
          if (curY !== nextWaypoint.y) curY += Math.sign(nextWaypoint.y - curY);
        }
      }
      break;
    }
    case "open": {
      const spawn = { x: Math.floor(width / 2), y: 1 };
      spawns.push(spawn);
      const pathWidth = Math.round(rng() * 10) % 2 === 0 ? 3 : 2;
      carveWidePath(tiles, spawn, base, pathWidth);
      if (rng() > 0.5) {
        const midY = Math.floor(height * (0.25 + rng() * 0.5));
        const branchX = Math.floor(width * (0.2 + rng() * 0.6));
        for (let x = Math.max(0, branchX - 2); x <= Math.min(width - 1, branchX + 2); x++) {
          if (midY >= 0 && midY < height && tiles[midY]![x]!.type !== "base") {
            tiles[midY]![x]!.type = "path";
            tiles[midY]![x]!.height = 1;
          }
        }
        for (let y = Math.max(0, midY - 2); y <= Math.min(height - 1, midY + 2); y++) {
          const leftX = Math.max(0, Math.floor(width / 2) - 3);
          const rightX = Math.min(width - 1, Math.floor(width / 2) + 3);
          if (tiles[y]![leftX]!.type !== "base") {
            tiles[y]![leftX]!.type = "path";
            tiles[y]![leftX]!.height = 1;
          }
          if (tiles[y]![rightX]!.type !== "base") {
            tiles[y]![rightX]!.type = "path";
            tiles[y]![rightX]!.height = 1;
          }
        }
      }
      break;
    }
    case "canyon": {
      const spawnX = rng() > 0.5 ? 1 : width - 2;
      const spawn = { x: spawnX, y: 1 };
      spawns.push(spawn);
      carveCanyon(tiles, spawn, base, rng);
      break;
    }
    case "serpentine": {
      const spawn = { x: Math.round(rng() * 2), y: Math.floor(height * (0.1 + rng() * 0.3)) };
      spawns.push(spawn);
      carveSerpentine(tiles, spawn, base, 1, { phase: "cross", crossTargetX: Math.floor(width / 2) + 2 });
      carveSerpentine(tiles, { x: spawn.x, y: spawn.y }, base, 1, { phase: "drift" });
      carveSerpentine(tiles, { x: spawn.x, y: spawn.y }, base, 1, { phase: "down", downStepMultiplier: 2 });
      break;
    }
    case "split": {
      const spawn1 = { x: 1, y: 1 };
      const spawn2 = { x: width - 2, y: 1 };
      spawns.push(spawn1, spawn2);
      carveWidePath(tiles, spawn1, base, 1);
      carveWidePath(tiles, spawn2, base, 1);
      break;
    }
    case "bastion": {
      const spawn = { x: Math.floor(width / 2), y: 0 };
      spawns.push(spawn);
      const openAreaHeight = Math.floor(height * (0.2 + rng() * 0.2));
      const openAreaWidthFactor = 0.8 + rng() * 0.6;
      const openAreaWidth = Math.floor(height * openAreaWidthFactor);
      const shapeIndex = Math.floor(rng() * 4);
      const topEdge = base.y - openAreaHeight;
      for (let y = 0; y < topEdge; y++) {
        if (tiles[y]![spawn.x]!.type !== "base") {
          tiles[y]![spawn.x]!.type = "path";
          tiles[y]![spawn.x]!.height = 1;
        }
      }
      carveOpenArea(tiles, base, openAreaHeight, openAreaWidth, shapeIndex);
      break;
    }
  }

  for (let deltaY = -1; deltaY <= 1; deltaY++)
    for (let deltaX = -1; deltaX <= 1; deltaX++) {
      const baseX = base.x + deltaX;
      const baseY = base.y + deltaY;
      if (baseX >= 0 && baseY >= 0 && baseX < width && baseY < height) tiles[baseY]![baseX]!.type = "base";
    }
  for (const spawn of spawns) tiles[spawn.y]![spawn.x]!.type = "spawn";

  return {
    regionId,
    level,
    style,
    width,
    height,
    tiles,
    spawns,
    base,
    name: level > 0 ? `Region ${regionId + 1} Map ${level}` : "Random Map",
    bossCadence: BOSS_CADENCE[regionId]!,
    seed,
  };
}
