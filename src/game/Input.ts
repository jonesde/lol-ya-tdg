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
export function useInput(gameStore: GameStoreLike, engine: EngineLike, uiStore: UiStoreLike): void {
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
        handleTabCycle(gs);
        event.preventDefault();
        break;
      case "ArrowRight":
        gs.cycleSpeed();
        break;
      case "ArrowLeft":
        gs.cycleSpeedReverse();
        break;
      case "ArrowUp":
        if (gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "u":
        if (gs.selectedTower) {
          engine?.upgradeSelected?.();
        }
        break;
      case "s":
        if (gs.selectedTower) {
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

function handleTabCycle(gameStore: GameStoreLike): void {
  if (gameStore.selectedTowerType !== null) {
    const towerIndex = towerIdList.indexOf(gameStore.selectedTowerType);
    const nextIndex = (towerIndex + 1) % towerIdList.length;
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
      const nextIndex = (selectedIndex + 1) % sortedTowers.length;
      gameStore.selectTower(sortedTowers[nextIndex]!);
    }
  } else {
    gameStore.selectTower(sortedTowers[0]!);
  }
}
