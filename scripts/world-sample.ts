/**
 * npm run world:sample [seed]
 *
 * Print one Ostreya: where everything landed, what state it is in, and what the
 * world is saying wrong. The fastest way to judge whether a seed reads as a
 * place rather than as noise.
 */

import { makeRng } from '../src/core/rng.ts';
import { ClimateMap } from '../src/worldgen/fields.ts';
import { placeWorld, describeLead, describeViolation } from '../src/worldgen/placement.ts';

const seed = Number(process.argv[2] ?? 7);
const GRID = 64;
const world = placeWorld(new ClimateMap(seed), makeRng(seed), GRID, GRID, seed % 9);

console.log(`\nOSTREYA  seed ${seed}   ${GRID}x${GRID} rooms`);
console.log(`Aldez wakes at ${world.wake.rx},${world.wake.ry}\n`);

const rows = [...world.sites].sort((a, b) => a.threat - b.threat);
console.log('  place                        kind      at        threat  condition');
console.log('  ' + '-'.repeat(74));
for (const s of rows) {
  const mark = s.entry.sanctumIndex !== undefined ? `*${s.entry.sanctumIndex}` : '  ';
  console.log(
    `${mark} ${s.entry.name.padEnd(28)} ${s.entry.kind.padEnd(9)} ` +
    `${String(s.rx).padStart(2)},${String(s.ry).padEnd(6)} ` +
    `${s.threat.toFixed(2)}    ${s.condition}`,
  );
}

console.log('\nWhat is wrong here:');
const wrong = world.sites.map(describeViolation).filter((v): v is string => v !== null);
if (wrong.length === 0) console.log('  (nothing — this Draft came out close to true)');
for (const w of wrong) console.log(`  - ${w}`);

console.log('\nLeads from the waking place:');
for (const s of rows.slice(0, 4)) {
  console.log(`  ${describeLead(s, world.wake)}`);
}
console.log();
