// Central feature-flag home (static consts, not env/dynamic import, so the OFF path
// stays dead-code and tree-shakeable during migration).
//
// RECAST_NAV — when true, enemy pathfinding + routing use a recast-navigation navmesh
// and DetourCrowd (plans/recast.md) instead of the grid BFS path + tile-path following
// in Enemy.ts. Default OFF: the old BFS/`Enemy` motion path stays intact and existing
// specs stay green until the behavioral suite passes; the BFS/`Enemy` motion code is
// deleted at flip.
export const RECAST_NAV = false;
