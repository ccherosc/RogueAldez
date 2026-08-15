/**
 * Palette definitions.
 *
 * Authored in OKLCH, converted to sRGB, quantized to 5 bits per channel. Each
 * palette is 15 usable colors plus transparent, matching an SNES sprite palette.
 *
 * Slot layout, held to across every palette so shaders can rely on it:
 *   0        transparent
 *   1        outline
 *   2..13    working colors
 *   14, 15   flash pair (damage flash swaps the whole sprite to these)
 */

import { oklchToRgb, quantize5, ramp } from '../core/color.ts';
import type { Oklch, Rgb } from '../core/color.ts';

export interface Palette {
  readonly name: string;
  /** exactly 16 entries; [0] is a placeholder for transparent */
  readonly colors: readonly Rgb[];
  /** 'grass.2' -> palette index */
  readonly idx: Readonly<Record<string, number>>;
}

const OUTLINE: Oklch = { L: 0.17, C: 0.025, H: 268 };
const FLASH_A: Oklch = { L: 0.97, C: 0.012, H: 95 };
const FLASH_B: Oklch = { L: 1.0, C: 0.0, H: 0 };

const one = (c: Oklch): Rgb[] => [quantize5(oklchToRgb(c))];

/**
 * Pack named color groups into the fixed slot layout. Groups are laid down in
 * declaration order starting at index 2; a group of N colors becomes N slots
 * named `group.0` .. `group.N-1` (or just `group` when N is 1).
 */
/**
 * Working-colour ceiling.
 *
 * The SNES allowed 15 per palette and a scene composed of many palettes; the old
 * cap of 12 was stricter than the hardware ever was, and it was the single
 * tightest constraint on the art — every ramp was three or four steps, so nothing
 * could shade smoothly and the generic lighting pass had nowhere to move a colour
 * to. Palettes resolve to RGBA at bake time, so the runtime cost of raising this
 * is exactly zero.
 */
const MAX_WORKING = 28;
const PALETTE_SLOTS = MAX_WORKING + 4; // transparent, outline, two flash steps

function buildPalette(name: string, groups: Record<string, Rgb[]>): Palette {
  const colors: Rgb[] = new Array(PALETTE_SLOTS).fill({ r: 0, g: 0, b: 0 });
  const idx: Record<string, number> = {};

  colors[0] = { r: 0, g: 0, b: 0 };
  colors[1] = quantize5(oklchToRgb(OUTLINE));
  idx['outline'] = 1;

  let slot = 2;
  for (const [group, list] of Object.entries(groups)) {
    for (let i = 0; i < list.length; i++) {
      if (slot >= MAX_WORKING + 2) {
        throw new Error(
          `palette "${name}": more than ${MAX_WORKING} working colors (at "${group}.${i}")`,
        );
      }
      colors[slot] = list[i]!;
      idx[list.length === 1 ? group : `${group}.${i}`] = slot;
      slot++;
    }
  }

  const flashA = PALETTE_SLOTS - 2;
  const flashB = PALETTE_SLOTS - 1;
  colors[flashA] = quantize5(oklchToRgb(FLASH_A));
  colors[flashB] = quantize5(oklchToRgb(FLASH_B));
  idx['flash.0'] = flashA;
  idx['flash.1'] = flashB;

  return { name, colors, idx };
}

/** Look up a slot, failing loudly rather than silently drawing transparent. */
/**
 * The next index *up* a colour's own ramp, or the index itself at the top.
 *
 * Lets a generic lighting pass brighten a pixel without knowing which material
 * it is: a green stays green, a purple stays purple, and nothing ever leaves the
 * palette — which is the whole discipline that keeps this reading as SNES rather
 * than as a filter applied to SNES.
 */
export function brighter(p: Palette, index: number): number {
  const entry = Object.entries(p.idx).find(([, v]) => v === index);
  if (!entry) return index;
  const dot = entry[0].lastIndexOf('.');
  if (dot < 0) return index;
  const group = entry[0].slice(0, dot);
  const step = Number(entry[0].slice(dot + 1));
  const up = p.idx[`${group}.${step + 1}`];
  return up ?? index;
}

/** The next index *down* a ramp — the shadow counterpart of brighter(). */
export function darker(p: Palette, index: number): number {
  const entry = Object.entries(p.idx).find(([, v]) => v === index);
  if (!entry) return index;
  const dot = entry[0].lastIndexOf('.');
  if (dot < 0) return index;
  const group = entry[0].slice(0, dot);
  const step = Number(entry[0].slice(dot + 1));
  if (step === 0) return index;
  const down = p.idx[`${group}.${step - 1}`];
  return down ?? index;
}

