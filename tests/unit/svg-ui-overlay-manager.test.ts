// @ts-nocheck
import { beforeEach, describe, expect, it } from "vitest";
import { SVG_NS } from "@/render/svg/types.js";
import { UiOverlayManager } from "@/render/svg/UiOverlayManager.js";

function makeLayer(): SVGGElement {
  return document.createElementNS(SVG_NS, "g") as unknown as SVGGElement;
}

function towerSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    type: "basic",
    x: 100,
    y: 100,
    tileX: 1,
    tileY: 1,
    level: 1,
    variant: null,
    angle: 0,
    cooldown: 0,
    targeting: "first",
    totalInvested: 0,
    waveDamage: 0,
    totalDamageDealt: 0,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    health: 50,
    maxHealth: 100,
    color: "#fff",
    animation: null,
    base: { fixedAim: false },
    placedAt: 0,
    ...overrides,
  } as never;
}

describe("UiOverlayManager tower health bars", () => {
  let manager: UiOverlayManager;
  let layer: SVGGElement;

  beforeEach(() => {
    layer = makeLayer();
    manager = new UiOverlayManager();
    manager.init(layer);
  });

  it("shows a bar above a damaged tower with width proportional to health", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 50, maxHealth: 100 })]);
    const fg = (manager as never as { towerHpBarPool: SVGRectElement[] }).towerHpBarPool[2]!;
    expect(fg.style.visibility).toBe("visible");
    expect(fg.getAttribute("width")).toBe("12");
    expect(fg.getAttribute("transform")).toContain("88"); // x - 12
  });

  it("colors the bar yellow below 50% and red below 25%", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 30, maxHealth: 100 })]);
    const fg = (manager as never as { towerHpBarPool: SVGRectElement[] }).towerHpBarPool[2]!;
    expect(fg.getAttribute("fill")).toBe("#ffff00");
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 10, maxHealth: 100 })]);
    expect(fg.getAttribute("fill")).toBe("#ff0000");
  });

  it("hides the bar for a full-health tower", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 100, maxHealth: 100 })]);
    const fg = (manager as never as { towerHpBarPool: SVGRectElement[] }).towerHpBarPool[2]!;
    expect(fg.style.visibility).toBe("hidden");
  });

  it("hides leftover bars when fewer towers are damaged", () => {
    manager.syncFromGameEngine([], null, [
      towerSnapshot({ id: "a", health: 50, maxHealth: 100 }),
      towerSnapshot({ id: "b", health: 40, maxHealth: 100 }),
    ]);
    // Now only one damaged tower remains; second bar group must hide.
    manager.syncFromGameEngine([], null, [towerSnapshot({ id: "a", health: 50, maxHealth: 100 })]);
    const secondBg = (manager as never as { towerHpBarPool: SVGRectElement[] }).towerHpBarPool[3]!;
    expect(secondBg.style.visibility).toBe("hidden");
  });

  it("removes bar elements on dispose", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 50, maxHealth: 100 })]);
    manager.dispose();
    const pool = (manager as never as { towerHpBarPool: SVGRectElement[] }).towerHpBarPool;
    expect(pool.length).toBe(0);
  });
});
