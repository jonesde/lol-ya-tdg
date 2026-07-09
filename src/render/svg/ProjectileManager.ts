import type { Projectile } from "./types.js";
import { PROJECTILE_POOL_SIZE, SVG_NS } from "./types.js";

export class ProjectileManager {
  private pool: SVGCircleElement[] = [];
  private idToIndex: Map<number, number> = new Map();
  private freeIndexStack: number[] = [];
  private overflowIds: Set<number> = new Set();
  private activeIdScratch: Set<number> = new Set();
  private lastRadius: string[] = [];
  private lastFill: string[] = [];

  init(layer: SVGGElement): void {
    for (let i = PROJECTILE_POOL_SIZE - 1; i >= 0; i--) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "#ffffff");
      circle.style.visibility = "hidden";
      layer.appendChild(circle);
      this.pool.push(circle);
      this.freeIndexStack.push(i);
      this.lastRadius.push("");
      this.lastFill.push("");
    }
  }

  syncFromGameEngine(projectiles: Projectile[]): void {
    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i]!;
      if (!this.idToIndex.has(proj.id) && !this.overflowIds.has(proj.id)) {
        const freeIndex = this.freeIndexStack.pop();
        if (freeIndex !== undefined) {
          this.idToIndex.set(proj.id, freeIndex);
        } else {
          this.overflowIds.add(proj.id);
        }
      }
      const poolIndex = this.idToIndex.get(proj.id);
      if (poolIndex === undefined) continue;
      const circle = this.pool[poolIndex]!;
      circle.style.visibility = "visible";
      circle.setAttribute("transform", `translate(${proj.x}, ${proj.y})`);
      const radiusString = String(proj.radius);
      if (radiusString !== this.lastRadius[poolIndex]) {
        circle.setAttribute("r", radiusString);
        this.lastRadius[poolIndex] = radiusString;
      }
      const fillColor = proj.color || "#ffffff";
      if (fillColor !== this.lastFill[poolIndex]) {
        circle.setAttribute("fill", fillColor);
        this.lastFill[poolIndex] = fillColor;
      }
    }

    this.activeIdScratch.clear();
    for (const p of projectiles) this.activeIdScratch.add(p.id);
    for (const [id, index] of this.idToIndex) {
      const circle = this.pool[index]!;
      if (!this.activeIdScratch.has(id)) {
        circle.style.visibility = "hidden";
        this.freeIndexStack.push(index);
        this.idToIndex.delete(id);
      }
    }
    for (const overflowId of this.overflowIds) {
      if (!this.activeIdScratch.has(overflowId)) {
        this.overflowIds.delete(overflowId);
      }
    }
  }

  dispose(): void {
    for (const circle of this.pool) {
      if (circle.parentNode) {
        circle.parentNode.removeChild(circle);
      }
    }
    this.pool = [];
    this.idToIndex.clear();
    this.freeIndexStack = [];
    this.overflowIds.clear();
  }
}
