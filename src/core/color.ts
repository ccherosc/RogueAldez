/**
 * Color for a 15-bit SNES target.
 *
 * Palettes are authored in OKLCH because perceptually even ramps are what make
 * generated pixel art read as hand-drawn. Everything is quantized to 5 bits per
 * channel on the way out — see the palette discipline notes in art-synthesis.
 */

export interface Rgb { r: number; g: number; b: number }
export interface Oklch { L: number; C: number; H: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** linear-light -> sRGB transfer */
function encodeSrgb(v: number): number {
  const c = clamp01(v);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** OKLCH (H in degrees) -> 8-bit sRGB, unquantized. */
export function oklchToRgb({ L, C, H }: Oklch): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: Math.round(encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255),
    g: Math.round(encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255),
    b: Math.round(encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255),
  };
}

/**
 * Snap each channel to one of 32 levels, the way SNES hardware stores color.
 * Skipping this is the fastest way to make generated art look "modern indie"
 * instead of 1992. Applied as the final step of every color computation.
 */
export function quantize5(c: Rgb): Rgb {
  const q = (v: number) => {
    const level = Math.round(clamp01(v / 255) * 31);
    return Math.round((level / 31) * 255);
  };
  return { r: q(c.r), g: q(c.g), b: q(c.b) };
}

export function isQuantized5(c: Rgb): boolean {
  const ok = (v: number) => Math.abs(Math.round((Math.round((v / 255) * 31) / 31) * 255) - v) === 0;
  return ok(c.r) && ok(c.g) && ok(c.b);
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * A perceptual ramp from shadow to highlight.
 *
 * Interpolating hue and chroma alongside lightness is the whole point: shadows
 * drift cool, highlights drift warm. A pure-value ramp (one hue, varying L) is
 * flat and dead, and it is the single most common failure in generated palettes.
 */
export function ramp(steps: number, from: Oklch, to: Oklch): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    // Ease the midtones slightly wider than linear — matches how pixel artists
    // spend most of their palette in the middle of the range.
    const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    out.push(
      quantize5(
        oklchToRgb({
          L: from.L + (to.L - from.L) * e,
          C: from.C + (to.C - from.C) * e,
          H: from.H + (to.H - from.H) * e,
        }),
      ),
    );
  }
  return out;
}
