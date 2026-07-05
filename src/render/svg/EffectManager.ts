import { TOWER_BASE, TOWER_LEVEL_RANGE_MULT } from "@/game/ConstantsTower.js";
import { GRID_TILE_SIZE, LIGHTNING_POOL_SIZE, STUN_POOL_SIZE, SVG_NS } from "./types.js";

interface LightningEffect {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  life: number;
  maxLife: number;
  seed: number;
}

interface StunEffect {
  id: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  angle: number;
}

const LIGHTNING_SEGMENTS = 5;
const LIGHTNING_STROKE_WIDTH = 2;
const LIGHTNING_LIFE_SECONDS = 1 / 3;
const LIGHTNING_PERP_OFFSET = 6;
const LIGHTNING_COLOR_PRIMARY = "#40a0ff";

const STUN_STAR_COUNT = 5;
const STUN_RADIUS = 10;
const STUN_LIFE_SECONDS = 0.5;
const STUN_ROTATION_SPEED = 9;
const STUN_COLOR = "#40a0ff";

const TILE_SIZE = 36;

export class EffectManager {
  private lightningPool: SVGPolylineElement[] = [];
  private stunPool: SVGGElement[] = [];
  private buildPreviewEl: SVGRectElement | null = null;
  private buildPreviewSpriteEl: SVGUseElement | null = null;
  private rangeCircleEl: SVGCircleElement | null = null;
  private buildRangeCircleEl: SVGCircleElement | null = null;
  private upgradeButtonEl: SVGGElement | null = null;
  private upgradeButtonBgEl: SVGRectElement | null = null;
  private upgradeButtonTextEl: SVGTextElement | null = null;
  private selectedTileRectEl: SVGRectElement | null = null;

  private lightningEffects: Map<string, LightningEffect> = new Map();
  private stunEffects: Map<string, StunEffect> = new Map();

  private nextLightningId: number = 0;
  private nextStunId: number = 0;

  private buildPreviewSpriteLastId = "";
  private buildPreviewSpriteLastTransform = "";
  private buildPreviewSpriteLastSize = "";
  private buildPreviewSpriteLastColor = "";

