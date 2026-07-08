import { defineStore } from "pinia";
import type { EnemyManager } from "@/enemies/EnemyManager.js";
import { GameState, StartingGold } from "@/game/Constants.js";
import type { ParticleSystem } from "@/game/ParticleSystem.js";
import type { ProjectileManager } from "@/game/ProjectileManager.js";
import type { Grid } from "@/grid/Grid.js";
import type { GeneratedMap } from "@/grid/Map.js";
import type { Tower } from "@/towers/Tower.js";
import type { TowerManager } from "@/towers/TowerManager.js";

type GameStateValue = (typeof GameState)[keyof typeof GameState];
type TowerId = typeof import("@/game/ConstantsTower").TowerIds[keyof typeof import("@/game/ConstantsTower").TowerIds];

interface BreakdownEntry {
  base: number;
  afterDiff: number;
  afterRegion: number;
  afterFirstTime: number;
}

interface GemBreakdown {
  bossKills: BreakdownEntry;
  milestones: BreakdownEntry;
  waveCompletion: BreakdownEntry;
  firstClearBonus: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface TowerPanelPos {
  x: number;
  y: number;
}

interface HoverTile {
  tileX: number;
  tileY: number;
}

interface EndScreenPayload {
  victory: boolean;
  wave: number;
  gems: number;
  gemBreakdown: GemBreakdown;
}

interface MilestoneRewardsClaimed {
  [wave: number]: boolean;
}

interface TowerManagerLike {
  towers: Tower[];
  towerAt(tileX: number, tileY: number): Tower | undefined;
}

export interface GameStoreLike {
  state: GameStateValue;
  timeScale: number;
  selectedTower: Tower | null;
  selectedTowerType: TowerId | null;
  hoverTile: HoverTile | null;
  camera: CameraState;
  towerManager: TowerManagerLike | null;
  cycleSpeed(): number;
  cycleSpeedReverse(): number;
  selectBuildType(type: TowerId | null): void;
  selectTower(tower: Tower | null): void;
  setHoverTile(tile: HoverTile | null): void;
}

interface GameStateShape {
  state: GameStateValue;
  mapIndex: number;
  map: GeneratedMap | null;
  grid: Grid | null;
  lives: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  selectedTower: Tower | null;
  selectedTowerType: TowerId | null;
  towerPanelPos: TowerPanelPos;
  gameShopPos: TowerPanelPos;
  hoverTile: HoverTile | null;
  hoverUpgradeBtn: boolean;
  upgradeBtnClickAnim: number;
  frameId: number;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  milestoneRewardsClaimed: MilestoneRewardsClaimed;
  gemBreakdown: GemBreakdown;
  endScreenData: EndScreenPayload | null;
  camera: CameraState;
  towerManager: TowerManager | null;
  enemyManager: EnemyManager | null;
  projectileManager: ProjectileManager | null;
  particleManager: ParticleSystem | null;
  randomMapParams: Record<string, unknown> | null;
  worker: Worker | null;
}

export const useGameStore = defineStore("game", {
  state: (): GameStateShape => ({
    state: GameState.MENU,
    mapIndex: -1,
    map: null,
    grid: null,
    lives: 20,
    gold: 0,
    currentWave: 0,
    waveCountdown: null,
    timeScale: 1,
    selectedTower: null,
    selectedTowerType: null,
    towerPanelPos: { x: 0, y: 48 },
    gameShopPos: { x: 0, y: 0 },
    hoverTile: null,
    hoverUpgradeBtn: false,
    upgradeBtnClickAnim: 0,
    frameId: 0,
    runGemsEarned: 0,
    bossesKilledThisRun: 0,
    bossesReachedBaseThisRun: 0,
    milestoneRewardsClaimed: {},
    gemBreakdown: {
      bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
      firstClearBonus: 0,
    },
    endScreenData: null,
    camera: { x: 0, y: 0, zoom: 1 },
    towerManager: null,
    enemyManager: null,
    projectileManager: null,
    particleManager: null,
    randomMapParams: null,
    worker: null,
  }),

  getters: {
    isPlaying: (state) => state.state === GameState.PLAYING,
    isPaused: (state) => state.state === GameState.PAUSED,
    isInGame: (state) => state.state === GameState.PLAYING || state.state === GameState.PAUSED,
    claimedMilestoneSet: (state) => new Set(Object.keys(state.milestoneRewardsClaimed)),
  },

  actions: {
    addGold(amount: number) {
      this.gold += amount;
    },

    setGold(amount: number) {
      this.gold = amount;
    },

    loseLives(amount: number) {
      this.lives -= amount;
    },

    setWave(wave: number) {
      this.currentWave = wave;
    },

    cycleSpeed(): number {
      const speeds = [1, 2, 4, 8] as const;
      const speedIndex = (speeds as readonly number[]).indexOf(this.timeScale);
      this.timeScale = speeds[(speedIndex + 1) % speeds.length]!;
      return this.timeScale;
    },

    cycleSpeedReverse(): number {
      const speeds = [1, 2, 4, 8] as const;
      const speedIndex = (speeds as readonly number[]).indexOf(this.timeScale);
      this.timeScale = speeds[(speedIndex - 1 + speeds.length) % speeds.length]!;
      return this.timeScale;
    },

    selectTower(tower: Tower | null) {
      this.selectedTower = tower;
    },

    selectBuildType(type: TowerId | null) {
      this.selectedTowerType = type;
    },

    setHoverTile(tile: HoverTile | null) {
      this.hoverTile = tile;
    },

    setHoverUpgradeBtn(active: boolean) {
      this.hoverUpgradeBtn = active;
    },

    setState(newState: GameStateValue) {
      this.state = newState;
    },

    togglePause() {
      if (this.state === GameState.PLAYING) this.state = GameState.PAUSED;
      else if (this.state === GameState.PAUSED) this.state = GameState.PLAYING;
    },

    initMap(mapIndex: number, mapData: GeneratedMap, grid: Grid | null) {
      this.mapIndex = mapIndex;
      this.map = mapData;
      this.grid = grid;
      this.lives = 20;
      this.gold = StartingGold[mapData.regionId]!;
      this.currentWave = 0;
      this.runGemsEarned = 0;
      this.bossesKilledThisRun = 0;
      this.bossesReachedBaseThisRun = 0;
      this.milestoneRewardsClaimed = {};
      this.gemBreakdown = {
        bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        firstClearBonus: 0,
      };
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.hoverTile = null;
      this.upgradeBtnClickAnim = 0;
      this.endScreenData = null;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.towerManager = null;
      this.enemyManager = null;
      this.projectileManager = null;
      this.particleManager = null;
    },

    setManagers(
      towerManager: TowerManager,
      enemyManager: EnemyManager,
      projectileManager: ProjectileManager,
      particleManager: ParticleSystem,
    ) {
      this.towerManager = towerManager;
      this.enemyManager = enemyManager;
      this.projectileManager = projectileManager;
      this.particleManager = particleManager;
    },

    setCamera(x: number, y: number, zoom: number) {
      this.camera = { x, y, zoom };
    },

    setWorker(worker: Worker) {
      this.worker = worker;
    },

    clearWorker() {
      this.worker = null;
    },

    claimMilestone(wave: number) {
      this.milestoneRewardsClaimed[wave] = true;
    },

    hasClaimedMilestone(wave: number): boolean {
      return !!this.milestoneRewardsClaimed[wave];
    },

    triggerEnd(victoryFlag: boolean, data: Omit<EndScreenPayload, "victory">) {
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.hoverTile = null;
      this.upgradeBtnClickAnim = 0;
      this.endScreenData = { victory: victoryFlag, ...data };
      this.state = victoryFlag ? GameState.VICTORY : GameState.GAME_OVER;
    },

    resetToMenu() {
      this.state = GameState.MENU;
      this.mapIndex = -1;
      this.map = null;
      this.grid = null;
      this.lives = 20;
      this.gold = 0;
      this.currentWave = 0;
      this.timeScale = 1;
      this.selectedTower = null;
      this.selectedTowerType = null;
      this.towerPanelPos = { x: 0, y: 48 };
      this.gameShopPos = { x: 0, y: 0 };
      this.hoverTile = null;
      this.hoverUpgradeBtn = false;
      this.upgradeBtnClickAnim = 0;
      this.runGemsEarned = 0;
      this.bossesKilledThisRun = 0;
      this.bossesReachedBaseThisRun = 0;
      this.milestoneRewardsClaimed = {};
      this.gemBreakdown = {
        bossKills: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        milestones: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        waveCompletion: { base: 0, afterDiff: 0, afterRegion: 0, afterFirstTime: 0 },
        firstClearBonus: 0,
      };
      this.endScreenData = null;
      this.camera = { x: 0, y: 0, zoom: 1 };
      this.randomMapParams = null;
    },
  },
});

export type GameStore = ReturnType<typeof useGameStore>;
