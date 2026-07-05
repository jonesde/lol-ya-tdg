import { defineStore } from "pinia";
import { GameState } from "@/game/Constants.js";
import { getGameEngine } from "@/game/GameEngine.js";
import { useGameStore } from "./game";

export interface UiStoreLike {
  showMainMenu: boolean;
  showSkillTree: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  debugPanelVisible: boolean;
  confirmDialog: ConfirmDialogState | null;
  closeAllDialogs: () => void;
  executeConfirm: () => void;
  openMenuFromGame: () => void;
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
  showMainMenu: boolean;
  showMapSelect: boolean;
  showSkillTree: boolean;
  showEndScreen: boolean;
  showStatsPanel: boolean;
  showHelpDialog: boolean;
  confirmDialog: ConfirmDialogState | null;
  notification: NotificationState | null;
  debugPanelVisible: boolean;
  randomMapPanelVisible: boolean;
  wasPlayingWhenMenuOpened: boolean;
  wasPlayingWhenSkillTreeOpened: boolean;
  wasPlayingWhenHelpOpened: boolean;
}

function defaultUiState(): UiStateShape {
  return {
    showMainMenu: false,
    showMapSelect: false,
    showSkillTree: false,
    showEndScreen: false,
    showStatsPanel: false,
    showHelpDialog: false,
    confirmDialog: null,
    notification: null,
    debugPanelVisible: false,
    randomMapPanelVisible: false,
    wasPlayingWhenMenuOpened: false,
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

    openMenuFromGame() {
      const gameStore = useGameStore();
      this.wasPlayingWhenMenuOpened = gameStore.isPlaying;
      if (gameStore.isPlaying) {
        getGameEngine()?.togglePause();
      }
      this.showMainMenu = true;
    },

    closeMenuResume() {
      if (this.wasPlayingWhenMenuOpened) {
        getGameEngine()?.togglePause();
      }
      this.showMainMenu = false;
      this.wasPlayingWhenMenuOpened = false;
    },

    openSkillTreeFromGame() {
      const gameStore = useGameStore();
      this.wasPlayingWhenSkillTreeOpened = this.wasPlayingWhenMenuOpened || gameStore.isPlaying;
      if (gameStore.isPlaying) {
        getGameEngine()?.togglePause();
      }
      this.showMainMenu = false;
      this.showSkillTree = true;
    },

    closeSkillTree() {
      if (this.wasPlayingWhenSkillTreeOpened) {
        getGameEngine()?.togglePause();
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
      const gameStore = useGameStore();
      if (!this.showHelpDialog && gameStore.isPlaying) {
        this.wasPlayingWhenHelpOpened = true;
        getGameEngine()?.togglePause();
      } else {
        this.wasPlayingWhenHelpOpened = false;
      }
      this.showHelpDialog = !this.showHelpDialog;
    },

    closeHelpDialog() {
      const gameStore = useGameStore();
      if (this.wasPlayingWhenHelpOpened && gameStore.state === GameState.PAUSED) {
        getGameEngine()?.togglePause();
      }
      this.showHelpDialog = false;
      this.wasPlayingWhenHelpOpened = false;
    },

    closeAllDialogs() {
      const _gameStore = useGameStore();
      if (this.showMainMenu) this.closeMenuResume();
      if (this.showSkillTree) this.closeSkillTree();
      if (this.showStatsPanel) this.closeStatsPanel();
      if (this.showHelpDialog) this.closeHelpDialog();
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
