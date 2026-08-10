/**
 * A palette-indexed pixel buffer and the drawing primitives every generator uses.
 *
 * Generators work in palette *indices*, never RGB. That enforces the 15-colors +
 * transparent constraint structurally rather than by discipline, and it keeps the
 * door open for shader palette swaps later. Index 0 is always transparent.
 */

import type { Rng } from '../core/rng.ts';

export const TRANSPARENT = 0;

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height); // zero == transparent
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.data[y * this.width + x]! : TRANSPARENT;
  }

  set(x: number, y: number, ci: number): void {
    if (this.inBounds(x, y)) this.data[y * this.width + x] = ci;
  }

  /** set, but only where the target is currently transparent */
  under(x: number, y: number, ci: number): void {
    if (this.inBounds(x, y) && this.data[y * this.width + x] === TRANSPARENT) {
      this.data[y * this.width + x] = ci;
    }
  }

  fill(ci: number): void {
    this.data.fill(ci);
  }

  rect(x: number, y: number, w: number, h: number, ci: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ci);
  }

  hline(x: number, y: number, w: number, ci: number): void {
    for (let i = 0; i < w; i++) this.set(x + i, y, ci);
  }

  vline(x: number, y: number, h: number, ci: number): void {
    for (let i = 0; i < h; i++) this.set(x, y + i, ci);
  }

  /** Filled ellipse inscribed in the given box. */
  ellipse(x: number, y: number, w: number, h: number, ci: number): void {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx - 0.5;
    const cy = y + ry - 0.5;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.set(xx, yy, ci);
      }
    }
  }

  /** Blit another buffer, treating index 0 as transparent. */
  blit(src: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const ci = src.get(x, y);
        if (ci !== TRANSPARENT) this.set(dx + x, dy + y, ci);
      }
    }
  }

  /** Horizontal mirror. Sprites generate one side and mirror — never both. */
  mirrored(): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out.set(this.width - 1 - x, y, this.get(x, y));
    }
    return out;
  }

  clone(): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    out.data.set(this.data);
    return out;
  }

  /** Shift contents by (dx, dy). Used for the 1px walk-cycle body bob. */
  shifted(dx: number, dy: number): PixelBuffer {
    const out = new PixelBuffer(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out.set(x + dx, y + dy, this.get(x, y));
    }
    return out;
  }

  /**
   * Trace a 1px outline around every non-transparent region.
   *
   * Sprites outline on all sides so they separate from terrain. Tiles outline
   * only bottom/right, because the light source is upper-left and consistency of
   * light direction matters more than any individual tile.
   */
  outline(ci: number, sides: 'all' | 'br' = 'all'): void {
    const src = this.clone();
    const offsets: Array<[number, number]> =
      sides === 'all'
        ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
        : [[1, 0], [0, 1]];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (src.get(x, y) !== TRANSPARENT) continue;
        for (const [ox, oy] of offsets) {
          if (src.get(x - ox, y - oy) !== TRANSPARENT) {
            this.set(x, y, ci);
            break;
          }
        }
      }
    }
  }

  /** Darken the bottom/right lip of a solid shape to fake depth. */
  shadeEdges(shadowCi: number, lightCi: number): void {
    const src = this.clone();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const ci = src.get(x, y);
        if (ci === TRANSPARENT) continue;
        if (src.get(x, y + 1) === TRANSPARENT || src.get(x + 1, y) === TRANSPARENT) {
          this.set(x, y, shadowCi);
        } else if (src.get(x, y - 1) === TRANSPARENT && src.get(x - 1, y) === TRANSPARENT) {
          this.set(x, y, lightCi);
        }
      }
    }
  }
}

/**
 * Scale2x (EPX) — the classic pixel-art doubler.
 *
 * Where a plain 2x blowup turns every stair-step into a chunky block, EPX reads
 * each pixel's four neighbours and rounds the diagonals, keeping flat areas flat
 * and curves curved. On 15-colour palette art this is precisely the "same sprite,
 * redrawn finer" look the console remasters use — no blur, no new colours, no
 * hand labour. Hand-plotted sprites go through this; field-sampled tiles are
 * drawn natively at 2x instead, because they can generate true new detail.
 */
