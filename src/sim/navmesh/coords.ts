import type { Vector3 } from "recast-navigation";

// recast-navigation is a Y-up toolkit: its heightfield is built in the XZ plane
// and Y is height. The game's walkable plane is (x, y) at z=0. We therefore map
// the game's y onto Recast's Z axis and keep Recast Y at 0. Every geometry,
// agent, obstacle, and query position flows through these two helpers so the
// game never has to reason about Recast's axis convention.
export function toRecast(point: { x: number; y: number }): Vector3 {
  return { x: point.x, y: 0, z: point.y };
}

export function fromRecast(point: Vector3): { x: number; y: number } {
  return { x: point.x, y: point.z };
}
