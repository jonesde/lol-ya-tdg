import { BETWEEN_WAVES_TIMER, PRE_EMPTIVE_WAVE_TIMER, VICTORY_WAVE } from "../game/Constants.js";
import { ENEMY_TYPES, WAVE_COUNT_BASE, WAVE_COUNT_SCALE } from "../game/ConstantsEnemy.js";
import { mulberry32 } from "../grid/Map.js";

interface MapRef {
  regionId: number;
  level: number;
  bossCadence: number;
  spawns: { x: number; y: number }[];
  seed: number;
}

interface EnemyManagerRef {
  enemies: unknown[];
  spawn(type: string, level: number, spawnIndex: number, wave: number): unknown;
  getEnemiesInRange(x: number, y: number, range: number): unknown[];
}

interface WaveEntry {
  type: string;
  level: number;
  delay: number;
}

export class WaveManager {
  map: MapRef;
  regionId: number;
  enemyManager: EnemyManagerRef;
  bossCadence: number;
  currentWave: number;
  maxWaves: number;
  active: boolean;
  queue: WaveEntry[];
  spawnTimer: number;
  betweenTimer: number;
  betweenWaves: boolean;
  bossesThisWave: number;
  bossesReachedBaseThisWave: number;
  baseReached: boolean;
  waveComposition: Record<string, number>;
  rng: () => number;
  _waveGameTime: number;
  countdownActive: boolean;
  countdownTimer: number;

  constructor(map: MapRef, enemyManager: EnemyManagerRef) {
    this.map = map;
    this.regionId = map.regionId;
    this.enemyManager = enemyManager;
    this.bossCadence = map.bossCadence;
    this.rng = mulberry32(map.seed);
    this.currentWave = 0;
    this.maxWaves = VICTORY_WAVE;
    this.active = false;
    this.queue = [];
    this.spawnTimer = 0;
    this.betweenTimer = 0;
    this.betweenWaves = true;
    this.bossesThisWave = 0;
    this.bossesReachedBaseThisWave = 0;
    this.baseReached = false;
    this.waveComposition = {};
    this._waveGameTime = 0;
    this.countdownActive = false;
    this.countdownTimer = 0;
  }

  startNextWave() {
    this.currentWave++;
    this.betweenWaves = false;
    this.queue = this.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this._waveGameTime = 0;
    this.countdownActive = false;
    this.countdownTimer = 0;
    this.bossesReachedBaseThisWave = 0;
    this.bossesThisWave = this.queue.filter((entry) => entry.type === "boss").length;
    this.active = true;
    this.waveComposition = this._countTypes(this.queue);
  }

  _countTypes(queue: WaveEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of queue) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }
    return counts;
  }

  generateWave(n: number): WaveEntry[] {
    const baseCount = WAVE_COUNT_BASE + Math.floor(n * WAVE_COUNT_SCALE);
    const out: WaveEntry[] = [];
    const regionLevel = this.map.level;
    const enemyLevel = Math.max(1, Math.floor(n / 3) + regionLevel);

    for (let i = 0; i < baseCount; i++) {
      const rand = this.rng();
      let type = "minion";
      const tierThresholds = [
        { minWave: 15, threshold: 0.08, type: "healer" as const },
        { minWave: 12, threshold: 0.1, type: "shielded" as const },
        { minWave: 8, threshold: 0.1, type: "tank" as const },
        { minWave: 5, threshold: 0.08, type: "runner" as const },
      ];
      let cumulative = 0;
      for (const tier of tierThresholds) {
        cumulative += tier.threshold;
        if (n >= tier.minWave && rand < cumulative) {
          type = tier.type;
          break;
        }
      }
      out.push({ type, level: enemyLevel, delay: 0.5 + this.rng() * 0.5 });
    }

    if (n % this.bossCadence === 0) {
      const bossCount = 1 + Math.floor(n / 30);
      for (let i = 0; i < bossCount; i++) {
        out.push({ type: "boss", level: enemyLevel, delay: 2 + i * 2 });
      }
    }
    return out;
  }

  update(dt: number, onWaveCleared: ((wave: number) => void) | null, onWaveStart: ((wave: number) => void) | null) {
    if (this.betweenWaves) {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) {
        if (this.currentWave < VICTORY_WAVE) {
          this.startNextWave();
          if (onWaveStart) onWaveStart(this.currentWave);
        }
      }
      return;
    }

    this._waveGameTime += dt;

    if (this.countdownActive) {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdownActive = false;
        if (this.currentWave < VICTORY_WAVE) {
          this.startNextWave();
          if (onWaveStart) onWaveStart(this.currentWave);
        }
      }
      return;
    }

    if (!this.queue.length) {
      if (this.enemyManager.enemies.length === 0 || this._waveGameTime >= PRE_EMPTIVE_WAVE_TIMER) {
        if (onWaveCleared) onWaveCleared(this.currentWave);
        if (this.currentWave >= VICTORY_WAVE) {
          this.betweenWaves = true;
        } else {
          this.countdownActive = true;
          this.countdownTimer = BETWEEN_WAVES_TIMER;
        }
      }
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const next = this.queue.shift();
      if (!next || !ENEMY_TYPES[next.type]) {
        if (next) {
          this.waveComposition[next.type] = (this.waveComposition[next.type] || 0) - 1;
        }
        return;
      }
      const spawnIdx = Math.floor(this.rng() * this.map.spawns.length);
      this.enemyManager.spawn(next.type, next.level, spawnIdx, this.currentWave);
      this.spawnTimer = next.delay;
    }
  }

  reportBossReachedBase() {
    this.bossesReachedBaseThisWave++;
  }
}
