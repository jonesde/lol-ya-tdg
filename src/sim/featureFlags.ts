// Central feature-flag home (static consts, not env/dynamic import).
//
// RECAST_NAV — enemy pathfinding + routing use a recast-navigation navmesh and
// DetourCrowd (plans/recast.md) instead of the grid BFS path + tile-path following
// in Enemy.ts. The old OFF BFS/`Enemy` motion code has been deleted.
export const RECAST_NAV = true;
