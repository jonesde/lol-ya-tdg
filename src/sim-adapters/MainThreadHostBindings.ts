import type { ConfirmPayload, HostBindings, PersistStateSlice, SoundName, UiEvent } from "@/sim/HostBindings.js";
import type { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

export class MainThreadHostBindings implements HostBindings {
  private sound: SoundManager;

  constructor(sound: SoundManager) {
    this.sound = sound;
  }

  playSound(name: SoundName): void {
    this.sound.play(name);
  }

  notifyUi(event: UiEvent): void {
    const uiStore = useUiStore();
    switch (event.type) {
      case "initForRun":
        uiStore.initForRun(null);
        break;
      case "showNotification":
        uiStore.showNotification(event.message);
        break;
      case "endGame": {
        const gameStore = useGameStore();
        const { victory, ...data } = event.payload;
        gameStore.triggerEnd(victory, data as any);
        break;
      }
    }
  }

  schedulePersistSave(state: PersistStateSlice): void {
    const persistStore = usePersistStore();
    persistStore.gems = state.gems;
    if (state.bestWaves) persistStore.bestWaves = { ...state.bestWaves };
    if (state.activeWaves) persistStore.activeWaves = { ...state.activeWaves };
    if (state.firstTimeMilestones) persistStore.firstTimeMilestones = { ...state.firstTimeMilestones };
    if (state.firstClears) persistStore.firstClears = { ...state.firstClears };
    if (state.runHistory) persistStore.runHistory = [...state.runHistory];
    persistStore.save();
  }

  requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    const uiStore = useUiStore();
    const themeStore = useMapThemeStore();
    const visual = themeStore.getDefaultTowerVisual(payload.towerType);
    const towerName = visual?.name ?? payload.towerType;
    return new Promise<boolean>((resolve) => {
      uiStore.showConfirm({
        title: payload.isRefund ? "Full Refund" : "Sell Tower",
        message: `${payload.isRefund ? "Refund" : "Sell"} ${towerName} (Lv ${payload.towerLevel}) for ${payload.sellValue}g?`,
        confirmLabel: payload.isRefund ? "Refund" : "Sell",
        cancelLabel: "Keep",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}
