<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { MAP_GEM_MULTIPLIERS } from "@/game/Constants.js";
import { getMap } from "@/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const themeStore = useMapThemeStore();

const regionNames = computed(() => {
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    const activeRegion = themeStore.activeTheme?.regions.find((r) => r.id === i);
    const defaultRegion = themeStore.defaultTheme?.regions.find((r) => r.id === i);
    names.push(activeRegion?.name ?? defaultRegion?.name ?? `Region ${i + 1}`);
  }
  return names;
});

const mapDisplayName = computed(() => {
  return (map: { regionId: number; level?: number; name?: string }) => {
    if (map.name) return map.name;
    const theme = themeStore.activeTheme ?? themeStore.defaultTheme;
    if (theme) {
      const region = theme.regions.find((r) => r.id === map.regionId);
      if (region && map.level !== undefined) {
        return `${region.name} Map ${map.level}`;
      }
    }
    return `Map ${map.regionId}`;
  };
});

watch(
  () => themeStore.activeThemeId,
  (id) => {
    themeStore.loadActive(id).catch((err) => console.error("Failed to load theme:", err));
  },
);

interface MapEntry {
  name: string;
  region: string;
  style: string;
  gemReward: number;
  width: number;
  height: number;
  locked: boolean;
  bestWave: number;
}

// Computed map entries: reactive to highestUnlockedMap and bestWaves changes
const mapEntries = computed<Record<number, MapEntry>>(() => {
  const entries: Record<number, MapEntry> = {};
  for (let i = 0; i < 36; i++) {
    const map = getMap(i);
    entries[i] = {
      name: mapDisplayName.value(map),
      region: regionNames.value[map.regionId],
      style: map.style,
      gemReward: MAP_GEM_MULTIPLIERS[i],
      width: map.width,
      height: map.height,
      locked: i > persistStore.highestUnlockedMap,
      bestWave: typeof persistStore.bestWaves[`best_${i}`] === "number" ? persistStore.bestWaves[`best_${i}`] : 0,
    };
  }
  return entries;
});

function getFullEntry(index: number) {
  return mapEntries.value[index];
}

const regionMapCounts = [12, 12, 12];

interface MapGroup {
  regionId: number;
  name: string;
  maps: { index: number }[];
}

const mapsByRegion = computed<MapGroup[]>(() => {
  const groups: MapGroup[] = [];
  let start = 0;
  for (let regionIdx = 0; regionIdx < 3; regionIdx++) {
    const count = regionMapCounts[regionIdx];
    if (count === 0) continue;
    groups.push({
      regionId: regionIdx,
      name: regionNames[regionIdx],
      maps: Array.from({ length: count }, (_, i) => ({ index: start + i })),
    });
    start += count;
  }
  return groups;
});

async function startMap(index: number) {
  persistStore.clearActiveWave(index);

  // Ensure theme is resolved before navigating to /game
  if (themeStore.activeTheme && themeStore.activeTheme.id === themeStore.activeThemeId) {
    // Theme already loaded and matches selected id
  } else if (themeStore.defaultTheme && themeStore.activeThemeId === themeStore.defaultTheme.id) {
    // Use preloaded default theme
    themeStore.activeTheme = themeStore.defaultTheme;
  } else {
    await themeStore.loadActive(themeStore.activeThemeId).catch((err) => console.error("Failed to load theme:", err));
  }

  // Load map data into the store so SvgGameRoot can pick it up
  const mapData = getMap(index);
  gameStore.mapIndex = index;
  gameStore.map = mapData;

  router.push("/game");
}
</script>

<template>
  <div class="map-select">
    <div class="map-select-header">
      <h2>Select Map</h2>
      <div class="header-controls">
        <select v-model="themeStore.activeThemeId" class="theme-select">
          <option v-for="theme in themeStore.availableThemes" :key="theme.id" :value="theme.id">
            {{ theme.label }}
          </option>
        </select>
        <button class="back-btn" @click="$router.push('/')">← Back</button>
      </div>
    </div>

    <div class="map-grid">
      <template v-for="group in mapsByRegion" :key="group.regionId">
        <div class="region-header" :class="'region-' + group.regionId">
          <span class="region-label">{{ group.name }}</span>
          <span class="region-divider"></span>
        </div>
        <div
          v-for="m in group.maps"
          :key="m.index"
          class="map-card"
          :class="{ locked: getFullEntry(m.index).locked }"
          @click="!getFullEntry(m.index).locked && startMap(m.index)"
        >
          <div class="map-name">{{ getFullEntry(m.index).name }}</div>
          <div class="map-region">
            {{ getFullEntry(m.index).region }} • {{ getFullEntry(m.index).style }} • 💎 x{{ getFullEntry(m.index).gemReward }}
          </div>
          <div class="map-best">Best Wave: {{ getFullEntry(m.index).bestWave }}</div>
          <div class="map-dimensions">{{ getFullEntry(m.index).width }}×{{ getFullEntry(m.index).height }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.map-select {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  z-index: 50;
  background: var(--color-bg);
  overflow-y: auto;
  padding: 20px;
}

.map-select-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.header-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.theme-select {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.theme-select:hover {
  background: rgba(255, 255, 255, 0.15);
}

.map-select-header h2 {
  color: var(--color-accent);
  font-size: 24px;
}

.back-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  justify-content: center;
}

.region-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-bottom: 4px;
}

.region-header:first-child {
  margin-top: 0;
}

.region-label {
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 0.5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.region-0 .region-label { color: #6abf6a; }
.region-1 .region-label { color: #e8c96a; }
.region-2 .region-label { color: #8a7d6a; }

.region-divider {
  flex: 1;
  height: 1px;
}

.region-0 .region-divider { background: linear-gradient(to right, rgba(106, 191, 106, 0.5), transparent); }
.region-1 .region-divider { background: linear-gradient(to right, rgba(232, 201, 106, 0.5), transparent); }
.region-2 .region-divider { background: linear-gradient(to right, rgba(138, 125, 106, 0.5), transparent); }

.map-card {
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.map-card:hover:not(.locked) {
  background: rgba(95, 208, 255, 0.1);
  border-color: var(--color-accent);
}

.map-card.locked {
  opacity: 0.35;
  cursor: not-allowed;
}

.map-name {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 6px;
}

.map-region {
  font-size: 11px;
  color: var(--color-text-dim);
  margin-bottom: 4px;
}

.map-best {
  font-size: 12px;
  color: var(--color-gold);
  margin-bottom: 2px;
}

.map-dimensions {
  font-size: 11px;
  color: var(--color-text-dim);
}
</style>
