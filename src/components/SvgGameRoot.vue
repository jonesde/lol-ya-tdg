<template>
  <div class="svg-wrapper">
    <svg ref="svgRoot" class="game-svg" xmlns="http://www.w3.org/2000/svg"
         :viewBox="mapViewBox" @mousemove="onMouseMove" @click="onClick" @mousedown="onMouseDown" @contextmenu.prevent>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Enemy } from "@/enemies/Enemy.js";
import { GameState, SELL_DISCOUNT_PCT } from "@/game/Constants.js";
import { TOWER_META } from "@/game/ConstantsTower.js";
import { GameEngine } from "@/game/GameEngine.js";
import { useInput } from "@/game/Input.js";
import { fitToGrid } from "@/render/svg/cameraUtils.js";
import { EffectManager } from "@/render/svg/EffectManager.js";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
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
  themeStore.activeTheme,
);

const mouseWorldPos = ref<{ x: number; y: number } | null>(null);

const buildPreviewTilePos = computed(() => {
  if (gameStore.selectedTowerType) {
    if (gameStore.hoverTile) {
      return gameStore.hoverTile;
    }
    const grid = gameStore.grid;
    if (grid) {
      return { tileX: Math.floor(grid.width / 2), tileY: Math.floor(grid.height / 2) };
    }
  }
  return null;
});

const buildPreviewValid = computed(() => {
  const pos = buildPreviewTilePos.value;
  if (!pos || !gameStore.grid) return false;
  if (!gameStore.selectedTowerType) return false;
  const meta = TOWER_META[gameStore.selectedTowerType];
  if (!meta) return false;
  const discount = persistStore.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
  const cost = Math.floor(meta.cost * discount);
  return gameStore.grid.canBuild(pos.tileX, pos.tileY) && gameStore.gold >= cost;
});

const buildPreviewColor = computed(() => {
  if (!gameStore.selectedTowerType) return null;
  return themeStore.getTowerVisual(gameStore.selectedTowerType)?.color ?? null;
});

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
let spawnManager!: SpawnManager;
let pathHighlightsGroup: SVGGElement | null = null;

let cameraTransformString = "translate(0,0) scale(1)";

// Cached inverse CTM -- only recomputed when camera or view size changes
let cachedInverseCtm: DOMMatrix | null = null;
let cachedCameraX: number = 0;
let cachedCameraY: number = 0;
let cachedCameraZoom: number = 1;
let cachedViewW: number = 0;
let cachedViewH: number = 0;

// Mousedown/click deduplication — mousedown fires on button press (less likely to be dropped),
// click fires on button release (can be dropped when the main thread is blocked at high speed).
const CLICK_DEDUP_MS = 50;
let lastMouseDownTime: number = 0;
let lastMouseDownX: number = 0;
let lastMouseDownY: number = 0;

const updateCachedCtm = (): void => {
  if (!worldLayer.value) return;
  const cam = gameStore.camera;
  if (
    cam.x === cachedCameraX &&
    cam.y === cachedCameraY &&
    cam.zoom === cachedCameraZoom &&
    viewSize.value.w === cachedViewW &&
    viewSize.value.h === cachedViewH
  ) {
    return;
  }
  cachedCameraX = cam.x;
  cachedCameraY = cam.y;
  cachedCameraZoom = cam.zoom;
  cachedViewW = viewSize.value.w;
  cachedViewH = viewSize.value.h;
  cachedInverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
};

// rAF-throttled hover coordinates
let pendingHoverX: number = 0;
let pendingHoverY: number = 0;
let pendingHoverScheduled: boolean = false;

const scheduleHover = (clientX: number, clientY: number): void => {
  pendingHoverX = clientX;
  pendingHoverY = clientY;
  if (!pendingHoverScheduled) {
    pendingHoverScheduled = true;
    requestAnimationFrame(flushHover);
  }
};

