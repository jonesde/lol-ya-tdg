<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { DIFFICULTY_MULT_GEM_BASE, DIFFICULTY_MULT_TICK } from "@/game/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";

const router = useRouter();
const gameStore = useGameStore();
const persistStore = usePersistStore();
const uiStore = useUiStore();

const diffTick = computed(() => persistStore.difficulty?.multiplierTick || 0);
const diffMult = computed(() => diffTick.value * DIFFICULTY_MULT_TICK + 1);
const gemMult = computed(() => 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult.value - 1));

function onDiffSliderInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const tickValue = parseInt(target.value, 10);
  persistStore.setDifficultyTick(tickValue);
}

function closeMenu() {
  uiStore.closePauseMenu();
}

function endRun() {
  uiStore.showConfirm({
    title: "End Run",
    message: "End the current run and return to the main menu?",
    confirmLabel: "End Run",
    cancelLabel: "Cancel",
    onConfirm: () => {
      gameStore.engine?.endGame(false);
      router.push("/game-over");
    },
  });
}

function openSkillTree() {
  uiStore.openSkillTreeFromGame();
}
</script>

<template>
  <div class="pause-menu" @click.self="closeMenu()">
    <div class="menu-content">
      <div class="menu-buttons">
        <button class="menu-btn primary" @click="closeMenu()">
          Resume
        </button>
        <button class="menu-btn" @click="endRun()">
          End Run
        </button>
        <button class="menu-btn" @click="openSkillTree()">
          Upgrades!
        </button>
      </div>

      <div class="difficulty-section">
        <div class="diff-header">Difficulty</div>
        <input
          type="range"
          min="0"
          max="12"
          :value="diffTick"
          @input="onDiffSliderInput"
          class="diff-slider"
        />
        <div class="diff-values">
          <span>Enemy: ×{{ diffMult.toFixed(2) }}</span>
          <span>Gems: ×{{ gemMult.toFixed(2) }}</span>
        </div>
      </div>

      <div class="gems-display">💎 {{ persistStore.gems }}</div>
    </div>
  </div>
</template>

<style scoped>
.pause-menu {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
}

.menu-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 40px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  min-width: 360px;
}

.menu-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.menu-btn {
  padding: 12px 24px;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.menu-btn.primary {
  background: rgba(95, 208, 255, 0.15);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.difficulty-section {
  width: 100%;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.diff-header {
  font-size: 13px;
  font-weight: bold;
  color: var(--color-text-dim);
  margin-bottom: 8px;
}

.diff-slider {
  width: 100%;
  accent-color: var(--color-accent);
}

.diff-values {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-dim);
}

.gems-display {
  font-size: 18px;
  color: var(--color-gem);
}
</style>
