/**
 * Tile generators. Every tile is 16x16, drawn by a pure function of (rng, variant).
 *
 * Tiles are *terrain only*. Props (pots, bushes, chests, torches) are sprites, not
 * tiles — a tile draws from a single palette, and a prop almost always needs colors
 * from a different one. Making props sprites also makes them destructible entities
 * later, which is where they need to end up anyway.
 */

import { ART_SCALE } from '../core/const.ts';
import { makeRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import { PixelBuffer, makeFbm, makeNoise, scatter } from './pixels.ts';
import { ci, PAL_DUNGEON, PAL_TERRAIN, PAL_PROP } from './palettes.ts';
import type { Palette } from './palettes.ts';

/** A tile in *world* pixels — the unit the simulation moves in. Never changes. */
export const TILE = 16;

/**
 * A tile in *texels* — the resolution the art is drawn at.
 *
 * Tile generators are field-sampled (noise, ramps, geometry), so raising the
 * canvas and shrinking the sample step produces genuine new detail rather than a
 * bigger version of the same marks: individual grass blades, finer wave crests,
 * hairline mortar, real bevels on brick. This is authored HD, not an upscale.
 */
export const TILE_TEX = TILE * ART_SCALE;

/**
 * The generators below were authored against a 2-texel world pixel. These keep
 * them resolution-independent so ART_SCALE can move without re-tuning by hand:
 * lengths scale linearly, scatter counts scale by area, and noise sample steps
 * scale with length so the *feature size in world pixels* never changes.
 */
const U = ART_SCALE / 2;
/** a length authored at 2x, in texels at the current density */
const len = (nAt2x: number): number => Math.max(1, Math.round(nAt2x * U));
/** a scatter count authored at 2x, corrected for area */
const dens = (nAt2x: number): number => Math.max(1, Math.round(nAt2x * U * U));

export interface TileGen {
  key: string;
  palette: Palette;
  variants: number;
  draw(px: PixelBuffer, rng: Rng, variant: number): void;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function drawGrass(px: PixelBuffer, rng: Rng): void {
  const p = PAL_TERRAIN;
  const g = (n: number) => ci(p, `grass.${n * 2}`);

  // Flat base, deliberately. An earlier version filled from two-octave noise
  // across two midtones; over a full screen that read as camouflage, because
  // large-scale value variation plus per-variant noise seeds patchworks at the
  // tile scale. ALTTP grass is essentially one colour — all of the interest lives
  // in small repeated tuft motifs, which is what the detail passes below are.
  px.fill(g(2));
  const T = TILE_TEX;

  // Blade tufts drawn as actual blades: a stem with a wind-bent lit tip and a
  // root shadow. At HD density the stem is several texels, so it tapers.
  const blade = len(2);
  for (const [x, y] of scatter(rng, T, dens(9), len(6))) {
    const lean = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < blade; i++) {
      px.set((x + Math.floor((i * lean) / 2) + T) % T, (y + i) % T, g(3));
    }
    // Lit tip, bent by the wind.
    px.set((x + lean * blade + T) % T, (y - 1 + T) % T, g(4));
    px.set((x + lean + T) % T, (y - 1 + T) % T, g(4));
    // Root shadow keeps the tuft sitting *in* the field rather than on it.
    for (let i = 0; i < len(1); i++) px.set(x, (y + blade + i) % T, g(1));
  }

  // Darker blades between the lit tufts, for depth.
  for (const [x, y] of scatter(rng, T, dens(5), len(7))) {
    for (let i = 0; i < blade; i++) px.set(x, (y + i) % T, g(1));
    px.set((x + 1) % T, (y + blade - 1) % T, g(1));
  }

  // The odd clover speck.
  for (let c = 0; c < dens(1); c++) {
    if (!rng.chance(0.5)) continue;
    const bx = rng.int(2, T - 4);
    const by = rng.int(2, T - 4);
    for (let i = 0; i < len(1); i++) {
      px.set(bx + i, by, g(4));
      px.set(bx + i, by + 1, g(3));
    }
  }
}

function drawDirt(px: PixelBuffer, rng: Rng): void {
  const p = PAL_TERRAIN;
  const d = (n: number) => ci(p, `dirt.${n * 2}`);
  const noise = makeNoise(rng, 8);

  // Same lesson as grass: a mid-tone base with restrained speckling. Three-way
  // thresholding on low-frequency noise produced dark blotches that read as
  // potholes rather than a trodden path.
  px.fill(d(1));
  const T = TILE_TEX;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      // Same world-scale mottling, sampled at texel density so the grain is
      // finer than any single world pixel could carry.
      const v = noise(x / len(8), y / len(8));
      if (v > 0.74) px.set(x, y, d(2));
      else if (v < 0.2) px.set(x, y, d(0));
    }
  }

  // Pebbles get a full form: lit crown, mid flank, cast shadow.
  const r = len(1);
  for (const [x, y] of scatter(rng, T, dens(6), len(7))) {
    for (let i = 0; i < r * 2; i++) {
      for (let j = 0; j < r * 2; j++) {
        const tx = (x + i) % T;
        const ty = (y + j) % T;
        const lit = i + j < r;
        const low = i + j > r * 2.2;
        px.set(tx, ty, lit ? d(2) : low ? d(0) : d(1));
      }
    }
    for (let i = 0; i < r * 2; i++) px.set((x + i) % T, (y + r * 2) % T, d(0));
  }
}

