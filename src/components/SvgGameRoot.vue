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
import { GameState, SELL_DISCOUNT_PCT } from "@/game/Constants.js";
import { ENEMY_TYPES } from "@/game/ConstantsEnemy.js";
import { TOWER_META, TowerIds } from "@/game/ConstantsTower.js";
import { useInput } from "@/game/Input.js";
import { fitToGrid } from "@/render/svg/cameraUtils.js";
import { EffectManager } from "@/render/svg/EffectManager.js";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import { ParticleManager } from "@/render/svg/ParticleManager.js";
import { ProjectileManager } from "@/render/svg/ProjectileManager.js";
import { SpawnManager } from "@/render/svg/SpawnManager.js";
import { TowerManager } from "@/render/svg/TowerManager.js";
import type { EnemyVisualMeta, TowerVisualMeta } from "@/render/themes/index.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import type { ThemeBundle } from "@/sim/HostBindings.js";
import type { PersistState } from "@/sim/PersistState.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import { WorkerCommandDispatcher } from "@/sim/WorkerCommandDispatcher.js";
import GameWorker from "@/sim/WorkerEntry.ts?worker";
import type { WorkerToMainMessage } from "@/sim/WorkerProtocol.js";
import { MainThreadHostBindings } from "@/sim-adapters/MainThreadHostBindings.js";
import { SoundManager } from "@/sound/SoundManager.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

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

// Monotonic id source for click commands dispatched to the dispatcher. The
// dispatcher reassigns ids when undefined; click handlers always supply their
// own so each click carries a distinct commandId for tracing.
let nextClickCommandId = 1;
// Separate id source for sell-confirm-initiated executeSell commands (fix #7).
let nextConfirmCommandId = 1;

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

// Worker-owned simulation: the worker owns the engine; the main thread owns a
// SnapshotStore projection and a WorkerCommandDispatcher that posts commands.
let worker: Worker | null = null;
let dispatcher: WorkerCommandDispatcher | null = null;
const snapshotStore = new SnapshotStore(gameStore);

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

