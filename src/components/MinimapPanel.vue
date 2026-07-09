<template>
  <div
    class="minimap-panel"
    :style="{ top: gameStore.minimapPanelPos.y + 'px', left: gameStore.minimapPanelPos.x + 'px' }"
  >
    <div class="panel-header" @mousedown="onHeaderMouseDown">
      Minimap
      <span class="close-btn" @click="uiStore.closeMinimap()" @mousedown.stop>✕</span>
    </div>
    <div class="panel-body">
      <TextGameRoot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import { useGameStore } from "@/stores/game.js";
import { useUiStore } from "@/stores/ui.js";
import TextGameRoot from "./TextGameRoot.vue";

const gameStore = useGameStore();
const uiStore = useUiStore();

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panelStartX = 0;
let panelStartY = 0;
let currentOnMove: ((event: MouseEvent) => void) | null = null;
let currentOnUp: (() => void) | null = null;

function onHeaderMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  dragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  panelStartX = gameStore.minimapPanelPos.x;
  panelStartY = gameStore.minimapPanelPos.y;

  currentOnMove = (moveEvent: MouseEvent) => {
    if (!dragging) return;
    gameStore.minimapPanelPos = {
      x: panelStartX + (moveEvent.clientX - dragStartX),
      y: panelStartY + (moveEvent.clientY - dragStartY),
    };
  };
  currentOnUp = () => {
    dragging = false;
    cleanupDragListeners();
  };
  document.addEventListener("mousemove", currentOnMove);
  document.addEventListener("mouseup", currentOnUp);
  event.preventDefault();
}

function cleanupDragListeners(): void {
  if (currentOnMove) document.removeEventListener("mousemove", currentOnMove);
  if (currentOnUp) document.removeEventListener("mouseup", currentOnUp);
  currentOnMove = null;
  currentOnUp = null;
}

onUnmounted(() => {
  cleanupDragListeners();
});
</script>

<style scoped>
.minimap-panel {
  position: absolute;
  width: 320px;
  padding: 8px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  z-index: 12;
  font-size: 12px;
}

.panel-header {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 6px;
  cursor: grab;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header:active {
  cursor: grabbing;
}

.close-btn {
  cursor: pointer;
  color: var(--color-text-dim);
  font-weight: normal;
}

.close-btn:hover {
  color: var(--color-danger);
}

.panel-body {
  overflow: auto;
}
</style>
