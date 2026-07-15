import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";

// How far the navmesh corridor is eroded from the walkable-tile boundary. Set to
// the largest *common* enemy radius (tank) so the eroded bend fillet is at least
// that radius and the tank follows a wider arc through a corner. Keeping it at
// exactly the tank radius (rather than larger) minimizes how much the erosion
// lengthens paths on real maps. 1-wide corridors stay navigable; wider corridors
// unaffected. Bosses are larger but rare — raising this factor is a tunable
// tradeoff against path length / 1-wide corridor width.
export const NAVMESH_CLEARANCE_TANK_FACTOR = 1.0;

export function navmeshClearanceWorld(tileSize: number): number {
  return ENEMY_TYPES.tank!.radius * tileSize * 0.5 * NAVMESH_CLEARANCE_TANK_FACTOR;
}

// How far each inside-corner wall vertex is chamfered back into the non-walkable
// side. At an inside bend the two corridor walls meet at a sharp convex vertex; an
// enemy circle clips that vertex and the physics shove reroutes it. Cutting the
// vertex back by ~1.5× the tank radius (and shortening the two flanking wall
// segments to meet a diagonal) rounds the catch point into a pocket the enemy can
// follow. Only the catch vertex moves — straight wall runs stay at the tile edge,
// so corridor containment (and the base perimeter) is unchanged.
export const CORRIDOR_WALL_TANK_FACTOR = 1.5;

export function corridorWallInsetWorld(tileSize: number): number {
  return ENEMY_TYPES.tank!.radius * tileSize * 0.5 * CORRIDOR_WALL_TANK_FACTOR;
}
