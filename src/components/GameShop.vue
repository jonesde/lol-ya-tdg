<script setup lang="ts">
import { computed } from "vue";
import type { TowerId } from "@/game/ConstantsTower.js";
import { TOWER_META, TowerIds } from "@/game/ConstantsTower.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const discount = computed(() => {
  return persistStore.generalAddons?.sellActive === "discount" ? 0.75 : 1;
});

const towerList = Object.values(TowerIds) as TowerId[];

function toggleBuild(type: TowerId) {
  gameStore.selectBuildType(gameStore.selectedTowerType === type ? null : type);
}

function getCost(type: TowerId) {
  return Math.floor(TOWER_META[type].cost * discount.value);
}

function getTowerDisplayName(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.name || type;
}

function getTowerDisplayColor(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.color || "#8fbc8f";
}

function getTowerDisplayIcon(type: TowerId): string {
  return themeStore.getTowerVisual(type)?.icon || "\u2500";
}
</script>

<template>
  <div class="shop-bar">
    <div
      v-for="id in towerList"
      :key="id"
      class="shop-tower"
      :class="{
        selected: gameStore.selectedTowerType === id,
        disabled: gameStore.gold < getCost(id),
      }"
      @click="gameStore.gold >= getCost(id) && toggleBuild(id)"
    >
      <span class="tower-icon" :style="{ color: getTowerDisplayColor(id) }">
        {{ getTowerDisplayIcon(id) }}
      </span>
      <div class="tower-name-wrap">
        <div v-for="word in getTowerDisplayName(id).split(' ')" :key="word" class="tower-name">
          {{ word }}
        </div>
      </div>
      <span class="tower-cost">{{ getCost(id) }}g</span>
    </div>
  </div>
</template>

<style scoped>
.shop-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  background: rgba(0,0,0,0);
  border-top: 1px solid var(--color-border);
  z-index: 10;
  overflow-x: auto;
}

.shop-tower {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 2px solid transparent;
  background: rgba(20, 24, 50, 0.7);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.shop-tower:hover {
  background: rgba(40, 48, 100, 1);
}

.shop-tower.selected {
  background: #1a5c2a;
  border-color: var(--color-success);
}

.shop-tower.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tower-icon {
  font-size: 18px;
  line-height: 1;
}

.tower-name-wrap {
  display: flex;
  flex-direction: column;
  margin: 2px 0;
}

.tower-name {
  font-size: 9px;
  color: var(--color-text-dim);
  text-align: center;
  line-height: 1.2;
}

.tower-cost {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-gold);
}
</style>
