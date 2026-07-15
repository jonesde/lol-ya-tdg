import { beforeAll, describe, expect, it } from "vitest";
import { getRecast, initNavMesh, isNavMeshInitialized } from "@/sim/navmesh/recastContext.js";

// Phase 0 verification: the recast-navigation WASM module loads under the jsdom test
// environment and exposes the NavMesh / Crowd classes the later phases build on.
describe("recastContext", () => {
  beforeAll(async () => {
    await initNavMesh();
  });

  it("initializes the recast-navigation WASM module", () => {
    expect(isNavMeshInitialized()).toBe(true);
  });

  it("exposes NavMesh and Crowd classes after init", () => {
    const recast = getRecast();
    expect(typeof recast.NavMesh).toBe("function");
    expect(typeof recast.Crowd).toBe("function");
  });
});
