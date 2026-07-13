import { mount } from "@vue/test-utils";
import { createPinia, type Pinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextGameRoot from "@/components/TextGameRoot.vue";
import type { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { buildTestTower, createTestEngine } from "../../helpers/engine-snapshot";
import { mockCtx } from "../../setup";

let nextCommandId = 0;

describe("TextGameRoot", () => {
  let pinia: Pinia;
  let gameStore: ReturnType<typeof useGameStore>;
  let engine: GameEngine;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    gameStore = useGameStore();

    engine = createTestEngine();
    buildTestTower(engine);
    engine.enemyManager!.spawn("minion", 1, 0, 1);
    gameStore.grid = engine.grid;
    gameStore.worker = { postMessage: vi.fn() } as unknown as Worker;
    // jsdom has no real 2D context; route getContext to the shared mock so the
    // render loop can drive the canvas. measureText returns 0 → fallback path.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as never;
    (mockCtx.fillText as ReturnType<typeof vi.fn>).mockClear();
  });

  it("drives a canvas redraw from the latest snapshot via rAF", () => {
    const snapshotStore = new SnapshotStore(gameStore as never);
    snapshotStore.apply(buildSnapshot(engine, nextCommandId++));

    mount(TextGameRoot, { global: { plugins: [pinia] } });
    globalThis.flushRaf();

    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it("never posts a snapshotAck (it is a passive second consumer)", () => {
    const snapshotStore = new SnapshotStore(gameStore as never);
    snapshotStore.apply(buildSnapshot(engine, nextCommandId++));

    mount(TextGameRoot, { global: { plugins: [pinia] } });
    globalThis.flushRaf();

    expect(gameStore.worker?.postMessage).not.toHaveBeenCalled();
  });
});
