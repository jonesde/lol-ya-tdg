<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { getGameEngine } from "@/game/GameEngine.js";
import { getMapDisplayName } from "@/grid/Map.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();
const themeStore = useMapThemeStore();

const notificationVisible = ref(false);

let checkInterval: number | null = null;

function shouldShowNotification() {
  const n = uiStore.notification;
  if (!n) return false;
  if (Date.now() > n.expires) {
    uiStore.hideNotification();
    return false;
  }
  return true;
}

function startNotificationCheck() {
  stopNotificationCheck();
  checkInterval = window.setInterval(() => {
    if (!shouldShowNotification()) {
      notificationVisible.value = false;
    } else {
      notificationVisible.value = true;
    }
  }, 200);
}

function stopNotificationCheck() {
  if (checkInterval !== null) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

watch(
  () => uiStore.notification,
  (n) => {
    if (n && shouldShowNotification()) {
      notificationVisible.value = true;
    } else {
      notificationVisible.value = false;
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (gameStore.isPlaying) {
    startNotificationCheck();
  }
});

onUnmounted(() => {
  stopNotificationCheck();
});

watch(
  () => gameStore.isPlaying,
  (playing) => {
    if (playing) {
      startNotificationCheck();
    } else {
      stopNotificationCheck();
      notificationVisible.value = false;
    }
  },
);
</script>

<template>
  <div class="hud-container">
    <div class="hud-bar">
      <div class="hud-left">
        <span class="hud-label map-title">{{ getMapDisplayName(gameStore.map, themeStore.activeTheme) }}</span>
      </div>
      <div class="hud-center">
        <span class="hud-stat lives" :class="{ warning: gameStore.lives <= 10 && gameStore.lives > 5, critical: gameStore.lives <= 5 }">
          <span class="hud-icon">♥</span>
          <span class="hud-value">{{ gameStore.lives }}</span>
        </span>
        <span class="hud-stat gold">
          <span class="hud-icon">🪙</span>
          <span class="hud-value">{{ gameStore.gold }}</span>
        </span>
        <span class="hud-stat gems">
          <span class="hud-icon">💎</span>
          <span class="hud-value">{{ persistStore.gems }}</span>
        </span>
      </div>
      <div class="hud-center-extra">
        <span class="hud-btn wave-counter">
          <span class="hud-icon">☠</span>
          <span>Wave</span>
          <span class="hud-value">{{ gameStore.currentWave }}</span>
        </span>
      </div>
      <div class="hud-right">
        <button class="hud-btn" :class="{ playing: !gameStore.isPaused }" id="pauseBtn" @click="getGameEngine()?.togglePause()">
          {{ gameStore.isPaused ? '>' : '⏸' }}
        </button>
        <button class="hud-btn" id="speedBtn" @click="gameStore.cycleSpeed()">
          {{ gameStore.timeScale }}×
        </button>
        <button class="hud-btn stats-btn" @click="uiStore.toggleStatsPanel()">∑</button>
        <button class="hud-btn" id="helpBtn" @click="uiStore.toggleHelpDialog()">🛈</button>
        <button class="hud-btn" id="menuBtn" @click="uiStore.openPauseMenu()">☰</button>
      </div>
    </div>
    <transition name="notification">
      <div v-if="notificationVisible" class="notification-toast">
        <span class="notification-message">{{ uiStore.notification?.message }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.hud-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
  user-select: none;
}

.hud-container {
  position: relative;
}

.notification-toast {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 16px;
  z-index: 11;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  user-select: none;
}

.notification-message {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
}

.notification-enter-active {
  transition: opacity 0.2s ease;
}

.notification-leave-active {
  transition: opacity 0.3s ease;
}

.notification-enter-from,
.notification-leave-to {
  opacity: 0;
}

.hud-left, .hud-center, .hud-right, .hud-center-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hud-label {
  font-size: 13px;
  color: var(--color-text-dim);
}

.hud-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 14px;
  font-weight: 600;
}

.hud-stat.lives {
  color: #5fff8a;
}

.hud-stat.critical {
  color: var(--color-danger);
  animation: pulse 0.5s ease-in-out infinite alternate;
}

.hud-stat.warning {
  color: #ffd84d;
}

.hud-stat.gold {
  color: var(--color-gold);
}

.hud-stat.gems {
  color: var(--color-gem);
}

.hud-btn.wave-counter {
  font-size: 18px;
  font-weight: 500;
  color: #d0d0ff;
  gap: 6px;
  height: 28px;
  padding: 4px 10px;
  user-select: none;
  background: none;
  border: none;
  cursor: default;
}

.hud-btn.wave-counter .hud-value {
  font-size: 20px;
  font-weight: 700;
}

.hud-btn.wave-counter .hud-icon {
  font-size: 24px;
}

.hud-icon {
  font-size: 12px;
}

.hud-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  height: 28px;
  min-width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  transition: background 0.15s;
}

.hud-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

@keyframes pulse {
  from { opacity: 1; }
  to { opacity: 0.5; }
}
</style>
