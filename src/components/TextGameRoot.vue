<template>
  <div class="text-game-root">
    <pre ref="preEl" class="text-grid-pre" :style="preStyle">{{ gridText }}</pre>
    <canvas
      ref="canvasEl"
      class="text-grid-canvas"
      :width="canvasWidth"
      :height="canvasHeight"
      :style="canvasStyle"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Grid } from "@/grid/Grid.js";
import { TextEnemyManager } from "@/render/text/TextEnemyManager.js";
import { TextGridBuilder } from "@/render/text/TextGridBuilder.js";
import { TextOverlayRenderer } from "@/render/text/TextOverlayRenderer.js";
import { TextTowerManager } from "@/render/text/TextTowerManager.js";
import type { TextRenderScale } from "@/render/text/types.js";
import { getLatestSnapshot } from "@/sim/SnapshotStore.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";

const gameStore = useGameStore();
const themeStore = useMapThemeStore();

const FONT_SIZE = 12;
const FONT_FAMILY = "monospace";
const LINE_HEIGHT_FACTOR = 1.2;

const preEl = ref<HTMLPreElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const gridText = ref("");
const gridWidth = ref(0);
const gridHeight = ref(0);

// Measured monospace cell box. In a real browser `measureText` yields the
// advance; under jsdom it returns 0, so we fall back to a non-zero box derived
// from the font size to avoid divide-by-zero and a collapsed canvas.
const cellWidthPx = ref(FONT_SIZE * 0.6);
const cellHeightPx = ref(FONT_SIZE);

const scale = computed<TextRenderScale>(() => ({
  scaleX: (3 * cellWidthPx.value) / 36,
  scaleY: (3 * cellHeightPx.value) / 36,
}));

const canvasWidth = computed(() => Math.round(gridWidth.value * 3 * cellWidthPx.value));
const canvasHeight = computed(() => Math.round(gridHeight.value * 3 * cellHeightPx.value));

// The `<pre>` and the canvas overlay must share the exact same font metrics and
// origin, or glyphs will not sit in their cells. Drive both from one computed
// style object.
const preStyle = computed(() => ({
  fontFamily: FONT_FAMILY,
  fontSize: `${FONT_SIZE}px`,
  lineHeight: `${cellHeightPx.value}px`,
  margin: "0",
  letterSpacing: "0",
  color: "var(--color-text-dim)",
}));

const canvasStyle = computed(() => ({ fontFamily: FONT_FAMILY, fontSize: `${FONT_SIZE}px` }));

const towerManager = new TextTowerManager();
const enemyManager = new TextEnemyManager();
const overlayRenderer = new TextOverlayRenderer();

let disposed = false;
let renderFrameHandle: number | null = null;

function measureCell(): void {
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  let measuredWidth = 0;
  if (measureCtx) {
    measureCtx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    measuredWidth = measureCtx.measureText("M").width || 0;
  }
  cellHeightPx.value = FONT_SIZE * LINE_HEIGHT_FACTOR;
  if (measuredWidth > 0) {
    cellWidthPx.value = measuredWidth;
  } else {
    cellWidthPx.value = FONT_SIZE * 0.6;
    cellHeightPx.value = FONT_SIZE;
  }
}

function renderFrame(): void {
  if (disposed) return;
  const snapshot = getLatestSnapshot();
  const ctx = canvasEl.value?.getContext("2d");
  if (snapshot && ctx) {
    // Match the `<pre>` font so canvas glyphs sit in the same cells. The
    // context font persists across fillText calls until changed.
    ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
    towerManager.render(ctx, snapshot.towers, themeStore, scale.value);
    enemyManager.render(ctx, snapshot.enemies, themeStore, scale.value);
    overlayRenderer.render(ctx, snapshot, scale.value);
  }
  renderFrameHandle = requestAnimationFrame(renderFrame);
}

onMounted(() => {
  const grid: Grid | null = gameStore.grid;
  if (grid) {
    gridWidth.value = grid.width;
    gridHeight.value = grid.height;
    const builder = new TextGridBuilder(grid);
    gridText.value = builder.getText();
  }
  measureCell();
  renderFrameHandle = requestAnimationFrame(renderFrame);
});

onUnmounted(() => {
  disposed = true;
  if (renderFrameHandle !== null) {
    cancelAnimationFrame(renderFrameHandle);
    renderFrameHandle = null;
  }
});
</script>

<style scoped>
.text-game-root {
  position: relative;
  line-height: 1;
}

.text-grid-pre {
  margin: 0;
  white-space: pre;
  display: block;
  user-select: none;
}

.text-grid-canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
