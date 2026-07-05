import type { Enemy } from "../../enemies/Enemy.js";
import type { EnemyManager } from "../../enemies/EnemyManager.js";
import type { Grid } from "../../grid/Grid.js";
import type { Tower } from "../../towers/Tower.js";
import { BOSS_TEXT_POOL_SIZE, HP_BAR_POOL_SIZE, SHIELD_BAR_POOL_SIZE, SVG_NS } from "./types.js";

export class UiOverlayManager {
  private hpBarPool: SVGRectElement[] = [];
  private shieldBarPool: SVGRectElement[] = [];
  private bossTextPool: SVGTextElement[] = [];
  private pendingTextPool: SVGTextElement[] = [];

  init(layer: SVGGElement): void {
    for (let i = 0; i < HP_BAR_POOL_SIZE; i++) {
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.style.visibility = "hidden";
      bg.setAttribute("width", "24");
      bg.setAttribute("height", "3");
      bg.setAttribute("fill", "#000000");
      bg.setAttribute("opacity", "0.6");
      layer.appendChild(bg);

      const border = document.createElementNS(SVG_NS, "rect");
      border.style.visibility = "hidden";
      border.setAttribute("width", "24");
      border.setAttribute("height", "3");
      border.setAttribute("fill", "none");
      border.setAttribute("stroke", "#000000");
      border.setAttribute("stroke-width", "0.5");
      layer.appendChild(border);

      const fg = document.createElementNS(SVG_NS, "rect");
      fg.style.visibility = "hidden";
      fg.setAttribute("width", "24");
      fg.setAttribute("height", "3");
      fg.setAttribute("fill", "#00ff00");
      layer.appendChild(fg);

      this.hpBarPool.push(bg, border, fg);
    }

    for (let i = 0; i < SHIELD_BAR_POOL_SIZE; i++) {
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.style.visibility = "hidden";
      bg.setAttribute("width", "24");
      bg.setAttribute("height", "3");
      bg.setAttribute("fill", "#00004a");
      bg.setAttribute("opacity", "0.6");
      layer.appendChild(bg);

      const border = document.createElementNS(SVG_NS, "rect");
      border.style.visibility = "hidden";
      border.setAttribute("width", "24");
      border.setAttribute("height", "3");
      border.setAttribute("fill", "none");
      border.setAttribute("stroke", "#000000");
      border.setAttribute("stroke-width", "0.5");
      layer.appendChild(border);

      const fg = document.createElementNS(SVG_NS, "rect");
      fg.style.visibility = "hidden";
      fg.setAttribute("width", "24");
      fg.setAttribute("height", "3");
      fg.setAttribute("fill", "#00ffff");
      layer.appendChild(fg);

      this.shieldBarPool.push(bg, border, fg);
    }

    for (let i = 0; i < BOSS_TEXT_POOL_SIZE; i++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.style.visibility = "hidden";
      text.setAttribute("fill", "#ffffff");
      text.setAttribute("font-size", "6");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      layer.appendChild(text);
      this.bossTextPool.push(text);
    }

    for (let i = 0; i < 4; i++) {
      const text = document.createElementNS(SVG_NS, "text");
      text.style.visibility = "hidden";
      text.setAttribute("fill", "#ffff00");
      text.setAttribute("font-size", "8");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      layer.appendChild(text);
      this.pendingTextPool.push(text);
    }
  }

