<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  WAVE_GRAPH_DOT_OPACITY,
  WAVE_GRAPH_DOT_OPACITY_WAVE_START,
  WAVE_GRAPH_DOT_SIZE,
  WAVE_GRAPH_DOT_SPACING,
  WAVE_GRAPH_HEIGHT,
  WAVE_GRAPH_INTERVAL_SECONDS,
} from "@/game/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const uiStore = useUiStore();

const overlayRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);

const containerWidth = ref(0);

const tooltipVisible = ref(false);
const tooltipDot = ref<{
  damage: number;
  peakEnemyHp: number;
  gold: number;
  gems: number;
  baseHealth: number;
  baseHealthColor: string;
  waveStart: boolean;
} | null>(null);
const tooltipX = ref(0);
const tooltipY = ref(0);

const tooltipPositionStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }));

const hoveredDotIndex = ref<number | null>(null);

const timeAgo = computed(() => {
  // The wave-graph tracker lives in the worker and is not surfaced in the
  // snapshot (Phase 8). Without it we cannot compute "time ago" for a hovered
  // dot, so the tooltip shows no relative time.
  if (!tooltipDot.value || hoveredDotIndex.value === null) return "";
  return "";
});

interface PathData {
  d: string;
  opacity: number;
  stroke: string;
}

const paths = ref<PathData[]>(Array(5).fill({ d: "", opacity: 0, stroke: "" }));

let resizeObserver: ResizeObserver | null = null;
let pollId: ReturnType<typeof setInterval> | null = null;

function onResize(): void {
  if (!overlayRef.value) return;
  const newWidth = overlayRef.value.clientWidth;
  containerWidth.value = newWidth;
}

function updatePaths(): void {
  // The wave-graph tracker is worker-internal and not in the snapshot, so there
  // are no dots to plot in the worker model (Phase 8). Degrade to an empty graph.
  return;
}

function onMouseMove(event: MouseEvent): void {
  if (!overlayRef.value) return;

  const rect = overlayRef.value.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const dotIndex = Math.floor(relativeX / WAVE_GRAPH_DOT_SPACING);
  void dotIndex;
}

watch(
  () =>
    uiStore.showPauseMenu ||
    uiStore.showSkillTree ||
    uiStore.showStatsPanel ||
    uiStore.showHelpDialog ||
    uiStore.confirmDialog,
  () => {
    tooltipVisible.value = false;
    tooltipDot.value = null;
    hoveredDotIndex.value = null;
  },
);

onMounted(() => {
  if (!overlayRef.value) return;

  const initialWidth = overlayRef.value.clientWidth;
  if (initialWidth > 0) {
    containerWidth.value = initialWidth;
  }

  resizeObserver = new ResizeObserver(() => {
    onResize();
  });
  resizeObserver.observe(overlayRef.value);

  // In the worker model the wave-graph tracker is worker-internal and the
  // engine's renderCallback no longer exists (Phase 8). The graph cannot be
  // driven from the main thread, so we render an empty graph. (A future phase
  // can surface tracker dots via the snapshot.)
  onResize();
});

onUnmounted(() => {
  if (pollId) clearInterval(pollId);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div
    v-show="gameStore.isInGame"
    ref="overlayRef"
    class="wave-graph-overlay"
    @mousemove="onMouseMove"
    @mouseleave="tooltipVisible = false"
  >
    <div class="wave-graph-separator"></div>
    <svg
      ref="svgRef"
      class="wave-graph-svg"
      :viewBox="`0 0 ${containerWidth} ${WAVE_GRAPH_HEIGHT}`"
      xmlns="http://www.w3.org/2000/svg"
      pointer-events="none"
    >
      <path
        v-for="(p, i) in paths"
        :key="i"
        :d="p.d"
        :stroke="p.stroke"
        :style="{ opacity: p.opacity }"
        fill="none"
        :stroke-width="WAVE_GRAPH_DOT_SIZE"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <div
      v-if="tooltipVisible && tooltipDot"
      class="wave-graph-tooltip"
      :style="tooltipPositionStyle"
    >
      <div class="wg-row wg-title">
        <span class="wg-title-label">{{ timeAgo }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_DAMAGE }">
        <span class="wg-label">Damage</span><span class="wg-value">{{ tooltipDot.damage }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH }">
        <span class="wg-label">Peak HP</span><span class="wg-value">{{ tooltipDot.peakEnemyHp }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_GOLD_EARNED }">
        <span class="wg-label">Gold</span><span class="wg-value">{{ tooltipDot.gold }}</span>
      </div>
      <div class="wg-row" :style="{ color: WAVE_GRAPH_COLOR_GEMS_EARNED }">
        <span class="wg-label">Gems</span><span class="wg-value">{{ tooltipDot.gems }}</span>
      </div>
      <div class="wg-row" :style="{ color: tooltipDot?.baseHealthColor }">
        <span class="wg-label">Base HP</span><span class="wg-value">{{ tooltipDot?.baseHealth }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wave-graph-overlay {
  position: absolute;
  bottom: 2px;
  left: 0;
  right: 0;
  z-index: 9;
  pointer-events: all;
}

.wave-graph-separator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
  pointer-events: none;
}

.wave-graph-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.wave-graph-tooltip {
  position: absolute;
  background: rgba(10, 10, 20, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--font-main);
  color: var(--color-text);
  pointer-events: none;
  white-space: nowrap;
  z-index: 12;
}

.wg-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  line-height: 1.5;
}

.wg-title {
  justify-content: center;
  padding-bottom: 2px;
  margin-bottom: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.wg-title-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.wg-label {
  color: var(--color-text-dim);
  font-weight: 500;
}

.wg-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
