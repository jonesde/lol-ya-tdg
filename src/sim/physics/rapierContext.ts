import RAPIER from "@dimforge/rapier2d-compat";

let initialized = false;
let rapierModule: typeof RAPIER | null = null;

// Cached async init of the Rapier WASM module. Safe to call multiple times.
export async function initPhysics(): Promise<void> {
  if (initialized) return;
  // rapier2d-compat@0.19.3's bundled init() passes the inlined WASM bytes to the
  // wasm-bindgen loader as a positional argument, which triggers a spurious
  // "deprecated parameters for the initialization function" warning. The call is
  // correct; suppress only that exact message while init runs, then restore.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].includes("deprecated parameters for the initialization function")) {
      return;
    }
    originalWarn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = originalWarn;
  }
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
