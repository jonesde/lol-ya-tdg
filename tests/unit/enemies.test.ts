// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { Enemy, resetEnemyId } from "@/enemies/Enemy.js";
import { DIFFICULTY_MULT_TICK } from "@/game/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "@/game/ConstantsEnemy.js";
import { Grid } from "@/grid/Grid.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

describe("Enemy", () => {
  let grid: Grid;
  let map: ReturnType<typeof makeBastionMap>;

  beforeEach(() => {
    resetEnemyId();
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    map = makeBastionMap();
    grid = new Grid(map);
  });

  describe("constructor", () => {
    it("assigns incrementing IDs", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1);
      const enemy2 = new Enemy("minion", 1, 0, grid, 1);
      expect(enemy2.id).toBe(enemy1.id + 1);
    });

    it("sets type, level, and meta", () => {
      const enemy = new Enemy("tank", 3, 0, grid, 10);
      expect(enemy.type).toBe("tank");
      expect(enemy.level).toBe(3);
      expect(enemy.meta).toBe(ENEMY_TYPES.tank);
    });

    it("computes HP using the formula", () => {
      const wave = 10;
      const level = 2;
      const diffTick = 0;
      const enemy = new Enemy("minion", level, 0, grid, wave, diffTick);
      const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
      const diffMult = 1 + DIFFICULTY_MULT_TICK * diffTick;
      const expected = ENEMY_TYPES.minion.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
      expect(enemy.maxHp).toBeCloseTo(expected, 4);
      expect(enemy.hp).toBe(enemy.maxHp);
    });

    it("scales HP with wave number", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 1, 0, grid, 11, 0);
      const expectedRatio = (1 + ENEMY_WAVE_DAMAGE_MULT * 10) / (1 + ENEMY_WAVE_DAMAGE_MULT * 0);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("scales HP with enemy level", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 3, 0, grid, 1, 0);
      const expectedRatio = ENEMY_LEVEL_HP_MULT(3) / ENEMY_LEVEL_HP_MULT(1);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("scales HP with difficulty tick", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 1, 0, grid, 1, 4);
      const expectedRatio = (1 + DIFFICULTY_MULT_TICK * 4) / (1 + DIFFICULTY_MULT_TICK * 0);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("computes bounty using level scaling", () => {
      const level = 3;
      const enemy = new Enemy("minion", level, 0, grid, 1, 0);
      const expected = Math.ceil(ENEMY_TYPES.minion.bounty * (1 + 0.5 * (level - 1)));
      expect(enemy.bounty).toBe(expected);
    });

    it("sets shield for shielded enemies", () => {
      const enemy = new Enemy("shielded", 2, 0, grid, 1, 0);
      expect((enemy as { shield: number }).shield).toBe(ENEMY_TYPES.shielded.shield! * 2);
      expect((enemy as { maxShield: number }).maxShield).toBe((enemy as { shield: number }).shield);
    });

    it("has zero shield for non-shielded types", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect((enemy as { shield: number }).shield).toBe(0);
    });

    it("sets speed from meta", () => {
      const enemy = new Enemy("runner", 1, 0, grid, 1, 0);
      expect(enemy.speed).toBe(ENEMY_TYPES.runner.speed);
    });

    it("sets radius from meta and grid.tileSize", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(enemy.radius).toBe(ENEMY_TYPES.minion.radius * grid.tileSize * 0.5);
    });

    it("sets heal and healRange for healer type", () => {
      const enemy = new Enemy("healer", 1, 0, grid, 1, 0);
      expect((enemy as { heal: number }).heal).toBe(ENEMY_TYPES.healer.heal!);
      expect((enemy as { healRange: number }).healRange).toBe(ENEMY_TYPES.healer.healRange! * grid.tileSize);
    });

    it("sets resist and slowResist for boss", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      expect((enemy as { resist: number }).resist).toBe(ENEMY_TYPES.boss.resist);
      expect((enemy as { slowResist: number }).slowResist).toBe(ENEMY_TYPES.boss.slowResist);
    });

    it("initializes status effects to zero", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(enemy.slowFactor).toBe(1);
      expect(enemy.slowStack).toHaveLength(0);
      expect(enemy.stunTimer).toBe(0);
      expect(enemy.reachedBase).toBe(false);
      expect(enemy.removed).toBe(false);
      expect(enemy.burnTimer).toBe(0);
      expect(enemy.burnDps).toBe(0);
    });

    it("sets path and pathIdx from grid", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(enemy.path).not.toBeNull();
      expect(enemy.pathIdx).toBe(0);
      expect(enemy.path?.length).toBeGreaterThan(0);
    });

    it("sets initial world position to first path tile", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const firstTile = grid.tileToWorld(enemy.path![0].x, enemy.path![0].y);
      expect(enemy.x).toBe(firstTile.x);
      expect(enemy.y).toBe(firstTile.y);
    });

    it("marks as removed when no path exists", () => {
      const bastionMap = makeBastionMap();
      const grid2 = new Grid(bastionMap);
      for (const tile of grid2.paths[0]!) {
        grid2.blocked.add(`${tile.x},${tile.y}`);
      }
      grid2.recomputePaths();
      const enemy = new Enemy("minion", 1, 0, grid2, 1, 0);
      expect(enemy.removed).toBe(true);
      expect(enemy.onPathBlocked).toBe(true);
      expect(enemy.path).toBeNull();
    });
  });

  describe("takeDamage", () => {
    it("reduces HP by damage amount", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const initialHp = enemy.hp;
      enemy.takeDamage(5);
      expect(enemy.hp).toBeCloseTo(initialHp - 5, 4);
    });

    it("marks enemy as removed when HP <= 0", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 10;
      enemy.takeDamage(10);
      expect(enemy.removed).toBe(true);
    });

    it("does not remove when HP > 0 after damage", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 10;
      enemy.takeDamage(5);
      expect(enemy.removed).toBe(false);
    });

    it("absorbs damage with shield before reducing HP", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      const initialShield = (enemy as { shield: number }).shield;
      enemy.takeDamage(10);
      expect((enemy as { shield: number }).shield).toBeCloseTo(initialShield - 10, 4);
      expect(enemy.hp).toBe(enemy.maxHp);
    });

    it("depletes shield before damaging HP", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 5;
      enemy.takeDamage(10);
      expect((enemy as { shield: number }).shield).toBe(0);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    it("does not use shield when armorPiercing is true", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      const initialShield = (enemy as { shield: number }).shield;
      enemy.takeDamage(10, true);
      expect((enemy as { shield: number }).shield).toBe(initialShield);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    it("returns the actual damage dealt", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const damage = enemy.takeDamage(7);
      expect(damage).toBe(7);
    });

    it("returns 0 when damage is fully absorbed by shield", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 100;
      const damage = enemy.takeDamage(5);
      expect(damage).toBe(0);
    });
  });

  describe("applySlow", () => {
    it("adds a slow entry to the stack", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 2.0);
      expect(enemy.slowStack).toHaveLength(1);
      expect(enemy.slowStack[0].eff).toBe(0.5);
      expect(enemy.slowStack[0].remaining).toBe(2.0);
    });

    it("respects slowResist", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 2.0);
      const expectedEff = 0.5 * (1 - enemy.slowResist);
      expect(enemy.slowStack[0].eff).toBeCloseTo(expectedEff, 4);
    });

    it("merges with existing entry of same or lower strength", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.3, 1.0);
      enemy.applySlow(0.4, 2.0);
      expect(enemy.slowStack).toHaveLength(1);
      expect(enemy.slowStack[0].eff).toBe(0.4);
      expect(enemy.slowStack[0].remaining).toBe(2.0);
    });

    it("clamps slowFactor to MIN_SLOW_FACTOR", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.95, 10.0);
      expect(enemy.slowFactor).toBeGreaterThanOrEqual(MIN_SLOW_FACTOR);
    });

    it("does nothing for zero or negative eff", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0, 1.0);
      expect(enemy.slowStack).toHaveLength(0);
    });
  });

  describe("applyStun", () => {
    it("sets stunTimer to the given duration", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyStun(0.5);
      expect(enemy.stunTimer).toBe(0.5);
    });

    it("does not reduce existing stun timer", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyStun(1.0);
      enemy.applyStun(0.5);
      expect(enemy.stunTimer).toBe(1.0);
    });

    it("reduces duration for boss by BOSS_STUN_REDUCTION", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      enemy.applyStun(1.0);
      expect(enemy.stunTimer).toBeCloseTo(1.0 * BOSS_STUN_REDUCTION, 4);
    });
  });

  describe("applyBurn", () => {
    it("sets burnDps and burnTimer", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(5, 3.0);
      expect(enemy.burnDps).toBe(5);
      expect(enemy.burnTimer).toBe(3.0);
    });

    it("does not reduce existing burn values", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(10, 5.0);
      enemy.applyBurn(5, 3.0);
      expect(enemy.burnDps).toBe(10);
      expect(enemy.burnTimer).toBe(5.0);
    });
  });

  describe("update", () => {
    it("does nothing when removed", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.removed = true;
      enemy.update(0.1, null);
      expect(enemy.removed).toBe(true);
    });

    it("does nothing when reached base", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.reachedBase = true;
      enemy.update(0.1, null);
      expect(enemy.reachedBase).toBe(true);
    });

    it("reduces stunTimer each tick", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyStun(1.0);
      enemy.update(0.5, null);
      expect(enemy.stunTimer).toBeCloseTo(0.5, 4);
    });

    it("does not move while stunned", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const startX = enemy.x;
      enemy.applyStun(1.0);
      enemy.update(0.5, null);
      expect(enemy.x).toBe(startX);
    });

    it("moves toward next waypoint", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const startX = enemy.x;
      const startY = enemy.y;
      enemy.update(1.0, null);
      const distMoved = Math.hypot(enemy.x - startX, enemy.y - startY);
      expect(distMoved).toBeGreaterThan(0);
    });

    it("reaches base when pathIdx reaches end", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.pathIdx = enemy.path!.length - 1;
      enemy.update(0.01, null);
      expect(enemy.reachedBase).toBe(true);
      expect(enemy.removed).toBe(false);
    });

    it("reduces slow stack remaining time each tick", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 2.0);
      enemy.update(1.0, null);
      expect(enemy.slowStack[0].remaining).toBeCloseTo(1.0, 4);
    });

    it("removes expired slow entries", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 0.5);
      enemy.update(1.0, null);
      expect(enemy.slowStack).toHaveLength(0);
      expect(enemy.slowFactor).toBe(1);
    });

    it("applies burn damage each tick", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 20;
      enemy.applyBurn(5, 2.0);
      const hpBefore = enemy.hp;
      enemy.update(1.0, null);
      expect(enemy.hp).toBeLessThan(hpBefore);
    });

    it("stops burning when burnTimer expires", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 20;
      enemy.applyBurn(5, 0.5);
      enemy.update(1.0, null);
      const hpAfterExpiry = enemy.hp;
      enemy.update(1.0, null);
      expect(enemy.hp).toBe(hpAfterExpiry);
    });

    it("adjusts pathIdx to nearest tile when path is recomputed", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);

      for (let i = 0; i < 5; i++) {
        enemy.update(0.5, null);
      }
      const midX = enemy.x;
      const midY = enemy.y;

      if (enemy.pathIdx + 1 < enemy.path!.length) {
        const blockedTile = enemy.path![enemy.pathIdx + 1];
        grid.blocked.add(`${blockedTile.x},${blockedTile.y}`);
        grid.recomputePathsForTile(blockedTile.x, blockedTile.y);

        enemy.update(0.1, null);

        const distFromMid = Math.hypot(enemy.x - midX, enemy.y - midY);
        expect(distFromMid).toBeLessThan(grid.tileSize * 3);
        expect(enemy.pathIdx).toBeGreaterThanOrEqual(0);
        expect(enemy.pathIdx).toBeLessThan(enemy.path!.length);
      }
    });

    it("never selects a backward pathIdx on recalculation", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);

      for (let i = 0; i < 5; i++) {
        enemy.update(0.5, null);
      }

      const baseWorldPos = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
      const oldPathIdx = enemy.pathIdx;
      const oldPathTile = enemy.path![oldPathIdx];
      const oldPathWorldPos = grid.tileToWorld(oldPathTile.x, oldPathTile.y);
      const oldPathDistSqToBase = (oldPathWorldPos.x - baseWorldPos.x) ** 2 + (oldPathWorldPos.y - baseWorldPos.y) ** 2;

      if (oldPathIdx + 1 < enemy.path!.length) {
        const blockedTile = enemy.path![oldPathIdx + 1];
        grid.blocked.add(`${blockedTile.x},${blockedTile.y}`);
        grid.recomputePathsForTile(blockedTile.x, blockedTile.y);

        enemy.update(0.1, null);

        const newPathTile = enemy.path![enemy.pathIdx];
        const newPathWorldPos = grid.tileToWorld(newPathTile.x, newPathTile.y);
        const newPathDistSqToBase =
          (newPathWorldPos.x - baseWorldPos.x) ** 2 + (newPathWorldPos.y - baseWorldPos.y) ** 2;
        expect(newPathDistSqToBase).toBeLessThanOrEqual(oldPathDistSqToBase);
      }
    });
  });
});
