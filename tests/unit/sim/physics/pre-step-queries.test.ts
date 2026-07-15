// @ts-nocheck
// Path-relative pile consumers (isBlockedAhead / findLateralOpenSpot) now resolve
// through Rapier-backed proximity queries. Characterization tests (Risk 4).

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { makeParticleSystem } from "../../../helpers/mock-managers.js";
import { mockDefaultTheme } from "../../../helpers/mock-stores.js";
import { stepPhysics } from "../../../helpers/physicsTestDriver.js";

describe("pre-step pile queries (Risk 4)", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;
  let pw: PhysicsWorld;
  beforeAll(async () => {
    await initPhysics();
  });
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    grid = new Grid(makeBastionMap());
    particles = makeParticleSystem();
    manager = new EnemyManager(grid, particles, 0);
    pw = new PhysicsWorld(grid);
    manager.setPhysicsWorld(pw);
  });

  function spawnAt(x: number, y: number): Enemy {
    const e = manager.spawn("minion", 1, 0, 1)!;
    e.x = x;
    e.y = y;
    e.centerX = x;
    e.centerY = y;
    e.body?.setTranslation({ x, y }, true);
    return e;
  }

  it("isBlockedAhead reports a blocking enemy ahead but not one far aside", () => {
    const a = spawnAt(200, 200);
    const ahead = spawnAt(240, 200); // directly ahead toward objective (+x)
    pw.step();
    expect(a.isBlockedAhead(manager, 300, 200)).toBe(true);

    ahead.x = 200;
    ahead.y = 300;
    ahead.centerX = 200;
    ahead.centerY = 300;
    ahead.body?.setTranslation({ x: 200, y: 300 }, true);
    pw.step();
    expect(a.isBlockedAhead(manager, 300, 200)).toBe(false);
  });

  it("findLateralOpenSpot returns an open spot when blocked ahead", () => {
    const a = spawnAt(200, 200);
    spawnAt(240, 200);
    pw.step();
    const spot = a.findLateralOpenSpot(manager, 200, 200, 0, 1, -100, 100, 0, 300, 200, false);
    expect(spot).not.toBeNull();
    expect(typeof spot!.x).toBe("number");
    expect(typeof spot!.y).toBe("number");
  });

  it("a pile spreads laterally instead of collapsing to one point (proxy)", () => {
    const enemies: Enemy[] = [];
    for (let i = 0; i < 5; i++) enemies.push(spawnAt(200 + i * 2, 200));
    for (let s = 0; s < 30; s++) stepPhysics(manager, pw, 1 / 60);
    const positions = enemies.map((e) => ({ x: e.x, y: e.y }));
    let minPair = Infinity;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const d = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
        minPair = Math.min(minPair, d);
      }
    }
    expect(minPair).toBeGreaterThan(1);
  });
});
