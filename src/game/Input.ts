import { onUnmounted } from "vue";
import { GameState } from "@/game/Constants.js";
import { type TowerId, TowerIds } from "@/game/ConstantsTower.js";
import type { GameStoreLike } from "@/stores/game.js";
import type { UiStoreLike } from "@/stores/ui.js";
import type { Tower } from "@/towers/Tower.js";

interface EngineLike {
  togglePause?: () => void;
  cancelBuildMode?: () => void;
  upgradeSelected?: () => void;
  sellSelected?: () => void;
  downgradeSelected?: () => void;
  setTargeting?: (mode: string) => void;
  handleClick?: (worldX: number, worldY: number) => void;
}

const towerIdList = Object.values(TowerIds) as TowerId[];
const targetingModes = ["first", "last", "closest", "strong", "furthest"] as const;

/**
 * Keyboard input handler as a Vue composable.
 * Dispatches actions to Pinia stores and game engine.
 */
const KEY_REPEAT_INTERVAL = 500;

export function useInput(gameStore: GameStoreLike, engine: EngineLike, uiStore: UiStoreLike): void {
  let lastActionTime = 0;

  function canActNow(): boolean {
    const now = performance.now();
    if (now - lastActionTime >= KEY_REPEAT_INTERVAL) {
      lastActionTime = now;
      return true;
    }
    return false;
  }

  const handle = (event: KeyboardEvent) => {
    const gs = gameStore;
    if (gs.state === GameState.MENU || gs.state === GameState.GAME_OVER || gs.state === GameState.VICTORY) return;

    switch (event.key) {
      case " ":
        if (uiStore.showPauseMenu) {
          uiStore.closeAllDialogs();
        } else {
          engine?.togglePause?.();
        }
        event.preventDefault();
        break;
      case "Escape":
      case "x":
        if (
          uiStore.showPauseMenu ||
          uiStore.showSkillTree ||
          uiStore.showStatsPanel ||
          uiStore.showHelpDialog ||
          uiStore.debugPanelVisible ||
          uiStore.confirmDialog
        ) {
          uiStore.closeAllDialogs();
        } else if (gs.selectedTowerType) {
          engine?.cancelBuildMode?.();
        } else if (gs.selectedTower) {
          gs.selectedTower = null;
        } else {
          uiStore.openPauseMenu();
        }
        break;
      case "Tab": {
        if (gs.selectedTowerType) {
          handleTabCycle(gs, event.shiftKey);
        } else {
          if (event.shiftKey) {
            gs.cycleSpeedReverse();
          } else {
            gs.cycleSpeed();
          }
        }
        event.preventDefault();
        break;
      }
      case "ArrowRight":
        if (gs.selectedTowerType) {
          if (canActNow()) moveBuildPosition(gs, 1, 0);
        } else if (canActNow()) {
          moveTowerSelection(gs, "right");
        }
        break;
      case "ArrowLeft":
        if (gs.selectedTowerType) {
          if (canActNow()) moveBuildPosition(gs, -1, 0);
        } else if (canActNow()) {
          moveTowerSelection(gs, "left");
        }
        break;
      case "ArrowUp":
        if (gs.selectedTowerType) {
          if (canActNow()) moveBuildPosition(gs, 0, -1);
        } else if (canActNow()) {
          moveTowerSelection(gs, "up");
        }
        break;
      case "ArrowDown":
        if (gs.selectedTowerType) {
          if (canActNow()) moveBuildPosition(gs, 0, 1);
        } else if (canActNow()) {
          moveTowerSelection(gs, "down");
        }
        break;
      case "w":
        if (canActNow() && gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "u":
        if (canActNow() && gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "a":
        if (canActNow()) {
          gs.cycleSpeedReverse();
        }
        break;
      case "s":
        if (canActNow() && gs.selectedTower) {
          if (gs.selectedTower.level > 1) {
            engine?.downgradeSelected?.();
          } else {
            engine?.sellSelected?.();
          }
        }
        break;
      case "d":
        if (canActNow()) {
          gs.cycleSpeed();
        }
        break;
      case "f":
        if (canActNow() && gs.selectedTower) {
          const currentMode = gs.selectedTower.targeting || "first";
          const currentIndex = targetingModes.indexOf(currentMode as (typeof targetingModes)[number]);
          const nextIndex = (currentIndex + 1) % targetingModes.length;
          engine?.setTargeting?.(targetingModes[nextIndex]!);
        }
        break;
      case "Enter":
        if (uiStore.confirmDialog) {
          uiStore.executeConfirm();
        } else if (gs.selectedTowerType && gs.hoverTile) {
          const grid = (
            gs as unknown as { grid: { tileToWorld: (tx: number, ty: number) => { x: number; y: number } } | null }
          ).grid;
          if (grid) {
            const worldPos = grid.tileToWorld(gs.hoverTile.tileX, gs.hoverTile.tileY);
            engine?.handleClick?.(worldPos.x, worldPos.y);
          }
        }
        break;
      default: {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          const towerIndex = (digit - 1) % towerIdList.length;
          gs.selectBuildType(towerIdList[towerIndex]!);
        }
        break;
      }
    }
  };

  const handleDown = (event: KeyboardEvent) => handle(event);
  const handleUp = (_event: KeyboardEvent) => {
    lastActionTime = 0;
  };
  window.addEventListener("keydown", handleDown);
  window.addEventListener("keyup", handleUp);
  onUnmounted(() => {
    window.removeEventListener("keydown", handleDown);
    window.removeEventListener("keyup", handleUp);
  });
}

function handleTabCycle(gameStore: GameStoreLike, previous: boolean): void {
  if (gameStore.selectedTowerType !== null) {
    const towerIndex = towerIdList.indexOf(gameStore.selectedTowerType);
    const offset = previous ? -1 : 1;
    const nextIndex = (towerIndex + offset + towerIdList.length) % towerIdList.length;
    gameStore.selectBuildType(towerIdList[nextIndex]!);
    return;
  }

  const towerManager = gameStore.towerManager;
  if (!towerManager || towerManager.towers.length === 0) return;

  const sortedTowers = [...towerManager.towers].sort((a, b) => {
    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
    return a.tileX - b.tileX;
  });

  if (gameStore.selectedTower) {
    const selectedId = gameStore.selectedTower.id;
    const selectedIndex = sortedTowers.findIndex((tower) => tower.id === selectedId);
    if (selectedIndex >= 0) {
      const offset = previous ? -1 : 1;
      const nextIndex = (selectedIndex + offset + sortedTowers.length) % sortedTowers.length;
      gameStore.selectTower(sortedTowers[nextIndex]!);
    }
  } else if (previous) {
    gameStore.selectTower(sortedTowers[sortedTowers.length - 1]!);
  } else {
    gameStore.selectTower(sortedTowers[0]!);
  }
}

function moveBuildPosition(gameStore: GameStoreLike, dx: number, dy: number): void {
  const grid = (gameStore as unknown as { grid: { width: number; height: number } | null }).grid;
  if (!grid) return;

  const currentHover = gameStore.hoverTile;
  let tileX: number;
  let tileY: number;

  if (currentHover === null) {
    tileX = Math.floor(grid.width / 2);
    tileY = Math.floor(grid.height / 2);
  } else {
    tileX = currentHover.tileX + dx;
    tileY = currentHover.tileY + dy;
  }

  tileX = Math.max(0, Math.min(tileX, grid.width - 1));
  tileY = Math.max(0, Math.min(tileY, grid.height - 1));

  gameStore.setHoverTile({ tileX, tileY });
}

type Direction = "up" | "down" | "left" | "right";

function moveTowerSelection(gameStore: GameStoreLike, direction: Direction): void {
  const towerManager = gameStore.towerManager;
  if (!towerManager || towerManager.towers.length === 0) return;

  const selected = gameStore.selectedTower;
  if (!selected) {
    // No tower selected: pick the most extreme tower in the given direction
    const sorted = [...towerManager.towers].sort((a, b) => {
      if (direction === "up") return a.tileY - b.tileY || a.tileX - b.tileX;
      if (direction === "down") return b.tileY - a.tileY || a.tileX - b.tileX;
      if (direction === "left") return a.tileX - b.tileX || a.tileY - b.tileY;
      return b.tileX - a.tileX || a.tileY - b.tileY;
    });
    gameStore.selectTower(sorted[0]!);
    return;
  }

  const originX = selected.tileX;
  const originY = selected.tileY;
  const towerSet = new Map<string, Tower>();
  for (const tower of towerManager.towers) {
    if (tower.id !== selected.id) {
      towerSet.set(`${tower.tileX},${tower.tileY}`, tower);
    }
  }

  // Direction-priority BFS: search by direction priority first, then distance
  const searchOrder: Array<{ dx: number; dy: number }> = [];

  if (direction === "up") {
    for (let dist = 1; dist <= 100; dist++) searchOrder.push({ dx: 0, dy: -dist });
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: -dist, dy: -dist });
      searchOrder.push({ dx: dist, dy: -dist });
    }
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: -dist, dy: 0 });
      searchOrder.push({ dx: dist, dy: 0 });
    }
  } else if (direction === "down") {
    for (let dist = 1; dist <= 100; dist++) searchOrder.push({ dx: 0, dy: dist });
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: -dist, dy: dist });
      searchOrder.push({ dx: dist, dy: dist });
    }
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: -dist, dy: 0 });
      searchOrder.push({ dx: dist, dy: 0 });
    }
  } else if (direction === "left") {
    for (let dist = 1; dist <= 100; dist++) searchOrder.push({ dx: -dist, dy: 0 });
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: -dist, dy: -dist });
      searchOrder.push({ dx: -dist, dy: dist });
    }
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: 0, dy: -dist });
      searchOrder.push({ dx: 0, dy: dist });
    }
  } else {
    for (let dist = 1; dist <= 100; dist++) searchOrder.push({ dx: dist, dy: 0 });
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: dist, dy: -dist });
      searchOrder.push({ dx: dist, dy: dist });
    }
    for (let dist = 1; dist <= 100; dist++) {
      searchOrder.push({ dx: 0, dy: -dist });
      searchOrder.push({ dx: 0, dy: dist });
    }
  }

  for (const offset of searchOrder) {
    const target = towerSet.get(`${originX + offset.dx},${originY + offset.dy}`);
    if (target) {
      gameStore.selectTower(target);
      return;
    }
  }
}
