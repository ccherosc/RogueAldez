/**
 * Particles: debris from breaking things, sparks from sword hits.
 *
 * Pooled and fixed-capacity — a burst never allocates, and running out drops the
 * oldest rather than growing. Randomness comes from a dedicated rng substream so
 * adding an effect can never shift Draft generation.
 */

import { makeRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';

const MAX_PARTICLES = 256;

export interface Particle {
  active: boolean;
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** upward velocity in the fake-Z sense; particles arc and settle */
  vz: number;
  z: number;
  life: number;
  maxLife: number;
  /** ambient drift: no gravity, no settling — leaves on the wind, motes in a crypt */
  float: boolean;
}

export interface BurstOptions {
  /** sprite family; '.0' and '.1' variants are picked per particle */
  key: string;
  count: number;
  /** pixels per frame */
  speed?: number;
  lift?: number;
  life?: number;
  /** bias the spray in a direction, e.g. away from the sword */
  dirX?: number;
  dirY?: number;
}

const GRAVITY = 0.16;

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;
  private rng: Rng;

  constructor(seed = 0x50415254) {
    this.rng = makeRng(seed).stream('fx');
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        active: false, key: '', x: 0, y: 0, vx: 0, vy: 0, vz: 0, z: 0, life: 0, maxLife: 1,
        float: false,
      });
    }
  }

  get all(): readonly Particle[] {
    return this.pool;
  }

  burst(x: number, y: number, opts: BurstOptions): void {
    const speed = opts.speed ?? 1.1;
    const lift = opts.lift ?? 1.6;
    const life = opts.life ?? 26;

    for (let i = 0; i < opts.count; i++) {
      const p = this.pool[this.cursor]!;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;

      const angle = this.rng.next() * Math.PI * 2;
      const mag = speed * (0.5 + this.rng.next() * 0.7);

      p.active = true;
      p.key = `${opts.key}.${this.rng.int(0, 1)}`;
      p.x = x + this.rng.range(-3, 3);
      p.y = y + this.rng.range(-3, 1);
      p.vx = Math.cos(angle) * mag + (opts.dirX ?? 0) * 0.5;
      p.vy = Math.sin(angle) * mag * 0.55 + (opts.dirY ?? 0) * 0.3;
      p.vz = lift * (0.6 + this.rng.next() * 0.8);
      p.z = 0;
      p.maxLife = life * (0.75 + this.rng.next() * 0.5);
      p.life = p.maxLife;
      p.float = false;
    }
  }

  /**
   * One ambient drifter — a leaf on the wind, a snowflake, an ember, a mote.
   *
   * These are what make an empty screen read as weather rather than as a pause:
   * something is always moving that is not the player and wants nothing from
   * them.
   */
  drift(x: number, y: number, key: string, vx: number, vy: number, life = 200): void {
    const p = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.active = true;
    p.float = true;
    p.key = key;
    p.x = x;
    p.y = y;
    p.vx = vx + this.rng.range(-0.08, 0.08);
    p.vy = vy + this.rng.range(-0.05, 0.05);
    p.vz = 0;
    p.z = 4 + this.rng.range(0, 12);
    p.maxLife = life * (0.7 + this.rng.next() * 0.6);
    p.life = p.maxLife;
  }

  update(): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      if (p.float) {
        // A slow sway across the drift direction, so leaves tumble rather than
        // travel in ruled lines.
        p.x += p.vx + Math.sin(p.life / 22) * 0.18;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) p.active = false;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vz -= GRAVITY;
      if (p.z < 0) {
        // Settle on the ground rather than sinking through it.
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      p.life--;
      if (p.life <= 0) p.active = false;
    }
  }

  /** Fade over the last third of life, so debris dissolves instead of popping. */
  alphaOf(p: Particle): number {
    const t = p.life / p.maxLife;
    return t > 0.34 ? 1 : t / 0.34;
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
  }
}