export function scale2x(src: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(src.width * 2, src.height * 2);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const p = src.get(x, y);
      const n = src.get(x, y - 1);
      const s = src.get(x, y + 1);
      const w = src.get(x - 1, y);
      const e = src.get(x + 1, y);

      let tl = p, tr = p, bl = p, br = p;
      if (w === n && w !== s && n !== e) tl = n;
      if (n === e && n !== w && e !== s) tr = e;
      if (s === w && s !== e && w !== n) bl = w;
      if (e === s && e !== n && s !== w) br = s;

      out.set(x * 2, y * 2, tl);
      out.set(x * 2 + 1, y * 2, tr);
      out.set(x * 2, y * 2 + 1, bl);
      out.set(x * 2 + 1, y * 2 + 1, br);
    }
  }
  return out;
}

/**
 * Scale3x — the 3x sibling of EPX, same family, same rules.
 *
 * Needed because the magnification a 1080p screen wants for SNES-sized
 * characters is exactly 6, and 6 is 2x3. Powers of two alone cannot reach it:
 * 4 leaves characters too small and 8 crops away more of the room than the
 * playable interior can spare.
 */
export function scale3x(src: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(src.width * 3, src.height * 3);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const e = src.get(x, y);
      const a = src.get(x - 1, y - 1), b = src.get(x, y - 1), c = src.get(x + 1, y - 1);
      const d = src.get(x - 1, y), f = src.get(x + 1, y);
      const g = src.get(x - 1, y + 1), h = src.get(x, y + 1), i = src.get(x + 1, y + 1);

      const db = d === b && d !== h && b !== f;
      const bf = b === f && b !== d && f !== h;
      const dh = d === h && d !== b && h !== f;
      const fh = f === h && b !== f && d !== h;

      const o = [
        db ? d : e,
        (db && e !== c) || (bf && e !== a) ? b : e,
        bf ? f : e,
        (db && e !== g) || (dh && e !== a) ? d : e,
        e,
        (bf && e !== i) || (fh && e !== c) ? f : e,
        dh ? d : e,
        (fh && e !== g) || (dh && e !== i) ? h : e,
        fh ? f : e,
      ];
      for (let k = 0; k < 9; k++) {
        out.set(x * 3 + (k % 3), y * 3 + Math.floor(k / 3), o[k]!);
      }
    }
  }
  return out;
}

/**
 * Raise a hand-plotted sprite to texel density.
 *
 * Factors the target into 3s then 2s and applies the matching EPX pass for
 * each, so any ART_SCALE built from those primes works without a special case.
 */
export function upscaleSprite(src: PixelBuffer, factor: number): PixelBuffer {
  let out = src;
  let remaining = factor;
  while (remaining % 3 === 0) { out = scale3x(out); remaining /= 3; }
  while (remaining % 2 === 0) { out = scale2x(out); remaining /= 2; }
  if (remaining !== 1) {
    throw new Error(`ART_SCALE ${factor} is not a product of 2s and 3s`);
  }
  return out;
}

/**
 * Derive a normal map from a sprite's own silhouette.
 *
 * There is no depth information in a hand-plotted sprite, so the surface is
 * inferred: build a distance field inward from the edge of the solid area, and
 * take the normal as the gradient of that field, tilted up toward the viewer as
 * you move inward. The result is a form that bulges — edges face outward, the
 * middle faces the camera — which is exactly the shading a rounded 2D character
 * wants and costs no authoring at all.
 *
 * Encoded the usual way: RGB = (N + 1) / 2, so 128,128,255 is "facing the
 * viewer". Alpha carries coverage so the light pass can ignore empty texels.
 */
export function deriveNormals(px: PixelBuffer, outline: number): Uint8Array {
  const { width: w, height: h } = px;
  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return px.get(x, y) !== 0;
  };

  // Chamfer distance transform, two passes. Cheap and quite good enough for a
  // field whose only job is to be smooth.
  const dist = new Float32Array(w * h);
  const BIG = 1e6;
  for (let i = 0; i < dist.length; i++) dist[i] = solid(i % w, Math.floor(i / w)) ? BIG : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let best = dist[i]!;
      if (x > 0) best = Math.min(best, dist[i - 1]! + 1);
      if (y > 0) best = Math.min(best, dist[i - w]! + 1);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - w - 1]! + 1.414);
      dist[i] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let best = dist[i]!;
      if (x < w - 1) best = Math.min(best, dist[i + 1]! + 1);
      if (y < h - 1) best = Math.min(best, dist[i + w]! + 1);
      if (x < w - 1 && y < h - 1) best = Math.min(best, dist[i + w + 1]! + 1.414);
      dist[i] = best;
    }
  }

  // Radius over which the surface turns from edge-on to facing the viewer. Too
  // large and everything is a sphere; this reads as a bevel on a solid form.
  const ROUND = 5;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (!solid(x, y)) continue;

      // Gradient of the distance field points *inward*; the surface normal
      // points the other way.
      const gx = (dist[i + (x < w - 1 ? 1 : 0)]! - dist[i - (x > 0 ? 1 : 0)]!) * 0.5;
      const gy = (dist[i + (y < h - 1 ? w : 0)]! - dist[i - (y > 0 ? w : 0)]!) * 0.5;
      // Flatten toward the viewer as the texel gets further inside the shape.
      const flat = Math.min(1, dist[i]! / ROUND);
      let nx = -gx * (1 - flat);
      let ny = -gy * (1 - flat);
      const nz = 0.35 + 0.65 * flat;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;

      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      // Outline texels are the silhouette, not surface — keep them unlit-ish.
      out[o + 3] = px.get(x, y) === outline ? 128 : 255;
    }
  }
  return out;
}

