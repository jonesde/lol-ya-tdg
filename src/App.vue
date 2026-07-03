<script setup lang="ts">
import ConfirmDialog from "@/components/ConfirmDialog.vue";
</script>

<template>
  <div class="app-container">
    <router-view />
    <ConfirmDialog />
  </div>
</template>

<style>
:root {
  --color-bg: #1a1d2e;
  --color-panel: rgba(20, 24, 40, 0.95);
  --color-border: rgba(95, 208, 255, 0.3);
  --color-accent: #5fd0ff;
  --color-gold: #ffd700;
  --color-gem: #c084fc;
  --color-danger: #ff4444;
  --color-success: #44ff44;
  --color-text: #e0e0e0;
  --color-text-dim: #8892a4;
  --font-main: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
  font-family: var(--font-main);
  color: var(--color-text);
}

#app {
  width: 100%;
  height: 100%;
}

.app-container {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
