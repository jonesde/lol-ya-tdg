import type { GameRunState } from "@/sim/GameRunState.js";
import type { PersistState } from "@/sim/PersistState.js";
import type { WaveGraphDot } from "@/sim/SimulationSnapshot.js";
import {
  WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN,
  WAVE_GRAPH_COLOR_BASE_HEALTH_RED,
  WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW,
  WAVE_GRAPH_DOT_SPACING,
  WAVE_GRAPH_INTERVAL_SECONDS,
  WAVE_GRAPH_WIDTH,
} from "./Constants.js";

interface TowerManagerRef {
  towers: { totalDamageDealt: number }[];
}

interface EnemyManagerRef {
  enemies: { hp: number }[];
}

export class WaveGraphTracker {
  private runState: GameRunState;
  private persistState: PersistState;
  private towerManager: TowerManagerRef;
  private enemyManager: EnemyManagerRef;

  private _gameTimeAccum: number = 0;
  private _dots: WaveGraphDot[] = [];
  private _containerWidth: number = 0;
  private _maxDots: number = 0;
  private _prevTotalDamage: number = 0;
  private _prevGems: number = 0;
  private _intervalDamage: number = 0;
  private _intervalPeakEnemyHp: number = 0;
  private _intervalGold: number = 0;
  private _intervalGems: number = 0;
  private _intervalMinLives: number = 0;
  private _waveStartThisInterval: boolean = false;
  private _lastKnownWave: number = 0;
  // Bumped whenever the dots array changes shape (push or front-trim) so the
  // serializer can ship the array only on the ticks where it actually changed,
  // not every posted frame. Mirrors the grid pathVersion gating.
  private _generation: number = 0;

  constructor(
    runState: GameRunState,
    persistState: PersistState,
    towerManager: TowerManagerRef,
    enemyManager: EnemyManagerRef,
  ) {
    this.runState = runState;
    this.persistState = persistState;
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;

    this._containerWidth = WAVE_GRAPH_WIDTH;
    this._maxDots = Math.ceil(this._containerWidth / WAVE_GRAPH_DOT_SPACING);
    this._prevTotalDamage = this._sumTotalDamage();
    this._prevGems = persistState.gems;
    this._intervalMinLives = runState.lives;
  }

  update(dt: number): void {
    this._gameTimeAccum += dt;

    const currentGems = this.persistState.gems;
    const gemDelta = currentGems - this._prevGems;
    if (gemDelta > 0) {
      this._intervalGems += gemDelta;
    }
    this._prevGems = currentGems;

    if (this.runState.lives < this._intervalMinLives) {
      this._intervalMinLives = this.runState.lives;
    }

    const currentEnemyHpSum = this._sumEnemyHp();
    if (currentEnemyHpSum > this._intervalPeakEnemyHp) {
      this._intervalPeakEnemyHp = currentEnemyHpSum;
    }

    if (this._gameTimeAccum >= WAVE_GRAPH_INTERVAL_SECONDS) {
      this._flushInterval();
    }
  }

  onGoldBounty(amount: number): void {
    this._intervalGold += amount;
  }

  onWaveStart(wave: number): void {
    if (wave !== this._lastKnownWave) {
      this._waveStartThisInterval = true;
      this._lastKnownWave = wave;
    }
  }

  setContainerWidth(width: number): void {
    this._containerWidth = width;
    const newMaxDots = Math.ceil(width / WAVE_GRAPH_DOT_SPACING);
    if (newMaxDots < this._maxDots) {
      this._dots.splice(0, this._dots.length - newMaxDots);
    }
    this._maxDots = newMaxDots;
  }

  getDots(): WaveGraphDot[] {
    return this._dots;
  }

  getGeneration(): number {
    return this._generation;
  }

  dispose(): void {
    this._dots = [];
    this._generation++;
  }

  private _flushInterval(): void {
    const currentDamage = this._sumTotalDamage();
    this._intervalDamage = Math.max(0, currentDamage - this._prevTotalDamage);
    this._prevTotalDamage = currentDamage;

    const baseHealthColor = this._computeBaseHealthColor(this._intervalMinLives);

    const dot: WaveGraphDot = {
      damage: Math.round(this._intervalDamage),
      peakEnemyHp: Math.round(this._intervalPeakEnemyHp),
      gold: Math.round(this._intervalGold),
      gems: Math.round(this._intervalGems),
      baseHealth: this._intervalMinLives,
      baseHealthColor,
      waveStart: this._waveStartThisInterval,
    };

    this._dots.push(dot);
    if (this._dots.length > this._maxDots) {
      this._dots.splice(0, this._dots.length - this._maxDots);
    }
    this._generation++;
    this._gameTimeAccum = 0;
    this._intervalDamage = 0;
    this._intervalPeakEnemyHp = 0;
    this._intervalGold = 0;
    this._intervalGems = 0;
    this._intervalMinLives = this.runState.lives;
    this._waveStartThisInterval = false;
  }

  private _computeBaseHealthColor(lives: number): string {
    if (lives >= 11) return WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN;
    if (lives >= 6) return WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW;
    return WAVE_GRAPH_COLOR_BASE_HEALTH_RED;
  }

  private _sumTotalDamage(): number {
    let total = 0;
    for (const tower of this.towerManager.towers) {
      total += tower.totalDamageDealt;
    }
    return total;
  }

  private _sumEnemyHp(): number {
    let total = 0;
    for (const enemy of this.enemyManager.enemies) {
      total += enemy.hp;
    }
    return total;
  }
}
