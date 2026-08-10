/**
 * npm run lint:layers
 *
 * Enforces the subsystem dependency layering from the aldez-architecture skill.
 * A module may import from a strictly lower layer, or from its own subsystem —
 * never sideways across subsystems, never upward.
 *
 * The point is not tidiness. It is that one agent can own one subsystem and work
 * without reading the others, which is what makes the build order in the
 * gauntlet-loop skill tractable.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const LAYERS: Record<string, number> = {
  core: 0,
  render: 1, art: 1, audio: 1,
  // worldgen sits with chronicle: both are pure content/data that gen/ reads and
  // that must not reach up into the simulation. It deliberately uses its own
  // abstract terrain vocabulary rather than importing world/'s TileKind, which
  // would be a sideways dependency.
  worldgen: 2, chronicle: 2, world: 2, physics: 2,
  gen: 3, entity: 3,
  player: 4, ai: 4, fx: 4,
  ui: 5,
  game: 6,
  '': 7, // main.ts and anything else at the src/ root
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Subsystem = first path segment under src/; '' for files directly in src/. */
function subsystemOf(file: string): string {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const slash = rel.indexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

const violations: string[] = [];
let checked = 0;

for (const file of walk(SRC)) {
  const from = subsystemOf(file);
  const fromLayer = LAYERS[from];
  if (fromLayer === undefined) {
    violations.push(`${relative(ROOT, file)}: unknown subsystem "${from}" — add it to LAYERS`);
    continue;
  }

  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1]!;
    if (!spec.startsWith('.')) continue; // node: builtins and bare specifiers
    checked++;

    const target = subsystemOf(resolve(dirname(file), spec));
    if (target === from) continue; // within a subsystem, anything goes

    const toLayer = LAYERS[target];
    if (toLayer === undefined) {
      violations.push(`${relative(ROOT, file)}: imports unknown subsystem "${target}"`);
      continue;
    }
    if (toLayer >= fromLayer) {
      const direction = toLayer === fromLayer ? 'sideways' : 'upward';
      violations.push(
        `${relative(ROOT, file).replace(/\\/g, '/')}\n` +
          `  imports "${spec}"\n` +
          `  ${from} [${fromLayer}] -> ${target} [${toLayer}] is ${direction}. ` +
          `Use the core/ event bus instead.`,
      );
    }
  }
}

if (violations.length === 0) {
  console.log(`ok  ${checked} cross-module imports, no layer violations`);
  process.exit(0);
}
console.error(`\n${violations.length} layer violation(s):\n`);
for (const v of violations) console.error(`  ${v}\n`);
process.exit(1);
