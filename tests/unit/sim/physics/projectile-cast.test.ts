// @ts-nocheck
// Swept-shape projectile casts (continuous collision, no tunneling).

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECTILE_HIT_THRESHOLD } from "@/sim/Constants.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { makeParticleSystem } from "../../../helpers/mock-managers.js";
import { mockDefaultTheme } from "../../../helpers/mock-stores.js";

// projectile.radius (3 for non-cannon) + the existing graze slack.
const BALL = 3 + PROJECTILE_HIT_THRESHOLD;

describe("PhysicsWorld swept casts", () => {
  let grid: Grid;
  let pw: PhysicsWorld;
  beforeEach(() => {
    grid = new Grid(getMap(0));
    pw = new PhysicsWorld(grid);
  });
  afterEach(() => {
    pw.dispose();
  });

  function addAt(x: number, y: number): Enemy {
    const e = new Enemy("minion", 1, 0, grid, 1);
    e.x = x;
    e.y = y;
    e.centerX = x;
    e.centerY = y;
    pw.addEnemy(e);
    return e;
  }

  it("continuous cast catches an enemy a discrete check would tunnel past", () => {
    addAt(200, 200);
    pw.step();
    // Origin (100,200), dir +x, sweep covers 300px -> passes through (200,200).
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy.x).toBeCloseTo(200);
  });

  it("pierce returns multiple enemies along a line, closest-first", () => {
    addAt(150, 200);
    addAt(200, 200);
    addAt(250, 200);
    pw.step();
    const hits: number[] = [];
    pw.castShapePierce(100, 200, 1, 0, BALL, 300, 3, (e) => {
      hits.push(e.x);
      return true;
    });
    expect(hits).toEqual([150, 200, 250]);
  });

  it("ignores towers/walls and returns only enemies (Risk 3)", () => {
    // Only a tower on the line: no enemy -> must be ignored (null).
    pw.rebuildTowers({ towers: [{ tileX: 0, tileY: 0, isGhost: false, x: 150, y: 200 }] });
    pw.step();
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300)).toBeNull();

    // An enemy behind the tower: cast must return it (tower excluded).
    const e = addAt(200, 200);
    pw.step();
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy).toBe(e);
    // Excluding the enemy's collider leaves only the ignored tower -> null.
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300, hit!.collider)).toBeNull();
  });
});

describe("EnemyManager cast delegate", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let pw: PhysicsWorld;
  let particles: ReturnType<typeof makeParticleSystem>;
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

  it("castShapePierce delegates to the physics world", () => {
    const e1 = manager.spawn("minion", 1, 0, 1)!;
    const e2 = manager.spawn("minion", 1, 0, 1)!;
    for (const [e, x] of [
      [e1, 150],
      [e2, 200],
    ] as const) {
      e.x = x;
      e.y = 200;
      e.centerX = x;
      e.centerY = 200;
      e.body?.setTranslation({ x, y: 200 }, true);
    }
    pw.step();
    const hits: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, BALL, 300, 3, (en) => {
      hits.push(en.x);
      return true;
    });
    expect(hits).toHaveLength(2);
  });
});
