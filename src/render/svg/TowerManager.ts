import type { Tower } from "../../towers/Tower.js";
import { SVG_NS, TOWER_SCALED_SIZE } from "./types.js";

export class TowerManager {
  private layer: SVGGElement | null = null;
  private towerMap: Map<string, TowerRenderProxy> = new Map();
  private pipMap: Map<string, SVGCircleElement[]> = new Map();
  private timeOffset: number = 0;

  init(layer: SVGGElement): void {
    this.layer = layer;
  }

  setTimeOffset(offset: number): void {
    this.timeOffset = offset;
  }

  syncFromGameEngine(towers: Tower[], dt: number): void {
    if (!this.layer) return;

    const activeIds = new Set<string>();

    for (const tower of towers) {
      const towerId = tower.id;
      activeIds.add(towerId);

      if (!this.towerMap.has(towerId)) {
        const el = document.createElementNS(SVG_NS, "use") as SVGUseElement;
        el.style.visibility = "hidden";
        this.layer.appendChild(el);
        this.towerMap.set(towerId, new TowerRenderProxy(el));
      }

      const proxy = this.towerMap.get(towerId) as TowerRenderProxy;
      proxy.sync(tower, dt, this.timeOffset);

      const pipCount = Math.max(0, tower.level - 1);
      let pips = this.pipMap.get(towerId);
      if (!pips) {
        pips = [];
        this.pipMap.set(towerId, pips);
      }

      while (pips.length < pipCount) {
        const pip = document.createElementNS(SVG_NS, "circle");
        pip.setAttribute("r", "2");
        pip.style.visibility = "hidden";
        this.layer.appendChild(pip);
        pips.push(pip);
      }

      while (pips.length > pipCount) {
        const removed = pips.pop() as SVGCircleElement;
        if (removed.parentNode) {
          removed.parentNode.removeChild(removed);
        }
      }

      for (let p = 0; p < pips.length; p++) {
        const pip = pips[p]!;
        pip.style.visibility = "visible";
        const pipX = tower.x + (p - (pipCount - 1) / 2) * 5;
        const pipY = tower.y + 12;
        pip.setAttribute("transform", `translate(${pipX}, ${pipY})`);
        pip.setAttribute("fill", tower.level >= 5 ? "#ffd700" : "#c0c0c0");
      }
    }

    for (const [towerId, proxy] of this.towerMap) {
      if (!activeIds.has(towerId)) {
        proxy.dispose();
        this.towerMap.delete(towerId);
      }
    }

    for (const [towerId, pips] of this.pipMap) {
      if (!activeIds.has(towerId)) {
        for (const pip of pips) {
          if (pip.parentNode) {
            pip.parentNode.removeChild(pip);
          }
        }
        this.pipMap.delete(towerId);
      }
    }
  }

  dispose(): void {
    if (!this.layer) return;

    for (const proxy of this.towerMap.values()) {
      proxy.dispose();
    }
    this.towerMap.clear();

    for (const pips of this.pipMap.values()) {
      for (const pip of pips) {
        if (pip.parentNode) {
          pip.parentNode.removeChild(pip);
        }
      }
    }
    this.pipMap.clear();

    this.layer = null;
  }
}

function computeTowerFrame(
  animConfig: { duration: number; referenceImages?: unknown[] } | null,
  elapsed: number,
): number {
  if (!animConfig || animConfig.duration <= 0) return 0;
  const refImages = animConfig.referenceImages;
  const frameCount = refImages?.length || 1;
  if (elapsed >= animConfig.duration) return 0;
  return frameCount - 1 - Math.floor((elapsed / animConfig.duration) * frameCount);
}

class TowerRenderProxy {
  private el: SVGUseElement;
  private lastSpriteId: string = "";
  private scaledElapsed: number = 0;
  private lastSeenFireAnimTime: number = 0;
  private animStartElapsed: number = 0;
  private animConfig: { duration: number; referenceImages?: unknown[] } | null = null;

  constructor(el: SVGUseElement) {
    this.el = el;
  }

  getEl(): SVGUseElement {
    return this.el;
  }

  sync(tower: Tower, dt: number, _timeOffset: number): void {
    this.el.style.visibility = "visible";
    this.el.style.color = tower.color;

    const fireAnimTime = (tower as unknown as { fireAnimTime: number }).fireAnimTime;
    if (fireAnimTime > 0 && fireAnimTime !== this.lastSeenFireAnimTime) {
      this.lastSeenFireAnimTime = fireAnimTime;
      const config = (tower as unknown as { animation: { duration: number; referenceImages?: unknown[] } | null })
        .animation;
      if (config && config.duration > 0) {
        this.animConfig = config;
        this.animStartElapsed = this.scaledElapsed;
      }
    }

    this.scaledElapsed += dt;

    let frameIdx = 0;
    if (this.animConfig) {
      const elapsed = this.scaledElapsed - this.animStartElapsed;
      frameIdx = computeTowerFrame(this.animConfig, elapsed);
      if (elapsed >= this.animConfig.duration) {
        this.animConfig = null;
      }
    }
    const spriteId = `tower-${tower.type}-f${frameIdx}`;
    if (spriteId !== this.lastSpriteId) {
      this.el.setAttribute("href", `#${spriteId}`);
      this.lastSpriteId = spriteId;
    }

    this.el.setAttribute("width", String(TOWER_SCALED_SIZE));
    this.el.setAttribute("height", String(TOWER_SCALED_SIZE));

    const rotationDeg = (tower.angle || 0) * (180 / Math.PI);
    const halfSize = TOWER_SCALED_SIZE / 2;
    this.el.setAttribute(
      "transform",
      `translate(${tower.x - halfSize}, ${tower.y - halfSize}) rotate(${rotationDeg}, ${halfSize}, ${halfSize})`,
    );
  }

  dispose(): void {
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.lastSpriteId = "";
  }
}
