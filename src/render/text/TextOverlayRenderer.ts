import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import type { TextRenderScale } from "./types.js";

const HP_BAR_HALF_WIDTH = 6;
const HP_BAR_OFFSET = 8;
const PROJECTILE_RADIUS = 1.5;

// Canvas overlay for the thin "minimized" effects: projectile dots, enemy HP
// bars, lightning lines, and stun marks. Mirrors the SVG ProjectileManager +
// UiOverlayManager + EffectManager but with dots/lines only — no sprites,
// particles, range circles, or build preview.
export class TextOverlayRenderer {
  render(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    this.renderProjectiles(ctx, snapshot, scale);
    this.renderHealthBars(ctx, snapshot, scale);
    this.renderLightning(ctx, snapshot, scale);
    this.renderStuns(ctx, snapshot, scale);
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    for (const projectile of snapshot.projectiles) {
      const pixelX = projectile.x * scale.scaleX;
      const pixelY = projectile.y * scale.scaleY;
      ctx.fillStyle = projectile.color || "#ffffff";
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderHealthBars(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    for (const enemy of snapshot.enemies) {
      const hpFraction = enemy.maxHp > 0 ? Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)) : 0;
      if (hpFraction >= 1) continue;
      const centerX = enemy.x * scale.scaleX;
      const topY = enemy.y * scale.scaleY - HP_BAR_OFFSET * scale.scaleY - enemy.radius * scale.scaleY;
      const barWidth = HP_BAR_HALF_WIDTH * scale.scaleX;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX + barWidth, topY);
      ctx.stroke();
      ctx.strokeStyle = hpFraction > 0.5 ? "#00ff00" : hpFraction > 0.25 ? "#ffff00" : "#ff0000";
      ctx.beginPath();
      ctx.moveTo(centerX - barWidth, topY);
      ctx.lineTo(centerX - barWidth + barWidth * 2 * hpFraction, topY);
      ctx.stroke();
    }
  }

  private renderLightning(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    ctx.strokeStyle = "#40a0ff";
    ctx.lineWidth = 1;
    for (const bolt of snapshot.lightningEffects) {
      ctx.beginPath();
      ctx.moveTo(bolt.x1 * scale.scaleX, bolt.y1 * scale.scaleY);
      ctx.lineTo(bolt.x2 * scale.scaleX, bolt.y2 * scale.scaleY);
      ctx.stroke();
    }
  }

  private renderStuns(ctx: CanvasRenderingContext2D, snapshot: SimulationSnapshot, scale: TextRenderScale): void {
    ctx.fillStyle = "#40a0ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const stun of snapshot.stunEffects) {
      const pixelX = stun.x * scale.scaleX;
      const pixelY = stun.y * scale.scaleY;
      ctx.fillText("*", pixelX, pixelY);
    }
  }
}