export function ci(p: Palette, slot: string): number {
  const v = p.idx[slot];
  if (v === undefined) {
    throw new Error(`palette "${p.name}": no slot "${slot}" (have: ${Object.keys(p.idx).join(', ')})`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Overworld / grass biome
// ---------------------------------------------------------------------------

export const PAL_TERRAIN = buildPalette('terrain', {
  // shadows cool and desaturated, highlights warm and more chromatic
  grass: ramp(9, { L: 0.34, C: 0.075, H: 152 }, { L: 0.76, C: 0.155, H: 124 }),
  dirt: ramp(5, { L: 0.40, C: 0.045, H: 68 }, { L: 0.73, C: 0.085, H: 80 }),
  water: ramp(5, { L: 0.36, C: 0.085, H: 252 }, { L: 0.70, C: 0.115, H: 228 }),
  bloom: one({ L: 0.84, C: 0.14, H: 95 }),
});

// ---------------------------------------------------------------------------
// Dungeon interior
// ---------------------------------------------------------------------------

export const PAL_DUNGEON = buildPalette('dungeon', {
  floor: ramp(9, { L: 0.30, C: 0.018, H: 268 }, { L: 0.71, C: 0.032, H: 248 }),
  wall: ramp(7, { L: 0.24, C: 0.022, H: 78 }, { L: 0.61, C: 0.048, H: 88 }),
  mortar: one({ L: 0.19, C: 0.012, H: 268 }),
  torch: ramp(3, { L: 0.62, C: 0.165, H: 48 }, { L: 0.86, C: 0.125, H: 88 }),
});

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * Aldez, keyed to assets/Portrait_Aldez.png rather than to Link.
 *
 * The portrait is the character bible for colour: brown hair with a silver
 * streak, weathered skin, a deep blue hooded cloak, a crimson scarf, brown
 * leather, and a cyan Formcraft rune on the glove. Twelve working colours is the
 * hard budget, so gold pauldron trim and a separate steel tone are deliberately
 * cut — neither survives being drawn at 16px, whereas the cloak/scarf/streak
 * silhouette reads instantly.
 */
export const PAL_PLAYER = buildPalette('player', {
  cloak: ramp(5, { L: 0.26, C: 0.075, H: 268 }, { L: 0.56, C: 0.105, H: 256 }),
  /**
   * The garment under the cloak.
   *
   * Added because Aldez had no tunic: cloak, torso, trousers and boots were all
   * one blue-violet, so from the scarf down he read as a single dark mass with a
   * head on it. A second garment ramp, warmer and a clear step lighter, is what
   * turns that mass into a chest, a belt and legs — and it costs five of the
   * eleven palette slots that were still free.
   */
  tunic: ramp(5, { L: 0.34, C: 0.050, H: 96 }, { L: 0.62, C: 0.065, H: 108 }),
  boot: one({ L: 0.28, C: 0.045, H: 56 }),
  scarf: ramp(3, { L: 0.40, C: 0.145, H: 24 }, { L: 0.58, C: 0.170, H: 32 }),
  skin: ramp(3, { L: 0.61, C: 0.080, H: 54 }, { L: 0.78, C: 0.060, H: 64 }),
  hair: ramp(3, { L: 0.27, C: 0.050, H: 52 }, { L: 0.46, C: 0.075, H: 62 }),
  streak: one({ L: 0.88, C: 0.012, H: 248 }),
  leather: one({ L: 0.36, C: 0.060, H: 58 }),
  rune: one({ L: 0.80, C: 0.135, H: 196 }),
});
// The portrait's amber eyes and gold pauldron trim both ride `scarf.1` rather
// than claiming palette slots of their own — the twelve-colour cap is the
// discipline that keeps this art reading as SNES, and one warm accent serving
// three roles is exactly how the era's artists worked within it.

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export const PAL_OCTOROK = buildPalette('octorok', {
  body: ramp(7, { L: 0.33, C: 0.115, H: 22 }, { L: 0.64, C: 0.175, H: 42 }),
  belly: ramp(3, { L: 0.70, C: 0.075, H: 68 }, { L: 0.86, C: 0.045, H: 82 }),
  eye: ramp(2, { L: 0.95, C: 0.01, H: 90 }, { L: 0.22, C: 0.03, H: 268 }),
});

export const PAL_MOBLIN = buildPalette('moblin', {
  body: ramp(7, { L: 0.32, C: 0.075, H: 292 }, { L: 0.63, C: 0.115, H: 312 }),
  gear: ramp(3, { L: 0.34, C: 0.055, H: 58 }, { L: 0.55, C: 0.075, H: 68 }),
  metal: ramp(3, { L: 0.55, C: 0.018, H: 252 }, { L: 0.87, C: 0.015, H: 250 }),
  eye: ramp(2, { L: 0.93, C: 0.02, H: 60 }, { L: 0.24, C: 0.04, H: 30 }),
});

/**
 * The slime: the first thing a player ever swings at.
 *
 * Deliberately the friendliest colour in the bestiary — a soft green with a lit
 * crown and a translucent rim, closer to a jelly than a monster. It has to read
 * as "hit me to learn what hitting does", not as a threat, because it is the
 * only Erratum in the waking meadow and the meadow's job is to teach.
 */
export const PAL_SLIME = buildPalette('slime', {
  // Saturated and opaque, not washed and translucent. The first version pushed
  // transparency and the creature dissolved into whatever it stood on; a slime
  // should read as a solid coloured shape from across the room, the way the
  // Dragon Warrior ones do, with the "wet" carried entirely by one hard specular
  // highlight rather than by low contrast.
  body: ramp(7, { L: 0.30, C: 0.115, H: 158 }, { L: 0.74, C: 0.165, H: 140 }),
  eye: ramp(3, { L: 0.12, C: 0.02, H: 260 }, { L: 0.98, C: 0.01, H: 110 }),
});

/**
 * Faces.
 *
 * Four skin ramps, two hair ramps and a cloth ramp, sharing one palette so every
 * portrait in the game can be drawn from a single atlas page. Skin varies by
 * person rather than by role — Amberwake is a place people come to, and a cast
 * where everyone looks the same undercuts the one thing the town is for, which
 * is being recognised across lives.
 */
export const PAL_FACE = buildPalette('face', {
  skinA: ramp(5, { L: 0.42, C: 0.055, H: 48 }, { L: 0.82, C: 0.045, H: 62 }),
  skinB: ramp(5, { L: 0.30, C: 0.060, H: 40 }, { L: 0.66, C: 0.050, H: 54 }),
  skinC: ramp(5, { L: 0.22, C: 0.045, H: 34 }, { L: 0.54, C: 0.040, H: 46 }),
  hair: ramp(5, { L: 0.14, C: 0.030, H: 40 }, { L: 0.58, C: 0.060, H: 68 }),
  cloth: ramp(5, { L: 0.24, C: 0.055, H: 250 }, { L: 0.60, C: 0.070, H: 268 }),
  eye: ramp(3, { L: 0.16, C: 0.030, H: 250 }, { L: 0.92, C: 0.020, H: 90 }),
});

export const PAL_KEESE = buildPalette('keese', {
  body: ramp(7, { L: 0.26, C: 0.045, H: 300 }, { L: 0.56, C: 0.075, H: 285 }),
  eye: ramp(2, { L: 0.72, C: 0.185, H: 32 }, { L: 0.95, C: 0.09, H: 60 }),
});

// ---------------------------------------------------------------------------
// Pickups / props
// ---------------------------------------------------------------------------

/** Collectables. Kept separate from props so each gets a full ramp per material. */
export const PAL_PICKUP = buildPalette('pickup', {
  heart: ramp(5, { L: 0.42, C: 0.155, H: 18 }, { L: 0.80, C: 0.175, H: 28 }),
  rupee: ramp(5, { L: 0.44, C: 0.115, H: 158 }, { L: 0.86, C: 0.135, H: 148 }),
  gold: ramp(5, { L: 0.55, C: 0.115, H: 78 }, { L: 0.93, C: 0.105, H: 95 }),
  bomb: ramp(5, { L: 0.24, C: 0.022, H: 268 }, { L: 0.58, C: 0.030, H: 255 }),
});

/** Destructibles and set dressing. */
export const PAL_PROP = buildPalette('prop', {
  pot: ramp(5, { L: 0.40, C: 0.065, H: 212 }, { L: 0.78, C: 0.085, H: 228 }),
  wood: ramp(5, { L: 0.32, C: 0.055, H: 56 }, { L: 0.62, C: 0.085, H: 70 }),
  stone: ramp(5, { L: 0.28, C: 0.018, H: 268 }, { L: 0.66, C: 0.030, H: 252 }),
  flame: ramp(5, { L: 0.58, C: 0.175, H: 38 }, { L: 0.94, C: 0.115, H: 92 }),
  // Straw, for the third roof. `pot` was tried here first and read as a swimming
  // pool: it is a blue ceramic glaze, and nothing that saturated has ever kept
  // rain off a house.
  thatch: ramp(5, { L: 0.36, C: 0.045, H: 82 }, { L: 0.70, C: 0.075, H: 96 }),
  /**
   * Faces, for the townsfolk.
   *
   * PAL_PROP had no skin tone, so folkSprite drew every head with `pot.4` — the
   * lightest step of the blue *ceramic glaze* ramp. Every person in Amberwake,
   * and the walker on the first screen, had a pale blue face. At sixteen pixels
   * that does not read as a person with an unusual complexion; it reads as a
   * tile stuck to their shoulders, which is exactly how it was reported.
   *
   * Three steps is all a head this size needs, and three is exactly what was
   * left under the 28-colour working cap.
   */
  face: ramp(3, { L: 0.44, C: 0.060, H: 48 }, { L: 0.74, C: 0.055, H: 62 }),
});

export const ALL_PALETTES: readonly Palette[] = [
  PAL_TERRAIN,
  PAL_DUNGEON,
  PAL_PLAYER,
  PAL_OCTOROK,
  PAL_MOBLIN,
  PAL_KEESE,
  PAL_SLIME,
  PAL_FACE,
  PAL_PICKUP,
  PAL_PROP,
];
