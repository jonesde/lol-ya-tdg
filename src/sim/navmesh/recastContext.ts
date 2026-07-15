import * as Recast from "recast-navigation";

let initialized = false;
let recastModule: typeof Recast | null = null;

// Cached async init of the recast-navigation WASM module (plans/recast.md Phase 0).
// Mirrors the Rapier init seam (rapierContext.ts): the library's `init()` loads the
// inlined WASM, then the named exports (NavMesh, Crowd, generateSoloNavMesh, …) are
// usable. Safe to call multiple times.
export async function initNavMesh(): Promise<void> {
  if (initialized) return;
  await Recast.init();
  recastModule = Recast;
  initialized = true;
}

// Returns the initialized recast-navigation module namespace (classes + helpers).
// THROWS if initNavMesh() has not resolved — this guards misuse (the synchronous
// GameEngine constructor / NavMeshBuilder call getRecast() unconditionally, so it is
// only safe after initNavMesh() has resolved).
export function getRecast(): typeof Recast {
  if (!recastModule) {
    throw new Error("initNavMesh() must be awaited before getRecast() is called");
  }
  return recastModule;
}

export function isNavMeshInitialized(): boolean {
  return initialized;
}