/**
 * Water is 4 spatial variants x 2 animation frames, packed as `spatial * 2 + frame`.
 *
 * The spatial variants matter more than they look. With a single tile, a pond is
 * that one tile repeated perfectly, and *any* structure in it becomes a visible
 * lattice — the pond reads as patterned wallpaper no matter how good the tile is.
 * The noise seed therefore depends only on `spatial`, so the two animation frames
 * of a variant are the same water moving rather than two different waters.
 */
function drawWater(px: PixelBuffer, _rng: Rng, variant: number): void {
  const p = PAL_TERRAIN;
  const w = (n: number) => ci(p, `water.${n * 2}`);
  const spatial = variant >> 1;
  const frame = variant & 1;
  const rng = makeRng(0x57415445 + spatial); // 'WATE'
  const noise = makeNoise(rng, 8);

  // Flat base with irregular ripples. A strong periodic sine wave tiles into an
  // unmistakable repeating scallop — it reads as patterned wallpaper rather than
  // water, and it is far more obvious across a whole pond than on one tile.
  px.fill(w(1));
  const T = TILE_TEX;

  // Scroll the sampling window rather than re-rolling the pattern.
  const shift = frame * len(6);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      // Tight thresholds: ripples are accents on a flat surface, not a texture
      // covering it. Texel sampling gives the crests thin, drawn-out edges.
      const n = noise((x + shift) / len(10), y / len(6));
      if (n > 0.8) px.set(x, y, w(2));
      else if (n < 0.18) px.set(x, y, w(0));
    }
  }

  // Surface glints: long thin dashes with a trailing fade — the classic SNES
  // water motif, now with room to actually taper.
  const glint = len(5);
  for (const [gx, gy] of scatter(rng, T, dens(4), len(9))) {
    const x0 = (gx + shift) % T;
    for (let i = 0; i < glint; i++) px.set((x0 + i) % T, gy, w(2));
    for (let i = 0; i < len(1); i++) px.set((x0 + glint + i) % T, gy, w(1));
    // A second, shorter crest just below reads as a wave rather than a scratch.
    for (let i = 0; i < Math.max(1, glint - len(2)); i++) {
      px.set((x0 + len(2) + i) % T, (gy + len(1)) % T, w(1));
    }
  }
}

// ---------------------------------------------------------------------------
// Dungeon
// ---------------------------------------------------------------------------

function drawDungeonFloor(px: PixelBuffer, rng: Rng): void {
  const p = PAL_DUNGEON;
  const f = (n: number) => ci(p, `floor.${n * 2}`);
  const mortar = ci(p, 'mortar');

  // One large flagstone per tile, with mortar only on the tile edges. Four small
  // stones each lipped on all four sides reads as a grid of buttons, not a floor —
  // ALTTP dungeon floors are big slabs with restrained seams.
  const T = TILE_TEX;
  const noise = makeNoise(rng, 8);
  const base = rng.pick([f(1), f(2), f(2)] as const);
  const speck = base === f(1) ? f(2) : f(3);
  const m = len(1);
  for (let y = m; y < T; y++) {
    for (let x = m; x < T; x++) {
      // Texel-density stone grain — visible as texture, far below dither.
      const n = noise(x / len(10), y / len(10));
      px.set(x, y, n > 0.68 ? speck : n < 0.24 ? f(1) : base);
    }
  }

  // Mortar seam, then a lit lip below it and a shaded one at the foot: at HD
  // density the seam is a *carved* joint with real depth rather than one line.
  for (let i = 0; i < m; i++) {
    px.hline(0, i, T, mortar);
    px.vline(i, 0, T, mortar);
    px.hline(m, m + i, T - m, f(3));
    px.vline(m + i, m, T - m, f(3));
    px.hline(m, T - 1 - i, T - m, f(0));
  }
  for (let i = 0; i < m; i++) px.hline(m, T - m - 1 - i, T - m, f(1));

  // Weathering: a fracture with a lit edge, wandering down the slab.
  if (rng.chance(0.3)) {
    let cx = rng.int(len(8), T - len(10));
    const cy = rng.int(len(6), len(14));
    const run = rng.int(len(5), len(9));
    for (let i = 0; i < run && cy + i < T; i++) {
      for (let t = 0; t < m; t++) {
        px.set(cx + t, cy + i, f(0));
        px.set(cx + m + t, cy + i, f(3));
      }
      if (rng.chance(0.4)) cx += rng.int(-1, 1);
    }
  }
}

