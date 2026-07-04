// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAPALM_BURN_DPS_RATIO, NAPALM_BURN_DURATION } from "@/game/ConstantsTower.js";
import { ProjectileManager } from "@/game/ProjectileManager.js";

interface MockEnemy {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  removed: boolean;
  takeDamage: (dmg: number) => void;
  applyBurn?: (dps: number, duration: number) => void;
  applySlow?: (factor: number, duration: number) => void;
  applyStun?: (duration: number) => void;
}

interface MockEnemyManager {
  enemies: MockEnemy[];
  getEnemiesInRange: (x: number, y: number, range: number) => MockEnemy[];
  getEnemyById: (id: number) => MockEnemy | null;
}

interface MockParticleSystem {
  spawns: Array<{ x: number; y: number; color: string; count: number; speed: number; life: number }>;
  spawn: (x: number, y: number, color: string, count: number, opts: { speed: number; life: number }) => void;
}

function createMockEnemy(
  opts: Partial<MockEnemy> & { id: number; x: number; y: number; hp: number; maxHp: number },
): MockEnemy {
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    hp: opts.hp,
    maxHp: opts.maxHp,
    removed: opts.removed ?? false,
    takeDamage: opts.takeDamage ?? vi.fn(),
    applyBurn: opts.applyBurn,
    applySlow: opts.applySlow,
    applyStun: opts.applyStun,
  };
}

function createMockEnemyManager(enemies: MockEnemy[]): MockEnemyManager {
  return {
    enemies,
    getEnemiesInRange(x, y, range) {
      return enemies.filter((e) => {
        const dx = e.x - x;
        const dy = e.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= range;
      });
    },
    getEnemyById(id) {
      return enemies.find((e) => e.id === id) ?? null;
    },
  };
}

function createMockParticleSystem(): MockParticleSystem {
  const spawns: MockParticleSystem["spawns"] = [];
  return {
    spawns,
    spawn(x, y, color, count, opts) {
      spawns.push({ x, y, color, count, ...opts });
    },
  };
}

