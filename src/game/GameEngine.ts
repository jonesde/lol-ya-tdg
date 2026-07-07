import type { Enemy } from "@/enemies/Enemy.js";
import { resetEnemyId } from "@/enemies/Enemy.js";
import { EnemyManager } from "@/enemies/EnemyManager.js";
import { ParticleSystem } from "@/game/ParticleSystem.js";
import { ProjectileManager } from "@/game/ProjectileManager.js";
import { WaveGraphTracker } from "@/game/WaveGraphTracker.js";
import { Grid } from "@/grid/Grid.js";
import type { GeneratedMap } from "@/grid/Map.js";
import { generateRandomMap, getMap } from "@/grid/Map.js";
import type { MapThemeData, SpawnState } from "@/render/themes/index.js";
import type { HostBindings } from "@/sim/HostBindings.js";
import type { GameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import type { PersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import type { Tower } from "@/towers/Tower.js";
import { TowerManager } from "@/towers/TowerManager.js";
import { WaveManager } from "@/waves/WaveManager.js";
import {
  BONUS_GEM_BASE,
  BOSS_LIFE_LOSS,
  BOUNTY_BLOCKED_RATIO,
  DIFFICULTY_MULT_GEM_BASE,
  FIXED_DT,
  GameState,
  MAP_GEM_MULTIPLIERS,
  MAX_ACCUM,
  MILESTONE_GEMS,
  MILESTONE_WAVES,
  SELL_DISCOUNT_PCT,
  SELL_VALUE_RATIO,
  SLOW_HEALING_PER_ROUND,
  STARTING_GOLD_BONUS,
  STARTING_HEALTH_BONUS,
  UPGRADE_COST_REDUCTION_PCT,
  VICTORY_WAVE,
} from "./Constants.js";
import { ENEMY_TYPES } from "./ConstantsEnemy.js";
import { TOWER_META } from "./ConstantsTower.js";

interface WaveManagerRef {
  currentWave: number;
  betweenWaves: boolean;
  countdownActive: boolean;
  countdownTimer: number;
  baseReached: boolean;
  _waveGameTime: number;
  spawnStates: SpawnState[];
  update(
    dt: number,
    onWaveCleared: ((wave: number) => void) | null,
    onWaveStart: ((wave: number) => void) | null,
  ): void;
  reportBossReachedBase(): void;
  startNextWave(): void;
}

export class GameEngine {
  gameStore: GameStore;
  persistStore: PersistStore;
  host: HostBindings;
  grid: Grid | null;
  enemyManager: EnemyManager | null;
  towerManager: TowerManager | null;
  waveManager: WaveManagerRef | null;
  projectileManager: ProjectileManager | null;
  particleManager: ParticleSystem | null;
  waveGraphTracker: WaveGraphTracker | null = null;
  _rafId: number | null;
  lastTime: number;
  _accumulator: number;
  totalGoldEarned: number;
  totalHealingReceived: number;
  startingLives: number;
  waveTopTowers: { tower: Tower; rank: number; dmg: number; startTime: number }[] | null;
  renderCallback: (() => void) | null = null;
  lastScaledDt: number = 0;
  shouldEndGame: boolean = false;

  theme: MapThemeData | null = null;

  constructor(gameStore: GameStore, persistStore: PersistStore, theme: MapThemeData | null, host: HostBindings) {
    this.gameStore = gameStore;
    this.persistStore = persistStore;
    this.theme = theme ?? null;
    this.host = host;

    if (this.theme) {
      this.setTheme(this.theme);
    }

    this.grid = null;
    this.enemyManager = null;
    this.towerManager = null;
    this.waveManager = null;
    this.projectileManager = null;
    this.particleManager = null;

    this._rafId = null;
    this.lastTime = 0;
    this._accumulator = 0;

    this.totalGoldEarned = 0;
    this.totalHealingReceived = 0;
    this.startingLives = 20;
    this.waveTopTowers = null;
  }

  setTheme(theme: MapThemeData | null): void {
    this.theme = theme;
  }

  loadMap(mapIndex: number): void {
    const mapData = getMap(mapIndex);
    this._initMap(mapIndex, mapData);
  }

  loadRandomMap(width: number, height: number, level: number, style: string, regionId: number, seed: number): void {
    const mapData = generateRandomMap(width, height, style, regionId, level, seed);
    this._initMap(-1, mapData);
  }

  _initMap(mapIndex: number, mapData: GeneratedMap): void {
    useUiStore().initForRun(null);

    this.gameStore.initMap(mapIndex, mapData, null);
    resetEnemyId();

    this.grid = new Grid(mapData);
    this.grid.regionId = mapData.regionId;
    this.gameStore.grid = this.grid;

    const diffTick = this.persistStore.getDifficultyTick();
    this.particleManager = new ParticleSystem();
    this.enemyManager = new EnemyManager(this.grid, this.particleManager, diffTick, this.theme);
    this.projectileManager = new ProjectileManager(this.enemyManager, this.particleManager, null, null, this.grid);
    this.towerManager = new TowerManager(
      this.grid,
      this.particleManager,
      this.projectileManager,
      this.host,
      this.theme,
    );
    this.projectileManager.setTowerLookup((towerId) => this.towerManager?.getTowerById(towerId) ?? null);
    this.projectileManager.setOnGoldReward((amount) => {
      this.earnGold(amount);
    });
    this.waveManager = new WaveManager(mapData, this.enemyManager);

    this.gameStore.setManagers(this.towerManager, this.enemyManager, this.projectileManager, this.particleManager);

    this.waveGraphTracker = new WaveGraphTracker(
      this.gameStore,
      this.persistStore,
      this.towerManager!,
      this.enemyManager!,
    );

    this._applyStartingBonuses();

    this.gameStore.setWave(this.waveManager.currentWave);
    this.totalGoldEarned = 0;
    this.totalHealingReceived = 0;
  }

  _applyStartingBonuses(): void {
    const generalAddons = this.persistStore.generalAddons;

    const ehTier = generalAddons.extraHealth;
    if (ehTier !== null && ehTier !== undefined) {
      this.gameStore.lives += STARTING_HEALTH_BONUS[ehTier] || 0;
    }

    this.startingLives = this.gameStore.lives;

    const sgTier = generalAddons.startingGold;
    if (sgTier !== null && sgTier !== undefined) {
      this.gameStore.gold += STARTING_GOLD_BONUS[sgTier] || 0;
    }
  }

  onBossKilled(): void {
    this.gameStore.bossesKilledThisRun++;

    const base = 1;
    const diffMult = this.persistStore.difficultyMultiplier;
    const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
    const mapMult = this.gameStore.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[this.gameStore.mapIndex] || 1 : 1;

    const afterDiff = Math.ceil(base * gemMult);
    const afterRegion = Math.ceil(afterDiff * mapMult);

    const breakdown = this.gameStore.gemBreakdown.bossKills;
    breakdown.base += base;
    breakdown.afterDiff += afterDiff;
    breakdown.afterRegion += afterRegion;
    breakdown.afterFirstTime += afterRegion;

    this.persistStore.gems += afterRegion;
    this.gameStore.runGemsEarned += afterRegion;
    this.persistStore.save();

    this.host.playSound("boss_die");
  }

  start(): void {
    if (this.gameStore.state === GameState.PLAYING) return;
    this._rafId = requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  loop(now: number): void {
    const gameStore = this.gameStore;
    if (gameStore.state !== GameState.PLAYING && gameStore.state !== GameState.PAUSED) return;

    if (this.lastTime === 0) this.lastTime = now;
    const rawDt = Math.min(MAX_ACCUM, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const scaledDt = rawDt * (gameStore.state === GameState.PAUSED ? 0 : gameStore.timeScale);
    this.lastScaledDt = scaledDt;
    this._accumulator += scaledDt;

    while (this._accumulator >= FIXED_DT) {
      this.update(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    this.renderCallback?.();

    this._rafId = requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  update(dt: number): void {
    if (!this.waveManager || !this.enemyManager || !this.towerManager) return;

    this.waveManager.update(
      dt,
      (wave) => this.onWaveCleared(wave),
      (wave) => this.onWaveStart(wave),
    );

    const wm = this.waveManager;
    if (wm.countdownActive) {
      const currentRemaining = Math.ceil(wm.countdownTimer);
      const stored: { remaining: number; nextWave: number } | null = this.gameStore.waveCountdown;
      if (!stored || stored.remaining !== currentRemaining) {
        this.gameStore.waveCountdown = { remaining: currentRemaining, nextWave: wm.currentWave + 1 };
      }
    } else if (this.gameStore.waveCountdown !== null) {
      this.gameStore.waveCountdown = null;
    }

    this.particleManager?.update(dt);

    this.projectileManager?.update(dt);

    this.enemyManager.update(dt, (enemy) => {
      if (enemy.reachedBase) {
        this.gameStore.loseLives(enemy.type === "boss" ? BOSS_LIFE_LOSS : 1);
        enemy.removed = true;
        this.waveManager!.baseReached = true;
        if (enemy.type === "boss") {
          this.gameStore.bossesReachedBaseThisRun++;
          this.waveManager!.reportBossReachedBase();
        }
        this.host.playSound("base_hit");
        if (this.gameStore.lives <= 0) {
          this.shouldEndGame = true;
          return;
        }
      } else if (enemy.type === "boss") {
        this.onBossKilled();
        this.onEnemyKill(enemy);
      } else if (enemy.onPathBlocked) {
        const bounty = Math.ceil((ENEMY_TYPES[enemy.type]?.bounty || 1) * BOUNTY_BLOCKED_RATIO);
        this.waveGraphTracker?.onGoldBounty(bounty);
        this.earnGold(bounty);
      } else {
        this.onEnemyKill(enemy);
      }
    });

    this.towerManager.update(dt, this.enemyManager);

    this.waveGraphTracker?.update(dt);

    if (this.shouldEndGame) {
      this.endGame(false);
      return;
    }

    if (
      this.waveManager.currentWave >= VICTORY_WAVE &&
      this.waveManager.betweenWaves &&
      this.enemyManager.enemies.length === 0 &&
      !this.enemyManager.hasPendingEnemies()
    ) {
      this.endGame(true);
    }
  }

  onWaveCleared(wave: number): void {
    this.gameStore.setWave(wave);

    for (const m of MILESTONE_WAVES) {
      if (wave >= m && !this.gameStore.hasClaimedMilestone(m)) {
        this.gameStore.claimMilestone(m);

        const hasClaimed =
          this.gameStore.mapIndex >= 0 && this.persistStore.hasClaimedMilestone(this.gameStore.mapIndex, m);
        const base = MILESTONE_GEMS[m];
        const diffMult = this.persistStore.difficultyMultiplier;
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const mapMult = this.gameStore.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[this.gameStore.mapIndex] || 1 : 1;

        const afterDiff = Math.ceil(base * gemMult);
        const afterRegion = Math.ceil(afterDiff * mapMult);
        let afterFirstTime = afterRegion;

        if (!hasClaimed) {
          afterFirstTime = afterRegion * 2;
        }

        const breakdown = this.gameStore.gemBreakdown.milestones;
        breakdown.base += base;
        breakdown.afterDiff += afterDiff;
        breakdown.afterRegion += afterRegion;
        breakdown.afterFirstTime += afterFirstTime;

        this.persistStore.gems += afterFirstTime;
        this.gameStore.runGemsEarned += afterFirstTime;

        if (!hasClaimed && this.gameStore.mapIndex >= 0) {
          this.persistStore.markFirstTimeMilestone(this.gameStore.mapIndex, m);
        }
      }
    }

    if (this.gameStore.mapIndex >= 0) {
      this.persistStore.updateBestWave(this.gameStore.mapIndex, wave);
      if (wave >= 15) {
        this.persistStore.maybeUnlockNextMap(this.gameStore.mapIndex);
      }
    }
  }

  onWaveStart(wave: number): void {
    this.gameStore.setWave(wave);
    this.waveGraphTracker?.onWaveStart(wave);

    const towers = this.towerManager!.towers;
    const sorted = towers
      .map((tower) => ({ tower, dmg: tower.waveDamage }))
      .filter((entry) => entry.dmg > 0)
      .sort(
        (entryA, entryB) => entryB.dmg - entryA.dmg || entryB.tower.totalDamageDealt - entryA.tower.totalDamageDealt,
      )
      .slice(0, 3);
    if (sorted.length > 0) {
      this.waveTopTowers = sorted.map((entry, i) => ({
        tower: entry.tower,
        rank: i + 1,
        dmg: entry.dmg,
        startTime: performance.now(),
      }));
    }

    this.towerManager!.towers.forEach((tower) => {
      tower.waveDamage = 0;
    });

    const generalAddons = this.persistStore.generalAddons;
    const healTier = generalAddons.slowHealing;
    if (healTier !== null && healTier !== undefined) {
      const healAmount = SLOW_HEALING_PER_ROUND[healTier] || 0;
      if (this.gameStore.lives < this.startingLives) {
        const before = this.gameStore.lives;
        this.gameStore.lives = Math.min(this.gameStore.lives + healAmount, this.startingLives);
        this.totalHealingReceived += this.gameStore.lives - before;
      }
    }
  }

  onEnemyKill(enemy: Enemy): void {
    const bounty = ENEMY_TYPES[enemy.type]?.bounty || 1;
    this.waveGraphTracker?.onGoldBounty(bounty);
    this.earnGold(bounty);
  }

  earnGold(amount: number): void {
    this.totalGoldEarned += amount;
    this.gameStore.addGold(amount);
  }

  endGame(victory: boolean): void {
    const gameStore = this.gameStore;

    gameStore.selectedTower = null;
    gameStore.selectedTowerType = null;
    gameStore.hoverTile = null;
    this.enemyManager!.clear();

    this.persistStore.clearActiveWave(gameStore.mapIndex);

    const finalWave = this.waveManager!.currentWave;
    const lastLevel = Math.floor(finalWave / 10);
    const perWaveRate = Math.floor(BONUS_GEM_BASE ** lastLevel);
    const totalBonus = Math.floor((finalWave * perWaveRate) / 10);

    if (totalBonus > 0) {
      const diffMult = this.persistStore.difficultyMultiplier;
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = gameStore.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[gameStore.mapIndex] || 1 : 1;
      const afterDiff = Math.ceil(totalBonus * gemMult);
      const afterRegion = Math.ceil(afterDiff * mapMult);

      const breakdown = gameStore.gemBreakdown.waveCompletion;
      breakdown.base += totalBonus;
      breakdown.afterDiff += afterDiff;
      breakdown.afterRegion += afterRegion;
      breakdown.afterFirstTime += afterRegion;

      this.persistStore.gems += afterRegion;
      gameStore.runGemsEarned += afterRegion;
    }

    if (victory && this.waveManager!.currentWave >= VICTORY_WAVE && gameStore.mapIndex >= 0) {
      if (!this.persistStore.hasCleared(gameStore.mapIndex)) {
        const breakdown = this.gameStore.gemBreakdown;
        const subtotal =
          breakdown.bossKills.afterFirstTime +
          breakdown.milestones.afterFirstTime +
          breakdown.waveCompletion.afterFirstTime;
        const bonus = subtotal * 2;
        gameStore.gemBreakdown.firstClearBonus = bonus;
        this.persistStore.gems += bonus;
        gameStore.runGemsEarned += bonus;
        this.persistStore.markFirstClear(gameStore.mapIndex);
      }
    }

    this.persistStore.save();

    const historyEntry: Record<string, unknown> = {
      mapIndex: this.gameStore.mapIndex,
      victory,
      wave: this.waveManager!.currentWave,
      gems: gameStore.runGemsEarned,
      bossesKilled: gameStore.bossesKilledThisRun,
      bossesReachedBase: gameStore.bossesReachedBaseThisRun,
      gemBreakdown: gameStore.gemBreakdown,
      date: Date.now(),
    };

    if (this.gameStore.mapIndex === -1 && gameStore.randomMapParams) {
      historyEntry.randomMapParams = gameStore.randomMapParams;
    }

    this.persistStore.addRunToHistory(historyEntry);

    gameStore.triggerEnd(victory, {
      wave: this.waveManager!.currentWave,
      gems: gameStore.runGemsEarned,
      gemBreakdown: gameStore.gemBreakdown,
    });
  }

  private isUpgradeBtnAt(worldX: number, worldY: number): boolean {
    if (!this.gameStore.selectedTower || this.gameStore.selectedTowerType) return false;
    const selectedTower = this.gameStore.selectedTower;
    const tileSize = this.grid?.tileSize || 36;
    const buildX = (selectedTower.tileX + 1) * tileSize - 12;
    const buildY = selectedTower.tileY * tileSize + 2;
    return worldX >= buildX && worldX <= buildX + 10 && worldY >= buildY && worldY <= buildY + 10;
  }

  private lastHoverTileX: number | null = null;
  private lastHoverTileY: number | null = null;
  private lastHoverUpgradeBtn: boolean = false;

  setHover(worldX: number, worldY: number): void {
    const grid = this.grid;
    if (!grid) return;

    const tileSize = grid.tileSize;
    const tileX = Math.floor(worldX / tileSize);
    const tileY = Math.floor(worldY / tileSize);

    if (tileX !== this.lastHoverTileX || tileY !== this.lastHoverTileY) {
      this.lastHoverTileX = tileX;
      this.lastHoverTileY = tileY;
      this.gameStore.setHoverTile(grid.inBounds(tileX, tileY) ? { tileX, tileY } : null);
    }

    const hoverUpgradeBtn = this.isUpgradeBtnAt(worldX, worldY);
    if (hoverUpgradeBtn !== this.lastHoverUpgradeBtn) {
      this.lastHoverUpgradeBtn = hoverUpgradeBtn;
      this.gameStore.setHoverUpgradeBtn(hoverUpgradeBtn);
    }
  }

  handleClick(worldX: number, worldY: number): void {
    const gameStore = this.gameStore;
    if (!this.grid) return;

    const tileSize = this.grid?.tileSize || 36;
    const tx = Math.floor(worldX / tileSize),
      ty = Math.floor(worldY / tileSize);

    if (this.isUpgradeBtnAt(worldX, worldY)) {
      gameStore.upgradeBtnClickAnim = 0.4;
      this.upgradeSelected();
      return;
    }

    if (!this.grid.inBounds(tx, ty)) {
      if (gameStore.selectedTowerType) gameStore.selectBuildType(null);
      return;
    }

    if (gameStore.selectedTowerType) {
      const existing = this.towerManager?.towerAt(tx, ty);
      if (existing) {
        gameStore.selectBuildType(null);
        gameStore.selectTower(existing);
      } else {
        const meta = TOWER_META[gameStore.selectedTowerType]!;
        const discount = this.persistStore.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
        const cost = Math.floor(meta.cost * discount);
        if (gameStore.gold >= cost && this.grid.canBuild(tx, ty)) {
          const tower = this.towerManager?.build(
            gameStore.selectedTowerType,
            tx,
            ty,
            this.persistStore.$state,
            this.grid,
          );
          if (tower) {
            gameStore.setGold(gameStore.gold - cost);
            gameStore.selectTower(tower);
          }
        }
      }
    } else {
      const tower = this.towerManager?.towerAt(tx, ty);
      gameStore.selectTower(tower ?? null);
    }
  }

  getUpgradeCost(tower: Tower): number {
    const check = tower.canUpgrade(this.persistStore.$state);
    if (!check.ok) return 0;
    const cost = check.cost ?? 0;
    const ucrTier = this.persistStore.generalAddons.upgradeCostReduction;
    if (ucrTier !== null && ucrTier !== undefined) {
      const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
      return Math.floor(cost * (1 - reduction));
    }
    return cost;
  }

  canAffordUpgrade(tower: Tower): boolean {
    if (!tower) return false;
    return this.gameStore.gold >= this.getUpgradeCost(tower);
  }

  upgradeSelected(): void {
    const gameStore = this.gameStore;
    if (!gameStore.selectedTower) return;

    const tower = gameStore.selectedTower;
    const check = tower.canUpgrade(this.persistStore.$state);
    if (check.needVariant) return;
    if (!check.ok) return;

    const cost = this.getUpgradeCost(tower);
    if (gameStore.gold < cost) return;
    gameStore.setGold(gameStore.gold - cost);
    tower.doUpgrade(this.persistStore.$state, cost);
  }

  specializeSelected(variant: string): void {
    const gameStore = this.gameStore;
    if (!gameStore.selectedTower) return;

    const tower = gameStore.selectedTower;
    const lv5Cost = tower.upgradeCost(5);
    const ucrTier = this.persistStore.generalAddons.upgradeCostReduction;
    let cost = lv5Cost;
    if (ucrTier !== null && ucrTier !== undefined) {
      const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
      cost = Math.floor(cost * (1 - reduction));
    }
    if (gameStore.gold < cost) return;

    gameStore.setGold(gameStore.gold - cost);
    tower.specialize(variant as "A" | "B", this.persistStore.$state, cost);
  }

  sellSelected(): void {
    const gameStore = this.gameStore;
    if (!gameStore.selectedTower) return;

    if (this.persistStore.generalAddons.sellActive === "discount") {
      return;
    }

    const tower = gameStore.selectedTower;
    const themeStore = useMapThemeStore();
    const towerVisual = themeStore.getDefaultTowerVisual(tower.type);
    const towerName = towerVisual?.name || tower.type;
    const isRefund = this.persistStore.generalAddons.sellActive === "refund";
    const val = isRefund ? tower.totalInvested : tower.sellValue();

    const uiStore = useUiStore();
    uiStore.showConfirm({
      title: isRefund ? "Full Refund" : "Sell Tower",
      message: `${isRefund ? "Refund" : "Sell"} ${towerName} (Lv ${tower.level}) for ${val}g?`,
      confirmLabel: isRefund ? "Refund" : "Sell",
      cancelLabel: "Keep",
      onConfirm: () => this.executeSell(),
    });
  }

  executeSell(): void {
    const gameStore = this.gameStore;
    const tower = gameStore.selectedTower;
    if (tower === null) return;

    const isRefund = this.persistStore.$state.generalAddons?.sellActive === "refund";
    const val = isRefund ? tower.totalInvested : this.towerManager!.sell(tower, this.persistStore.$state);
    gameStore.setGold(gameStore.gold + val);
    this.totalGoldEarned += val;
    gameStore.selectTower(null);
  }

  cancelSelected(): void {
    const gameStore = this.gameStore;
    if (!gameStore.selectedTower) return;

    const tower = gameStore.selectedTower;
    if (!tower.canCancel()) return;

    const refund = tower.totalInvested;
    this.towerManager!.cancelBuild(tower);
    gameStore.setGold(gameStore.gold + refund);
    this.totalGoldEarned += refund;
    gameStore.selectTower(null);
  }

  downgradeSelected(): void {
    const gameStore = this.gameStore;
    if (!gameStore.selectedTower) return;
    if (gameStore.selectedTower.level <= 1) return;
    this.executeDowngrade();
  }

  executeDowngrade(): void {
    const gameStore = this.gameStore;
    const tower = gameStore.selectedTower;
    if (tower === null) return;

    const delta = this.towerManager!.downgradeTower(tower);
    const isRefund = this.persistStore.$state.generalAddons?.sellActive === "refund";
    const refund = isRefund ? delta : Math.round(delta * SELL_VALUE_RATIO);

    gameStore.setGold(gameStore.gold + refund);
  }

  setTargeting(mode: string): void {
    if (this.gameStore.selectedTower) {
      this.gameStore.selectedTower.targeting = mode;
    }
  }

  setFixedAimDir(dir: "N" | "E" | "S" | "W" | null): void {
    if (this.gameStore.selectedTower) {
      this.gameStore.selectedTower.fixedAimDir = dir;
    }
  }

  togglePause(): void {
    this.gameStore.togglePause();
  }

  cycleSpeed(): number {
    return this.gameStore.cycleSpeed();
  }

  cycleSpeedReverse(): number {
    return this.gameStore.cycleSpeedReverse();
  }

  stop(): void {
    this.gameStore.setState(GameState.MENU);
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  dispose(): void {
    this.stop();
    this.waveGraphTracker?.dispose();
  }

  cancelBuildMode(): void {
    if (this.gameStore.selectedTowerType) {
      this.gameStore.selectBuildType(null);
      this.gameStore.setHoverTile(null);
    }
  }
}
