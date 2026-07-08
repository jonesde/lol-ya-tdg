// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Enemy } from "@/enemies/Enemy.js";
import { GameEngine } from "@/game/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import {
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
  mockDefaultTheme,
} from "../../helpers/mock-stores";

function makeEngine() {
  const engine = new GameEngine(
    createTestPersistState(),
    createTestThemeBundle(mockDefaultTheme),
    new MockHostBindings(),
    0,
  );
  engine.loadMap(0);
  return engine;
}

function buildTowerOnValidTile(engine: GameEngine) {
  const grid = engine.runState.grid;
  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      if (grid.canBuild(x, y)) {
        const tower = engine.towerManager.build("basic", x, y, engine.persistState, grid);
        if (tower) return tower;
      }
    }
  }
  throw new Error("no buildable tile found");
}

describe("SnapshotSerializer (Phase 5)", () => {
  it("builds a complete snapshot from a live engine", () => {
    const engine = makeEngine();
    const grid = engine.runState.grid;
    buildTowerOnValidTile(engine);
    const enemy = new Enemy("boss", 2, 0, grid, 1, 0, engine.themeBundle.active, null);
    engine.enemyManager.enemies.push(enemy);

    const snap = buildSnapshot(engine, 7);

    expect(snap.schemaVersion).toBe(1);
    expect(snap.lastAppliedCommandId).toBe(7);
    expect(snap.frameId).toBeGreaterThan(0);
    expect(snap.meta.gold).toBe(engine.runState.gold);
    expect(snap.meta.lives).toBe(engine.runState.lives);
    expect(snap.meta.mapIndex).toBe(0);
    expect(snap.towers.length).toBe(1);
    expect(snap.enemies.length).toBe(1);
    expect(snap.projectiles).toBeInstanceOf(Array);
    expect(snap.particles).toBeInstanceOf(Array);
    expect(snap.spawnStates.length).toBe(grid.spawns.length);
    expect(typeof snap.spawnStates[0].pendingCount).toBe("number");
    expect(typeof snap.persistDirty).toBe("boolean");
  });

  it("carries expected entity fields", () => {
    const engine = makeEngine();
    const grid = engine.runState.grid;
    buildTowerOnValidTile(engine);
    const enemy = new Enemy("boss", 2, 0, grid, 1, 0, engine.themeBundle.active, null);
    engine.enemyManager.enemies.push(enemy);

    const snap = buildSnapshot(engine, 0);
    const e = snap.enemies[0];
    expect(e.type).toBe("boss");
    expect(e.isBoss).toBe(true);
    expect(e.radius).toBeGreaterThan(0);
    expect(e.x).toBe(enemy.x);
    expect(e.angle).toBe(enemy.moveAngle);
    expect(e.statusEffects).toBeInstanceOf(Array);

    const t = snap.towers[0];
    expect(t.type).toBe("basic");
    expect(t.color).toBeTruthy();
    expect(t.sellValue).toBeGreaterThan(0);
    expect(t.animation).toBeTruthy();
  });

  it("reflects engine mutations in subsequent snapshots", () => {
    const engine = makeEngine();
    const first = buildSnapshot(engine, 1);
    engine.runState.gold = 999;
    const second = buildSnapshot(engine, 2);

    expect(first.meta.gold).not.toBe(999);
    expect(second.meta.gold).toBe(999);
    expect(second.frameId).toBe(first.frameId + 1);
  });

  it("produces an independent copy of scalar state (no shared mutation)", () => {
    const engine = makeEngine();
    const snap = buildSnapshot(engine, 0);
    const originalGold = snap.meta.gold;
    engine.runState.gold = originalGold + 50;
    // Mutating the engine after snapshot must not retroactively change the snapshot.
    expect(snap.meta.gold).toBe(originalGold);
  });
});
