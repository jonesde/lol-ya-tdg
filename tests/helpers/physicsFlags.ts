// Shared test helpers for the Rapier physics migration (plans/rapier2d.md Phase 5).
// Position-exact enemy-motion unit specs are skipped when RAPIER_PHYSICS is on,
// because under physics the solver produces different positions than the closed-form
// path integration. The physics suite + behavioral integration tests are the source
// of truth once the flag is flipped.

import { describe, it } from "vitest";
import { RAPIER_PHYSICS } from "@/sim/featureFlags.js";

export function itIfOff(name: string, fn: () => void | Promise<void>, timeout?: number): void {
  if (RAPIER_PHYSICS) {
    it.skip(name, fn, timeout);
  } else {
    it(name, fn, timeout);
  }
}

export function describeIfOff(name: string, fn: () => void): void {
  if (RAPIER_PHYSICS) {
    describe.skip(name, fn);
  } else {
    describe(name, fn);
  }
}
