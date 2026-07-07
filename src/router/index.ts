import {
  createRouter,
  createWebHistory,
  type NavigationGuardNext,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from "vue-router";
import { GameState } from "@/game/Constants.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "main-menu", component: () => import("@/components/MainMenu.vue") },
  { path: "/map-select", name: "map-select", component: () => import("@/components/MapSelect.vue") },
  { path: "/skill-tree", name: "skill-tree", component: () => import("@/components/SkillTree.vue") },
  { path: "/game", name: "game", component: () => import("@/components/GameScreen.vue") },
  {
    path: "/game-over",
    name: "game-over",
    component: () => import("@/components/EndScreen.vue"),
    props: { won: false },
  },
  { path: "/victory", name: "victory", component: () => import("@/components/EndScreen.vue"), props: { won: true } },
  { path: "/history", name: "history", component: () => import("@/components/HistoryScreen.vue") },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const gameStore = useGameStore();
  const persistStore = usePersistStore();

  // Block direct access to /game without a loaded map
  // Check `gameStore.map` instead of `mapIndex` — random maps use mapIndex=-1 but still have a valid map
  if (to.name === "game" && !gameStore.map) {
    next("/map-select");
    return;
  }

  // Require active theme to be resolved before entering /game
  const mapThemeStore = useMapThemeStore();
  if (to.name === "game" && !mapThemeStore.activeTheme) {
    next("/map-select");
    return;
  }

  // Auto-redirect from game state to end screen
  // Capture terminal state BEFORE dispose() overwrites it with MENU
  const prevState = gameStore.state;

  // Leaving /game — stop engine and save progress
  if (from.name === "game" && to.name !== "game") {
    gameStore.engine?.dispose();
    persistStore.save();
  }

  if (prevState === GameState.GAME_OVER && to.name !== "game-over" && to.name !== "victory") {
    next("/game-over");
    return;
  }
  if (prevState === GameState.VICTORY && to.name !== "game-over" && to.name !== "victory") {
    next("/victory");
    return;
  }
  next();
});

export default router;
