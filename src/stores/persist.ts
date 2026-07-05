import { defineStore } from "pinia";
import { useUiStore } from "@/stores/ui.js";

const STORAGE_KEY = "gempath_save_v1";

interface TowerUnlocks {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

export interface GeneralAddons {
  extraHealth: number | null;
  startingGold: number | null;
  sellRefundUnlocked: boolean;
  sellDiscountUnlocked: boolean;
  sellActive: string | null;
  upgradeCostReduction: number | null;
  terrainHeightBonus: number | null;
  damageMilestoneBonus: number | null;
  slowHealing: number | null;
}

interface PersistStateShape {
  gems: number;
  highestUnlockedMap: number;
  bestWaves: Record<string, number>;
  activeWaves: Record<string, number>;
  difficulty: { multiplierTick: number };
  firstTimeMilestones: Record<string, boolean>;
  firstClears: Record<string, boolean>;
  generalAddons: GeneralAddons;
  unlocked: Record<string, TowerUnlocks>;
  runHistory: unknown[];
  randomMapRegion: number;
  randomMapLevel: number;
  randomMapStyle: string;
  randomMapSeed: number | null;
  randomMapWidth: number;
  randomMapHeight: number;
  lastSelectedThemeId: string;
}

function blankTower(): TowerUnlocks {
  return {
    levels: [true, true, false, false, false, false, false],
    variantA: [false, false, false],
    variantB: [false, false, false],
    addons: [false, false, false],
  };
}

function mergeTowerUnlocks(saved: TowerUnlocks): TowerUnlocks {
  const base = blankTower();
  const merged: TowerUnlocks = { levels: [], variantA: [], variantB: [], addons: [] };
  for (const key of ["levels", "variantA", "variantB", "addons"] as const) {
    const baseArr = base[key];
    const savedArr = saved[key] ?? [];
    const length = Math.max(baseArr.length, savedArr.length);
    for (let i = 0; i < length; i++) {
      merged[key][i] = savedArr[i] ?? baseArr[i] ?? false;
    }
  }
  return merged;
}

function defaultUnlocked(): Record<string, TowerUnlocks> {
  return {
    basic: blankTower(),
    ice: blankTower(),
    sniper: blankTower(),
    cannon: blankTower(),
    lightning: blankTower(),
    railgun: blankTower(),
  };
}

function defaultGeneralAddons(): GeneralAddons {
  return {
    extraHealth: null,
    startingGold: null,
    sellRefundUnlocked: false,
    sellDiscountUnlocked: false,
    sellActive: null,
    upgradeCostReduction: null,
    terrainHeightBonus: null,
    damageMilestoneBonus: null,
    slowHealing: null,
  };
}

function defaultState(): PersistStateShape {
  return {
    gems: 0,
    highestUnlockedMap: 0,
    bestWaves: {},
    activeWaves: {},
    difficulty: { multiplierTick: 0 },
    firstTimeMilestones: {},
    firstClears: {},
    generalAddons: defaultGeneralAddons(),
    unlocked: defaultUnlocked(),
    runHistory: [],
    randomMapRegion: 1,
    randomMapLevel: 1,
    randomMapStyle: "open",
    randomMapSeed: null,
    randomMapWidth: 20,
    randomMapHeight: 20,
    lastSelectedThemeId: "default",
  };
}

export const usePersistStore = defineStore("persist", {
  state: () => defaultState(),

  getters: {
    difficultyMultiplier: (state) => {
      const tick = state.difficulty?.multiplierTick || 0;
      return tick * 0.25 + 1;
    },
    getLatestRun: (state) =>
      state.runHistory && state.runHistory.length > 0 ? state.runHistory[state.runHistory.length - 1] : null,
  },

  actions: {
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state));
      } catch {
        const uiStore = useUiStore();
        uiStore.showNotification("Save failed - progress may not be persisted.");
      }
    },

    load() {
      try {
        const rawData = localStorage.getItem(STORAGE_KEY);
        if (rawData) {
          const parsed = JSON.parse(rawData);
          const defaults = defaultState();
          this.$state = { ...defaults, ...parsed };
          this.difficulty = { ...defaults.difficulty, ...this.difficulty };
          this.generalAddons = { ...defaults.generalAddons, ...this.generalAddons };
          this.unlocked = { ...defaults.unlocked, ...this.unlocked };
          for (const towerId of Object.keys(defaults.unlocked)) {
            if (this.unlocked[towerId]) {
              this.unlocked[towerId] = mergeTowerUnlocks(this.unlocked[towerId]);
            }
          }
          return;
        }
      } catch {
        // Corrupted save - reset
      }
      this.$state = defaultState();
    },

    reset() {
      this.$state = defaultState();
      this.save();
    },

    getDifficultyTick(): number {
      return this.difficulty?.multiplierTick || 0;
    },

    setDifficultyTick(tick: number) {
      this.difficulty = { multiplierTick: tick };
      this.save();
    },

    updateBestWave(mapIndex: number, wave: number) {
      const key = `best_${mapIndex}`;
      const prev = typeof this.bestWaves[key] === "number" ? this.bestWaves[key] : 0;
      if (wave > prev) {
        this.bestWaves[key] = wave;
        this.save();
      }
    },

    maybeUnlockNextMap(mapIndex: number) {
      if (mapIndex >= 0 && mapIndex + 1 < 36) {
        this.highestUnlockedMap = Math.max(this.highestUnlockedMap, mapIndex + 1);
        this.save();
      }
    },

    saveActiveWave(mapIndex: number, wave: number) {
      if (!this.activeWaves) this.activeWaves = {};
      this.activeWaves[mapIndex] = wave;
      this.save();
    },

    clearActiveWave(mapIndex: number) {
      if (this.activeWaves && mapIndex !== undefined) {
        delete this.activeWaves[mapIndex];
        this.save();
      }
    },

    addRunToHistory(entry: unknown) {
      if (!this.runHistory) this.runHistory = [];
      this.runHistory.push(entry);
      while (this.runHistory.length > 20) this.runHistory.shift();
      this.save();
    },

    markFirstTimeMilestone(mapIndex: number, wave: number) {
      const key = `${mapIndex}_${wave}`;
      this.firstTimeMilestones[key] = true;
      this.save();
    },

    hasClaimedMilestone(mapIndex: number, wave: number): boolean {
      const key = `${mapIndex}_${wave}`;
      return !!this.firstTimeMilestones[key];
    },

    markFirstClear(mapIndex: number) {
      const key = String(mapIndex);
      this.firstClears[key] = true;
      this.save();
    },

    hasCleared(mapIndex: number): boolean {
      const key = String(mapIndex);
      return !!this.firstClears[key];
    },
  },
});

export type PersistStore = ReturnType<typeof usePersistStore>;
