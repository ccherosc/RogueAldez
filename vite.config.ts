import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

import { computeArtHash } from './scripts/art-hash.ts';
import { ART_SEED } from './src/art/seed.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Fail loudly when the atlas on disk no longer matches the generators that made
 * it. Stale art silently invalidates every critic capture, so this shouts rather
 * than warns quietly.
 */
function artFreshness(): Plugin {
  return {
    name: 'aldez:art-freshness',
    configureServer() {
      const atlas = join(ROOT, 'public', 'atlas', 'atlas.png');
      const hashFile = join(ROOT, 'public', 'atlas', 'atlas.hash');

      if (!existsSync(atlas) || !existsSync(hashFile)) {
        console.error('\n  [aldez] no atlas found — run `npm run gen:art`\n');
        return;
      }
      const actual = computeArtHash(ROOT, ART_SEED, readFileSync(atlas));
      if (actual !== readFileSync(hashFile, 'utf8').trim()) {
        console.error(
          '\n  [aldez] ATLAS IS STALE — the art generators changed since the last' +
            '\n          `npm run gen:art`. What you see in the browser is not what' +
            '\n          the code produces. Regenerate before judging anything.\n',
        );
      }
    },
  };
}

export default {
  plugins: [artFreshness()],
  server: {
    port: 5173,
    watch: {
      // A file held open by an image editor makes chokidar throw EBUSY on
      // Windows, which takes the whole dev server down. Nothing here is a module
      // graph input, so there is no reason to watch it.
      ignored: ['**/.captures/**', '**/assets/**', '**/public/atlas/**'],
    },
  },
  build: { target: 'es2022' },
};
