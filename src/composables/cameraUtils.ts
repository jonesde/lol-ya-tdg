import { computed } from "vue";
import { useGameStore } from "@/stores/game.js";

interface Point {
  x: number;
  y: number;
}

export function useCameraCTM() {
  const gameStore = useGameStore();

  const spriteLayerTransform = computed(() => {
    const { camera } = gameStore;
    const { x: camX, y: camY, zoom } = camera;
    return `matrix(${zoom}, 0, 0, ${zoom}, ${camX}, ${camY})`;
  });

  function worldToScreen(worldPos: Point): Point {
    const { camera } = gameStore;
    const grid = gameStore.grid as { tileSize: number } | null | undefined;
    const tileSize = grid?.tileSize || 36;
    return { x: worldPos.x * tileSize * camera.zoom + camera.x, y: worldPos.y * tileSize * camera.zoom + camera.y };
  }

  function screenToWorld(screenPos: Point): Point {
    const { camera } = gameStore;
    const grid = gameStore.grid as { tileSize: number } | null | undefined;
    const tileSize = grid?.tileSize || 36;
    return {
      x: (screenPos.x - camera.x) / camera.zoom / tileSize,
      y: (screenPos.y - camera.y) / camera.zoom / tileSize,
    };
  }

  return { spriteLayerTransform, worldToScreen, screenToWorld };
}
