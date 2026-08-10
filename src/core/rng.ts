/**
 * Seeded deterministic RNG. Nothing in src/ may call Math.random().
 *
 * sfc32 — small, fast, passes PractRand, and trivially reproducible across
 * machines because it is pure 32-bit integer math.
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  /** float in [min, max) */
  range(min: number, max: number): number;
  /** true with probability p */
  chance(p: number): boolean;
  /** uniform pick */
  pick<T>(items: readonly T[]): T;
  /** in-place Fisher-Yates */
  shuffle<T>(items: T[]): T[];
  /** an independent, named substream — see the determinism rules in aldez-architecture */
  stream(name: string): Rng;
}

/** FNV-1a — turns a stream name into a 32-bit seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  return buildSfc32(0x9e3779b9, seed, seed ^ 0x6d2b79f5, 1);
}

function buildSfc32(sa: number, sb: number, sc: number, sd: number): Rng {
  let a = sa >>> 0;
  let b = sb >>> 0;
  let c = sc >>> 0;
  let d = sd >>> 0;

  const raw = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };

  // Discard the first values so low-entropy seeds decorrelate.
  for (let i = 0; i < 12; i++) raw();

  const rng: Rng = {
    next: () => raw() / 4294967296,
    int: (min, max) => min + Math.floor((raw() / 4294967296) * (max - min + 1)),
    range: (min, max) => min + (raw() / 4294967296) * (max - min),
    chance: (p) => raw() / 4294967296 < p,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor((raw() / 4294967296) * items.length)]!;
    },
    shuffle: <T,>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor((raw() / 4294967296) * (i + 1));
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },
    stream: (name: string) => buildSfc32(hashString(name), sb ^ hashString(name), sc, sd),
  };

  return rng;
}
