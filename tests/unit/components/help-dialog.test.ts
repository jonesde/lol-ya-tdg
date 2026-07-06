// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HelpDialog from "@/components/HelpDialog.vue";
import { useUiStore } from "@/stores/ui.js";

describe("HelpDialog", () => {
  beforeEach(() => {
    createPinia();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the dialog", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(HelpDialog, { global: { plugins: [pinia] } });
    expect(document.querySelector(".help-dialog")).not.toBeNull();
  });

  it("renders the debug bug button", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const bugBtn = document.querySelector(".debug-bug");
    expect(bugBtn).not.toBeNull();
    expect(bugBtn.getAttribute("aria-label")).toBe("Open Debug Panel");
  });

  it("opens debug panel when bug is clicked", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const uiStore = useUiStore();
    uiStore.showHelpDialog = true;
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const bugBtn = document.querySelector(".debug-bug");
    bugBtn.click();
    expect(uiStore.debugPanelVisible).toBe(true);
  });

  it("closes when overlay background is clicked", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const uiStore = useUiStore();
    uiStore.showHelpDialog = true;
    mount(HelpDialog, { global: { plugins: [pinia] } });
    const overlay = document.querySelector(".help-overlay");
    overlay.click();
    expect(uiStore.showHelpDialog).toBe(false);
  });
});
