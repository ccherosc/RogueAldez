/**
 * Screen-space text, drawn from the baked font cells.
 *
 * The batcher applies a camera offset, so UI draws in its own pass with the
 * camera at the origin — see how the scene flushes the world before calling any
 * of this.
 */

import { fontKey, FONT_GLYPHS } from '../art/sprites.ts';
import type { SpriteBatch } from '../render/batcher.ts';

/**
 * Fold typographic characters onto the ASCII the font actually carries.
 *
 * Prose written for humans contains em-dashes and curly quotes; the atlas throws
 * on an unknown cell, so an unmapped character would take the whole frame down
 * rather than render slightly wrong.
 */
const FOLD: Record<string, string> = {
  '—': '-', '–': '-', '’': "'", '‘': "'",
  '“': ' ', '”': ' ', '…': '...', ' ': ' ',
};

export function normalizeText(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const folded = FOLD[ch] ?? ch;
    for (const c of folded) out += FONT_GLYPHS[c] === undefined ? '?' : c;
  }
  return out;
}

/** 3px glyph plus 1px gap, at full size. */
export const GLYPH_ADVANCE = 4;
export const LINE_HEIGHT = 8;

/**
 * UI text draws at half world size — one texel per world pixel.
 *
 * The font is authored at 2 texels per world pixel like everything else, so
 * halving costs no sharpness at all; it just stops the HUD scaling with the
 * world. Once a big monitor magnifies world pixels six or eight times, full-size
 * UI text takes a third of the screen.
 */
export const UI_SCALE = 0.5;

export function textWidth(s: string, scale = UI_SCALE): number {
  return normalizeText(s).length * GLYPH_ADVANCE * scale;
}

export function lineHeight(scale = UI_SCALE): number {
  return LINE_HEIGHT * scale;
}

export function drawText(
  batch: SpriteBatch,
  x: number,
  y: number,
  text: string,
  alpha = 1,
  scale = UI_SCALE,
): void {
  let cx = x;
  for (const ch of normalizeText(text)) {
    // Space advances without a draw call.
    if (ch !== ' ') batch.draw(fontKey(ch), cx, y, { alpha, scale });
    cx += GLYPH_ADVANCE * scale;
  }
}

/** Right-aligned, for anything anchored to the far edge of the screen. */
export function drawTextRight(
  batch: SpriteBatch,
  rightX: number,
  y: number,
  text: string,
  alpha = 1,
  scale = UI_SCALE,
): void {
  drawText(batch, Math.round(rightX - textWidth(text, scale)), y, text, alpha, scale);
}

export function drawTextCentred(
  batch: SpriteBatch,
  centreX: number,
  y: number,
  text: string,
  alpha = 1,
  scale = UI_SCALE,
): void {
  drawText(batch, Math.round(centreX - textWidth(text, scale) / 2), y, text, alpha, scale);
}
