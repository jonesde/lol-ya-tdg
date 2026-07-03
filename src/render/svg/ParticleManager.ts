import type { Particle } from "./types.js";
import { PARTICLE_POOL_SIZE, SVG_NS } from "./types.js";

export class ParticleManager {
  private pool: SVGCircleElement[] = [];
  private idToIndex: Map<number, number> = new Map();
  private freeIndexStack: number[] = [];

  init(layer: SVGGElement): void {
    for (let i = PARTICLE_POOL_SIZE - 1; i >= 0; i--) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "3");
      circle.setAttribute("fill", "#ffffff");
      circle.setAttribute("opacity", "1");
      circle.style.visibility = "hidden";
      layer.appendChild(circle);
      this.pool.push(circle);
      this.freeIndexStack.push(i);
    }
  }

  syncFromGameEngine(particles: Particle[]): void {
    for (const particle of particles) {
      if (!this.idToIndex.has(particle.id)) {
        const freeIndex = this.freeIndexStack.pop();
        if (freeIndex !== undefined) {
          this.idToIndex.set(particle.id, freeIndex);
        }
      }
      const poolIndex = this.idToIndex.get(particle.id);
      if (poolIndex === undefined) continue;
      const circle = this.pool[poolIndex]!;
      circle.style.visibility = "visible";
      circle.setAttribute("transform", `translate(${particle.x}, ${particle.y})`);
      circle.setAttribute("r", String(particle.size));
      circle.setAttribute("fill", particle.color);
      circle.setAttribute("opacity", String(particle.opacity));
    }

    for (const [id, index] of this.idToIndex) {
      const circle = this.pool[index]!;
      const stillActive = particles.some((p) => p.id === id);
      if (!stillActive) {
        circle.style.visibility = "hidden";
        this.freeIndexStack.push(index);
        this.idToIndex.delete(id);
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
  }
}