function drawDungeonWall(px: PixelBuffer, rng: Rng): void {
  const p = PAL_DUNGEON;
  const w = (n: number) => ci(p, `wall.${n * 2}`);
  const mortar = ci(p, 'mortar');

  px.fill(mortar);
  const T = TILE_TEX;
  const grain = makeNoise(rng, 8);

  // Four courses per tile, half-brick offset. At HD the bevel is several texels
  // deep, so each brick is a solid with a lit top-left and a shadowed underside
  // rather than a rectangle with a highlight line.
  const course = Math.floor(T / 4);
  const brick = course * 2;
  const bevel = len(1);
  for (let r = 0; r < 4; r++) {
    const y = r * course;
    const offset = r % 2 === 0 ? 0 : -brick / 2;
    for (let bx = offset; bx < T; bx += brick) {
      const shade = rng.pick([w(1), w(1), w(2), w(2), w(3)]);
      const top = y + bevel;
      const bottom = y + course - bevel;
      for (let yy = top; yy < bottom; yy++) {
        for (let xx = bx; xx < bx + brick - bevel; xx++) {
          const tx = ((xx % T) + T) % T;
          const n = grain(tx / len(6), yy / len(6));
          px.set(tx, yy, n > 0.78 ? w(3) : n < 0.2 ? w(0) : shade);
        }
      }
      for (let t = 0; t < bevel; t++) {
        for (let xx = bx; xx < bx + brick - bevel; xx++) {
          const tx = ((xx % T) + T) % T;
          px.set(tx, top + t, w(3));              // lit top bevel
          px.set(tx, bottom - 1 - t, w(0));       // shadowed underside
        }
        px.vline(((bx + t) % T + T) % T, top, bottom - top, w(3)); // lit left edge
      }
    }
  }
}

/**
 * Dense canopy. A *barrier* tile, not decoration — this is what a forest edge is
 * made of when water would be wrong.
 *
 * Drawn as overlapping crowns rather than one mass so a wall of it reads as many
 * trees rather than as green concrete.
 */
function drawTrees(px: PixelBuffer, rng: Rng): void {
  const p = PAL_TERRAIN;
  const g = (n: number) => ci(p, `grass.${n * 2}`);

  px.fill(g(0));
  const T = TILE_TEX;
  // Crowns at texel density, with an extra ring of mid-tone between light and
  // shadow so each canopy is a sphere rather than a two-tone disc.
  for (const [cx0, cy0, r0] of [[8, 10, 10], [22, 8, 8], [16, 22, 10], [3, 24, 7]] as const) {
    const cx = len(cx0);
    const cy = len(cy0);
    const r = len(r0);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d2 = x * x + y * y;
        if (d2 > r * r) continue;
        const tx = ((cx + x) % T + T) % T;
        const ty = ((cy + y) % T + T) % T;
        const lit = x + y < -r * 0.5;
        const mid = x + y < r * 0.2;
        const rim = d2 > r * r * 0.68;
        px.set(tx, ty, lit ? g(3) : mid ? g(2) : rim ? g(0) : g(1));
      }
    }
  }
  // Leaf clusters catching light on the crowns — small groups, not single dots,
  // so a canopy reads as foliage at HD instead of as noise.
  for (const [x, y] of scatter(rng, T, dens(10), len(5))) {
    for (let i = 0; i < len(1); i++) {
      px.set((x + i) % T, y, g(3));
      px.set((x + i + len(1)) % T, y, g(4));
      px.set((x + i) % T, (y + 1) % T, g(3));
    }
  }
}

