import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: { setupFiles: ["./tests/setup.ts"], include: ["tests/**/*.test.ts"], globals: true, environment: "jsdom" },
});
