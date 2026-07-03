import { GRID_TILE_SIZE } from "./types.js";

export function fitToGrid(
  mapWidth: number,
  mapHeight: number,
  svgWidth: number,
  svgHeight: number,
  padding: number = 40,
): { x: number; y: number; zoom: number } {
  const mapPixelWidth = mapWidth * GRID_TILE_SIZE;
  const mapPixelHeight = mapHeight * GRID_TILE_SIZE;

  const availableWidth = svgWidth - padding * 2;
  const availableHeight = svgHeight - padding * 2;

  const zoomX = availableWidth / mapPixelWidth;
  const zoomY = availableHeight / mapPixelHeight;
  const zoom = Math.min(zoomX, zoomY, 1.5);

  const centerX = mapPixelWidth / 2;
  const centerY = mapPixelHeight / 2;

  const x = svgWidth / 2 - centerX * zoom;
  const y = svgHeight / 2 - centerY * zoom;

  return { x, y, zoom };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
): { x: number; y: number } {
  const worldX = (screenX - cameraX) / zoom;
  const worldY = (screenY - cameraY) / zoom;
  return { x: worldX, y: worldY };
}

export function worldToTile(worldX: number, worldY: number): { tileX: number; tileY: number } {
  const tileX = Math.floor(worldX / GRID_TILE_SIZE);
  const tileY = Math.floor(worldY / GRID_TILE_SIZE);
  return { tileX, tileY };
}

export function screenToWorldCtm(
  screenX: number,
  screenY: number,
  svgRoot: SVGSVGElement,
  worldLayer: SVGGElement,
): { x: number; y: number } {
  const pt = svgRoot.createSVGPoint();
  pt.x = screenX;
  pt.y = screenY;
  const ctm = worldLayer.getScreenCTM()?.inverse();
  if (!ctm) return { x: screenX, y: screenY };
  const worldPos = pt.matrixTransform(ctm);
  return { x: worldPos.x, y: worldPos.y };
}
