import type { Enemy } from "../../enemies/Enemy.js";
import { ENEMY_POOL_SIZE, SVG_NS } from "./types.js";

export class EnemyManager {
  private pool: EnemyRenderProxy[] = [];
  private timeOffset: number = 0;

  init(layer: SVGGElement): void {
    for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
      const el = document.createElementNS(SVG_NS, "use") as SVGUseElement;
      el.style.visibility = "hidden";
      layer.appendChild(el);

      const proxy = new EnemyRenderProxy(el);
      this.pool.push(proxy);
    }
  }

  setTimeOffset(offset: number): void {
    this.timeOffset = offset;
  }

  syncFromGameEngine(enemies: Enemy[], dt: number): void {
    let proxyIndex = 0;

    for (const enemy of enemies) {
      if (proxyIndex >= this.pool.length) break;

      const proxy = this.pool[proxyIndex]!;
      proxy.sync(enemy, dt, this.timeOffset);
      proxyIndex++;
    }

    for (let i = proxyIndex; i < this.pool.length; i++) {
      this.pool[i]!.hide();
    }
  }

  dispose(): void {
    for (const proxy of this.pool) {
      const el = proxy.getEl();
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.pool = [];
  }
}

function computeEnemyFrame(enemy: Enemy, scaledElapsed: number): number {
  const walking = (enemy as unknown as { walking: { duration: number; referenceImages?: unknown[] } | null }).walking;
  if (!walking || walking.duration <= 0) return 0;
  const refImages = walking.referenceImages;
  const frameCount = refImages?.length || 1;
  return Math.floor((scaledElapsed / walking.duration) * frameCount) % frameCount;
}

class EnemyRenderProxy {
  private el: SVGUseElement;
  private lastSpriteId: string = "";
  private active: boolean = false;
  private walkingScaledElapsed: number = 0;
  private hitReactionStartElapsed: number = 0;
  private lastHitAnimTime: number = 0;

  constructor(el: SVGUseElement) {
    this.el = el;
    this.walkingScaledElapsed = 0;
    this.hitReactionStartElapsed = 0;
    this.lastHitAnimTime = 0;
  }

  getEl(): SVGUseElement {
    return this.el;
  }

  private isInHitReaction(hitReaction: unknown): boolean {
    if (!hitReaction || this.hitReactionStartElapsed === 0) return false;
    const elapsed = this.walkingScaledElapsed - this.hitReactionStartElapsed;
    return elapsed < (hitReaction as { duration: number }).duration;
  }

  sync(enemy: Enemy, dt: number, _timeOffset: number): void {
    if (!this.active) {
      this.walkingScaledElapsed = 0;
      this.lastSpriteId = "";
    }
    this.active = true;
    this.el.style.visibility = "visible";

    const spriteSize = enemy.radius * 4;
    this.el.setAttribute("transform", `translate(${enemy.x - spriteSize / 2}, ${enemy.y - spriteSize / 2})`);

    const hitReaction = (enemy as unknown as { hitReaction?: { duration: number; referenceImages?: unknown[] } | null })
      .hitReaction;
    const hitOccurred = enemy.hitAnimTime > 0 && enemy.hitAnimTime !== this.lastHitAnimTime;

    if (hitOccurred) {
      this.hitReactionStartElapsed = this.walkingScaledElapsed;
    }
    this.lastHitAnimTime = enemy.hitAnimTime;

    this.walkingScaledElapsed += dt;

    if (hitReaction && this.isInHitReaction(hitReaction)) {
      const elapsed = this.walkingScaledElapsed - this.hitReactionStartElapsed;
      const refImages = hitReaction.referenceImages;
      const frameCount = refImages?.length || 1;
      const hitFrameIdx = Math.floor((elapsed / hitReaction.duration) * frameCount) % frameCount;
      const spriteId = `enemy-${enemy.type}-hit-f${hitFrameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
      const scale = 0.7;
      this.el.setAttribute(
        "transform",
        `translate(${enemy.x - (spriteSize * scale) / 2}, ${enemy.y - (spriteSize * scale) / 2}) scale(${scale})`,
      );
    } else {
      if (this.hitReactionStartElapsed > 0) {
        this.hitReactionStartElapsed = 0;
        const currentTransform = this.el.getAttribute("transform") || "";
        const baseTransform = currentTransform.replace(/ scale\([\d.]+\)/, "");
        this.el.setAttribute("transform", baseTransform);
      }
      const frameIdx = computeEnemyFrame(enemy, this.walkingScaledElapsed);
      const spriteId = `enemy-${enemy.type}-f${frameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    }

    this.el.setAttribute("width", String(spriteSize));
    this.el.setAttribute("height", String(spriteSize));

    if (enemy.slowFactor < 1) {
      const filterLevel = Math.ceil((1 - enemy.slowFactor) * 10);
      this.el.setAttribute("filter", `url(#slow-${filterLevel})`);
    } else {
      this.el.removeAttribute("filter");
    }
  }

  hide(): void {
    if (this.active) {
      this.el.style.visibility = "hidden";
      this.active = false;
      this.lastSpriteId = "";
      this.walkingScaledElapsed = 0;
      this.hitReactionStartElapsed = 0;
      this.lastHitAnimTime = 0;
    }
  }
}
