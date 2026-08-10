/**
 * Atlas packing.
 *
 * Shelf/skyline packer with a 2px transparent gutter between cells — without the
 * gutter, bilinear sampling at non-integer UVs bleeds neighbouring cells into
 * each other, which shows up as coloured fringes on sprite edges.
 */

import type { PixelBuffer } from './pixels.ts';
import { deriveNormals } from './pixels.ts';
import type { Palette } from './palettes.ts';

export const GUTTER = 2;
// HD art at 4 texels per world pixel: a tile is 64x64 and the player cell 128.
// One 2048 page still holds the whole game, well inside any GPU's limit.
export const PAGE_WIDTH = 2048;

export interface AtlasEntry {
  key: string;
  buffer: PixelBuffer;
  palette: Palette;
  anchor: [number, number];
  /**
   * Hand-painted RGBA that replaces the generated cell verbatim. The escape
   * hatch from art-synthesis: generate everything, then paint over the handful
   * of cells that aren't landing.
   */
  override?: { width: number; height: number; rgba: Uint8Array };
}

export interface AtlasCell {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: [number, number];
}

export interface Atlas {
  width: number;
  height: number;
  rgba: Uint8Array;
  /**
   * Normal map, same layout as `rgba`. Derived from each cell's own silhouette
   * so lights can strike surfaces *directionally* rather than merely brightening
   * them — see deriveNormals().
   */
  normals: Uint8Array;
  cells: AtlasCell[];
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}

export function packAtlas(entries: readonly AtlasEntry[]): Atlas {
  // Tallest first keeps shelves dense. Ties break on key so packing is stable
  // across runs — a reordered atlas would defeat "regenerate twice and diff".
  const sorted = [...entries].sort(
    (a, b) => b.buffer.height - a.buffer.height || a.key.localeCompare(b.key),
  );

  const cells: AtlasCell[] = [];
  let penX = GUTTER;
  let penY = GUTTER;
  let shelfHeight = 0;

  for (const e of sorted) {
    const w = e.override?.width ?? e.buffer.width;
    const h = e.override?.height ?? e.buffer.height;
    if (penX + w + GUTTER > PAGE_WIDTH) {
      penX = GUTTER;
      penY += shelfHeight + GUTTER;
      shelfHeight = 0;
    }
    cells.push({ key: e.key, x: penX, y: penY, w, h, anchor: e.anchor });
    penX += w + GUTTER;
    shelfHeight = Math.max(shelfHeight, h);
  }

  const height = nextPow2(penY + shelfHeight + GUTTER);
  const rgba = new Uint8Array(PAGE_WIDTH * height * 4);

  const normals = new Uint8Array(PAGE_WIDTH * height * 4);

  const byKey = new Map(sorted.map((e) => [e.key, e]));
  for (const cell of cells) {
    const e = byKey.get(cell.key)!;
    if (e.override) {
      blitRgba(rgba, PAGE_WIDTH, cell.x, cell.y, e.override);
    } else {
      resolveInto(rgba, PAGE_WIDTH, cell.x, cell.y, e.buffer, e.palette);
    }
    // Normals come from the palette-indexed buffer, so a hand-painted override
    // keeps the generated cell's form — the shape is what matters here, not the
    // colours somebody painted over it.
    const n = deriveNormals(e.buffer, e.palette.idx['outline'] ?? 1);
    blitRaw(normals, PAGE_WIDTH, cell.x, cell.y, e.buffer.width, e.buffer.height, n);
  }

  return {
    width: PAGE_WIDTH,
    height,
    rgba,
    normals,
    cells: cells.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Copy a raw RGBA block, alpha 0 meaning "no surface here". */
function blitRaw(
  dst: Uint8Array,
  stride: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
  src: Uint8Array,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      if (src[s + 3] === 0) continue;
      const o = ((dy + y) * stride + (dx + x)) * 4;
      dst[o] = src[s]!;
      dst[o + 1] = src[s + 1]!;
      dst[o + 2] = src[s + 2]!;
      dst[o + 3] = src[s + 3]!;
    }
  }
}

/** Copy a hand-painted cell straight in, bypassing the palette entirely. */
function blitRgba(
  dst: Uint8Array,
  stride: number,
  dx: number,
  dy: number,
  src: { width: number; height: number; rgba: Uint8Array },
): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      if (src.rgba[s + 3] === 0) continue;
      const o = ((dy + y) * stride + (dx + x)) * 4;
      dst[o] = src.rgba[s]!;
      dst[o + 1] = src.rgba[s + 1]!;
      dst[o + 2] = src.rgba[s + 2]!;
      dst[o + 3] = src.rgba[s + 3]!;
    }
  }
}

/** Resolve palette indices to RGBA. Index 0 is transparent everywhere. */
function resolveInto(
  rgba: Uint8Array,
  stride: number,
  dx: number,
  dy: number,
  px: PixelBuffer,
  pal: Palette,
): void {
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      const idx = px.get(x, y);
      if (idx === 0) continue;
      const c = pal.colors[idx];
      if (!c) throw new Error(`atlas: palette "${pal.name}" has no color at index ${idx}`);
      const o = ((dy + y) * stride + (dx + x)) * 4;
      rgba[o] = c.r;
      rgba[o + 1] = c.g;
      rgba[o + 2] = c.b;
      rgba[o + 3] = 255;
    }
  }
}
