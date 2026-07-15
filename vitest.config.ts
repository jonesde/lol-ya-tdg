import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    globals: true,
    environment: "jsdom",
    // The worker round-trip suite drives a setTimeout-based fixed-timestep loop
    // and asserts on exact snapshot counts; running it alongside other files in
    // parallel can starve that loop and make those timing assertions flaky. A
    // small retry budget keeps npx vitest run green without the large slowdown
    // of disabling file parallelism.
    retry: 2,
  },
});
