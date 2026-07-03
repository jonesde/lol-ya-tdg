// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

interface MountResult {
  pinia: ReturnType<typeof createPinia>;
  gameStore: ReturnType<typeof useGameStore>;
  persistStore: ReturnType<typeof usePersistStore>;
  uiStore: ReturnType<typeof useUiStore>;
}

function mountConfirmDialog(): MountResult {
  const pinia = createPinia();
  setActivePinia(pinia);
  const gameStore = useGameStore();
  const persistStore = usePersistStore();
  const uiStore = useUiStore();
  return { pinia, gameStore, persistStore, uiStore };
}

describe("ConfirmDialog", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  it("renders when confirmDialog is set in uiStore", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    uiStore.showConfirm({ title: "Test Title", message: "Test message", confirmLabel: "OK", cancelLabel: "No" });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    expect(document.querySelector(".confirm-overlay")).not.toBeNull();
  });

  it("renders title and message", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    uiStore.showConfirm({
      title: "My Title",
      message: "My message content",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
    });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    expect(document.querySelector(".confirm-overlay")).not.toBeNull();
    const overlay = document.querySelector(".confirm-overlay")!;
    expect(overlay.textContent).toContain("My Title");
    expect(overlay.textContent).toContain("My message content");
  });

  it("renders confirm and cancel buttons", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    uiStore.showConfirm({ title: "Test", message: "Test msg", confirmLabel: "Confirm", cancelLabel: "Cancel" });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    const confirmBtn = document.querySelector(".confirm-overlay .confirm-btn.confirm")!;
    const cancelBtn = document.querySelector(".confirm-overlay .confirm-btn.cancel")!;
    expect(confirmBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    expect(confirmBtn.textContent.trim()).toBe("Confirm");
    expect(cancelBtn.textContent.trim()).toBe("Cancel");
  });

  it("uses custom labels when provided", () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    uiStore.showConfirm({
      title: "Custom",
      message: "Custom msg",
      confirmLabel: "Yes, do it",
      cancelLabel: "No, stop",
    });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    const overlay = document.querySelector(".confirm-overlay")!;
    expect(overlay.textContent).toContain("Yes, do it");
    expect(overlay.textContent).toContain("No, stop");
  });

  it("calls onConfirm and hides on confirm click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    const onConfirm = vi.fn();
    uiStore.showConfirm({ title: "Test", message: "Test", confirmLabel: "OK", cancelLabel: "Cancel", onConfirm });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    const confirmBtn = document.querySelector(".confirm-overlay .confirm-btn.confirm")! as HTMLButtonElement;
    await confirmBtn.click();
    expect(onConfirm).toHaveBeenCalled();
    expect(uiStore.confirmDialog).toBeNull();
  });

  it("calls onCancel and hides on cancel click", async () => {
    // biome-ignore lint/correctness/noUnusedVariables: unused stores from mount helper
    const { pinia, gameStore, persistStore, uiStore } = mountConfirmDialog();
    const onCancel = vi.fn();
    uiStore.showConfirm({ title: "Test", message: "Test", confirmLabel: "OK", cancelLabel: "Cancel", onCancel });
    mount(ConfirmDialog, { global: { plugins: [pinia] } });
    const cancelBtn = document.querySelector(".confirm-overlay .confirm-btn.cancel")! as HTMLButtonElement;
    await cancelBtn.click();
    expect(onCancel).toHaveBeenCalled();
    expect(uiStore.confirmDialog).toBeNull();
  });
});
