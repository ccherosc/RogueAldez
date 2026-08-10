/**
 * The ambient music bed.
 *
 * Modal rather than major/minor: a drone plus sparse notes drawn from a church
 * mode is what makes a thing sound old and mythic instead of like a game menu.
 * Each Act picks its own mode and root, so descending is audibly a change of
 * place — Lydian's raised fourth is bright and pastoral, Phrygian's flat second
 * is unsettled, Locrian barely resolves at all.
 *
 * Layer 1: this takes plain numbers, never an Act, so audio/ stays below
 * chronicle/ in the dependency order.
 */

import { buses, pluck } from './engine.ts';

export type Mode = 'aeolian' | 'dorian' | 'phrygian' | 'lydian' | 'locrian';

/** Semitone offsets from the root. */
const MODES: Record<Mode, number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const STEP_SECONDS = 0.46;
const LOOKAHEAD_MS = 90;
const SCHEDULE_AHEAD = 0.35;

const semitone = (root: number, n: number): number => root * Math.pow(2, n / 12);

export class MusicBed {
  private mode: Mode = 'lydian';
  private root = 146.83;
  private intensity = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private step = 0;
  private drone: { osc: OscillatorType[]; nodes: OscillatorNode[]; gain: GainNode } | null = null;
  private seed = 0x1234567;

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }

  setMood(mode: Mode, root: number): void {
    const changed = mode !== this.mode || root !== this.root;
    this.mode = mode;
    this.root = root;
    if (changed) this.rebuildDrone();
  }

  /** 0 = wandering, 1 = fighting. Raises density and opens the drone filter. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  start(): void {
    const b = buses();
    if (!b || this.timer !== null) return;

    // Fade in rather than snapping on — an ambient bed that appears abruptly
    // reads as a bug.
    b.music.gain.cancelScheduledValues(b.ctx.currentTime);
    b.music.gain.setValueAtTime(0.0001, b.ctx.currentTime);
    b.music.gain.exponentialRampToValueAtTime(0.34, b.ctx.currentTime + 3.5);

    this.rebuildDrone();
    this.nextStep = b.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.pump(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const b = buses();
    if (b) {
      b.music.gain.cancelScheduledValues(b.ctx.currentTime);
      b.music.gain.exponentialRampToValueAtTime(0.0001, b.ctx.currentTime + 1.2);
    }
    this.teardownDrone();
  }

  private teardownDrone(): void {
    if (!this.drone) return;
    const b = buses();
    const stopAt = (b?.ctx.currentTime ?? 0) + 1.4;
    for (const node of this.drone.nodes) {
      try { node.stop(stopAt); } catch { /* already stopped */ }
    }
    this.drone = null;
  }

  /** Root plus fifth, low and filtered — the floor the melody sits on. */
  private rebuildDrone(): void {
    const b = buses();
    if (!b) return;
    this.teardownDrone();

    const gain = b.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.16, b.ctx.currentTime + 2.5);

    const filter = b.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;

    const nodes: OscillatorNode[] = [];
    for (const [ratio, level, type] of [
      [1, 0.5, 'sawtooth'],
      [1.5, 0.28, 'sawtooth'],
      [0.5, 0.4, 'sine'],
    ] as Array<[number, number, OscillatorType]>) {
      const osc = b.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = this.root * ratio;
      // A few cents of drift keeps the drone from sounding like a test tone.
      osc.detune.value = (this.rand() - 0.5) * 9;
      const voice = b.ctx.createGain();
      voice.gain.value = level;
      osc.connect(voice);
      voice.connect(filter);
      osc.start();
      nodes.push(osc);
    }

    filter.connect(gain);
    gain.connect(b.music);
    this.drone = { osc: [], nodes, gain };
    this.droneFilter = filter;
  }

  private droneFilter: BiquadFilterNode | null = null;

  private pump(): void {
    const b = buses();
    if (!b) return;

    if (this.droneFilter) {
      // Combat opens the filter; wandering closes it back down.
      const target = 380 + this.intensity * 900;
      this.droneFilter.frequency.setTargetAtTime(target, b.ctx.currentTime, 0.6);
    }

    while (this.nextStep < b.ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleStep(this.nextStep);
      this.nextStep += STEP_SECONDS;
      this.step++;
    }
  }

  private scheduleStep(at: number): void {
    const b = buses();
    if (!b) return;

    const scale = MODES[this.mode];
    // Sparse by default. Density rises with intensity but never becomes a tune —
    // this has to survive being heard for an hour.
    const density = 0.16 + this.intensity * 0.22;
    if (this.rand() > density) return;

    const octave = this.rand() < 0.28 ? 2 : 1;
    const degree = scale[Math.floor(this.rand() * scale.length)]!;
    const freq = semitone(this.root, degree) * 2 * octave;

    const osc = b.ctx.createOscillator();
    osc.type = this.rand() < 0.5 ? 'triangle' : 'sine';
    osc.frequency.value = freq;

    const gain = b.ctx.createGain();
    const decay = 1.1 + this.rand() * 1.4;
    pluck(b.ctx, gain, at, 0.09 + this.intensity * 0.05, decay);

    // A little space so notes sit behind the action rather than on top of it.
    const delay = b.ctx.createDelay(1.0);
    delay.delayTime.value = STEP_SECONDS * 1.5;
    const feedback = b.ctx.createGain();
    feedback.gain.value = 0.28;

    osc.connect(gain);
    gain.connect(b.music);
    gain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    feedback.connect(b.music);

    osc.start(at);
    osc.stop(at + decay + 0.1);
  }
}

export const music = new MusicBed();
