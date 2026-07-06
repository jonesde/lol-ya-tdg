import { describe, expect, it } from "vitest";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
import type { SpawnState } from "@/render/themes/index.js";

function createSvgRoot(spawnCount: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");

  const gridLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  gridLayer.setAttribute("class", "grid-layer");

  for (let i = 0; i < spawnCount; i++) {
    const useEl = document.createElementNS("http://www.w3.org/2000/svg", "use");
    useEl.setAttribute("id", `spawn-${i}`);
    useEl.setAttribute("href", "#spawn-closed");
    useEl.setAttribute("x", String(i * 36));
    useEl.setAttribute("y", "0");
    useEl.setAttribute("width", "36");
    useEl.setAttribute("height", "36");
    gridLayer.appendChild(useEl);
  }

  svg.appendChild(gridLayer);
  document.body.appendChild(svg);
  return svg;
}

describe("SpawnManager", () => {
  it("should find spawn elements by ID on init", () => {
    const svg = createSvgRoot(3);
    const manager = new SpawnManager();
    manager.init(svg, 3);
    expect(manager.getElements()).toHaveLength(3);
    manager.dispose();
    svg.remove();
  });

  it("should only find elements that exist in the DOM", () => {
    const svg = createSvgRoot(2);
    const manager = new SpawnManager();
    manager.init(svg, 5);
    expect(manager.getElements()).toHaveLength(2);
    manager.dispose();
    svg.remove();
  });

  it("should update href when visualState changes", () => {
    const svg = createSvgRoot(2);
    const manager = new SpawnManager();
    manager.init(svg, 2);

    const states: SpawnState[] = [
      { visualState: "open", closeTransitionTimer: 0 },
      { visualState: "closed", closeTransitionTimer: 0 },
    ];
    manager.sync(states);

    const el0 = svg.querySelector("#spawn-0") as SVGUseElement;
    const el1 = svg.querySelector("#spawn-1") as SVGUseElement;
    expect(el0.getAttribute("href")).toBe("#spawn-open");
    expect(el0.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-open");
    expect(el1.getAttribute("href")).toBe("#spawn-closed");
    expect(el1.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-closed");

    manager.dispose();
    svg.remove();
  });

  it("should skip DOM write when state has not changed", () => {
    const svg = createSvgRoot(1);
    const manager = new SpawnManager();
    manager.init(svg, 1);

    const states: SpawnState[] = [{ visualState: "closed", closeTransitionTimer: 0 }];
    manager.sync(states);
    manager.sync(states);

    const el = svg.querySelector("#spawn-0") as SVGUseElement;
    expect(el.getAttribute("href")).toBe("#spawn-closed");

    manager.dispose();
    svg.remove();
  });

  it("should handle all three visual states", () => {
    const svg = createSvgRoot(3);
    const manager = new SpawnManager();
    manager.init(svg, 3);

    const states: SpawnState[] = [
      { visualState: "closed", closeTransitionTimer: 0 },
      { visualState: "transition", closeTransitionTimer: 0.5 },
      { visualState: "open", closeTransitionTimer: 0 },
    ];
    manager.sync(states);

    expect(svg.querySelector("#spawn-0")!.getAttribute("href")).toBe("#spawn-closed");
    expect(svg.querySelector("#spawn-0")!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-closed");
    expect(svg.querySelector("#spawn-1")!.getAttribute("href")).toBe("#spawn-transition");
    expect(svg.querySelector("#spawn-1")!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe(
      "#spawn-transition",
    );
    expect(svg.querySelector("#spawn-2")!.getAttribute("href")).toBe("#spawn-open");
    expect(svg.querySelector("#spawn-2")!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#spawn-open");

    manager.dispose();
    svg.remove();
  });

  it("should clear elements on dispose", () => {
    const svg = createSvgRoot(2);
    const manager = new SpawnManager();
    manager.init(svg, 2);
    manager.dispose();
    expect(manager.getElements()).toHaveLength(0);
    svg.remove();
  });
});
