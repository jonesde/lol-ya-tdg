<template>
  <div class="svg-wrapper">
    <svg ref="svgRoot" class="game-svg" xmlns="http://www.w3.org/2000/svg"
         :viewBox="mapViewBox" @mousemove="onMouseMove" @click="onClick" @contextmenu.prevent>
      <defs ref="defsLayer"></defs>

      <g class="grid-layer" v-html="gridContent"></g>

      <g ref="worldLayer" class="camera-wrapper">
        <g ref="entityLayer" class="entity-layer"></g>
        <g ref="uiOverlayLayer" class="ui-overlay-layer"></g>
        <g ref="projectileLayer" class="projectile-layer"></g>
        <g ref="effectLayer" class="effect-layer"></g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Enemy } from "@/enemies/Enemy.js";
import { GameState } from "@/game/Constants.js";
import { GameEngine } from "@/game/GameEngine.js";
import { useInput } from "@/game/Input.js";
import { fitToGrid } from "@/render/svg/cameraUtils.js";
import { EffectManager } from "@/render/svg/EffectManager.js";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { TowerManager } from "@/render/svg/TowerManager.js";
import type { Particle, Projectile } from "@/render/svg/types.js";
import { UiOverlayManager } from "@/render/svg/UiOverlayManager.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import type { Tower } from "@/towers/Tower.js";

const svgRoot = ref<SVGSVGElement | null>(null);
const defsLayer = ref<SVGDefsElement | null>(null);
const worldLayer = ref<SVGGElement | null>(null);
const entityLayer = ref<SVGGElement | null>(null);
const uiOverlayLayer = ref<SVGGElement | null>(null);
const projectileLayer = ref<SVGGElement | null>(null);
const effectLayer = ref<SVGGElement | null>(null);

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

const { staticDefsContent, mapDefsContent, gridContent } = useSvgStaticContent(
  computed(() => gameStore.map),
  computed(() => gameStore.grid),
  themeStore.activeTheme,
);

const mouseWorldPos = ref<{ x: number; y: number } | null>(null);

const engine = ref<GameEngine | null>(null);

const viewSize = ref({ w: 800, h: 600 });

const mapTileSize = 36;
const mapViewBox = computed(() => {
  const map = gameStore.map;
  if (!map) return undefined;
  const w = map.width * mapTileSize;
  const h = map.height * mapTileSize;
  return `0 0 ${w} ${h}`;
});

let enemyManager!: EnemyManager;
let towerManager!: TowerManager;
let projectileManager!: ProjectileManager;
let particleManager!: ParticleManager;
let effectManager!: EffectManager;
let uiOverlayManager!: UiOverlayManager;

let cameraTransformString = "translate(0,0) scale(1)";

const onMouseMove = (e: MouseEvent): void => {
  if (!svgRoot.value || !worldLayer.value) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;

  const ctm = worldLayer.value.getScreenCTM()?.inverse();
  if (!ctm) return;
  const worldPos = pt.matrixTransform(ctm);

  mouseWorldPos.value = worldPos;

  if (engine.value) {
    engine.value.setHover(worldPos.x, worldPos.y);
  }
};

const onClick = (e: MouseEvent): void => {
  if (!svgRoot.value || !worldLayer.value || !engine.value) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;

  const ctm = worldLayer.value.getScreenCTM()?.inverse();
  if (!ctm) return;
  const worldPos = pt.matrixTransform(ctm);

  engine.value.handleClick(worldPos.x, worldPos.y);
};

const resizeObserver = ref<ResizeObserver | null>(null);

async function buildDefsImperative(staticContent: string, mapContent: string): Promise<void> {
  if (!defsLayer.value) return;
  while (defsLayer.value.firstChild) {
    defsLayer.value.removeChild(defsLayer.value.firstChild);
  }
  defsLayer.value.innerHTML = staticContent + mapContent;
}

