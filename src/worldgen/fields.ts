/**
 * Continuous climate fields.
 *
 * The world's geography is three scalar fields sampled at a coordinate —
 * elevation, moisture, temperature — and biomes are *classified* from them
 * rather than picked from a list. That single decision is what prevents
 * geographic nonsense at any scale: temperature cannot jump between neighbouring
 * cells, so a glacier can never border a salt flat, and no adjacency rule has to
 * be written to say so.
 *
 * Two consequences fall out for free:
 *  - Rain shadow: moisture is reduced downwind of high elevation, so deserts
 *    appear *behind* mountain ranges without being placed there.
 *  - Coastlines: low elevation plus high moisture is a shore, everywhere.
 *
 * Sampling is a pure function of (seed, x, y). Region (4,7) resolves identically
 * whether the player reaches it first or fiftieth — see the determinism rules in
 * the world-gen skill.
 */

import { makeRng, hashString } from '../core/rng.ts';

export interface ClimateSample {
  elevation: number;
  moisture: number;
  temperature: number;
}

const LATTICE = 256;

/**
 * Seeded value noise on a wrapping lattice, sampled with smoothstep.
 *
 * Built once per field per world seed. Not shared with any gameplay stream, so
 * adding a particle effect can never move a mountain range.
 */
function makeField(seed: number, label: string): (x: number, y: number) => number {
  const rng = makeRng(seed ^ hashString(label));
  const grid = new Float32Array(LATTICE * LATTICE);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();

  const at = (ix: number, iy: number): number =>
    grid[(((iy % LATTICE) + LATTICE) % LATTICE) * LATTICE + (((ix % LATTICE) + LATTICE) % LATTICE)]!;

  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = at(x0, y0);
    const n10 = at(x0 + 1, y0);
    const n01 = at(x0, y0 + 1);
    const n11 = at(x0 + 1, y0 + 1);
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  };
}

/** Several octaves, normalised to 0..1. */
function fbm(
  field: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 4,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += field(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

export class ClimateMap {
  private readonly elevationField: (x: number, y: number) => number;
  private readonly moistureField: (x: number, y: number) => number;
  private readonly warpField: (x: number, y: number) => number;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.elevationField = makeField(seed, 'elevation');
    this.moistureField = makeField(seed, 'moisture');
    this.warpField = makeField(seed, 'warp');
  }

  /** Sample at a world position, in region units. */
  sample(x: number, y: number): ClimateSample {
    // Domain warping breaks up the smooth blobbiness of raw fbm and is most of
    // what makes coastlines and ridgelines look natural rather than generated.
    const warpX = x + fbm(this.warpField, x * 0.35, y * 0.35, 2) * 3.5;
    const warpY = y + fbm(this.warpField, x * 0.35 + 41.7, y * 0.35 - 17.3, 2) * 3.5;

    const raw = fbm(this.elevationField, warpX * 0.18, warpY * 0.18, 5);
    // Push toward extremes so there are real lowlands and real peaks rather than
    // an undifferentiated middle.
    const elevation = clamp01(Math.pow(raw, 1.35) * 1.15);

    // Latitude gradient minus a lapse rate for altitude. The world is 64 regions
    // tall in the y axis for the purposes of climate.
    const latitude = clamp01(1 - Math.abs((y % 64) / 64 - 0.5) * 2);
    const temperature = clamp01(latitude * 0.95 - elevation * 0.45 + 0.18);

    // Rain shadow: sample elevation slightly upwind and subtract it. Wind blows
    // west-to-east, so land east of a ridge is drier — the reason real deserts
    // sit where they do.
    const upwind = fbm(this.elevationField, (warpX - 2.2) * 0.18, warpY * 0.18, 4);
    const base = fbm(this.moistureField, warpX * 0.22, warpY * 0.22, 4);
    const moisture = clamp01(base * 1.1 - Math.max(0, upwind - 0.5) * 0.9 - elevation * 0.2 + 0.1);

    return { elevation, moisture, temperature };
  }

  /** Stable per-region seed, keyed by coordinate rather than by visit order. */
  regionSeed(x: number, y: number): number {
    return (this.seed ^ hashString(`region:${x},${y}`)) >>> 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
