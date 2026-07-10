// @ts-nocheck
/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { PROJECTILE_POOL_SIZE } from "@/render/svg/types.js";

function createMockSVGElement(tagName: string) {
  const attrs: Record<string, string> = {};
  const style: Record<string, string> = {};
  const el: {
    tagName: string;
    attributes: Record<string, string>;
    style: Record<string, string>;
    children: (typeof el)[];
    parentNode: typeof el | null;
    appendChild(child: typeof el): void;
    removeChild(child: typeof el): void;
    setAttribute(key: string, value: string): void;
  } = {
    tagName,
    attributes: attrs,
    style,
    children: [],
    parentNode: null,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
    },
    setAttribute(key, value) {
      attrs[key] = value;
    },
  };
  return el;
}

function createMockSVGGElement() {
  return createMockSVGElement("g");
}

vi.mock("@/render/svg/types.js", () => ({ PROJECTILE_POOL_SIZE: 150, SVG_NS: "http://www.w3.org/2000/svg" }));

let documentCreateElementNS: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

beforeEach(() => {
  documentCreateElementNS = vi.fn((_ns: string, tag: string) => {
    return createMockSVGElement(tag);
  });
  (globalThis as unknown as Record<string, unknown>).document = { createElementNS: documentCreateElementNS };
});

describe("ProjectileManager", () => {
  let pm: ProjectileManager;
  let layer: ReturnType<typeof createMockSVGGElement>;

  beforeEach(() => {
    pm = new ProjectileManager();
    layer = createMockSVGGElement();
  });

  describe("init()", () => {
    it("creates PROJECTILE_POOL_SIZE text elements", () => {
      pm.init(layer as unknown as SVGGElement);
      expect(documentCreateElementNS).toHaveBeenCalledTimes(PROJECTILE_POOL_SIZE);
      const textCalls = documentCreateElementNS.mock.calls.filter((call) => call[1] === "text");
      expect(textCalls.length).toBe(PROJECTILE_POOL_SIZE);
    });

    it("sets font-size=6, fill=#ffffff on text elements", () => {
      pm.init(layer as unknown as SVGGElement);
      const texts = layer.children.filter((c) => c.tagName === "text");
      for (const text of texts) {
        expect(text.attributes["font-size"]).toBe("6");
        expect(text.attributes.fill).toBe("#ffffff");
      }
    });

    it("sets visibility:hidden on all elements", () => {
      pm.init(layer as unknown as SVGGElement);
      for (const el of layer.children) {
        expect(el.style.visibility).toBe("hidden");
      }
    });

    it("appends all elements to the layer", () => {
      pm.init(layer as unknown as SVGGElement);
      expect(layer.children.length).toBe(PROJECTILE_POOL_SIZE);
    });
  });

  describe("syncFromGameEngine()", () => {
    beforeEach(() => {
      pm.init(layer as unknown as SVGGElement);
    });

    it("shows text elements for projectiles with glyph + color", () => {
      pm.syncFromGameEngine([{ id: 1, x: 10, y: 20, radius: 5, color: "#ff0000", icon: "◉" }]);
      const firstText = layer.children[0];
      expect(firstText.style.visibility).toBe("visible");
      expect(firstText.attributes.transform).toBe("translate(10, 20)");
      expect(firstText.attributes["font-size"]).toBe("10");
      expect(firstText.attributes.fill).toBe("#ff0000");
      expect(firstText.textContent).toBe("◉");
    });

    it("hides unused pool elements after sync", () => {
      pm.syncFromGameEngine([{ id: 1, x: 0, y: 0, radius: 3, color: "#fff" }]);
      const firstCircle = layer.children[0];
      expect(firstCircle.style.visibility).toBe("visible");
      const secondCircle = layer.children[1];
      expect(secondCircle.style.visibility).toBe("hidden");
    });

    it("handles multiple projectiles in order", () => {
      pm.syncFromGameEngine([
        { id: 1, x: 10, y: 20, radius: 4, color: "#fff" },
        { id: 2, x: 30, y: 40, radius: 6, color: "#f00" },
      ]);
      expect(layer.children[0].style.visibility).toBe("visible");
      expect(layer.children[0].attributes.transform).toBe("translate(10, 20)");
      expect(layer.children[1].style.visibility).toBe("visible");
      expect(layer.children[1].attributes.transform).toBe("translate(30, 40)");
      expect(layer.children[2].style.visibility).toBe("hidden");
    });

    it("does not exceed pool bounds", () => {
      const projectiles = Array.from({ length: PROJECTILE_POOL_SIZE + 10 }, (_, i) => ({
        id: i + 1,
        x: i,
        y: i,
        radius: 3,
        color: "#fff",
      }));
      pm.syncFromGameEngine(projectiles);
      for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
        expect(layer.children[i].style.visibility).toBe("visible");
      }
    });

    it("does not re-create elements on subsequent sync calls", () => {
      pm.syncFromGameEngine([{ id: 1, x: 10, y: 20, radius: 3, color: "#fff" }]);
      const callCountAfterFirst = documentCreateElementNS.mock.calls.length;
      pm.syncFromGameEngine([{ id: 2, x: 30, y: 40, radius: 5, color: "#f00" }]);
      expect(documentCreateElementNS.mock.calls.length).toBe(callCountAfterFirst);
    });

    it("tracks overflow projectiles without re-attempting allocation on subsequent frames", () => {
      const projectiles = Array.from({ length: PROJECTILE_POOL_SIZE + 5 }, (_, i) => ({
        id: i + 1,
        x: i,
        y: i,
        radius: 3,
        color: "#fff",
      }));
      pm.syncFromGameEngine(projectiles);
      const callCountAfterExhaust = documentCreateElementNS.mock.calls.length;
      pm.syncFromGameEngine(projectiles);
      expect(documentCreateElementNS.mock.calls.length).toBe(callCountAfterExhaust);
    });

    it("releases overflow tracking when projectile becomes inactive", () => {
      const projectiles = Array.from({ length: PROJECTILE_POOL_SIZE + 3 }, (_, i) => ({
        id: i + 1,
        x: i,
        y: i,
        radius: 3,
        color: "#fff",
      }));
      pm.syncFromGameEngine(projectiles);
      const overflowIds = Array.from((pm as unknown as { overflowIds: Set<number> }).overflowIds);
      expect(overflowIds.length).toBe(3);
      pm.syncFromGameEngine(projectiles.slice(0, PROJECTILE_POOL_SIZE));
      const overflowIdsAfter = Array.from((pm as unknown as { overflowIds: Set<number> }).overflowIds);
      expect(overflowIdsAfter.length).toBe(0);
    });

    it("defaults color to #ffffff when not provided", () => {
      pm.syncFromGameEngine([{ id: 1, x: 10, y: 20, radius: 3, color: "" }]);
      expect(layer.children[0].attributes.fill).toBe("#ffffff");
    });
  });

  describe("dispose()", () => {
    beforeEach(() => {
      pm.init(layer as unknown as SVGGElement);
    });

    it("removes all elements from the layer", () => {
      pm.dispose();
      expect(layer.children.length).toBe(0);
    });

    it("clears the internal pools", () => {
      pm.dispose();
      pm.syncFromGameEngine([{ id: 1, x: 0, y: 0, radius: 3, color: "#fff" }]);
      expect(layer.children.length).toBe(0);
    });
  });
});
