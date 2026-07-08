/**
 * Worker round-trip smoke test (Phase 7).
 *
 * A real `import GameWorker from "@/sim/WorkerEntry.ts?worker"` does not run
 * under Vitest's jsdom/forks pool reliably, so we exercise the worker's actual
 * message-handler logic directly: we install a mock `self` (the DedicatedWorker
 * global), import the worker entry module (which binds its `onmessage` to our
 * mock), drive an `init` message + a `command`, let the setTimeout-driven loop
 * tick, and assert that `snapshot` messages are produced with the expected
 * meta. This covers the same code path the real worker uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Grid } from "@/grid/Grid.js";
import { getMap } from "@/grid/Map.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "@/sim/WorkerProtocol.js";
import { createTestPersistState, createTestThemeBundle } from "../helpers/mock-stores";

// Minimal DedicatedWorkerGlobalScope shape — mirrors the declaration in
// src/sim/WorkerEntry.ts so we can type the mock `self` without pulling in the
// WebWorker lib (which conflicts with the DOM lib used for the main thread).
interface WorkerGlobalScope {
  postMessage(message: WorkerToMainMessage): void;
  onmessage: ((event: { data: MainToWorkerMessage }) => void) | null;
}

interface WorkerGlobalThis {
  self: WorkerGlobalScope | undefined;
}

type SnapshotMessage = Extract<WorkerToMainMessage, { type: "snapshot" }>;

function snapshotMessages(messages: WorkerToMainMessage[]): SnapshotMessage[] {
  return messages.filter((m): m is SnapshotMessage => m.type === "snapshot");
}

describe("worker round-trip", () => {
  const gw = globalThis as WorkerGlobalThis;
  const originalSelf = gw.self;
  const posted: WorkerToMainMessage[] = [];
  const mockSelf: WorkerGlobalScope = { postMessage: (msg: WorkerToMainMessage) => posted.push(msg), onmessage: null };

  afterEach(() => {
    gw.self = originalSelf;
  });

  it("initializes and produces snapshots with expected meta", async () => {
    gw.self = mockSelf;
    posted.length = 0;

    // Import after self is installed so the module binds self.onmessage to the mock.
    await import("@/sim/WorkerEntry.js");
    expect(typeof mockSelf.onmessage).toBe("function");

    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });

    // Let the setTimeout-driven fixed-timestep loop run a few ticks.
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Stop the loop cleanly.
    mockSelf.onmessage!({ data: { type: "dispose" } });

    const snapshots = snapshotMessages(posted);
    expect(snapshots.length).toBeGreaterThan(0);

    const firstSnapshot = snapshots[0]!.snapshot;
    expect(firstSnapshot.meta.mapIndex).toBe(0);
    expect(firstSnapshot.meta.gold).toBeGreaterThan(0);
  });

  it("builds a tower via selectBuildType + input:click commands", async () => {
    gw.self = mockSelf;
    posted.length = 0;

    await import("@/sim/WorkerEntry.js");

    // Find a buildable tile so the click actually places a tower (catches the
    // bug where the worker never received the active build type).
    const mapData = getMap(0);
    const grid = new Grid(mapData);
    let buildTile: { tx: number; ty: number } | null = null;
    for (let ty = 0; ty < grid.height && !buildTile; ty++) {
      for (let tx = 0; tx < grid.width && !buildTile; tx++) {
        if (grid.canBuild(tx, ty)) buildTile = { tx, ty };
      }
    }
    expect(buildTile).not.toBeNull();

    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });

    // Select a build type (this is what the main thread sends via the command seam).
    mockSelf.onmessage!({
      data: { type: "command", command: { commandId: 1, type: "action:selectBuildType", towerType: "basic" } },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterSelect = snapshotMessages(posted);
    expect(afterSelect[afterSelect.length - 1]!.snapshot.meta.selectedTowerType).toBe("basic");

    // Click the buildable tile to place a tower.
    const ts = 36;
    mockSelf.onmessage!({
      data: {
        type: "command",
        command: {
          commandId: 2,
          type: "input:click",
          worldX: buildTile!.tx * ts + 18,
          worldY: buildTile!.ty * ts + 18,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    mockSelf.onmessage!({ data: { type: "dispose" } });

    const finalSnapshots = snapshotMessages(posted);
    expect(finalSnapshots.length).toBeGreaterThan(0);
    const last = finalSnapshots[finalSnapshots.length - 1]!.snapshot;
    expect(last.towers.length).toBeGreaterThan(0);
  });
});
