<script setup lang="ts">
import { ref } from "vue";
import { GameState } from "@/game/Constants.js";
import { getGameEngine } from "@/game/GameEngine.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";

const gameStore = useGameStore();
const persistStore = usePersistStore();
const visible = ref(false);

function dbgGold() {
  gameStore.addGold(1000);
}

function dbgGems() {
  persistStore.gems += 100;
  persistStore.save();
}

function dbgLives() {
  gameStore.lives = Math.min(99, gameStore.lives + 10);
}

function dbgSkipWave() {
  const engine = getGameEngine();
  if (gameStore.state === GameState.PAUSED && engine?.waveManager) {
    engine.waveManager.startNextWave();
    gameStore.setWave(engine.waveManager.currentWave);
  }
}

function dbgKillAll() {
  const engine = getGameEngine();
  if (engine?.enemyManager) {
    for (const enemy of engine.enemyManager.enemies) {
      enemy.removed = true;
    }
  }
}

function dbgWave() {
  const engine = getGameEngine();
  if (engine?.waveManager) {
    engine.waveManager.currentWave = 50;
    gameStore.setWave(50);
  }
}

function dbgUnlockAll() {
  persistStore.highestUnlockedMap = 35;
  persistStore.save();
}

function dbgSpeed() {
  gameStore.timeScale = gameStore.timeScale === 8 ? 1 : 8;
}
</script>

<template>
  <div class="debug-panel" :class="{ hidden: !visible }">
    <div class="debug-header">Debug</div>
    <button @click="dbgGold">+1000 Gold</button>
    <button @click="dbgGems">+100 Gems</button>
    <button @click="dbgLives">+10 Lives</button>
    <button @click="dbgSkipWave">Skip Wave</button>
    <button @click="dbgKillAll">Kill All</button>
    <button @click="dbgWave">Set Wave 50</button>
    <button @click="dbgUnlockAll">Unlock All Maps</button>
    <button @click="dbgSpeed">Toggle 8x Speed</button>
    <label class="debug-toggle">
      <input type="checkbox" v-model="visible" />
      Show Debug Panel
    </label>
  </div>
</template>

<style scoped>
.debug-panel {
  position: absolute;
  top: 48px;
  left: 8px;
  padding: 8px;
  background: var(--color-panel);
  border: 1px solid rgba(255, 68, 68, 0.3);
  border-radius: 8px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.debug-panel.hidden {
  display: none;
}

.debug-header {
  font-weight: bold;
  color: var(--color-danger);
  margin-bottom: 4px;
}

.debug-panel button {
  padding: 4px 8px;
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.2);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

.debug-panel button:hover {
  background: rgba(255, 68, 68, 0.2);
}

.debug-toggle {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-dim);
  cursor: pointer;
}
</style>
