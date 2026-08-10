/**
 * Web Audio plumbing. No sound files — every voice here is synthesised, the same
 * rule the art follows.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the whole
 * graph is built lazily on the first keypress and everything before that is a
 * silent no-op rather than an error.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let unlocked = false;

export interface AudioBuses {
  ctx: AudioContext;
  sfx: GainNode;
  music: GainNode;
}

/** Called on the first real input. Safe to call repeatedly. */
export function unlockAudio(): void {
  if (unlocked) {
    void ctx?.resume();
    return;
  }
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? Reflect.get(window, 'webkitAudioContext');
  if (!Ctor) return;

  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.55;

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.0; // faded in by the music bed

  // A gentle limiter keeps a burst of simultaneous hits from clipping, which on
  // synthesised square waves is genuinely painful.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 12;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  unlocked = true;
  void ctx.resume();
}

export function buses(): AudioBuses | null {
  if (!ctx || !sfxBus || !musicBus || ctx.state === 'closed') return null;
  return { ctx, sfx: sfxBus, music: musicBus };
}

export function isReady(): boolean {
  return unlocked && ctx !== null && ctx.state === 'running';
}

export function setMasterVolume(v: number): void {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

export function masterVolume(): number {
  return master?.gain.value ?? 0;
}

/**
 * A short burst of white noise, generated once and reused.
 *
 * Impacts, breaks and footsteps are all shaped noise; making a fresh buffer per
 * hit would allocate constantly during combat.
 */
let noiseBuffer: AudioBuffer | null = null;
export function noise(context: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  const length = Math.floor(context.sampleRate * 0.5);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise: audio should not be a source of nondeterminism.
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

/** Percussive envelope: instant attack, exponential tail. */
export function pluck(
  context: AudioContext,
  gain: GainNode,
  at: number,
  peak: number,
  decay: number,
): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
}
