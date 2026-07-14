// Feature gate for the Rapier2d physics integration (plans/rapier2d.md).
// Single source of truth for the migration; flipping the default lives here.
// Static const (not env/dynamic) keeps the OFF path dead-code and tree-shakeable.
export const RAPIER_PHYSICS = false;
