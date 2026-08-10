/**
 * Presentation constants and the adaptive viewport.
 *
 * A room is always 256x224 — that is fixed by the SNES reference and by the
 * room-locked camera. The *viewport* is not: on a wider screen the game shows
 * more tiles rather than stretching the same ones, which is the only honest way
 * to fill a 16:9 monitor with 4:3-era art.
 *
 * Consequence worth understanding: when the viewport is larger than a room, you
 * see past the room's edge. In open country that reads as a bigger world and is
 * an improvement. In a dungeon the room is centred so the walls frame the view.
 */

export const TILE_SIZE = 16;

/**
 * Texels per world pixel.
 *
 * Simulation, layout and UI all speak *world pixels* — a tile is 16 of them, a
 * room is 256x224 of them, the zelda-feel numbers never move. The art is
 * authored at twice that density, so every world pixel is a 2x2 of texels and
 * the same SNES proportions carry twice the detail. This is the "rebuilt for
 * modern machines" constant: gameplay is 1992, the pixels are not.
 */
/**
 * Chosen at 4, not 6, after measuring both.
 *
 * 6 is the magnification a 1080p screen wants for the largest characters, and it
 * looks superb there — but the smallest acceptable field (256x176 world pixels)
 * then needs 1056 device pixels of height, which 900p, 768p, 720p and a browser
 * frame with chrome do not have. Every one of them collapsed to a pillarboxed
 * fallback at 64-82% fill. 4 fills 98-100% of every common display with each
 * texel landing on exactly one device pixel, which is as sharp as art can be.
 */
export const ART_SCALE = 4;

/** One room. Fixed — the generator, the camera and the transitions all assume it. */
export const ROOM_W = 256;
export const ROOM_H = 224;

/**
 * Viewport bounds, in world pixels. Always whole tiles.
 *
 * The height floor is 176, not the room's 224, on purpose: every room carries a
 * 2-tile solid barrier band top and bottom, so the playable interior is only
 * rows 32..192 — 160 world pixels. A 176-tall field still shows all of it with a
 * margin, and only ever crops into wall. Buying that 48px is what lets a 720p or
 * 1080p screen take a whole extra magnification step, which is the difference
 * between SNES-sized characters and postage stamps.
 */
export const MIN_VIEW_W = 256;
export const MIN_VIEW_H = 176;
export const MAX_VIEW_W = 480;
export const MAX_VIEW_H = 320;

/**
 * The field width we aim for, in world pixels.
 *
 * This is the character-size dial. A Link to the Past showed 256 world pixels
 * across with a 16px hero — one screen was sixteen Links wide. At 400 the field
 * is 16:9 against a 224-tall room and a character is still ~4% of the width,
 * which reads at a glance. Push it past ~450 and everyone turns into an ant.
 */
const TARGET_VIEW_W = 400;

export interface Viewport {
  /** internal render width in game pixels */
  w: number;
  /** internal render height in game pixels */
  h: number;
  /** integer upscale factor to the canvas */
  scale: number;
}

/**
 * Live viewport. Mutable module state on purpose: it is read on nearly every
 * draw call, and threading it through every signature would be noise. `core/`
 * is layer 0, so everything may read it and nothing needs to own it.
 */
export const viewport: Viewport = { w: ROOM_W, h: ROOM_H, scale: 1 };

function toTiles(px: number, min: number, max: number): number {
  const snapped = Math.floor(px / TILE_SIZE) * TILE_SIZE;
  return Math.max(min, Math.min(max, snapped));
}

/**
 * SNES framing, modern density.
 *
 * `scale` is canvas pixels per *texel*, so total magnification per world pixel
 * is ART_SCALE x scale. The rule picks the largest magnification at which a
 * whole room still fits on screen — characters as large as A Link to the Past
 * would draw them, but carrying 2x the pixel detail. A 1600x900 laptop lands on
 * exactly 400x224 world pixels (25x14 tiles) filling the screen edge to edge.
 *
 * On screens too small for even 2x magnification (phones, in CSS pixels) the
 * canvas backing keeps its integer size and the presenter shrinks it with CSS —
 * fractional, but phone DPR means device pixels still oversample the texels.
 */
export function computeViewport(availW: number, availH: number): Viewport {
  // Search the magnification steps rather than deriving one.
  //
  // Total magnification per world pixel is ART_SCALE x scale, and scale must
  // stay an integer or texels land on fractional device pixels and shimmer. The
  // earlier version picked "the largest scale at which a room fits", which in a
  // short window (a browser frame with chrome, an embedded page) collapsed to
  // the minimum and then hit a 4:3 cap — hence a small pillarboxed square on a
  // 16:9 monitor. Trying every step and scoring the *field it produces* fixes
  // both: it naturally tracks the window's aspect and prefers the magnification
  // that puts the field near TARGET_VIEW_W.
  let best: Viewport | null = null;

  for (let scale = 1; scale <= 8; scale++) {
    const m = ART_SCALE * scale;
    // The field this magnification would yield, before clamping. Testing the
    // *raw* field is what makes the rule honest: clamping first hides the fact
    // that a step is showing too little world and the check passes anyway.
    const rawW = availW / m;
    const rawH = availH / m;
    // Both shrink as scale rises, so the first failure ends the search.
    if (rawW < MIN_VIEW_W || rawH < MIN_VIEW_H) break;
    best = {
      scale,
      w: toTiles(rawW, MIN_VIEW_W, MAX_VIEW_W),
      h: toTiles(rawH, MIN_VIEW_H, MAX_VIEW_H),
    };
  }

  // Keeping the *last* valid step means the largest magnification at which the
  // field still shows a room's worth of world — biggest characters, nothing
  // important cropped. Scoring by field width instead made a 1366x768 laptop
  // pick half the magnification just to show 100 more pixels of grass.
  if (best) return best;

  // Nothing fits even at 1x — a phone, or a browser whose height lands just under
  // the minimum field. The presenter shrinks the backing store to suit.
  //
  // Width still comes from the *window*, not from MIN_VIEW_W. Hardcoding it here
  // was the square-screen bug: a 1366x700 browser is one pixel short on height,
  // fell into this branch, and got a 256-wide field — a 1.45 ratio pillarboxed
  // onto a 16:9 monitor, ignoring 1100 pixels of available width.
  return {
    scale: 1,
    w: toTiles(availW / ART_SCALE, MIN_VIEW_W, MAX_VIEW_W),
    h: toTiles(availH / ART_SCALE, MIN_VIEW_H, MAX_VIEW_H),
  };
}

/** Returns true when the size actually changed and buffers need rebuilding. */
export function setViewport(next: Viewport): boolean {
  const changed = next.w !== viewport.w || next.h !== viewport.h || next.scale !== viewport.scale;
  viewport.w = next.w;
  viewport.h = next.h;
  viewport.scale = next.scale;
  return changed;
}

// --- Compatibility aliases --------------------------------------------------
// Rooms are still 256x224 everywhere the *world* is concerned.
export const SCREEN_W = ROOM_W;
export const SCREEN_H = ROOM_H;

/** A room is exactly one screen of tiles. This is what makes the camera lock work. */
export const ROOM_TILES_W = 16;
export const ROOM_TILES_H = 14;
