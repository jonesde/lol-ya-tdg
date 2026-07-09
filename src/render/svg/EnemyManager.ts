import type { EnemySnapshot } from "../../sim/SimulationSnapshot.js";
import { ENEMY_POOL_SIZE, SVG_NS } from "./types.js";

export class EnemyManager {
  private pool: EnemyRenderProxy[] = [];
  init(layer: SVGGElement): void {
    for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
      const el = document.createElementNS(SVG_NS, "use") as SVGUseElement;
      el.style.visibility = "hidden";
      layer.appendChild(el);

      const proxy = new EnemyRenderProxy(el);
      this.pool.push(proxy);
    }
  }

  syncFromGameEngine(enemies: EnemySnapshot[]): void {
    let proxyIndex = 0;

    for (const enemy of enemies) {
      if (proxyIndex >= this.pool.length) break;

      const proxy = this.pool[proxyIndex]!;
      proxy.sync(enemy);
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

function computeEnemyFrame(enemy: EnemySnapshot, scaledElapsed: number): number {
  const walking = enemy.walking;
  if (!walking || walking.duration <= 0) return 0;
  const refImages = walking.referenceImages;
  const frameCount = refImages?.length || 1;
  return Math.floor((scaledElapsed / walking.duration) * frameCount) % frameCount;
}

class EnemyRenderProxy {
  private el: SVGUseElement;
  private lastSpriteId: string = "";
  private active: boolean = false;

  private lastTransform: string = "";
  private lastWidth: string = "";
  private lastHeight: string = "";
  private lastFilter: string = "";

  constructor(el: SVGUseElement) {
    this.el = el;
  }

  getEl(): SVGUseElement {
    return this.el;
  }

  sync(enemy: EnemySnapshot): void {
    if (!this.active) {
      this.lastSpriteId = "";
    }
    this.active = true;
    this.el.style.visibility = "visible";

    const spriteSize = enemy.radius * 4;
    const halfSize = spriteSize / 2;
    const angleDeg = enemy.angle * (180 / Math.PI);
    const posX = enemy.x - halfSize;
    const posY = enemy.y - halfSize;
    const facingLeft = Math.cos(enemy.angle) < 0;
    let transform: string;
    if (facingLeft) {
      const adjustDeg = 180 - angleDeg;
      // Inversion for facing left so rotation doesn't turn image upside-down
      // Note the negated translation with posX broken down to adjust by halfSize in the opposite direction.
      transform = `scale(-1, 1) translate(${-enemy.x - halfSize}, ${posY}) rotate(${adjustDeg}, ${halfSize}, ${halfSize})`;
    } else {
      transform = `translate(${posX}, ${posY}) rotate(${angleDeg}, ${halfSize}, ${halfSize})`;
    }
    if (transform !== this.lastTransform) {
      this.el.setAttribute("transform", transform);
      this.lastTransform = transform;
    }

    const hitReaction = enemy.hitReaction;
    const attackAnimation = enemy.attackAnimation;
    const gameSeconds = enemy.gameSeconds;
    const inHitReaction =
      hitReaction && enemy.hitAnimTime > 0 && gameSeconds - enemy.hitAnimTime < hitReaction.duration;
    const inAttack =
      !inHitReaction &&
      attackAnimation &&
      enemy.attackAnimTime > 0 &&
      gameSeconds - enemy.attackAnimTime < attackAnimation.duration;

    if (inHitReaction) {
      const elapsedInHit = gameSeconds - enemy.hitAnimTime;
      const refImages = hitReaction!.referenceImages;
      const frameCount = refImages?.length || 1;
      const hitFrameIdx = Math.floor((elapsedInHit / hitReaction!.duration) * frameCount) % frameCount;
      const spriteId = `enemy-${enemy.type}-hit-f${hitFrameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    } else if (inAttack) {
      const elapsedInAttack = gameSeconds - enemy.attackAnimTime;
      const refImages = attackAnimation!.referenceImages;
      const frameCount = refImages?.length || 1;
      const attackFrameIdx = Math.floor((elapsedInAttack / attackAnimation!.duration) * frameCount) % frameCount;
      const spriteId = `enemy-${enemy.type}-attack-f${attackFrameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    } else {
      const frameIdx = computeEnemyFrame(enemy, gameSeconds);
      const spriteId = `enemy-${enemy.type}-f${frameIdx}`;
      if (spriteId !== this.lastSpriteId) {
        this.el.setAttribute("href", `#${spriteId}`);
        this.lastSpriteId = spriteId;
      }
    }

    const widthStr = String(spriteSize);
    const heightStr = String(spriteSize);
    if (widthStr !== this.lastWidth) {
      this.el.setAttribute("width", widthStr);
      this.lastWidth = widthStr;
    }
    if (heightStr !== this.lastHeight) {
      this.el.setAttribute("height", heightStr);
      this.lastHeight = heightStr;
    }

    if (enemy.slowFactor < 1) {
      const filterLevel = Math.ceil((1 - enemy.slowFactor) * 10);
      const filterValue = `url(#slow-${filterLevel})`;
      if (filterValue !== this.lastFilter) {
        this.el.setAttribute("filter", filterValue);
        this.lastFilter = filterValue;
      }
    } else {
      if (this.lastFilter !== "") {
        this.el.removeAttribute("filter");
        this.lastFilter = "";
      }
    }
  }

  hide(): void {
    if (this.active) {
      this.el.style.visibility = "hidden";
      this.active = false;
      this.lastSpriteId = "";
      this.lastTransform = "";
      this.lastWidth = "";
      this.lastHeight = "";
      this.lastFilter = "";
    }
  }
}