const flushHover = (): void => {
  pendingHoverScheduled = false;
  if (!svgRoot.value || !cachedInverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = pendingHoverX;
  pt.y = pendingHoverY;
  const worldPos = pt.matrixTransform(cachedInverseCtm);

  mouseWorldPos.value = worldPos;

  if (engine.value) {
    engine.value.setHover(worldPos.x, worldPos.y);
  }
};

const onMouseMove = (e: MouseEvent): void => {
  updateCachedCtm();
  scheduleHover(e.clientX, e.clientY);
};

const onMouseDown = (e: MouseEvent): void => {
  if (e.button !== 0) return;
  if (!svgRoot.value || !worldLayer.value || !engine.value) return;

  const inverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
  if (!inverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const worldPos = pt.matrixTransform(inverseCtm);

  engine.value.handleClick(worldPos.x, worldPos.y);

  lastMouseDownTime = performance.now();
  lastMouseDownX = e.clientX;
  lastMouseDownY = e.clientY;
};

const onClick = (e: MouseEvent): void => {
  // If a mousedown already handled this click, skip to avoid double-processing.
  const elapsed = performance.now() - lastMouseDownTime;
  const dx = e.clientX - lastMouseDownX;
  const dy = e.clientY - lastMouseDownY;
  if (elapsed < CLICK_DEDUP_MS && dx * dx + dy * dy < 16) return;

  if (!svgRoot.value || !worldLayer.value || !engine.value) return;

  const inverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
  if (!inverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const worldPos = pt.matrixTransform(inverseCtm);

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

  useInput(gameStore, engine.value, uiStore);

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
  spawnManager = new SpawnManager();

  enemyManager.init(el);
  towerManager.init(el);
  uiOverlayManager.init(uol);
  projectileManager.init(pl);
  particleManager.init(ef);
  effectManager.init(ef);

  const initialMap = gameStore.map;

  if (initialMap) {
    const initialCam = fitToGrid(initialMap.width, initialMap.height, viewSize.value.w, viewSize.value.h - 104);
    cameraTransformString = `translate(${initialCam.x}, ${initialCam.y}) scale(${initialCam.zoom})`;
    worldLayer.value?.setAttribute("transform", cameraTransformString);
    gameStore.setCamera(initialCam.x, initialCam.y, initialCam.zoom);
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

  // Invalidate cached CTM when camera or view size changes
  watch(
    () => gameStore.camera,
    () => {
      cachedInverseCtm = null;
    },
    { deep: true },
  );
  watch(
    () => viewSize.value,
    () => {
      cachedInverseCtm = null;
    },
    { deep: true },
  );

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
        buildPreviewTilePos.value,
        gameStore.selectedTowerType || null,
        buildPreviewColor.value,
        gameStore.selectedTower,
        buildPreviewValid.value,
        dt,
      );
      uiOverlayManager.syncFromGameEngine(enemies, gameStore.selectedTower);
      if (gameStore.grid && gameStore.enemyManager) {
        uiOverlayManager.syncPendingQueueOverlays(gameStore.grid, gameStore.enemyManager);
      }
      if (engine.value?.waveManager?.spawnStates) {
        spawnManager.sync(engine.value.waveManager.spawnStates);
      }

      // Imperative path highlights — appended to grid-layer, not Vue-managed
      const grid = gameStore.grid;
      const gridLayer = svgRoot.value?.querySelector(".grid-layer") as SVGGElement | null;
      if (gridLayer && grid?.paths) {
        if (!pathHighlightsGroup?.parentNode) {
          pathHighlightsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          pathHighlightsGroup.setAttribute("id", "path-highlights");
          gridLayer.appendChild(pathHighlightsGroup);
        }
        let pathSvg = "";
        for (const path of grid.paths) {
          if (!path) continue;
          const points = path
            .map((t) => `${t.x * mapTileSize + mapTileSize / 2},${t.y * mapTileSize + mapTileSize / 2}`)
            .join(" ");
          pathSvg += `<polyline points="${points}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4" />`;
        }
        pathHighlightsGroup.innerHTML = pathSvg;
      }
    }
  };

  if (gameStore.mapIndex === -1 && gameStore.randomMapParams) {
    const p = gameStore.randomMapParams as {
      width: number;
      height: number;
      level: number;
      style: string;
      regionId: number;
      seed: number;
    };
    engine.value.loadRandomMap(p.width, p.height, p.level, p.style, p.regionId, p.seed);
  } else {
    engine.value.loadMap(gameStore.mapIndex);
  }

  await nextTick();
  const postLoadMap = gameStore.map;
  if (svgRoot.value && postLoadMap) {
    spawnManager.init(svgRoot.value, postLoadMap.spawns.length);
  }

  if (engine.value.projectileManager) {
    engine.value.projectileManager.setOnLightningFlash((startX, startY, endX, endY) => {
      effectManager.addLightningEffect(startX, startY, endX, endY);
    });
    engine.value.projectileManager.setOnStunEffect((x, y, duration) => {
      effectManager.addStunEffect(x, y, duration);
    });
  }

  gameStore.setState(GameState.PAUSED);
  engine.value.start();
});

onUnmounted(() => {
  pendingHoverScheduled = false;
  engine.value?.dispose();
  resizeObserver.value?.disconnect();
  resizeObserver.value = null;

  enemyManager.dispose();
  towerManager.dispose();
  projectileManager.dispose();
  particleManager.dispose();
  effectManager.dispose();
  uiOverlayManager.dispose();
  spawnManager.dispose();
  pathHighlightsGroup = null;
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