/** Rock face. The barrier for mountains, where a moat would look absurd. */
function drawCliff(px: PixelBuffer, rng: Rng): void {
  const p = PAL_DUNGEON;
  const w = (n: number) => ci(p, `wall.${n * 2}`);
  const noise = makeNoise(rng, 8);

  const T = TILE_TEX;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = noise(x / len(10), y / len(10));
      px.set(x, y, n > 0.66 ? w(2) : n < 0.3 ? w(0) : w(1));
    }
  }
  // Fracture lines with a lit right edge — strata, not scratches.
  const thick = len(1);
  for (let i = 0; i < dens(4); i++) {
    let cx = rng.int(2, T - 3);
    for (let y = 0; y < T; y++) {
      for (let t = 0; t < thick; t++) {
        px.set((cx + t) % T, y, w(0));
        px.set((cx + thick + t) % T, y, w(2));
      }
      if (rng.chance(0.3)) cx = (cx + rng.int(-1, 1) + T) % T;
    }
  }
  // Lit top lip, fading down — the edge that reads as a face rather than a wall.
  for (let i = 0; i < thick; i++) px.hline(0, i, T, w(3));
  for (let i = 0; i < thick; i++) px.hline(0, thick + i, T, w(2));
}

/**
 * A tiled roof, seen from above.
 *
 * The single biggest thing separating a town from a dungeon: you look *down* on
 * a house, so what you see is its roof, not the inside of its walls. Rendering
 * buildings as hollow wall outlines — which is what a dungeon room is — made
 * Amberwake read as a ruin with furniture even in its good years.
 *
 * Courses of overlapping tiles running down the slope, each with a lit upper lip
 * and a shadow where the next course laps over it.
 */
/**
 * A tiled roof seen from above.
 *
 * The three variants are three *materials*, not three noise seeds — fired clay,
 * slate, and thatch. A street of houses is the one place variety has to
 * be visible from across the screen, and shuffling the same brown three ways is
 * not visible from anywhere.
 */
const ROOF_RAMPS = ['wood', 'stone', 'thatch'] as const;

function drawRoof(px: PixelBuffer, rng: Rng, variant: number): void {
  const p = PAL_PROP;
  const ramp = ROOF_RAMPS[variant % ROOF_RAMPS.length]!;
  const w = (n: number) => ci(p, `${ramp}.${n * 2}`);
  const T = TILE_TEX;
  const course = len(4);
  const tileW = len(5);

  px.fill(w(1));
  for (let row = 0; row * course < T; row++) {
    const y = row * course;
    // Half-lap the alternate courses, the way real tiles are laid.
    const offset = row % 2 === 0 ? 0 : Math.floor(tileW / 2);
    for (let x = -offset; x < T; x += tileW) {
      const shade = rng.pick([w(1), w(1), w(2), w(0)]);
      for (let yy = y; yy < Math.min(T, y + course - 1); yy++) {
        for (let xx = x; xx < x + tileW - 1; xx++) {
          px.set(((xx % T) + T) % T, yy, shade);
        }
      }
      // Lit ridge along the top of each tile, shadow in the lap below it.
      for (let t = 0; t < len(1); t++) {
        for (let xx = x; xx < x + tileW - 1; xx++) {
          px.set(((xx % T) + T) % T, y + t, w(2));
          if (y + course - 1 - t < T) px.set(((xx % T) + T) % T, y + course - 1 - t, w(0));
        }
      }
      // The vertical joint between neighbouring tiles.
      px.vline(((x % T) + T) % T, y, course, w(0));
    }
  }
}

/**
 * Cobbles. A street the player can tell from a dungeon floor at a glance —
 * rounded stones with mortar between, rather than cut slabs with a seam grid.
 */