describe("ProjectileManager", () => {
  let manager: ProjectileManager;
  let enemyManager: MockEnemyManager;
  let particles: MockParticleSystem;
  let lightningSparks: Array<{ x1: number; y1: number; x2: number; y2: number }>;

  beforeEach(() => {
    enemyManager = createMockEnemyManager([]);
    particles = createMockParticleSystem();
    lightningSparks = [];
    manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
      lightningSparks.push({ x1, y1, x2, y2 });
    });
  });

  describe("spawn()", () => {
    it("adds a projectile", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 200,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const renderData = manager.getRenderData();
      expect(renderData).toHaveLength(1);
    });

    it("sets initial position on the projectile", () => {
      manager.spawn({ x: 50, y: 75, damage: 10, speed: 200, range: 5, towerType: "arrow", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.x).toBe(50);
      expect(renderData[0]!.y).toBe(75);
    });

    it("sets radius based on tower type", () => {
      manager.spawn({ x: 0, y: 0, damage: 10, speed: 200, range: 5, towerType: "cannon", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(5);
    });

    it("sets default radius of 3 for other types", () => {
      manager.spawn({ x: 0, y: 0, damage: 10, speed: 200, range: 5, towerType: "arrow", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(3);
    });
  });

  describe("circle projectile update", () => {
    it("moves toward target each frame", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const initialX = 100;
      manager.update(0.5);

      const renderData = manager.getRenderData();
      expect(renderData[0]!.x).toBeGreaterThan(initialX);
      expect(renderData[0]!.x).toBeLessThan(200);
    });

    it("removes projectile when target is removed", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100, removed: true });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes projectile when target id not found", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 999,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("hits target and removes projectile when close enough", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;

      manager.update(0.016);

      expect(takeDamage).toHaveBeenCalledWith(10);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("spawns particles on hit", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(particles.spawns).toHaveLength(1);
      expect(particles.spawns[0]!.count).toBe(3);
      expect(particles.spawns[0]!.speed).toBe(30);
      expect(particles.spawns[0]!.life).toBe(0.2);
    });

    it("applies crit damage when isCrit is true", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = true;

      manager.update(0.016);

      expect(takeDamage).toHaveBeenCalledWith(20);
    });

    it("pierces to next target when pierceCount > 0", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const enemy2 = createMockEnemy({ id: 2, x: 108, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      const takeDamage2 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 50,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;
      proj.pierceCount = 2;

      manager.update(0.016);

      expect(takeDamage1).toHaveBeenCalledWith(10);
      expect(proj.targetId).toBe(2);
      expect(manager.getRenderData()).toHaveLength(1);
    });

    it("removes after piercing all targets", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemyManager = createMockEnemyManager([enemy1]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;
      proj.pierceCount = 1;

      manager.update(0.016);

      expect(takeDamage1).toHaveBeenCalledWith(10);
      expect(manager.getRenderData()).toHaveLength(0);
    });
  });

  describe("lightning chain", () => {
    it("chains damage through nearest enemies and emits a flash per hop", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 1000, maxHp: 1000 });
      const enemy2 = createMockEnemy({ id: 2, x: 108, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamage1 = vi.fn();
      const takeDamage2 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      }, null, { tileSize: 36 } as any);

      // Force non-crit so damage values are deterministic
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 1, targetId: 1, stunDuration: 0.1 });

      randomSpy.mockRestore();

      // enemy1: full damage, then a chain back from enemy2 (second hop, falloff applied twice)
      expect(takeDamage1).toHaveBeenCalledWith(20);
      expect(takeDamage1).toHaveBeenCalledWith(20 * 0.8 ** 2);
      // enemy2: chain from initial target (first hop, falloff applied once), no further chains remain
      expect(takeDamage2).toHaveBeenCalledWith(20 * 0.8 ** 1);
      // 2 chain hops + 1 tower->final-target flash
      expect(lightningSparks).toHaveLength(3);
    });

    it("chains more hops at higher tower level", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 10000, maxHp: 10000 });
      const enemy2 = createMockEnemy({ id: 2, x: 108, y: 200, hp: 10000, maxHp: 10000 });
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      }, null, { tileSize: 36 } as any);

      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 5, targetId: 1, stunDuration: 0.1 });
      // level 5 -> tier 1 -> 3 chain hops + 1 tower->target flash
      expect(lightningSparks).toHaveLength(4);
    });
  });

  describe("napalm burn", () => {
    it("applies burn to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applyBurn = vi.fn();
      enemy.applyBurn = applyBurn;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 100,
        speed: 100,
        range: 5,
        towerType: "cannon",
        towerLevel: 1,
        targetId: 1,
        napalm: true,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      expect(proj.burnDps).toBe(100 * NAPALM_BURN_DPS_RATIO);
      expect(proj.burnDuration).toBe(NAPALM_BURN_DURATION);

      manager.update(0.016);

      expect(applyBurn).toHaveBeenCalledWith(proj.burnDps, proj.burnDuration);
    });
  });

  describe("railgun knockback and stun", () => {
    it("applies knockback to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      expect(proj.knockback).toBeGreaterThan(0);
      expect(proj.stunDuration).toBe(0.3);

      const initialX = enemy.x;
      manager.update(0.016);

      expect(enemy.x).not.toBe(initialX);
    });

    it("applies stun to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applyStun = vi.fn();
      enemy.applyStun = applyStun;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(applyStun).toHaveBeenCalledWith(0.3);
    });
  });

  describe("getRenderData()", () => {
    it("returns only active projectiles", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.active = false;

      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("includes radius and color", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(3);
      expect(renderData[0]!.color).toBe("#ffcf4d");
    });
  });

  describe("clear()", () => {
    it("removes all projectiles", () => {
      enemyManager = createMockEnemyManager([
        { id: 1, x: 200, y: 200, hp: 100, maxHp: 100, removed: false, takeDamage: vi.fn() },
      ]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });
      manager.spawn({
        x: 150,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      manager.clear();

      expect(manager.getRenderData()).toHaveLength(0);
    });
  });

  describe("setOnLightningFlash()", () => {
    it("updates the callback", () => {
      const newSparks: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      });

      manager.setOnLightningFlash((x1, y1, x2, y2) => {
        newSparks.push({ x1, y1, x2, y2 });
      });

      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 1, targetId: 1, stunDuration: 0.1 });

      expect(newSparks).toHaveLength(1);
      expect(lightningSparks).toHaveLength(0);
    });

    it("disables callback when set to null", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      manager.setOnLightningFlash(null);
      manager.update(0.016);

      expect(lightningSparks).toHaveLength(0);
    });
  });

  describe("no particle system", () => {
    it("does not crash when particles is null", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, null, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      expect(() => manager.update(0.016)).not.toThrow();
    });
  });

  describe("ice slow", () => {
    it("stores slowFactor and slowDuration from spawn opts", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 4,
        speed: 100,
        range: 5,
        towerType: "ice",
        towerLevel: 1,
        targetId: 1,
        slowAmt: 0.45,
        slowDur: 1.5,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      expect(proj.slowFactor).toBe(0.45);
      expect(proj.slowDuration).toBe(1.5);
    });

    it("applies slow to enemy on hit", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applySlow = vi.fn();
      enemy.applySlow = applySlow;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 4,
        speed: 100,
        range: 5,
        towerType: "ice",
        towerLevel: 1,
        targetId: 1,
        slowAmt: 0.45,
        slowDur: 1.5,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;

      manager.update(0.016);

      expect(applySlow).toHaveBeenCalledWith(0.45, 1.5);
    });

    it("does not apply slow when slowAmt is 0", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applySlow = vi.fn();
      enemy.applySlow = applySlow;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(applySlow).not.toHaveBeenCalled();
    });
  });

  describe("stun-triggered lightning flash gating", () => {
    it("fires lightning flash for lightning tower stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      });

      manager.fireLightning({ originX: 100, originY: 200, damage: 4, towerLevel: 1, targetId: 1, stunDuration: 0.1 });

      // Tower->target flash originates from the tower (origin), not the enemy pos
      const stunFlash = lightningSparks.find((spark) => spark.x1 === 100 && spark.y1 === 200);
      expect(stunFlash).toBeDefined();
    });

    it("does not fire lightning flash for railgun stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;
      proj.x = 104;
      proj.y = 200;

      manager.update(0.016);

      const stunFlash = lightningSparks.find((spark) => spark.x1 === 104 && spark.y1 === 200);
      expect(stunFlash).toBeUndefined();
    });

    it("does not fire lightning flash for sniper stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, (x1, y1, x2, y2) => {
        lightningSparks.push({ x1, y1, x2, y2 });
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 32,
        speed: 100,
        range: 5,
        towerType: "sniper",
        towerLevel: 5,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;
      proj.x = 104;
      proj.y = 200;

      manager.update(0.016);

      const stunFlash = lightningSparks.find((spark) => spark.x1 === 104 && spark.y1 === 200);
      expect(stunFlash).toBeUndefined();
    });
  });
});
