/**
 * npm run gen:verify
 *
 * The checks from the art-synthesis skill, automated. Run this before declaring
 * any art work done — several of these failures are invisible to the eye but
 * corrupt the render (bleeding, non-SNES color) or break the critic loop
 * (non-determinism, stale atlas).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isQuantized5 } from '../src/core/color.ts';
import { ART_SEED } from '../src/art/seed.ts';
import { decodePng } from '../src/art/png.ts';
import { GUTTER } from '../src/art/pack.ts';
import { RELICS } from '../src/chronicle/relics.ts';
import { computeArtHash } from './art-hash.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'atlas');

interface Cell { x: number; y: number; w: number; h: number; anchor: [number, number] }
interface Manifest { seed: number; width: number; height: number; cells: Record<string, Cell> }

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const atlasBytes = readFileSync(join(OUT, 'atlas.png'));
const manifest = JSON.parse(readFileSync(join(OUT, 'atlas.json'), 'utf8')) as Manifest;
const png = decodePng(atlasBytes);

// 1. dimensions agree between manifest and image
check(
  'manifest matches atlas dimensions',
  png.width === manifest.width && png.height === manifest.height,
  `${png.width}x${png.height}`,
);

// 2. seed is the fixed art seed, not a run seed
check('atlas built from ART_SEED', manifest.seed === ART_SEED, `0x${ART_SEED.toString(16)}`);

// 3. every visible pixel is 5-bit quantized
let unquantized = 0;
for (let i = 0; i < png.rgba.length; i += 4) {
  if (png.rgba[i + 3] === 0) continue;
  if (!isQuantized5({ r: png.rgba[i]!, g: png.rgba[i + 1]!, b: png.rgba[i + 2]! })) unquantized++;
}
check('all pixels 5-bit quantized', unquantized === 0, `${unquantized} bad pixels`);

// 4. cells stay inside the page
const cells = Object.entries(manifest.cells);
const outOfBounds = cells.filter(
  ([, c]) => c.x < 0 || c.y < 0 || c.x + c.w > png.width || c.y + c.h > png.height,
);
check('all cells within page', outOfBounds.length === 0, outOfBounds.map(([k]) => k).join(' '));

// 5. no two cells overlap, gutter included — overlap means UV bleed at runtime
let overlaps = 0;
for (let i = 0; i < cells.length; i++) {
  for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i]![1];
    const b = cells[j]![1];
    const sep =
      a.x + a.w + GUTTER <= b.x || b.x + b.w + GUTTER <= a.x ||
      a.y + a.h + GUTTER <= b.y || b.y + b.h + GUTTER <= a.y;
    if (!sep) overlaps++;
  }
}
check('no cell overlaps (incl. gutter)', overlaps === 0, `${overlaps} pairs`);

// 6. anchors sit inside their cell
const badAnchors = cells.filter(
  ([, c]) => c.anchor[0] < 0 || c.anchor[1] < 0 || c.anchor[0] > c.w || c.anchor[1] > c.h,
);
check('anchors within cells', badAnchors.length === 0, badAnchors.map(([k]) => k).join(' '));

// 7. atlas on disk matches the generators that claim to have produced it
// 8. Content referencing the atlas by string must actually resolve.
// A relic pointing at a cell that does not exist throws mid-frame the first time
// its screen opens — exactly the "content that can never appear" failure the
// world-gen skill warns about, and invisible until someone opens that menu.
const missingIcons = RELICS.filter((r) => manifest.cells[r.icon] === undefined);
check(
  'every relic icon resolves to an atlas cell',
  missingIcons.length === 0,
  missingIcons.map((r) => `${r.id}->${r.icon}`).join(' '),
);

const expected = readFileSync(join(OUT, 'atlas.hash'), 'utf8').trim();
check(
  'atlas is current with generators',
  computeArtHash(ROOT, ART_SEED, atlasBytes) === expected,
  'else: npm run gen:art',
);

console.log(
  failures.length === 0
    ? `\n${cells.length} cells verified.`
    : `\n${failures.length} check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
