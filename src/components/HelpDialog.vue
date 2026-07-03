<script setup lang="ts">
import { useUiStore } from "@/stores/ui.js";

const uiStore = useUiStore();
</script>

<template>
  <Teleport to="body">
    <div class="help-overlay" @click.self="uiStore.closeHelpDialog()">
      <div class="help-dialog">
        <div class="help-header">
          <span>Help</span>
          <button class="help-close" @click="uiStore.closeHelpDialog()">X</button>
        </div>

        <div class="help-section">
          <div class="help-section-title">How to Play</div>
          <p class="help-description">
            Defend your base against 100 waves of enemies across 36 procedurally-generated maps.
            Place towers from the shop bar, upgrade them with specializations, and earn gems
            for permanent skill tree upgrades.
          </p>
        </div>

        <div class="help-section">
          <div class="help-section-title">Keyboard Controls</div>
          <table class="help-table">
            <tbody>
              <tr>
                <td><kbd>Esc</kbd></td>
                <td>Close menus and dialogs; otherwise cancel build mode, deselect your tower, or open the pause menu</td>
              </tr>
              <tr>
                <td><kbd>Enter</kbd></td>
                <td>Confirm the highlighted button in an open dialog</td>
              </tr>
              <tr>
                <td><kbd>Space</kbd></td>
                <td>Pause or resume the game</td>
              </tr>
              <tr>
                <td><kbd>Tab</kbd></td>
                <td>Cycle to the next tower type in build mode, or select the next placed tower</td>
              </tr>
              <tr>
                <td><kbd>&rarr;</kbd></td>
                <td>Speed up time (1x to 2x to 4x to 8x)</td>
              </tr>
              <tr>
                <td><kbd>&larr;</kbd></td>
                <td>Slow down time (8x to 4x to 2x to 1x)</td>
              </tr>
              <tr>
                <td><kbd>1</kbd>-<kbd>9</kbd></td>
                <td>Select a tower type to build (matches the shop panel order)</td>
              </tr>
              <tr>
                <td><kbd>U</kbd> or <kbd>&uarr;</kbd></td>
                <td>Upgrade the selected tower</td>
              </tr>
              <tr>
                <td><kbd>S</kbd></td>
                <td>Sell the selected tower for a partial gold refund</td>
              </tr>
              <tr>
                <td>Click empty tile</td>
                <td>Place your selected tower (when in build mode)</td>
              </tr>
              <tr>
                <td>Click a tower</td>
                <td>Select it to view stats, upgrade, or sell</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.help-dialog {
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px 24px;
  width: 520px;
  max-height: 85vh;
  overflow-y: auto;
}

.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 18px;
  font-weight: bold;
  color: var(--color-accent);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.help-close {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-text);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.help-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.help-section {
  margin-bottom: 16px;
}

.help-section:last-child {
  margin-bottom: 0;
}

.help-section-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 10px;
}

.help-description {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.5;
}

.help-table {
  width: 100%;
  border-collapse: collapse;
}

.help-table tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.help-table tr:last-child {
  border-bottom: none;
}

.help-table td {
  padding: 6px 0;
  font-size: 13px;
  vertical-align: top;
}

.help-table td:first-child {
  width: 140px;
  color: var(--color-text-dim);
  padding-right: 12px;
}

.help-table td:last-child {
  color: var(--color-text);
}

kbd {
  font-family: inherit;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text);
}
</style>
