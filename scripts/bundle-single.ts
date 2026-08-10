/**
 * npm run bundle
 *
 * Fold the production build into one self-contained HTML file: game code
 * inlined, atlas embedded as data URIs. Made for hosts that permit no network
 * requests at all (the claude.ai artifact CSP) — the page must carry everything
 * it will ever load.
 *
 * Run `vite build` first; this reads dist/.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'rogue-aldez.html');

const built = readFileSync(join(DIST, 'index.html'), 'utf8');

// The artifact host wraps whatever it is given in its own <html><head><body>
// skeleton. Publishing a complete document therefore nests one document inside
// another, and what the parser salvages from that is anyone's guess — so the
// output is a **body fragment**: styles, markup and scripts, no shell of its own.
const styles = built.match(/<style>[\s\S]*?<\/style>/)?.[0];
// Vite hoists the built script tag into <head>, so the body holds only markup —
// take each piece from wherever it actually is and compose explicitly. The
// first version of this script extracted the body and string-replaced the
// script tag "in place"; both replaces silently no-opped and the output was a
// 3 KB shell that looked exactly like a frozen game.
let bodyInner = built.match(/<body>([\s\S]*?)<\/body>/)?.[1];
if (!styles || !bodyInner) throw new Error('could not extract style/body from dist/index.html');
bodyInner = bodyInner.replace(/<script[\s\S]*?<\/script>/g, '');

// --- inline the JS bundle ---------------------------------------------------
const jsFile = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
if (!jsFile) throw new Error('no JS bundle in dist/assets — run `vite build` first');
let js = readFileSync(join(DIST, 'assets', jsFile), 'utf8');

// A literal `</script` anywhere in the code would terminate the inline tag
// mid-bundle. Escaping the slash is a no-op inside JS strings and regexes.
js = js.replaceAll('</script', '<\\/script');

let html = `${styles}\n${bodyInner.trim()}\n<script type="module">${js}</script>`;

// --- embed the atlas --------------------------------------------------------
const atlasJson = readFileSync(join(ROOT, 'public', 'atlas', 'atlas.json'), 'utf8');
const atlasPng = readFileSync(join(ROOT, 'public', 'atlas', 'atlas.png'));
const normalPng = readFileSync(join(ROOT, 'public', 'atlas', 'atlas-normal.png'));
const bundle =
  `<script>window.__ALDEZ_BUNDLE = { atlasJson: ${atlasJson}, ` +
  `atlasPng: "data:image/png;base64,${atlasPng.toString('base64')}", ` +
  `atlasNormalPng: "data:image/png;base64,${normalPng.toString('base64')}" };</script>`;

// Must be parsed before the module script reads it; modules defer, plain
// scripts do not, so document order alone is enough.
html = html.replace('<script type="module">', `${bundle}\n    <script type="module">`);

// --- controls hint ----------------------------------------------------------
// A hosted link gets opened cold, with no README beside it. One dim line in the
// game's own HUD voice, gone at the first keypress; touch devices get the
// on-screen pad instead and never see it.
const hint = `
    <div id="hint" style="position:fixed;left:0;right:0;bottom:12px;text-align:center;
      color:#8de08d;opacity:.75;font:12px/1.6 ui-monospace,Consolas,monospace;
      text-shadow:0 1px 0 #000;pointer-events:none;">
      click the game, then press any key for sound<br>
      arrows/wasd move &nbsp;·&nbsp; Z sword (hold to spin) &nbsp;·&nbsp; X lift/throw
      &nbsp;·&nbsp; C item &nbsp;·&nbsp; Q cycle &nbsp;·&nbsp; F fullscreen
    </div>
    <script>
      addEventListener('keydown', () => document.getElementById('hint')?.remove(), { once: true });
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('hint')?.remove();
      }
    </script>`;
html = `${html}\n${hint}`;

// The failure mode of this script is not an error, it is a plausible-looking
// shell with nothing inside. Refuse to write one.
if (html.length < 60_000) {
  throw new Error(`bundle suspiciously small (${html.length} bytes) — inlining failed`);
}
if (!html.includes('__ALDEZ_BUNDLE')) throw new Error('atlas bundle missing from output');

writeFileSync(OUT, html);
console.log(`wrote dist/rogue-aldez.html  (${(html.length / 1024).toFixed(0)} KB, body fragment, self-contained)`);
