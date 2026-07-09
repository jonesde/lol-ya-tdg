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

const MAX_PARTICLES = 400;

export class ParticleSystem {
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
