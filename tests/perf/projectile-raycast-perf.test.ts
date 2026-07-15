// @ts-nocheck
// Performance guard for swept-shape projectile casts under a heavy wave (Risk 2).
import { afterEach, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";

describe("projectile raycast perf (Risk 2)", () => {
  let grid: Grid;
  let pw: PhysicsWorld;
  beforeEach(() => {
    // setup.ts already initializes the WASM module at module load.
    grid = new Grid(getMap(0));
    pw = new PhysicsWorld(grid);
  });
  afterEach(() => {
    pw.dispose();
  });

  it("sustains many swept casts over a heavy wave under budget", () => {
    for (let i = 0; i < 200; i++) {
      const e = new Enemy("minion", 1, 0, grid, 1);
      const x = 50 + ((i * 37) % 700);
      const y = 50 + ((i * 53) % 500);
      e.x = x;
      e.y = y;
      e.centerX = x;
      e.centerY = y;
      pw.addEnemy(e);
    }
    pw.step();

    const FRAMES = 60;
    const castsPerFrame = 150;
    const start = performance.now();
    for (let f = 0; f < FRAMES; f++) {
      pw.step();
      for (let c = 0; c < castsPerFrame; c++) {
        const ox = 50 + ((c * 31) % 700);
        const oy = 50 + ((c * 17) % 500);
        const hits: Enemy[] = [];
        pw.castShapePierce(ox, oy, 1, 0, 11, 200, 3, (e) => {
          hits.push(e);
          return hits.length < 3;
        });
      }
    }
    const elapsed = performance.now() - start;
    const perFrame = elapsed / FRAMES;
    // Generous budget: well under one 60Hz frame. This is a guard, not a tight bound.
    expect(perFrame).toBeLessThan(16.6);
  });
});
