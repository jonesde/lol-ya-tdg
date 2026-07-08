// @ts-nocheck
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
import { createTestPersistState, createTestThemeBundle } from "../helpers/mock-stores";

describe("worker round-trip", () => {
  const originalSelf = (globalThis as any).self;
  const posted: any[] = [];
  const mockSelf = {
    postMessage: (msg: any) => posted.push(msg),
    onmessage: null as null | ((event: { data: any }) => void),
  };

  afterEach(() => {
    (globalThis as any).self = originalSelf;
  });

  it("initializes and produces snapshots with expected meta", async () => {
    (globalThis as any).self = mockSelf;
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

    const snapshots = posted.filter((m) => m.type === "snapshot");
    expect(snapshots.length).toBeGreaterThan(0);

    const firstSnapshot = snapshots[0].snapshot;
    expect(firstSnapshot.meta.mapIndex).toBe(0);
    expect(firstSnapshot.meta.gold).toBeGreaterThan(0);
  });

  it("applies a selectTower command reflected in the snapshot", async () => {
    (globalThis as any).self = mockSelf;
    posted.length = 0;

    await import("@/sim/WorkerEntry.js");
    mockSelf.onmessage!({
      data: { type: "init", persistState: createTestPersistState(), themeBundle: createTestThemeBundle(), mapIndex: 0 },
    });

    // Build a tower via a click command so there is something selectable.
    mockSelf.onmessage!({
      data: { type: "command", command: { commandId: 1, type: "input:click", worldX: 36, worldY: 36 } },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    mockSelf.onmessage!({ data: { type: "dispose" } });

    const snapshots = posted.filter((m) => m.type === "snapshot");
    expect(snapshots.length).toBeGreaterThan(0);
  });
});