// Hover is main-thread-only in Phase 7 — compute the hovered tile here and
// write it directly to gameStore (the worker echoes it back unchanged).
const flushHover = (): void => {
  pendingHoverScheduled = false;
  if (!svgRoot.value || !cachedInverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = pendingHoverX;
  pt.y = pendingHoverY;
  const worldPos = pt.matrixTransform(cachedInverseCtm);

  mouseWorldPos.value = worldPos;

  const grid = gameStore.grid;
  const tileSize = grid?.tileSize ?? mapTileSize;
  const tileX = Math.floor(worldPos.x / tileSize);
  const tileY = Math.floor(worldPos.y / tileSize);
  if (grid?.inBounds(tileX, tileY)) {
    gameStore.setHoverTile({ tileX, tileY });
  } else {
    gameStore.setHoverTile(null);
  }

  gameStore.setHoverUpgradeBtn(computeHoverUpgradeBtn(worldPos.x, worldPos.y));
};

// The upgrade button hit-test that used to live on GameEngine.setHover. It
// depends only on the selected tower's tile + the grid tile size, both of which
// are available from the snapshot/grid on the main thread.
const computeHoverUpgradeBtn = (worldX: number, worldY: number): boolean => {
  const selectedTower = snapshotStore.resolveSelectedTower();
  if (!selectedTower || gameStore.selectedTowerType) return false;
  const grid = gameStore.grid;
  if (!grid) return false;
  const tileSize = grid.tileSize || mapTileSize;
  const buildX = (selectedTower.tileX + 1) * tileSize - 12;
  const buildY = selectedTower.tileY * tileSize + 2;
  return worldX >= buildX && worldX <= buildX + 10 && worldY >= buildY && worldY <= buildY + 10;
};

const onMouseMove = (e: MouseEvent): void => {
  updateCachedCtm();
  scheduleHover(e.clientX, e.clientY);
};

const dispatchClick = (clientX: number, clientY: number): void => {
  if (!svgRoot.value || !worldLayer.value || !dispatcher) return;

  const inverseCtm = worldLayer.value.getScreenCTM()?.inverse() ?? null;
  if (!inverseCtm) return;

  const pt = svgRoot.value.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const worldPos = pt.matrixTransform(inverseCtm);

  dispatcher.dispatch({ commandId: nextClickCommandId++, type: "input:click", worldX: worldPos.x, worldY: worldPos.y });
};

const onMouseDown = (e: MouseEvent): void => {
  if (e.button !== 0) return;
  dispatchClick(e.clientX, e.clientY);
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
  dispatchClick(e.clientX, e.clientY);
};

const resizeObserver = ref<ResizeObserver | null>(null);
const soundManager = ref<SoundManager | null>(null);

async function buildDefsImperative(staticContent: string, mapContent: string): Promise<void> {
  if (!defsLayer.value) return;
  while (defsLayer.value.firstChild) {
    defsLayer.value.removeChild(defsLayer.value.firstChild);
  }
  defsLayer.value.innerHTML = staticContent + mapContent;
}

function buildThemeBundle(): ThemeBundle {
  const defaultTowerVisuals: Record<string, TowerVisualMeta> = {};
  for (const id of Object.values(TowerIds)) {
    const visual = themeStore.getDefaultTowerVisual(id);
    if (visual) defaultTowerVisuals[id] = visual;
  }
  const defaultEnemyVisuals: Record<string, EnemyVisualMeta> = {};
  for (const type of Object.keys(ENEMY_TYPES)) {
    const visual = themeStore.getDefaultEnemyVisual(type);
    if (visual) defaultEnemyVisuals[type] = visual;
  }
  return { active: themeStore.activeTheme, defaultTowerVisuals, defaultEnemyVisuals };
}

// Wire worker → main messages. Snapshots are projected into the gameStore by
// SnapshotStore; sound/UI/persist/confirm are handled by the main-thread host.
function handleWorkerMessage(event: MessageEvent): void {
  const msg = event.data as WorkerToMainMessage;
  switch (msg.type) {
    case "snapshot":
      snapshotStore.apply(msg.snapshot);
      break;
    case "playSound":
      host.playSound(msg.name);
      break;
    case "notifyUi":
      host.notifyUi(msg.event);
      break;
    case "schedulePersistSave":
      host.schedulePersistSave(msg.state);
      break;
    case "requestConfirm": {
      // The main-thread host shows the dialog. On confirm we dispatch an
      // action:executeSell command (the worker re-validates and performs the
      // sell through the command seam — fix #7). We always post the result back
      // so the worker can clear its pending-confirm entry.
      host.requestConfirm(msg.payload).then((confirmed) => {
        if (confirmed && dispatcher) {
          dispatcher.dispatch({
            commandId: nextConfirmCommandId++,
            type: "action:executeSell",
            towerId: msg.payload.towerId,
          });
        }
        worker?.postMessage({ type: "confirmResult", requestId: msg.requestId, confirmed });
      });
      break;
    }
    case "workerReady":
      // Worker initialized; the simulation loop is running.
      break;
    case "workerError":
      console.error("Worker error:", msg.message, msg.stack);
      break;
  }
}

function renderLoop(): void {
  const snapshot = snapshotStore.get();
  if (!snapshot) {
    requestAnimationFrame(renderLoop);
    return;
  }

  const cam = gameStore.camera;
  cameraTransformString = `translate(${cam.x}, ${cam.y}) scale(${cam.zoom})`;
  worldLayer.value?.setAttribute("transform", cameraTransformString);

  enemyManager.syncFromGameEngine(snapshot.enemies);
  towerManager.syncFromGameEngine(snapshot.towers, snapshot.meta.lastScaledDt);
  projectileManager.syncFromGameEngine(snapshot.projectiles);
  particleManager.syncFromGameEngine(snapshot.particles);

  const selectedTower = snapshotStore.resolveSelectedTower();

  effectManager.syncFromGameEngine(
    buildPreviewTilePos.value,
    gameStore.selectedTowerType || null,
    buildPreviewColor.value,
    selectedTower,
    buildPreviewValid.value,
    snapshot.meta.lastScaledDt,
  );
  uiOverlayManager.syncFromGameEngine(snapshot.enemies, selectedTower);
  if (gameStore.grid) {
    uiOverlayManager.syncPendingQueueOverlays(gameStore.grid, snapshot.spawnStates);
  }
  spawnManager.sync(snapshot.spawnStates);

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
        .map((tile) => `${tile.x * mapTileSize + mapTileSize / 2},${tile.y * mapTileSize + mapTileSize / 2}`)
        .join(" ");
      pathSvg += `<polyline points="${points}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4" />`;
    }
    pathHighlightsGroup.innerHTML = pathSvg;
  }

  requestAnimationFrame(renderLoop);
}

