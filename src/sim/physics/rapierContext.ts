import RAPIER from "@dimforge/rapier2d-compat";

let initialized = false;
let rapierModule: typeof RAPIER | null = null;

// Cached async init of the Rapier WASM module. Safe to call multiple times.
export async function initPhysics(): Promise<void> {
  if (initialized) return;
  await RAPIER.init();
  rapierModule = RAPIER;
  initialized = true;
}

// Returns the initialized Rapier module. THROWS if initPhysics() has not
// resolved — this guards ON-mode misuse (the synchronous GameEngine constructor
// only calls this when RAPIER_PHYSICS is true, so it is unreachable in OFF mode).
export function getRapier(): typeof RAPIER {
  if (!rapierModule) {
    throw new Error("initPhysics() must be awaited before getRapier() is called");
  }
  return rapierModule;
}

export function isPhysicsInitialized(): boolean {
  return initialized;
}
