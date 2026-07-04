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
}

const towerIdList = Object.values(TowerIds) as TowerId[];

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
        if (uiStore.showMainMenu) {
          uiStore.closeAllDialogs();
        } else {
          engine?.togglePause?.();
        }
        event.preventDefault();
        break;
      case "Escape":
        if (
          uiStore.showMainMenu ||
          uiStore.showSkillTree ||
          uiStore.showStatsPanel ||
          uiStore.showHelpDialog ||
          uiStore.confirmDialog
        ) {
          uiStore.closeAllDialogs();
        } else if (gs.selectedTowerType) {
          engine?.cancelBuildMode?.();
        } else if (gs.selectedTower) {
          gs.selectedTower = null;
        } else {
          uiStore.openMenuFromGame();
        }
        break;
      case "Tab":
        handleTabCycle(gs, event.shiftKey);
        event.preventDefault();
        break;
      case "ArrowRight":
        if (canActNow()) gs.cycleSpeed();
        break;
      case "ArrowLeft":
        if (canActNow()) gs.cycleSpeedReverse();
        break;
      case "ArrowUp":
        if (canActNow() && gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "u":
        if (canActNow() && gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "s":
        if (canActNow() && gs.selectedTower) {
          engine?.sellSelected?.();
        }
        break;
      case "Enter":
        if (uiStore.confirmDialog) {
          uiStore.executeConfirm();
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

  window.addEventListener("keydown", handle);
  onUnmounted(() => window.removeEventListener("keydown", handle));
}

function handleTabCycle(gameStore: GameStoreLike, previous: boolean): void {
  if (gameStore.selectedTowerType !== null) {
    const towerIndex = towerIdList.indexOf(gameStore.selectedTowerType);
    const offset = previous ? -1 : 1;
    const nextIndex = (towerIndex + offset + towerIdList.length) % towerIdList.length;
    gameStore.selectBuildType(towerIdList[nextIndex]!);
    return;
  }

  const towerManager = (gameStore as unknown as { towerManager: { towers: Tower[] } | null }).towerManager;
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