let host: MainThreadHostBindings;

onMounted(async () => {
  const sound = new SoundManager();
  soundManager.value = sound;
  host = new MainThreadHostBindings(sound);

  worker = new GameWorker();
  gameStore.setWorker(worker);
  worker.addEventListener("message", handleWorkerMessage);

  dispatcher = new WorkerCommandDispatcher(worker);
  setCommandDispatcher(dispatcher);

  const themeBundle = buildThemeBundle();
  const persistState = structuredClone(persistStore.$state) as unknown as PersistState;

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

  if (svgRoot.value) {
    resizeObserver.value = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        viewSize.value = { w: width, h: height };
      }
    });
    resizeObserver.value.observe(svgRoot.value);
  }

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

  useInput(gameStore, dispatcher, uiStore);

  // The main thread builds its own static Grid from the same map data so that
  // click-coordinate conversion and path highlights work without the engine.
  if (gameStore.map) {
    const { Grid } = await import("@/grid/Grid.js");
    const grid = new Grid(gameStore.map);
    gameStore.grid = grid;
    const initialCam = fitToGrid(gameStore.map.width, gameStore.map.height, viewSize.value.w, viewSize.value.h - 104);
    cameraTransformString = `translate(${initialCam.x}, ${initialCam.y}) scale(${initialCam.zoom})`;
    worldLayer.value?.setAttribute("transform", cameraTransformString);
    gameStore.setCamera(initialCam.x, initialCam.y, initialCam.zoom);
  }

  worker.postMessage({
    type: "init",
    persistState,
    themeBundle,
    mapIndex: gameStore.mapIndex,
    randomMapParams: gameStore.randomMapParams ?? undefined,
  });

  if (gameStore.map) {
    spawnManager.init(svgRoot.value!, gameStore.map.spawns.length);
  }

  gameStore.setState(GameState.PAUSED);
  requestAnimationFrame(renderLoop);
});

onUnmounted(() => {
  pendingHoverScheduled = false;
  // Ask the worker to flush any dirty persist state and dispose, then wait for
  // the "disposed" ack before terminating so the final flush is not dropped
  // (fix #3). A short safety timeout prevents a hung worker from blocking unmount.
  const workerRef = worker;
  if (workerRef) {
    const disposeDone = new Promise<void>((resolve) => {
      const onDisposed = (event: MessageEvent): void => {
        const data = event.data as { type?: string } | null;
        if (data && data.type === "disposed") {
          workerRef.removeEventListener("message", onDisposed);
          resolve();
        }
      };
      workerRef.addEventListener("message", onDisposed);
      workerRef.postMessage({ type: "dispose" });
      setTimeout(resolve, 500);
    });
    void disposeDone.then(() => {
      workerRef.terminate();
    });
  }
  gameStore.clearWorker();
  setCommandDispatcher(null);
  worker = null;
  dispatcher = null;
  soundManager.value?.dispose();
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
