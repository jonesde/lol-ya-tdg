import { NavMeshQuery } from "recast-navigation";
import { describe, expect, it } from "vitest";
import { Grid } from "@/sim/grid/Grid.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { makeMapData } from "../../../helpers/mock-grid.js";
import { orderedPath } from "../../../helpers/navmesh-test-utils.js";

// True when the given game-world point sits over a walkable navmesh poly. Used to
// prove a tower obstacle carves its tile AND that removing it restores walkability.
function isOverPoly(builder: NavMeshBuilder, world: { x: number; y: number }): boolean {
  const navMesh = builder.getNavMesh();
  if (!navMesh) return false;
  const query = new NavMeshQuery(navMesh);
  const halfExtents = { x: 18, y: 18, z: 18 };
  const result = query.findNearestPoly(toRecast(world), { halfExtents });
  return result.success && result.isOverPoly;
}

type TileType = "terrain" | "path" | "base" | "spawn";

// A 1-tile-wide L-shaped corridor (horizontal run then vertical run to base) — the
// riskiest connectivity case, and every interior path tile is a choke that walls
// off the base if a tower is placed there.
function makeOneWideCorridorMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < 7; colIndex++) tiles[4]![colIndex]!.type = "path";
  for (let rowIndex = 4; rowIndex < 8; rowIndex++) tiles[rowIndex]![7]!.type = "path";
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 7 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

// A 2-tile-wide horizontal corridor so a single tower obstacle forces a re-route
// around it (the maze tactic) instead of fully walling off the base. Row 4 and row
// 5 are path for the full width; spawn on the left, base on the right.
function makeTwoWideCorridorMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: TileType; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: TileType; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) {
      row.push({ type: "terrain", height: 1 });
    }
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) {
    tiles[4]![colIndex]!.type = "path";
    tiles[5]![colIndex]!.type = "path";
  }
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 5 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

function spawnBaseWorld(grid: Grid) {
  const spawn = grid.spawns[0]!;
  const base = grid.getBase();
  return { spawnWorld: grid.tileToWorld(spawn.x, spawn.y), baseWorld: grid.tileToWorld(base.x, base.y) };
}

describe("NavMeshBuilder tower obstacles", () => {
  it("places a tower obstacle and re-routes enemies around it", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);
    const baselinePath = builder.findPath(spawnWorld, baseWorld);
    expect(baselinePath.length).toBeGreaterThan(0);

    // Drop a tower on row 4 — the corridor is still open via row 5, so enemies
    // must reach the base by routing around the cylinder.
    const obstacleReference = builder.addTowerObstacle(3, 4);
    expect(obstacleReference).not.toBeNull();
    const reroutedPath = builder.findPath(spawnWorld, baseWorld);
    expect(reroutedPath.length).toBeGreaterThan(0);
  });

  it("rejects a placement that would wall off the base and leaves the live navmesh untouched", () => {
    const grid = new Grid(makeOneWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);
    const baselinePath = builder.findPath(spawnWorld, baseWorld);
    expect(baselinePath.length).toBeGreaterThan(0);

    // Any interior path tile is a choke in a 1-wide corridor: placing a tower there
    // walls off the base, so the guard must reject it.
    const choke = orderedPath(grid, 0)[3]!;
    expect(builder.wouldRemainReachable(choke.x, choke.y)).toBe(false);

    // The probe never mutates the live navmesh, so the baseline corridor survives.
    expect(builder.findPath(spawnWorld, baseWorld).length).toBe(baselinePath.length);
  });

  it("syncTowers diffs the obstacle set against the live tower set", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const { spawnWorld, baseWorld } = spawnBaseWorld(grid);

    // No towers yet — no obstacles, corridor open.
    builder.syncTowers([]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Place two towers via sync; the corridor stays reachable (2-wide).
    builder.syncTowers([
      { id: 1, tileX: 2, tileY: 4, isGhost: false },
      { id: 2, tileX: 5, tileY: 4, isGhost: false },
    ]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Sell one tower (drop it from the set) — its obstacle is removed on next sync.
    builder.syncTowers([{ id: 2, tileX: 5, tileY: 4, isGhost: false }]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);

    // Ghosted towers do not carry obstacles; syncTowers clears it.
    builder.syncTowers([{ id: 2, tileX: 5, tileY: 4, isGhost: true }]);
    expect(builder.findPath(spawnWorld, baseWorld).length).toBeGreaterThan(0);
  });

  it("removing a tower obstacle restores walkability of that exact tile", () => {
    const grid = new Grid(makeTwoWideCorridorMap());
    const builder = new NavMeshBuilder(grid);
    expect(builder.isSuccess()).toBe(true);

    const obstacleCenter = grid.tileToWorld(3, 4);
    expect(isOverPoly(builder, obstacleCenter)).toBe(true);

    builder.addTowerObstacle(3, 4);
    expect(isOverPoly(builder, obstacleCenter)).toBe(false);

    builder.removeTowerObstacle(3, 4);
    // The carved tile must become walkable again after the obstacle is removed,
    // or selling a tower would permanently sever the maze at runtime.
    expect(isOverPoly(builder, obstacleCenter)).toBe(true);
  });
});