onMounted(async () => {
  engine.value = new GameEngine(gameStore, persistStore, themeStore.activeTheme);

  const staticContent = staticDefsContent.value;
  const mapContent = mapDefsContent.value;

  await buildDefsImperative(staticContent, mapContent);

  const el = entityLayer.value;
  const uol = uiOverlayLayer.value;
  const pl = projectileLayer.value;
  const ef = effectLayer.value;

  if (!el || !uol || !pl || !ef) return;

  enemyManager = new EnemyManager();
  towerManager = new TowerManager();
  projectileManager = new ProjectileManager();
  particleManager = new ParticleManager();
  effectManager = new EffectManager();
  uiOverlayManager = new UiOverlayManager();

  enemyManager.init(el);
  towerManager.init(el);
  uiOverlayManager.init(uol);
  projectileManager.init(pl);
  particleManager.init(ef);
  effectManager.init(ef);

  const wallClockStart = performance.now();
  const scaledStart = engine.value._accumulator;
  const timeOffset = wallClockStart / 1000 - scaledStart;
  enemyManager.setTimeOffset(timeOffset);
  towerManager.setTimeOffset(timeOffset);

  const map = gameStore.map;
  if (map) {
    const mapWidth = map.width;
    const mapHeight = map.height;
    const initialCam = fitToGrid(mapWidth, mapHeight, viewSize.value.w, viewSize.value.h - 104);
    cameraTransformString = `translate(${initialCam.x}, ${initialCam.y}) scale(${initialCam.zoom})`;
    worldLayer.value?.setAttribute("transform", cameraTransformString);
  }

  if (svgRoot.value) {
    resizeObserver.value = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        viewSize.value = { w: width, h: height };
      }
    });
    resizeObserver.value.observe(svgRoot.value);
  }

  engine.value.renderCallback = () => {
    const cam = gameStore.camera;
    cameraTransformString = `translate(${cam.x}, ${cam.y}) scale(${cam.zoom})`;
    worldLayer.value?.setAttribute("transform", cameraTransformString);

    if (engine.value) {
      const dt = engine.value.lastScaledDt;
      const enemies = gameStore.enemyManager?.enemies || [];
      const towers = gameStore.towerManager?.towers || [];
      const projectiles = engine.value.projectileManager?.getRenderData() || [];
      const particles = engine.value.particleManager?.getRenderData() || [];
      enemyManager.syncFromGameEngine(enemies, dt);
      towerManager.syncFromGameEngine(towers, dt);
      projectileManager.syncFromGameEngine(projectiles, dt);
      particleManager.syncFromGameEngine(particles);
      effectManager.syncFromGameEngine(
        mouseWorldPos.value,
        gameStore.selectedTowerType || null,
        gameStore.selectedTower,
        dt,
      );
      uiOverlayManager.syncFromGameEngine(enemies, gameStore.selectedTower);
    }
  };

  engine.value.loadMap(gameStore.mapIndex);

  if (engine.value.projectileManager) {
    engine.value.projectileManager.setOnLightningFlash((startX, startY, endX, endY) => {
      effectManager.addLightningEffect(startX, startY, endX, endY);
    });
    engine.value.projectileManager.setOnStunEffect((x, y) => {
      effectManager.addStunEffect(x, y);
    });
  }

  gameStore.setState(GameState.PAUSED);
  engine.value.start();

  useInput(gameStore, engine.value, uiStore);
});

onUnmounted(() => {
  engine.value?.dispose();
  resizeObserver.value?.disconnect();
  resizeObserver.value = null;

  enemyManager.dispose();
  towerManager.dispose();
  projectileManager.dispose();
  particleManager.dispose();
  effectManager.dispose();
  uiOverlayManager.dispose();
});
</script>

<style scoped>
.svg-wrapper {
  position: absolute;
  top: 40px;
  bottom: 64px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.game-svg {
  width: 100%;
  height: auto;
  max-height: 100%;
  cursor: crosshair;
  display: block;
  user-select: none;
}
</style>
