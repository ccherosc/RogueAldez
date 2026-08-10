/**
 * Fingerprint of everything that determines the atlas: the seed, the generator
 * sources, and any hand-painted overrides.
 *
 * Shared by gen-art (writes it), verify-art (checks it), and the dev server
 * (shouts when the art on disk no longer matches the code that made it). Art
 * drifting silently out of sync with its generators is exactly the confound that
 * makes a critic capture untrustworthy.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Generator sources, in a fixed order — the hash must not depend on readdir order. */
export const ART_SOURCES = [
  'src/art/palettes.ts',
  'src/art/tiles.ts',
  'src/art/sprites.ts',
  'src/art/pixels.ts',
  'src/art/pack.ts',
  'src/art/seed.ts',
  'src/core/color.ts',
] as const;

export function overrideFiles(root: string): string[] {
  const dir = join(root, 'src', 'art', 'overrides');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
}

/**
 * `atlasPng` is folded in so the hash also catches a hand-edited atlas.png —
 * omit it only when you need the input-side fingerprint alone.
 */
export function computeArtHash(root: string, seed: number, atlasPng?: Buffer): string {
  const h = createHash('sha256');
  h.update(String(seed));
  for (const rel of ART_SOURCES) h.update(readFileSync(join(root, rel)));
  for (const file of overrideFiles(root)) {
    h.update(file);
    h.update(readFileSync(join(root, 'src', 'art', 'overrides', file)));
  }
  if (atlasPng) h.update(atlasPng);
  return h.digest('hex');
}