  init(layer: SVGGElement): void {
    for (let i = 0; i < LIGHTNING_POOL_SIZE; i++) {
      const polyline = document.createElementNS(SVG_NS, "polyline");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", LIGHTNING_COLOR_PRIMARY);
      polyline.setAttribute("stroke-width", String(LIGHTNING_STROKE_WIDTH));
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      polyline.setAttribute("filter", "url(#glow)");
      polyline.style.visibility = "hidden";
      layer.appendChild(polyline);
      this.lightningPool.push(polyline);
    }

    for (let i = 0; i < STUN_POOL_SIZE; i++) {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("filter", "url(#glow)");
      group.style.visibility = "hidden";
      layer.appendChild(group);
      this.stunPool.push(group);
    }

    this.buildPreviewEl = document.createElementNS(SVG_NS, "rect");
    this.buildPreviewEl.setAttribute("fill", "rgba(0,255,0,0.3)");
    this.buildPreviewEl.setAttribute("stroke", "none");
    this.buildPreviewEl.style.visibility = "hidden";
    layer.appendChild(this.buildPreviewEl);

    this.buildPreviewSpriteEl = document.createElementNS(SVG_NS, "use");
    this.buildPreviewSpriteEl.style.visibility = "hidden";
    this.buildPreviewSpriteEl.style.opacity = "0.6";
    layer.appendChild(this.buildPreviewSpriteEl);

    this.rangeCircleEl = document.createElementNS(SVG_NS, "circle");
    this.rangeCircleEl.setAttribute("fill", "none");
    this.rangeCircleEl.setAttribute("stroke", "rgba(255,255,255,0.4)");
    this.rangeCircleEl.setAttribute("stroke-width", "1.5");
    this.rangeCircleEl.style.visibility = "hidden";
    layer.appendChild(this.rangeCircleEl);

    this.buildRangeCircleEl = document.createElementNS(SVG_NS, "circle");
    this.buildRangeCircleEl.setAttribute("fill", "none");
    this.buildRangeCircleEl.setAttribute("stroke", "rgba(0,255,0,0.6)");
    this.buildRangeCircleEl.setAttribute("stroke-width", "1.5");
    this.buildRangeCircleEl.setAttribute("stroke-dasharray", "4,3");
    this.buildRangeCircleEl.style.visibility = "hidden";
    layer.appendChild(this.buildRangeCircleEl);

    this.upgradeButtonEl = document.createElementNS(SVG_NS, "g");
    this.upgradeButtonEl.style.visibility = "hidden";

    this.upgradeButtonBgEl = document.createElementNS(SVG_NS, "rect");
    this.upgradeButtonBgEl.setAttribute("fill", "#00004a");
    this.upgradeButtonBgEl.setAttribute("stroke", "#40a0ff");
    this.upgradeButtonBgEl.setAttribute("stroke-width", "1");
    this.upgradeButtonBgEl.setAttribute("rx", "2");
    this.upgradeButtonBgEl.setAttribute("ry", "2");
    this.upgradeButtonBgEl.setAttribute("width", "10");
    this.upgradeButtonBgEl.setAttribute("height", "10");
    this.upgradeButtonEl.appendChild(this.upgradeButtonBgEl);

    this.upgradeButtonTextEl = document.createElementNS(SVG_NS, "text");
    this.upgradeButtonTextEl.setAttribute("fill", "#ffffff");
    this.upgradeButtonTextEl.setAttribute("font-size", "8");
    this.upgradeButtonTextEl.setAttribute("font-weight", "bold");
    this.upgradeButtonTextEl.setAttribute("font-family", "sans-serif");
    this.upgradeButtonTextEl.setAttribute("text-anchor", "middle");
    this.upgradeButtonTextEl.setAttribute("dominant-baseline", "central");
    this.upgradeButtonEl.appendChild(this.upgradeButtonTextEl);

    layer.appendChild(this.upgradeButtonEl);

    this.selectedTileRectEl = document.createElementNS(SVG_NS, "rect");
    this.selectedTileRectEl.setAttribute("fill", "none");
    this.selectedTileRectEl.setAttribute("stroke", "rgba(95,208,255,0.8)");
    this.selectedTileRectEl.setAttribute("stroke-width", "2");
    this.selectedTileRectEl.style.visibility = "hidden";
    layer.appendChild(this.selectedTileRectEl);
  }

  addLightningEffect(startX: number, startY: number, endX: number, endY: number): string {
    const id = this.generateLightningId();
    const effect: LightningEffect = {
      id,
      startX,
      startY,
      endX,
      endY,
      life: LIGHTNING_LIFE_SECONDS,
      maxLife: LIGHTNING_LIFE_SECONDS,
      seed: Math.random() * 1000,
    };
    this.lightningEffects.set(id, effect);
    return id;
  }

  addStunEffect(x: number, y: number): string {
    const id = this.generateStunId();
    const effect: StunEffect = { id, x, y, life: STUN_LIFE_SECONDS, maxLife: STUN_LIFE_SECONDS, angle: 0 };
    this.stunEffects.set(id, effect);
    return id;
  }

  syncFromGameEngine(
    buildTilePos: { tileX: number; tileY: number } | null,
    selectedTowerType: string | null,
    buildPreviewColor: string | null,
    selectedTower: { x: number; y: number; type: string; level: number } | null,
    buildValid: boolean,
    dt: number,
  ): void {
    this.syncLightning(dt);
    this.syncStun(dt);
    this.syncBuildPreview(buildTilePos, selectedTowerType, buildPreviewColor, buildValid);
    this.syncUpgradeButton(selectedTower);
  }

