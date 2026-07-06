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
  --color-bg: rgba(20, 23, 30, 1);
  --color-panel: rgba(20, 26, 40, 0.95);
  --color-border: rgba(95, 208, 255, 0.3);
  --color-accent: #5fd0ff;
  --color-gold: #ffd84d;
  --color-gem: #9be7ff;
  --color-danger: #ff4444;
  --color-success: #44ff44;
  --color-text: #e0f0ff;
  --color-text-dim: #80d8e0;
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
