import { defineStore } from "pinia";
import { GameState } from "@/sim/Constants.js";
import { dispatchCommand } from "@/sim/commandBus.js";
import { useGameStore } from "./game";

export interface UiStoreLike {
  showPauseMenu: boolean;
  showSkillTree: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  showMinimap: boolean;
  debugPanelVisible: boolean;
  confirmDialog: ConfirmDialogState | null;
  closeAllDialogs: () => void;
  executeConfirm: () => void;
  openPauseMenu: () => void;
  toggleMinimap: () => void;
  closeMinimap: () => void;
}

interface ConfirmDialogConfig {
  title?: string;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogState {
  title: string;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel: string;
  cancelLabel: string;
}

interface NotificationState {
  message: string;
  expires: number;
}

interface UiStateShape {
  showPauseMenu: boolean;
  showMapSelect: boolean;
  showSkillTree: boolean;
  showEndScreen: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  showMinimap: boolean;
  confirmDialog: ConfirmDialogState | null;
  notification: NotificationState | null;
  debugPanelVisible: boolean;
  randomMapPanelVisible: boolean;
  wasPlayingWhenPauseOpened: boolean;
  wasPlayingWhenSkillTreeOpened: boolean;
  wasPlayingWhenHelpOpened: boolean;
}

function defaultUiState(): UiStateShape {
  return {
    showPauseMenu: false,
    showMapSelect: false,
    showSkillTree: false,
    showEndScreen: false,
    showStatsPanel: false,
    showHelpDialog: false,
    showMinimap: false,
    confirmDialog: null,
    notification: null,
    debugPanelVisible: false,
    randomMapPanelVisible: false,
    wasPlayingWhenPauseOpened: false,
    wasPlayingWhenSkillTreeOpened: false,
    wasPlayingWhenHelpOpened: false,
  };
}

export const useUiStore = defineStore("ui", {
  state: (): UiStateShape => defaultUiState(),

  getters: { hasActiveDialog: (state) => !!state.confirmDialog },

  actions: {
    showConfirm(config: ConfirmDialogConfig) {
      this.confirmDialog = {
        title: config.title || "Confirm",
        ...(config.message !== undefined && { message: config.message }),
        ...(config.onConfirm && { onConfirm: config.onConfirm }),
        ...(config.onCancel && { onCancel: config.onCancel }),
        confirmLabel: config.confirmLabel || "Confirm",
        cancelLabel: config.cancelLabel || "Cancel",
      };
    },

    showNotification(message: string, duration?: number) {
      this.notification = { message, expires: Date.now() + (duration || 3000) };
    },

    hideNotification() {
      this.notification = null;
    },

    hideConfirm() {
      if (this.confirmDialog?.onCancel) {
        this.confirmDialog.onCancel();
      }
      this.confirmDialog = null;
    },

    executeConfirm() {
      if (this.confirmDialog?.onConfirm) {
        this.confirmDialog.onConfirm();
      }
      this.confirmDialog = null;
    },

    openPauseMenu() {
      const gameStore = useGameStore();
      this.wasPlayingWhenPauseOpened = gameStore.isPlaying;
      if (gameStore.isPlaying) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showPauseMenu = true;
    },

    closePauseMenu() {
      if (this.wasPlayingWhenPauseOpened) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showPauseMenu = false;
      this.wasPlayingWhenPauseOpened = false;
    },

    openSkillTreeFromGame() {
      const gameStore = useGameStore();
      this.wasPlayingWhenSkillTreeOpened = this.wasPlayingWhenPauseOpened || gameStore.isPlaying;
      if (gameStore.isPlaying) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showPauseMenu = false;
      this.showSkillTree = true;
    },

    closeSkillTree() {
      if (this.wasPlayingWhenSkillTreeOpened) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showSkillTree = false;
      this.wasPlayingWhenSkillTreeOpened = false;
    },

    toggleStatsPanel() {
      this.showStatsPanel = !this.showStatsPanel;
    },

    closeStatsPanel() {
      this.showStatsPanel = false;
    },

    toggleHelpDialog() {
      if (this.showHelpDialog) {
        this.closeHelpDialog();
        return;
      }
      const gameStore = useGameStore();
      if (gameStore.isPlaying) {
        this.wasPlayingWhenHelpOpened = true;
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showHelpDialog = true;
    },

    toggleMinimap() {
      this.showMinimap = !this.showMinimap;
    },

    closeMinimap() {
      this.showMinimap = false;
    },

    closeHelpDialog() {
      const gameStore = useGameStore();
      if (this.wasPlayingWhenHelpOpened && gameStore.state === GameState.PAUSED) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
      this.showHelpDialog = false;
      this.wasPlayingWhenHelpOpened = false;
    },

    closeAllDialogs() {
      const _gameStore = useGameStore();
      if (this.showPauseMenu) this.closePauseMenu();
      if (this.showSkillTree) this.closeSkillTree();
      if (this.showStatsPanel) this.closeStatsPanel();
      if (this.showHelpDialog) this.closeHelpDialog();
      if (this.showMinimap) this.closeMinimap();
      if (this.debugPanelVisible) this.closeDebugPanel();
      if (this.confirmDialog) this.hideConfirm();
    },

    openDebugPanel() {
      this.debugPanelVisible = true;
    },

    closeDebugPanel() {
      this.debugPanelVisible = false;
    },

    initForRun(savedState: Partial<UiStateShape> | null) {
      this.$state = { ...defaultUiState(), ...(savedState || {}) };
    },
  },
});