  private syncLightning(dt: number): void {
    let slotIndex = 0;
    for (const effect of this.lightningEffects.values()) {
      if (effect.life <= 0) continue;
      if (slotIndex >= this.lightningPool.length) break;

      const polyline = this.lightningPool[slotIndex]!;
      slotIndex++;

      const points = this.generateLightningPoints(
        effect.startX,
        effect.startY,
        effect.endX,
        effect.endY,
        LIGHTNING_SEGMENTS,
        effect.seed,
      );
      const elapsed = effect.maxLife - effect.life;
      const alpha = Math.max(0, 1 - elapsed / effect.maxLife);

      polyline.setAttribute("points", points);
      polyline.setAttribute("stroke", LIGHTNING_COLOR_PRIMARY);
      polyline.setAttribute("stroke-width", String(LIGHTNING_STROKE_WIDTH));
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("opacity", alpha.toFixed(3));
      polyline.setAttribute("filter", "url(#glow)");
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      polyline.style.visibility = "visible";
    }

    for (let i = slotIndex; i < this.lightningPool.length; i++) {
      this.lightningPool[i]!.style.visibility = "hidden";
    }

    const expiredIds: string[] = [];
    for (const [id, effect] of this.lightningEffects) {
      effect.life -= dt;
      if (effect.life <= 0) {
        expiredIds.push(id);
      }
    }
    for (const id of expiredIds) {
      this.lightningEffects.delete(id);
    }
  }

