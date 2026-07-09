// @ts-nocheck
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextGameRoot from "@/components/TextGameRoot.vue";
import type { Grid } from "@/grid/Grid.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { mockCtx } from "../../setup";

function makeFakeGrid(): Grid {
  return {
    width: 4,
    height: 3,
    isTerrain: () => false,
    isPath: () => true,
    isBase: () => false,
    isSpawn: () => false,
  } as unknown as Grid;
}

function makeSnapshot() {
  return {
    schemaVersion: 1,
    frameId: 1,
    lastAppliedCommandId: 0,
    meta: {
      state: "playing",
      mapIndex: 0,
      lives: 20,
      gold: 100,
      currentWave: 1,
      waveCountdown: null,
      timeScale: 1,
      selectedTowerId: null,
      selectedTowerType: null,
      hoverTile: null,
      hoverUpgradeBtn: false,
      upgradeBtnClickAnim: 0,
      runGemsEarned: 0,
      bossesKilledThisRun: 0,
      bossesReachedBaseThisRun: 0,
      lastScaledDt: 1 / 60,
      endScreenData: null,
    },
    enemies: [{ id: 1, type: "minion", x: 50, y: 60, hp: 10, maxHp: 10, radius: 8 }],
    towers: [{ id: "t1", type: "basic", tileX: 1, tileY: 1 }],
    projectiles: [{ id: 1, x: 30, y: 30, radius: 2, color: "#ff0" }],
    particleSpawns: undefined,
    spawnStates: [],
    paths: undefined,
    pathsVersion: 0,
    waveGraphDots: [],
    waveGraphDotsGeneration: 0,
    lightningEffects: [],
    stunEffects: [],
  };
}

describe("TextGameRoot", () => {
  let gameStore: ReturnType<typeof useGameStore>;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    gameStore = useGameStore();
    gameStore.grid = makeFakeGrid();
    gameStore.worker = { postMessage: vi.fn() } as unknown as Worker;
    // jsdom has no real 2D context; route getContext to the shared mock so the
    // render loop can drive the canvas. measureText returns 0 → fallback path.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
    (mockCtx.fillText as ReturnType<typeof vi.fn>).mockClear();
  });

  it("drives a canvas redraw from the latest snapshot via rAF", () => {
    const snapshotStore = new SnapshotStore(gameStore);
    snapshotStore.apply(makeSnapshot());

    mount(TextGameRoot, { global: { plugins: [createPinia()] } });
    globalThis.flushRaf();

    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it("never posts a snapshotAck (it is a passive second consumer)", () => {
    const snapshotStore = new SnapshotStore(gameStore);
    snapshotStore.apply(makeSnapshot());

    mount(TextGameRoot, { global: { plugins: [createPinia()] } });
    globalThis.flushRaf();

    expect(gameStore.worker?.postMessage).not.toHaveBeenCalled();
  });
});
