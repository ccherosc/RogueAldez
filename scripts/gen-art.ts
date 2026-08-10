/**
 * npm run gen:art
 *
 * Generates every tile and sprite from code, packs them into a deterministic
 * atlas, and writes a labelled contact sheet for review.
 *
 * Output:
 *   public/atlas/atlas.png     the packed texture
 *   public/atlas/atlas.json    key -> {x, y, w, h, anchor}
 *   public/atlas/contact.png   labelled review sheet
 *   public/atlas/atlas.hash    generator+seed fingerprint, checked at boot
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeArtHash } from './art-hash.ts';

import { ART_SCALE } from '../src/core/const.ts';
import { makeRng } from '../src/core/rng.ts';
import { isQuantized5 } from '../src/core/color.ts';
import { ART_SEED } from '../src/art/seed.ts';
import { PixelBuffer, upscaleSprite, rimLight } from '../src/art/pixels.ts';
import { brighter, darker, ci } from '../src/art/palettes.ts';
import { ALL_PALETTES } from '../src/art/palettes.ts';
import { TILES, TILE_TEX, GRASS_OVER_DIRT, blob47Masks, drawAutotile } from '../src/art/tiles.ts';
import { allSprites } from '../src/art/sprites.ts';
import { packAtlas } from '../src/art/pack.ts';
import type { AtlasEntry } from '../src/art/pack.ts';
import { renderContactSheet } from '../src/art/contact.ts';
import { decodePng, encodePng } from '../src/art/png.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'atlas');

function main(): void {
  const rng = makeRng(ART_SEED);
  const entries: AtlasEntry[] = [];

  // --- palette sanity, before anything is drawn with them -------------------
  for (const pal of ALL_PALETTES) {
    pal.colors.forEach((c, i) => {
      if (i > 0 && !isQuantized5(c)) {
        throw new Error(`palette "${pal.name}" index ${i} is not 5-bit quantized`);
      }
    });
  }

  // --- tiles: drawn natively at texel resolution ------------------------------
  for (const gen of TILES) {
    for (let v = 0; v < gen.variants; v++) {
      const px = new PixelBuffer(TILE_TEX, TILE_TEX);
      gen.draw(px, rng.stream(`tile:${gen.key}:${v}`), v);
      entries.push({ key: `${gen.key}.${v}`, buffer: px, palette: gen.palette, anchor: [0, 0] });
    }
  }

  // --- autotile transitions ---------------------------------------------------
  const masks = blob47Masks();
  for (const mask of masks) {
    const px = new PixelBuffer(TILE_TEX, TILE_TEX);
    drawAutotile(px, GRASS_OVER_DIRT, mask, rng.stream(`auto:${mask}`));
    entries.push({
      key: `${GRASS_OVER_DIRT.key}.${String(mask).padStart(3, '0')}`,
      buffer: px,
      palette: GRASS_OVER_DIRT.palette,
      anchor: [0, 0],
    });
  }

  // --- sprites: hand-plotted at 1x, doubled with Scale2x ----------------------
  // EPX rounds the staircases and keeps flats flat — the "same sprite, redrawn
  // finer" of the console remasters. Anchors double with the buffer.
  for (const s of allSprites(rng.stream('sprites'))) {
    // Sprites are hand-plotted at world resolution, so they reach texel density
    // through repeated EPX rather than being redrawn: each pass rounds the
    // staircases the previous one left, which is exactly how the console
    // remasters upscale their own source art.
    const doubled = upscaleSprite(s.buffer, ART_SCALE);
    // One light direction across every sprite in the game: a lit texel along the
    // upper-left of each form, a shaded one along the lower-right. Applies to
    // monsters, props and pickups alike, which is why the whole cast gains form
    // rather than just the hero.
    if (s.lit !== false) {
      const pal = s.palette;
      rimLight(
        doubled,
        (i) => brighter(pal, i),
        (i) => darker(pal, i),
        ci(pal, 'outline'),
        // Half a world pixel of rim, whatever the density.
        Math.max(1, ART_SCALE / 2),
      );
    }
    // Detail that only exists at 2x, added after the doubling: EPX can round a
    // staircase but it cannot invent a cheekbone.
    s.refine?.(doubled);
    entries.push({
      key: s.key,
      buffer: doubled,
      palette: s.palette,
      anchor: [s.anchor[0] * ART_SCALE, s.anchor[1] * ART_SCALE],
    });
  }

  // --- hand-painted overrides ----------------------------------------------
  // Applied last, so a PNG named after a cell wins over whatever was generated.
  const overrideDir = join(ROOT, 'src', 'art', 'overrides');
  const overrideFiles = existsSync(overrideDir)
    ? readdirSync(overrideDir).filter((f) => f.endsWith('.png')).sort()
    : [];
  const byKey = new Map(entries.map((e) => [e.key, e]));
  for (const file of overrideFiles) {
    const key = file.slice(0, -4);
    const entry = byKey.get(key);
    if (!entry) {
      // Loud, because a typo'd filename would otherwise silently do nothing.
      console.warn(`warn    override "${file}" matches no generated cell — ignored`);
      continue;
    }
    entry.override = decodePng(readFileSync(join(overrideDir, file)));
  }

  // --- pack + emit ----------------------------------------------------------
  const atlas = packAtlas(entries);
  mkdirSync(OUT, { recursive: true });

  const atlasPng = encodePng(atlas.width, atlas.height, atlas.rgba);
  writeFileSync(join(OUT, 'atlas.png'), atlasPng);
  // Surface normals, same layout. Lets lights strike form rather than just
  // brighten pixels — see deriveNormals().
  writeFileSync(
    join(OUT, 'atlas-normal.png'),
    encodePng(atlas.width, atlas.height, atlas.normals),
  );

  const manifest = {
    seed: ART_SEED,
    width: atlas.width,
    height: atlas.height,
    cells: Object.fromEntries(
      atlas.cells.map((c) => [c.key, { x: c.x, y: c.y, w: c.w, h: c.h, anchor: c.anchor }]),
    ),
  };
  writeFileSync(join(OUT, 'atlas.json'), JSON.stringify(manifest, null, 2));

  const patchKeys = ['grass.base.0', 'dirt.base.0', 'floor.dungeon.0', 'wall.dungeon.0', 'water.base.0'];
  const sheet = renderContactSheet(atlas, patchKeys);
  writeFileSync(join(OUT, 'contact.png'), encodePng(sheet.width, sheet.height, sheet.rgba));

  // Fingerprint the generators + seed so the dev server can shout when the art
  // on disk no longer matches the code that produced it.
  writeFileSync(join(OUT, 'atlas.hash'), computeArtHash(ROOT, ART_SEED, atlasPng));

  // --- report ---------------------------------------------------------------
  const tileCount = TILES.reduce((n, t) => n + t.variants, 0);
  const spriteCount = entries.length - tileCount - masks.length;
  console.log(`atlas   ${atlas.width}x${atlas.height}  (${atlasPng.length} bytes)`);
  console.log(`tiles   ${tileCount} base + ${masks.length} autotile transitions`);
  console.log(`sprites ${spriteCount}`);
  console.log(`cells   ${atlas.cells.length}  (${overrideFiles.length} hand-painted override(s))`);
  console.log(`wrote   public/atlas/{atlas.png, atlas.json, contact.png, atlas.hash}`);
}

main();
