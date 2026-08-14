/**
 * Sound effects, synthesised per event.
 *
 * Wired to the core event bus rather than called from the scene, so audio stays
 * a layer-1 subsystem that game/ never has to know about. Nothing here reaches
 * back into the simulation.
 */

import { bus } from '../core/bus.ts';
import { buses, noise, pluck } from './engine.ts';

type Voice = (t: number) => void;

function play(build: Voice): void {
  const b = buses();
  if (!b) return;
  build(b.ctx.currentTime);
}

/** Filtered noise burst — the basis of every impact. */
function hit(freq: number, decay: number, peak: number, q = 1): void {
  play((t) => {
    const b = buses();
    if (!b) return;
    const src = b.ctx.createBufferSource();
    src.buffer = noise(b.ctx);
    const filter = b.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = b.ctx.createGain();
    pluck(b.ctx, gain, t, peak, decay);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(b.sfx);
    src.start(t);
    src.stop(t + decay + 0.05);
  });
}

/** A pitched blip. `slide` sweeps the pitch over the note's life. */
function tone(
  freq: number,
  decay: number,
  peak: number,
  type: OscillatorType = 'triangle',
  slide = 1,
): void {
  play((t) => {
    const b = buses();
    if (!b) return;
    const osc = b.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + decay);
    const gain = b.ctx.createGain();
    pluck(b.ctx, gain, t, peak, decay);
    osc.connect(gain);
    gain.connect(b.sfx);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  });
}

export const sfx = {
  /** Airy, not metallic — the swing is the wind, the clang is the connect. */
  swing: (): void => hit(2200, 0.11, 0.16, 0.8),
  hitFlesh: (): void => { hit(420, 0.13, 0.30, 1.4); tone(180, 0.10, 0.14, 'square', 0.5); },
  hitBlocked: (): void => { tone(1400, 0.16, 0.22, 'square', 1.6); hit(3000, 0.09, 0.14, 3); },
  breakPot: (): void => hit(1500, 0.20, 0.28, 0.6),
  breakBush: (): void => hit(3800, 0.16, 0.18, 0.5),
  enemyDie: (): void => { hit(300, 0.28, 0.30, 0.9); tone(240, 0.26, 0.16, 'sawtooth', 0.35); },
  pickup: (): void => { tone(880, 0.09, 0.16); setTimeout(() => tone(1320, 0.12, 0.14), 55); },
  heart: (): void => { tone(660, 0.10, 0.16); setTimeout(() => tone(990, 0.16, 0.15), 70); },
  hurt: (): void => { tone(300, 0.24, 0.30, 'sawtooth', 0.4); hit(700, 0.18, 0.18, 1.2); },
  lift: (): void => tone(420, 0.09, 0.13, 'sine', 1.5),
  throw: (): void => hit(1200, 0.10, 0.16, 1.0),
  /** Heavy and final — the room just decided you are staying. */
  bars: (): void => { tone(90, 0.5, 0.34, 'square', 0.7); hit(260, 0.4, 0.24, 0.7); },
  /** Rising fourth. The one unambiguously good sound in the game. */
  cleared: (): void => {
    tone(523.25, 0.16, 0.18);
    setTimeout(() => tone(698.46, 0.16, 0.18), 90);
    setTimeout(() => tone(1046.5, 0.34, 0.20), 180);
  },
  descend: (): void => {
    tone(392, 0.24, 0.18, 'sine', 0.5);
    setTimeout(() => tone(261.63, 0.44, 0.18, 'sine', 0.5), 130);
  },
  /** The Bell of First Dawn, ringing backward. */
  death: (): void => {
    tone(196, 0.9, 0.30, 'sine', 1.6);
    setTimeout(() => tone(146.83, 1.3, 0.26, 'sine', 1.4), 180);
  },
  relic: (): void => {
    tone(587.33, 0.2, 0.18, 'triangle');
    setTimeout(() => tone(880, 0.3, 0.18, 'triangle'), 110);
    setTimeout(() => tone(1174.66, 0.5, 0.16, 'sine'), 230);
  },
  menuMove: (): void => tone(660, 0.05, 0.10, 'square'),

  /**
   * Stairs. A short run of footfalls on stone, pitched down when descending.
   *
   * The old descent was a two-note tone that read as a menu confirm. Feet on
   * steps tell the player they *travelled* rather than teleported, which is most
   * of what makes a floor change feel like a change of place.
   */
  stairs: (down: boolean): void => {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const k = down ? i : steps - 1 - i;
      setTimeout(() => {
        hit(760 - k * 55, 0.07, 0.13, 2.4);
        if (i === steps - 1) tone(down ? 174.61 : 261.63, 0.4, 0.15, 'sine', down ? 0.7 : 1.3);
      }, i * 105);
    }
  },

  /** Crossing a threshold into somewhere inhabited — a gate, a town wall. */
  enterTown: (): void => {
    tone(392, 0.28, 0.16, 'triangle');
    setTimeout(() => tone(523.25, 0.28, 0.16, 'triangle'), 120);
    setTimeout(() => tone(659.25, 0.5, 0.17, 'sine'), 250);
  },

  /**
   * A blast. Bombs were borrowing the enemy-death sound, which is thin and
   * pitched and reads as "something small popped" — the one moment in the game
   * with real physical force had the least of it.
   *
   * Three layers, because an explosion is three events: a crack at the front, a
   * body of noise, and a low drop that arrives fractionally late the way real
   * pressure does.
   */
  blast: (): void => {
    hit(2600, 0.06, 0.30, 0.7);
    hit(320, 0.55, 0.42, 0.5);
    tone(120, 0.7, 0.34, 'sine', 0.28);
    setTimeout(() => hit(180, 0.5, 0.20, 0.6), 40);
  },

  /**
   * A footstep. Barely audible on its own and enormous in aggregate — nothing
   * else makes a world feel like ground rather than a floor texture. Kept low
   * and short so forty a minute never becomes noticeable.
   */
  step: (variant: number): void => hit(variant === 0 ? 900 : 1150, 0.045, 0.045, 2.2),

  /**
   * Waking. The Bell of First Dawn, forward — the exact inverse of `death`,
   * which rings it backward. Canon says the bell runs backward when reality
   * breaks; this is what it sounds like when reality has just been rewritten and
   * is, for the moment, holding.
   */
  wake: (): void => {
    tone(146.83, 1.1, 0.22, 'sine', 1.35);
    setTimeout(() => tone(196, 0.9, 0.20, 'sine', 1.5), 200);
  },
};

let wired = false;

/** Subscribe the sound effects to game events. Idempotent. */
export function wireSfx(): void {
  if (wired) return;
  wired = true;

  bus.on('prop:broken', (e) => {
    if (e.kind.includes('bush')) sfx.breakBush();
    else sfx.breakPot();
  });
  bus.on('entity:died', () => sfx.enemyDie());
  bus.on('player:damaged', () => sfx.hurt());
  bus.on('player:blocked', () => sfx.hitBlocked());
  bus.on('room:barred', () => sfx.bars());
  bus.on('room:cleared', () => sfx.cleared());
}
