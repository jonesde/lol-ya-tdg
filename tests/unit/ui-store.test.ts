// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameState } from "@/game/Constants.js";
import type { GameEngine } from "@/game/GameEngine.js";
import { createTestStores, createTestUiStore } from "../helpers/mock-stores";

interface TogglePauseEngine extends GameEngine {
  togglePause: () => void;
}

describe("UiStore", () => {
  let store: ReturnType<typeof createTestUiStore>;

  beforeEach(() => {
    store = createTestUiStore();
  });

  describe("initial state", () => {
    it("starts with all dialogs hidden", () => {
      expect(store.showPauseMenu).toBe(false);
      expect(store.showMapSelect).toBe(false);
      expect(store.showSkillTree).toBe(false);
      expect(store.showEndScreen).toBe(false);
      expect(store.showStatsPanel).toBe(false);
    });

    it("starts with null confirmDialog", () => {
      expect(store.confirmDialog).toBeNull();
    });

    it("starts with debugPanelVisible = false", () => {
      expect(store.debugPanelVisible).toBe(false);
    });

    it("starts with randomMapPanelVisible = false", () => {
      expect(store.randomMapPanelVisible).toBe(false);
    });

    it("starts with wasPlayingWhenPauseOpened = false", () => {
      expect(store.wasPlayingWhenPauseOpened).toBe(false);
    });

    it("starts with wasPlayingWhenSkillTreeOpened = false", () => {
      expect(store.wasPlayingWhenSkillTreeOpened).toBe(false);
    });
  });

  describe("hasActiveDialog getter", () => {
    it("returns false when no confirmDialog", () => {
      expect(store.hasActiveDialog).toBe(false);
    });

    it("returns true when confirmDialog is set", () => {
      store.confirmDialog = { title: "Test", confirmLabel: "Confirm", cancelLabel: "Cancel" };
      expect(store.hasActiveDialog).toBe(true);
    });
  });

  describe("showConfirm / hideConfirm / executeConfirm", () => {
    it("showConfirm sets the dialog with defaults", () => {
      store.showConfirm({ title: "Test", message: "Are you sure?" });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.title).toBe("Test");
      expect(dialog.message).toBe("Are you sure?");
      expect(dialog.confirmLabel).toBe("Confirm");
      expect(dialog.cancelLabel).toBe("Cancel");
    });

    it("showConfirm uses custom labels", () => {
      store.showConfirm({ title: "Quit", message: "Leave?", confirmLabel: "Yes", cancelLabel: "No" });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.confirmLabel).toBe("Yes");
      expect(dialog.cancelLabel).toBe("No");
    });

    it("showConfirm stores onConfirm and onCancel callbacks", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm, onCancel });
      const dialog = store.confirmDialog as NonNullable<typeof store.confirmDialog>;
      expect(dialog.onConfirm).toBe(onConfirm);
      expect(dialog.onCancel).toBe(onCancel);
    });

    it("hideConfirm calls onCancel and clears dialog", () => {
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onCancel });
      store.hideConfirm();
      expect(onCancel).toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });

    it("hideConfirm does not throw when no onCancel", () => {
      store.showConfirm({ title: "T", message: "M" });
      expect(() => store.hideConfirm()).not.toThrow();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm calls onConfirm and hides dialog", () => {
      const onConfirm = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm });
      store.executeConfirm();
      expect(onConfirm).toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm does not throw when no onConfirm", () => {
      store.showConfirm({ title: "T", message: "M" });
      expect(() => store.executeConfirm()).not.toThrow();
      expect(store.confirmDialog).toBeNull();
    });

    it("executeConfirm does NOT call onCancel", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onConfirm, onCancel });
      store.executeConfirm();
      expect(onConfirm).toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(store.confirmDialog).toBeNull();
    });
  });

  describe("openPauseMenu / closePauseMenu", () => {
    it("openPauseMenu records wasPlayingWhenPauseOpened", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      expect(stores.ui.wasPlayingWhenPauseOpened).toBe(true);
      expect(stores.ui.showPauseMenu).toBe(true);
    });

    it("openPauseMenu does not toggle pause when engine is null", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.game.engine = null;
      stores.ui.openPauseMenu();
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("openPauseMenu toggles pause when engine exists", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const togglePauseMock = vi.fn();
      stores.game.engine = { togglePause: togglePauseMock } as unknown as TogglePauseEngine;
      stores.ui.openPauseMenu();
      expect(togglePauseMock).toHaveBeenCalled();
    });

    it("closePauseMenu hides menu and restores playing state", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      stores.ui.closePauseMenu();
      expect(stores.ui.showPauseMenu).toBe(false);
      expect(stores.ui.wasPlayingWhenPauseOpened).toBe(false);
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("closePauseMenu does not toggle when was not playing", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.MENU);
      stores.ui.openPauseMenu();
      stores.ui.closePauseMenu();
      expect(stores.game.state).toBe(GameState.MENU);
    });
  });

  describe("openSkillTreeFromGame / closeSkillTree", () => {
    it("openSkillTreeFromGame sets showSkillTree and closes pause menu", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      expect(stores.ui.showSkillTree).toBe(true);
      expect(stores.ui.showPauseMenu).toBe(false);
    });

    it("openSkillTreeFromGame does not toggle pause when engine is null", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.game.engine = null;
      stores.ui.openSkillTreeFromGame();
      expect(stores.game.state).toBe(GameState.PLAYING);
    });

    it("openSkillTreeFromGame toggles pause when engine exists", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      const togglePauseMock = vi.fn();
      stores.game.engine = { togglePause: togglePauseMock } as unknown as TogglePauseEngine;
      stores.ui.openSkillTreeFromGame();
      expect(togglePauseMock).toHaveBeenCalled();
    });

    it("closeSkillTree hides skill tree and restores playing state", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      stores.ui.closeSkillTree();
      expect(stores.ui.showSkillTree).toBe(false);
      expect(stores.ui.wasPlayingWhenSkillTreeOpened).toBe(false);
      expect(stores.game.state).toBe(GameState.PLAYING);
    });
  });

  describe("toggleStatsPanel / closeStatsPanel", () => {
    it("toggleStatsPanel toggles showStatsPanel", () => {
      expect(store.showStatsPanel).toBe(false);
      store.toggleStatsPanel();
      expect(store.showStatsPanel).toBe(true);
      store.toggleStatsPanel();
      expect(store.showStatsPanel).toBe(false);
    });

    it("closeStatsPanel sets showStatsPanel to false", () => {
      store.showStatsPanel = true;
      store.closeStatsPanel();
      expect(store.showStatsPanel).toBe(false);
    });
  });

  describe("closeAllDialogs", () => {
    it("closes pause menu", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openPauseMenu();
      stores.ui.closeAllDialogs();
      expect(stores.ui.showPauseMenu).toBe(false);
    });

    it("closes skill tree", () => {
      const stores = createTestStores();
      stores.game.setState(GameState.PLAYING);
      stores.ui.openSkillTreeFromGame();
      stores.ui.closeAllDialogs();
      expect(stores.ui.showSkillTree).toBe(false);
    });

    it("closes stats panel", () => {
      store.showStatsPanel = true;
      store.closeAllDialogs();
      expect(store.showStatsPanel).toBe(false);
    });

    it("hides confirm dialog", () => {
      const onCancel = vi.fn();
      store.showConfirm({ title: "T", message: "M", onCancel });
      store.closeAllDialogs();
      expect(store.confirmDialog).toBeNull();
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("initForRun", () => {
    it("resets to default state when no savedState", () => {
      store.showPauseMenu = true;
      store.initForRun(null);
      expect(store.showPauseMenu).toBe(false);
    });

    it("overrides defaults with savedState fields", () => {
      store.initForRun({ showMapSelect: true, debugPanelVisible: true });
      expect(store.showMapSelect).toBe(true);
      expect(store.debugPanelVisible).toBe(true);
    });

    it("preserves saved fields while resetting unsaved ones", () => {
      store.initForRun({ showMapSelect: true });
      expect(store.showMapSelect).toBe(true);
      expect(store.showPauseMenu).toBe(false);
    });
  });
});