function drawCobble(px: PixelBuffer, rng: Rng): void {
  // Prop stone rather than dungeon floor: the dungeon ramp bottoms out near
  // black, which made a market street read as a hole in the ground.
  const p = PAL_PROP;
  const f = (n: number) => ci(p, `stone.${n * 2}`);
  const T = TILE_TEX;
  const r = len(2);

  px.fill(f(0));
  for (let row = 0; row * r < T + r; row++) {
    const y = row * r;
    const offset = row % 2 === 0 ? 0 : Math.floor(r / 2);
    for (let x = -offset; x < T; x += r) {
      const shade = rng.pick([f(1), f(2), f(2), f(1)]);
      for (let dy = 0; dy < r - 1; dy++) {
        for (let dx = 0; dx < r - 1; dx++) {
          // Knock the corners off so each stone reads as rounded.
          if ((dx === 0 || dx === r - 2) && (dy === 0 || dy === r - 2)) continue;
          const tx = (((x + dx) % T) + T) % T;
          const ty = (y + dy) % T;
          px.set(tx, ty, dy === 0 ? f(2) : dy === r - 2 ? f(0) : shade);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Autotiling — corner-based, covers all 256 neighbour masks
// ---------------------------------------------------------------------------

/**
 * Each 16x16 transition tile is assembled from four 8x8 corner quadrants. A
 * quadrant only needs its two adjacent sides plus the diagonal, which collapses
 * 256 whole-tile cases into 5 quadrant cases drawn once and mirrored.
 *
 * Bit order matches the mask in dungeon-gen: N NE E SE S SW W NW.
 */
const CORNER_CASES = ['full', 'notch', 'edgeH', 'edgeV', 'outer'] as const;
export type CornerCase = (typeof CORNER_CASES)[number];

/**
 * `side1` is the horizontal neighbour, `side2` the vertical one. A horizontal
 * neighbour present with the vertical one absent means the boundary runs
 * *horizontally* across the top of the quadrant — hence edgeH, not edgeV.
 */
function cornerCase(side1: boolean, side2: boolean, diag: boolean): CornerCase {
  if (side1 && side2) return diag ? 'full' : 'notch';
  if (side1) return 'edgeH';
  if (side2) return 'edgeV';
  return 'outer';
}

/**
 * Coverage test for one 8x8 quadrant in "north-west" orientation: (0,0) is the
 * outer corner, (7,7) the tile centre. Other quadrants flip into this.
 */
function quadrantCovered(
  kase: CornerCase,
  x: number,
  y: number,
  jitter: (x: number, y: number) => number,
): boolean {
  // A constant ~2.2 world-pixel inset with organic wobble. Expressed through
  // len() so the border keeps the same *shape* at any texel density and simply
  // gains resolution to be irregular in — at HD the edge reads as brushed
  // rather than stepped.
  const jx = len(4.4) + jitter(y / len(6), 0) * len(2.8);
  const jy = len(4.4) + jitter(0, x / len(6)) * len(2.8);
  switch (kase) {
    case 'full': return true;
    case 'notch':
      return Math.hypot(x - 0.5, y - 0.5) > len(4.0) + jitter(x / len(6), y / len(6)) * len(2.4);
    case 'edgeH': return y >= jy;
    case 'edgeV': return x >= jx;
    case 'outer': return x >= jx && y >= jy;
  }
}

export interface AutotileSpec {
  key: string;
  palette: Palette;
  /** the terrain underneath the transition */
  base(px: PixelBuffer, rng: Rng): void;
  /** the terrain on top, sampled per pixel */
  overFill(rng: Rng): (x: number, y: number) => number;
  lip: number;
  shade: number;
}

/**
 * Collapse a raw 8-neighbour mask onto the tile that actually gets drawn.
 *
 * A diagonal bit only changes the rendering when both of its adjacent sides are
 * set — otherwise that corner is already an outer edge and the diagonal is
 * invisible. Normalising means 256 masks resolve to 47 distinct tiles, and the
 * runtime lookup uses this same function so it can never disagree with the baker.
 */
export function normalizeBlobMask(mask: number): number {
  const bit = (i: number) => (mask >> i) & 1;
  const pairs: Array<[number, number, number]> = [[1, 0, 2], [3, 2, 4], [5, 4, 6], [7, 6, 0]];
  let norm = mask;
  for (const [diag, s1, s2] of pairs) {
    if (bit(diag) && !(bit(s1) && bit(s2))) norm &= ~(1 << diag);
  }
  return norm;
}

/** The 47 distinct blob masks — the deduplicated subset of all 256. */
export function blob47Masks(): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let m = 0; m < 256; m++) {
    const norm = normalizeBlobMask(m);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function drawAutotile(
  px: PixelBuffer,
  spec: AutotileSpec,
  mask: number,
  rng: Rng,
): void {
  spec.base(px, rng.stream(`base:${mask}`));

  const bit = (i: number) => ((mask >> i) & 1) === 1;
  const N = bit(0), NE = bit(1), E = bit(2), SE = bit(3);
  const S = bit(4), SW = bit(5), W = bit(6), NW = bit(7);

  // Build coverage for the whole tile first, then light it as one shape. Lighting
  // each quadrant in isolation can't tell an interior edge from a tile seam, which
  // is what put highlight lips across fully-interior tiles.
  const T = TILE_TEX;
  const Q = T / 2;
  const cov = new Uint8Array(T * T);
  const quads: Array<[CornerCase, number, number, boolean, boolean]> = [
    [cornerCase(W, N, NW), 0, 0, false, false],
    [cornerCase(E, N, NE), Q, 0, true, false],
    [cornerCase(W, S, SW), 0, Q, false, true],
    [cornerCase(E, S, SE), Q, Q, true, true],
  ];

  for (const [kase, ox, oy, flipX, flipY] of quads) {
    const jitter = makeNoise(rng.stream(`q:${mask}:${ox}:${oy}`), 8);
    for (let y = 0; y < Q; y++) {
      for (let x = 0; x < Q; x++) {
        if (!quadrantCovered(kase, x, y, jitter)) continue;
        cov[(oy + (flipY ? Q - 1 - y : y)) * T + (ox + (flipX ? Q - 1 - x : x))] = 1;
      }
    }
  }

  // Clamping out-of-bounds reads to the tile edge means a covered border row sees
  // itself as covered above, so no lip is drawn along a seam.
  const covAt = (x: number, y: number): boolean => {
    const cx = x < 0 ? 0 : x > T - 1 ? T - 1 : x;
    const cy = y < 0 ? 0 : y > T - 1 ? T - 1 : y;
    return cov[cy * T + cx] === 1;
  };

  const fill = spec.overFill(rng.stream('over'));
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!covAt(x, y)) continue;
      px.set(x, y, covAt(x, y - 1) ? fill(x, y) : spec.lip);
    }
  }
  // Cast shadow under the overhang: a solid band then a dithered one, both
  // scaled with density so the penumbra stays the same width in world pixels.
  const solid = len(1);
  const soft = len(2);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (covAt(x, y)) continue;
      let depth = -1;
      for (let d = 1; d <= soft; d++) {
        if (covAt(x, y - d)) { depth = d; break; }
      }
      if (depth < 0) continue;
      if (depth <= solid) px.set(x, y, spec.shade);
      else if ((x + y) % 2 === 0) px.set(x, y, spec.shade);
    }
  }
}