  syncFromGameEngine(enemies: Enemy[], _selectedTower: Tower | null): void {
    let barIndex = 0;
    let shieldIndex = 0;
    let bossIndex = 0;

    for (const enemy of enemies) {
      if (barIndex + 2 >= this.hpBarPool.length) break;

      const bg = this.hpBarPool[barIndex]!;
      const border = this.hpBarPool[barIndex + 1]!;
      const fg = this.hpBarPool[barIndex + 2]!;
      barIndex += 3;

      const barX = enemy.x - 12;
      const barY = enemy.y - 12;

      bg.setAttribute("transform", `translate(${barX}, ${barY})`);
      border.setAttribute("transform", `translate(${barX}, ${barY})`);
      border.style.visibility = "visible";

      fg.style.visibility = "visible";
      fg.setAttribute("transform", `translate(${barX}, ${barY})`);

      const hpPercent = Math.max(0, enemy.hp / enemy.maxHp);
      fg.setAttribute("width", `${24 * hpPercent}`);
      fg.setAttribute("fill", hpPercent > 0.5 ? "#00ff00" : hpPercent > 0.25 ? "#ffff00" : "#ff0000");

      if (enemy.shield > 0 && enemy.maxShield > 0 && shieldIndex + 2 < this.shieldBarPool.length) {
        const shieldBg = this.shieldBarPool[shieldIndex]!;
        const shieldBorder = this.shieldBarPool[shieldIndex + 1]!;
        const shieldFg = this.shieldBarPool[shieldIndex + 2]!;
        shieldIndex += 3;

        const shieldBarX = enemy.x - 12;
        const shieldBarY = enemy.y - 16;

        shieldBg.style.visibility = "visible";
        shieldBg.setAttribute("transform", `translate(${shieldBarX}, ${shieldBarY})`);
        shieldBorder.style.visibility = "visible";
        shieldBorder.setAttribute("transform", `translate(${shieldBarX}, ${shieldBarY})`);

        shieldFg.style.visibility = "visible";
        shieldFg.setAttribute("transform", `translate(${shieldBarX}, ${shieldBarY})`);

        const shieldPercent = Math.max(0, enemy.shield / enemy.maxShield);
        shieldFg.setAttribute("width", `${24 * shieldPercent}`);
      }

      if (enemy.type === "boss" && bossIndex < this.bossTextPool.length) {
        const text = this.bossTextPool[bossIndex]!;
        bossIndex++;
        text.style.visibility = "visible";
        text.setAttribute("transform", `translate(${enemy.x}, ${enemy.y - 20})`);
        text.textContent = Math.ceil(enemy.hp).toLocaleString();
      }
    }

    for (let i = barIndex; i < this.hpBarPool.length; i++) {
      this.hpBarPool[i]!.style.visibility = "hidden";
    }
    for (let i = shieldIndex; i < this.shieldBarPool.length; i++) {
      this.shieldBarPool[i]!.style.visibility = "hidden";
    }
    for (let i = bossIndex; i < this.bossTextPool.length; i++) {
      this.bossTextPool[i]!.style.visibility = "hidden";
    }
  }

  syncPendingQueueOverlays(grid: Grid, enemyManager: EnemyManager): void {
    let textIndex = 0;
    for (let spawnIndex = 0; spawnIndex < grid.spawns.length; spawnIndex++) {
      const pendingCount = enemyManager.getPendingCountForSpawn(spawnIndex);
      if (pendingCount <= 0) continue;
      if (textIndex >= this.pendingTextPool.length) break;

      const text = this.pendingTextPool[textIndex]!;
      textIndex++;
      const spawnTile = grid.spawns[spawnIndex]!;
      const worldPos = grid.tileToWorld(spawnTile.x, spawnTile.y);
      text.style.visibility = "visible";
      text.setAttribute("transform", `translate(${worldPos.x}, ${worldPos.y})`);
      text.textContent = `+${pendingCount}`;
    }

    for (let i = textIndex; i < this.pendingTextPool.length; i++) {
      this.pendingTextPool[i]!.style.visibility = "hidden";
    }
  }

  dispose(): void {
    for (const el of this.hpBarPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    for (const el of this.shieldBarPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    for (const el of this.bossTextPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    for (const el of this.pendingTextPool) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    this.hpBarPool = [];
    this.shieldBarPool = [];
    this.bossTextPool = [];
    this.pendingTextPool = [];
  }
}