/**
 * Rim light and contact shade — one light direction, applied to any sprite.
 *
 * Walks the doubled buffer and brightens every solid pixel whose neighbour to
 * the *upper left* is empty or outline, then darkens the ones whose lower-right
 * neighbour is. That single rule is most of what separates a flat SNES sprite
 * from one with form: the silhouette gains a lit edge and a grounded underside
 * without anyone hand-shading a single frame.
 *
 * It runs after Scale2x, so the lit edge is one *texel* — a half world pixel,
 * far too fine to draw at the resolution the sprite was authored at, and exactly
 * the kind of mark a remaster adds.
 */
export function rimLight(
  px: PixelBuffer,
  brighten: (index: number) => number,
  darken: (index: number) => number,
  outline: number,
  /** rim thickness in texels — keep it a constant width in *world* pixels */
  thickness = 1,
): void {
  const src = px.clone();
  const empty = (x: number, y: number): boolean => {
    const v = src.get(x, y);
    return v === 0 || v === outline;
  };
  /** distance to the nearest empty texel in a direction, up to thickness */
  const near = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let d = 1; d <= thickness; d++) if (empty(x + dx * d, y + dy * d)) return true;
    return false;
  };

  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      const v = src.get(x, y);
      if (v === 0 || v === outline) continue;
      // Light from the upper left, consistently with the terrain shading.
      if (near(x, y, -1, 0) || near(x, y, 0, -1)) px.set(x, y, brighten(v));
      else if (near(x, y, 1, 0) || near(x, y, 0, 1)) px.set(x, y, darken(v));
    }
  }
}

/**
 * Tileable value noise.
 *
 * The lattice wraps at `period`, so sampling over a 16px tile with a period that
 * divides 16 produces seamless edges. Non-wrapping noise is the number one cause
 * of visible seams in generated tilesets.
 */
export function makeNoise(rng: Rng, period: number): (x: number, y: number) => number {
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();

  const at = (ix: number, iy: number) =>
    lattice[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)]!;

  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // smoothstep keeps the lattice from showing as a diamond grid
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = at(x0, y0);
    const n10 = at(x0 + 1, y0);
    const n01 = at(x0, y0 + 1);
    const n11 = at(x0 + 1, y0 + 1);

    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  };
}

/** Two octaves of wrapping noise, normalized to [0,1). */
export function makeFbm(rng: Rng, basePeriod: number): (x: number, y: number) => number {
  const a = makeNoise(rng, basePeriod);
  const b = makeNoise(rng, basePeriod * 2);
  return (x, y) => a(x, y) * 0.65 + b(x * 2, y * 2) * 0.35;
}

/**
 * Scatter positions on a wrapping grid with a minimum separation.
 *
 * Detail lands at the 2x2 pixel scale, not 1x1 — single-pixel scatter reads as
 * video noise or dithering artifacts, while clumped detail reads as texture.
 */
export function scatter(
  rng: Rng,
  size: number,
  count: number,
  minDist: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 40) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    const ok = pts.every(([px, py]) => {
      // measure on a torus so clumps don't pile up at the tile seam
      const dx = Math.min(Math.abs(px - x), size - Math.abs(px - x));
      const dy = Math.min(Math.abs(py - y), size - Math.abs(py - y));
      return dx * dx + dy * dy >= minDist * minDist;
    });
    if (ok) pts.push([x, y]);
  }
  return pts;
}
