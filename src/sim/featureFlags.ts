// Feature gate for the Rapier2d physics integration (plans/rapier2d.md).
// Single source of truth for the migration; flipping the default lives here.
// Static const (not env/dynamic) keeps the OFF path dead-code and tree-shakeable.
// Flipped ON: enemy motion now runs on the Rapier physics world (GameEngine wires
// PhysicsWorld; enemies get rigid bodies). Position-exact unit specs are gated via
// itIfOff (tests/helpers/physicsFlags.ts); the physics + behavioral suites are the
// source of truth.
export const RAPIER_PHYSICS = true;
