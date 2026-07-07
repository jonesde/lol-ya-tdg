// @ts-nocheck
interface Particle {
  x: number;
  y: number;
  color: string;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  removed: boolean;
}

interface SpawnRecord {
  x: number;
  y: number;
  color: string;
  count: number;
  speed?: number;
  life?: number;
}

interface ParticleSystem {
  spawns: SpawnRecord[];
  particles: Particle[];
  spawn(x: number, y: number, color: string, count: number, opts?: { speed?: number; life?: number }): void;
  update(dt: number): void;
  render(): void;
}

interface SoundRecord {
  plays: string[];
  playSound(name: string): void;
  dispose(): void;
}

export function makeParticleSystem(): ParticleSystem {
  const spawns: SpawnRecord[] = [];
  const particles: Particle[] = [];
  return {
    spawns,
    particles,
    spawn(x, y, color, count, opts) {
      spawns.push({ x, y, color, count, ...opts });
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x,
          y,
          color,
          vx: (Math.random() - 0.5) * (opts?.speed || 50),
          vy: (Math.random() - 0.5) * (opts?.speed || 50),
          life: opts?.life || 0.5,
          maxLife: opts?.life || 0.5,
          removed: false,
        });
      }
    },
    update(dt: number) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const particle = this.particles[i];
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
        if (particle.life <= 0) this.particles.splice(i, 1);
      }
    },
    render() {
      /* noop */
    },
  };
}

export function makeSoundManager(): SoundRecord {
  const plays: string[] = [];
  return {
    plays,
    playSound(name: string) {
      plays.push(name);
    },
    dispose() {
      plays.length = 0;
    },
  };
}
