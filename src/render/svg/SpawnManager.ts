import type { SpawnState } from "@/render/themes/index.js";

interface SpawnElement {
  useEl: SVGUseElement;
  lastVisualState: string;
}

export class SpawnManager {
  private elements: SpawnElement[] = [];

  init(svgRoot: SVGSVGElement, spawnCount: number): void {
    this.elements = [];
    for (let i = 0; i < spawnCount; i++) {
      const el = svgRoot.querySelector(`#spawn-${i}`) as SVGUseElement | null;
      if (el) {
        this.elements.push({ useEl: el, lastVisualState: el.getAttribute("href")?.split("#")[1] ?? "closed" });
      }
    }
  }

  sync(spawnStates: SpawnState[]): void {
    for (let i = 0; i < this.elements.length; i++) {
      const spawnState = spawnStates[i];
      if (!spawnState) continue;
      const spawnEl = this.elements[i]!;
      if (spawnState.visualState !== spawnEl.lastVisualState) {
        spawnEl.useEl.setAttribute("href", `#spawn-${spawnState.visualState}`);
        spawnEl.useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#spawn-${spawnState.visualState}`);
        spawnEl.lastVisualState = spawnState.visualState;
      }
    }
  }

  getElements(): SpawnElement[] {
    return this.elements;
  }

  dispose(): void {
    this.elements = [];
  }
}
