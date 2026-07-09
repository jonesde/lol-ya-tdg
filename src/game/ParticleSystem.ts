export interface ParticleGame {
  id: number;
  ox: number;
  oy: number;
  deltaX: number;
  deltaY: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface RenderParticle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  opacity: number;
}

// Sparse spawn request buffered by the worker-side spawner and shipped to the
// main thread inside the snapshot (only when non-empty). The main thread turns
// each request into live particles in its own ParticleSystem.
export interface ParticleSpawnRequest {
  x: number;
  y: number;
  color: string;
  count: number;
  speed: number;
  life: number;
}

// Shared spawner contract. `consumeSpawns` is optional: the main-thread
// ParticleSystem acts as its own spawner (spawns land directly in it) and has
// no buffer to drain, while the worker spawner buffers requests and drains
// them into the snapshot.
export interface ParticleSpawner {
  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void;
  consumeSpawns?(): ParticleSpawnRequest[] | undefined;
}

// Default no-op spawner so `new GameEngine(...)` call sites that do not supply
// a spawner (e.g. tests) stay green without a particle side channel.
export class NoopParticleSpawner implements ParticleSpawner {
  spawn(): void {
    /* noop */
  }
  consumeSpawns(): undefined {
    return undefined;
  }
}

// Worker-side spawner: records sparse spawn requests instead of simulating
// particles. buildSnapshot drains the buffer when non-empty (gated like
// `paths`), so quiet ticks ship nothing. Engine-scoped (not module-scoped) so
// per-engine buildSnapshot tests behave deterministically.
export class WorkerParticleSpawner implements ParticleSpawner {
  private buffer: ParticleSpawnRequest[] = [];

  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void {
    this.buffer.push({ x, y, color, count, speed: opts.speed ?? 60, life: opts.life ?? 0.5 });
  }

  consumeSpawns(): ParticleSpawnRequest[] | undefined {
    if (this.buffer.length === 0) return undefined;
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

const MAX_PARTICLES = 400;

export class ParticleSystem implements ParticleSpawner {
  particles: ParticleGame[];
  private nextParticleId: number;

  constructor() {
    this.particles = [];
    this.nextParticleId = 1;
  }

  spawn(
    x: number,
    y: number,
    color: string,
    count: number,
    opts: { speed?: number; life?: number; size?: number },
  ): void {
    const speed = opts.speed || 60;
    const life = opts.life || 0.5;
    const size = opts.size || 3;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const particleSpeed = speed * (0.5 + Math.random() * 0.8);
      this.particles.push({
        id: this.nextParticleId++,
        ox: x,
        oy: y,
        deltaX: Math.cos(angle) * particleSpeed,
        deltaY: Math.sin(angle) * particleSpeed,
        life: life,
        maxLife: life,
        color,
        size,
      });
    }

    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  update(dt: number): void {
    // In-place compaction instead of filter() so we don't allocate a fresh array
    // every tick (bounded by MAX_PARTICLES). Write-index swap keeps the live
    // particles packed at the front; trailing slots are dropped via length.
    let write = 0;
    for (let read = 0; read < this.particles.length; read++) {
      const particle = this.particles[read]!;
      particle.ox += particle.deltaX * dt;
      particle.oy += particle.deltaY * dt;
      particle.deltaX *= 0.98;
      particle.deltaY *= 0.98;
      particle.life -= dt;
      if (particle.life > 0) this.particles[write++] = particle;
    }
    this.particles.length = write;
  }

  getRenderData(): RenderParticle[] {
    const result: RenderParticle[] = [];
    for (const p of this.particles) {
      const lifeRatio = Math.max(0, p.life / p.maxLife);
      result.push({ id: p.id, x: p.ox, y: p.oy, color: p.color, size: p.size, opacity: lifeRatio });
    }
    return result;
  }

  clear(): void {
    this.particles = [];
  }
}
