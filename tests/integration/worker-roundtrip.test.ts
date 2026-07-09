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
import type { Command } from "@/sim/Command.js";
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

  function sendInit(): void {
    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });
  }
  function sendCommand(command: Command): void {
    mockSelf.onmessage!({ data: { type: "command", command } });
  }
  function sendDispose(): void {
    mockSelf.onmessage!({ data: { type: "dispose" } });
  }
  function snapshotCount(): number {
    return snapshotMessages(posted).length;
  }
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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

  it("(Finding 3a) posts no snapshot while paused and idle", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40); // baseline snapshot posts while paused

    // Start the game running so the loop actively posts.
    sendCommand({ commandId: 1, type: "action:togglePause" });
    await wait(120);
    const runningCount = snapshotCount();
    expect(runningCount).toBeGreaterThan(1);

    // Pause: scaledDt becomes 0. The pause command itself posts once (it mutated
    // state that tick), then the idle skip must hold for every subsequent tick.
    sendCommand({ commandId: 2, type: "action:togglePause" });
    await wait(120);
    expect(snapshotCount()).toBe(runningCount + 1);
    await wait(120);
    expect(snapshotCount()).toBe(runningCount + 1);
    sendDispose();
  });

  it("(Finding 3b) posts exactly one snapshot on the frame a command applies while paused", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    // Paused + idle: only the baseline snapshot was posted.
    const before = snapshotCount();
    expect(before).toBeGreaterThan(0);

    // A state-mutating command (selectBuildType) must force exactly one post.
    sendCommand({ commandId: 3, type: "action:selectBuildType", towerType: "basic" });
    await wait(40);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(Finding 3c) posts the terminal snapshot exactly once before the loop stops", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    const before = snapshotCount();
    sendCommand({ commandId: 4, type: "action:debugEndRun", victory: true });
    await wait(50);
    // Exactly one terminal snapshot was posted.
    expect(snapshotCount()).toBe(before + 1);
    const terminal = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    expect(terminal.snapshot.meta.state).toBe("victory");
    // Loop is stopped: no further snapshots even after a long wait.
    await wait(100);
    expect(snapshotCount()).toBe(before + 1);
    sendDispose();
  });

  it("(Finding 3d) a subsequent init re-enables the loop cleanly", async () => {
    gw.self = mockSelf;
    posted.length = 0;
    await import("@/sim/WorkerEntry.js");
    sendInit();
    await wait(40);

    // Drive to terminal, loop stops.
    sendCommand({ commandId: 5, type: "action:debugEndRun", victory: true });
    await wait(50);
    expect(snapshotMessages(posted).some((m) => m.snapshot.meta.state === "victory")).toBe(true);

    // Re-init on the same (stopped) worker → loop resumes, fresh baseline snapshot.
    const beforeReinit = snapshotCount();
    sendInit();
    await wait(60);
    expect(snapshotCount()).toBeGreaterThan(beforeReinit);
    const resumed = snapshotMessages(posted)[snapshotMessages(posted).length - 1]!;
    // Fresh run starts paused again.
    expect(resumed.snapshot.meta.state).toBe("paused");
    sendDispose();
  });
});