export const GRASS_OVER_DIRT: AutotileSpec = {
  key: 'grass.edge',
  palette: PAL_TERRAIN,
  base: (px, rng) => drawDirt(px, rng),
  // Matches the flat base of grass.base — an edge tile whose interior is busier
  // than the field it borders announces itself as a different tile.
  overFill: (rng) => {
    const n = makeNoise(rng, 8);
    return (x, y) => ci(PAL_TERRAIN, `grass.${n(x / len(12), y / len(12)) > 0.78 ? 3 : 2}`);
  },
  lip: ci(PAL_TERRAIN, 'grass.6'),
  shade: ci(PAL_TERRAIN, 'dirt.0'),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TILES: readonly TileGen[] = [
  { key: 'grass.base', palette: PAL_TERRAIN, variants: 4, draw: (px, rng) => drawGrass(px, rng) },
  { key: 'dirt.base', palette: PAL_TERRAIN, variants: 3, draw: (px, rng) => drawDirt(px, rng) },
  // 4 spatial variants x 2 animation frames, packed as spatial * 2 + frame.
  { key: 'water.base', palette: PAL_TERRAIN, variants: 8, draw: (px, rng, v) => drawWater(px, rng, v) },
  { key: 'floor.dungeon', palette: PAL_DUNGEON, variants: 4, draw: (px, rng) => drawDungeonFloor(px, rng) },
  { key: 'wall.dungeon', palette: PAL_DUNGEON, variants: 3, draw: (px, rng) => drawDungeonWall(px, rng) },
  { key: 'tree.base', palette: PAL_TERRAIN, variants: 4, draw: (px, rng) => drawTrees(px, rng) },
  { key: 'cliff.base', palette: PAL_DUNGEON, variants: 4, draw: (px, rng) => drawCliff(px, rng) },
  { key: 'roof.base', palette: PAL_PROP, variants: 3, draw: (px, rng, v) => drawRoof(px, rng, v) },
  { key: 'cobble.base', palette: PAL_PROP, variants: 3, draw: (px, rng) => drawCobble(px, rng) },
];