  private generateLightningPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    segments: number,
    seed: number,
  ): string {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length === 0) {
      return `${startX.toFixed(1)},${startY.toFixed(1)}`;
    }

    const perpX = -deltaY / length;
    const perpY = deltaX / length;
    const stepX = deltaX / (segments + 1);
    const stepY = deltaY / (segments + 1);

    const points: string[] = [];
    points.push(`${startX.toFixed(1)},${startY.toFixed(1)}`);

    for (let i = 1; i <= segments; i++) {
      const baseX = startX + stepX * i;
      const baseY = startY + stepY * i;
      const randomOffset = ((Math.sin(seed + i * 7.3) * 0.5 + 0.5) * 2 - 1) * LIGHTNING_PERP_OFFSET;
      const offsetX = perpX * randomOffset;
      const offsetY = perpY * randomOffset;
      points.push(`${(baseX + offsetX).toFixed(1)},${(baseY + offsetY).toFixed(1)}`);
    }

    points.push(`${endX.toFixed(1)},${endY.toFixed(1)}`);
    return points.join(" ");
  }

  private syncStun(dt: number): void {
    let slotIndex = 0;
    for (const effect of this.stunEffects.values()) {
      if (effect.life <= 0) continue;
      if (slotIndex >= this.stunPool.length) break;

      const group = this.stunPool[slotIndex]!;
      slotIndex++;
      if (group.childNodes.length === 0) {
        this.initStunGroup(group);
      }

      const elapsed = effect.maxLife - effect.life;
      const lifeRatio = Math.max(0, 1 - elapsed / effect.maxLife);
      const pulse = 0.7 + 0.3 * Math.sin((1 - lifeRatio) * Math.PI * 4);
      const radius = STUN_RADIUS * pulse;

      group.setAttribute("transform", `translate(${effect.x.toFixed(1)}, ${effect.y.toFixed(1)})`);
      group.setAttribute("opacity", lifeRatio.toFixed(3));
      group.style.visibility = "visible";

      const rotationAngle = effect.angle;
      for (let i = 0; i < group.childNodes.length; i++) {
        const star = group.childNodes[i] as SVGCircleElement;
        const starAngle = rotationAngle + (i / STUN_STAR_COUNT) * Math.PI * 2;
        const starX = Math.cos(starAngle) * radius;
        const starY = Math.sin(starAngle) * radius;
        const starR = 2.5 + 1.5 * Math.sin(starAngle * 2 + effect.angle);
        star.setAttribute("cx", starX.toFixed(1));
        star.setAttribute("cy", starY.toFixed(1));
        star.setAttribute("r", starR.toFixed(2));
      }

      effect.angle += STUN_ROTATION_SPEED * dt;
    }

    for (let i = slotIndex; i < this.stunPool.length; i++) {
      this.stunPool[i]!.style.visibility = "hidden";
    }

    const expiredIds: string[] = [];
    for (const [id, effect] of this.stunEffects) {
      effect.life -= dt;
      if (effect.life <= 0) {
        expiredIds.push(id);
      }
    }
    for (const id of expiredIds) {
      this.stunEffects.delete(id);
    }
  }

  private initStunGroup(group: SVGGElement): void {
    for (let i = 0; i < STUN_STAR_COUNT; i++) {
      const star = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
      star.setAttribute("fill", STUN_COLOR);
      star.setAttribute("stroke", "rgba(255,215,0,0.5)");
      star.setAttribute("stroke-width", "0.5");
      star.setAttribute("cx", "0");
      star.setAttribute("cy", "0");
      star.setAttribute("r", "3");
      group.appendChild(star);
    }
  }

  private syncBuildPreview(
    buildTilePos: { tileX: number; tileY: number } | null,
    selectedTowerType: string | null,
    buildPreviewColor: string | null,
    buildValid: boolean,
  ): void {
    if (selectedTowerType && buildTilePos) {
      const tileX = buildTilePos.tileX * TILE_SIZE;
      const tileY = buildTilePos.tileY * TILE_SIZE;
      const centerX = tileX + TILE_SIZE / 2;
      const centerY = tileY + TILE_SIZE / 2;

      if (this.buildPreviewEl) {
        this.buildPreviewEl.style.visibility = "visible";
        this.buildPreviewEl.setAttribute("transform", `translate(${tileX}, ${tileY})`);
        this.buildPreviewEl.setAttribute("width", String(TILE_SIZE));
        this.buildPreviewEl.setAttribute("height", String(TILE_SIZE));
        this.buildPreviewEl.setAttribute("fill", buildValid ? "rgba(0,255,0,0.3)" : "rgba(255,0,0,0.3)");
      }

      if (this.buildPreviewSpriteEl) {
        this.buildPreviewSpriteEl.style.visibility = "visible";
        const spriteId = `tower-${selectedTowerType}-f0`;
        if (spriteId !== this.buildPreviewSpriteLastId) {
          this.buildPreviewSpriteEl.setAttribute("href", `#${spriteId}`);
          this.buildPreviewSpriteLastId = spriteId;
        }
        const previewSize = GRID_TILE_SIZE * 0.56;
        const halfPreview = previewSize / 2;
        const spriteTransform = `translate(${centerX - halfPreview}, ${centerY - halfPreview})`;
        if (spriteTransform !== this.buildPreviewSpriteLastTransform) {
          this.buildPreviewSpriteEl.setAttribute("transform", spriteTransform);
          this.buildPreviewSpriteLastTransform = spriteTransform;
        }
        const sizeStr = String(previewSize);
        if (sizeStr !== this.buildPreviewSpriteLastSize) {
          this.buildPreviewSpriteEl.setAttribute("width", sizeStr);
          this.buildPreviewSpriteEl.setAttribute("height", sizeStr);
          this.buildPreviewSpriteLastSize = sizeStr;
        }
        if (buildValid) {
          if (buildPreviewColor && buildPreviewColor !== this.buildPreviewSpriteLastColor) {
            this.buildPreviewSpriteEl.style.color = buildPreviewColor;
            this.buildPreviewSpriteLastColor = buildPreviewColor;
          }
        } else {
          const redColor = "rgba(255,0,0,0.8)";
          if (redColor !== this.buildPreviewSpriteLastColor) {
            this.buildPreviewSpriteEl.style.color = redColor;
            this.buildPreviewSpriteLastColor = redColor;
          }
        }
      }

      if (this.buildRangeCircleEl) {
        this.buildRangeCircleEl.style.visibility = "visible";
        this.buildRangeCircleEl.setAttribute("transform", `translate(${centerX}, ${centerY})`);

        const towerBase = TOWER_BASE[selectedTowerType];
        const rangeTiles = towerBase?.range ?? 3.5;
        const rangePx = rangeTiles * TILE_SIZE;
        this.buildRangeCircleEl.setAttribute("r", String(rangePx));
        this.buildRangeCircleEl.setAttribute("stroke", buildValid ? "rgba(0,255,0,0.6)" : "rgba(255,0,0,0.6)");
      }
    } else {
      if (this.buildPreviewEl) {
        this.buildPreviewEl.style.visibility = "hidden";
      }
      if (this.buildPreviewSpriteEl) {
        this.buildPreviewSpriteEl.style.visibility = "hidden";
      }
      if (this.buildRangeCircleEl) {
        this.buildRangeCircleEl.style.visibility = "hidden";
      }
    }
  }

  private syncUpgradeButton(selectedTower: { x: number; y: number; type: string; level: number } | null): void {
    if (selectedTower) {
      if (this.upgradeButtonEl) {
        this.upgradeButtonEl.style.visibility = "visible";
        const buttonX = selectedTower.x + TILE_SIZE / 2 - 12;
        const buttonY = selectedTower.y - TILE_SIZE / 2 + 2;
        this.upgradeButtonEl.setAttribute("transform", `translate(${buttonX}, ${buttonY})`);

        if (this.upgradeButtonBgEl) {
          this.upgradeButtonBgEl.setAttribute("x", "0");
          this.upgradeButtonBgEl.setAttribute("y", "0");
          this.upgradeButtonBgEl.setAttribute("width", "10");
          this.upgradeButtonBgEl.setAttribute("height", "10");
        }

        if (this.upgradeButtonTextEl) {
          this.upgradeButtonTextEl.setAttribute("x", "5");
          this.upgradeButtonTextEl.setAttribute("y", "5");
          this.upgradeButtonTextEl.textContent = "^";
        }
      }

      if (this.selectedTileRectEl) {
        this.selectedTileRectEl.style.visibility = "visible";
        const tileX = Math.floor(selectedTower.x / TILE_SIZE) * TILE_SIZE + 1;
        const tileY = Math.floor(selectedTower.y / TILE_SIZE) * TILE_SIZE + 1;
        this.selectedTileRectEl.setAttribute("transform", `translate(${tileX}, ${tileY})`);
        this.selectedTileRectEl.setAttribute("width", String(TILE_SIZE - 2));
        this.selectedTileRectEl.setAttribute("height", String(TILE_SIZE - 2));
      }

      if (this.rangeCircleEl) {
        this.rangeCircleEl.style.visibility = "visible";
        this.rangeCircleEl.setAttribute("transform", `translate(${selectedTower.x}, ${selectedTower.y})`);
        const towerBase = TOWER_BASE[selectedTower.type];
        const baseRange = towerBase?.range ?? 3.5;
        const rangeTiles = baseRange * TOWER_LEVEL_RANGE_MULT ** (selectedTower.level - 1);
        const rangePx = rangeTiles * TILE_SIZE;
        this.rangeCircleEl.setAttribute("r", String(rangePx));
        this.rangeCircleEl.setAttribute("stroke", "rgba(0,255,0,0.6)");
      }
    } else {
      if (this.upgradeButtonEl) {
        this.upgradeButtonEl.style.visibility = "hidden";
      }
      if (this.selectedTileRectEl) {
        this.selectedTileRectEl.style.visibility = "hidden";
      }
      if (this.rangeCircleEl) {
        this.rangeCircleEl.style.visibility = "hidden";
      }
    }
  }

  private generateLightningId(): string {
    this.nextLightningId += 1;
    return `lightning-${this.nextLightningId}`;
  }

  private generateStunId(): string {
    this.nextStunId += 1;
    return `stun-${this.nextStunId}`;
  }

  dispose(): void {
    for (const polyline of this.lightningPool) {
      if (polyline.parentNode) {
        polyline.parentNode.removeChild(polyline);
      }
    }
    for (const group of this.stunPool) {
      if (group.parentNode) {
        group.parentNode.removeChild(group);
      }
    }
    if (this.buildPreviewEl?.parentNode) {
      this.buildPreviewEl.parentNode.removeChild(this.buildPreviewEl);
    }
    if (this.buildPreviewSpriteEl?.parentNode) {
      this.buildPreviewSpriteEl.parentNode.removeChild(this.buildPreviewSpriteEl);
    }
    if (this.rangeCircleEl?.parentNode) {
      this.rangeCircleEl.parentNode.removeChild(this.rangeCircleEl);
    }
    if (this.buildRangeCircleEl?.parentNode) {
      this.buildRangeCircleEl.parentNode.removeChild(this.buildRangeCircleEl);
    }
    if (this.upgradeButtonEl?.parentNode) {
      this.upgradeButtonEl.parentNode.removeChild(this.upgradeButtonEl);
    }
    if (this.selectedTileRectEl?.parentNode) {
      this.selectedTileRectEl.parentNode.removeChild(this.selectedTileRectEl);
    }
    this.lightningPool = [];
    this.stunPool = [];
    this.lightningEffects.clear();
    this.stunEffects.clear();
  }
}
