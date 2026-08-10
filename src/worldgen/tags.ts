/**
 * The tag vocabulary.
 *
 * This is the single most important file in the world builder. Tags are how a
 * conflict becomes *unrepresentable* rather than merely detected: a tombstone
 * requires `consecrated`, only an ossuary or a graveyard site provides it, and
 * so there is no code path that can place a tombstone in open desert. Detection
 * scales as O(biomes x content); this scales as O(1).
 *
 * Rules, learned the hard way in every project that has tried this:
 *
 *  1. Tags describe **the place**, never the content. `arid`, not `desert-stuff`.
 *  2. One canonical list. Two tags meaning the same thing is how the system rots
 *     — `wet` and `wetland` both existing means half the content checks the wrong
 *     one and nobody notices for a month.
 *  3. Every tag must be *provided* by something and *used* by something. The
 *     validator enforces this, because an orphan tag is either dead content or a
 *     typo, and both are invisible in play.
 */

export const TAGS = [
  // --- climate ---
  'hot',
  'temperate',
  'cold',
  'frozen',
  'arid',
  'wetland',

  // --- terrain ---
  'grassland',
  'forested',
  'rocky',
  'lowland',
  'high-altitude',
  'coastal',
  'subterranean',

  // --- light ---
  'dark',
  'luminous',

  // --- human history ---
  'wild',
  'settled',
  'ruined',
  'patrolled',
  'consecrated',

  // --- fertility ---
  'fertile',
  'barren',
] as const;

export type Tag = (typeof TAGS)[number];

const TAG_SET: ReadonlySet<string> = new Set(TAGS);

export function isTag(value: string): value is Tag {
  return TAG_SET.has(value);
}

/**
 * Tags that must never appear together on one tile.
 *
 * These are contradictions in the *place*, not in the content — a tile cannot be
 * both frozen and hot. The validator sweeps generated worlds for these, and a hit
 * means a biome is mis-specified rather than that content needs another rule.
 */
export const CONTRADICTIONS: ReadonlyArray<readonly [Tag, Tag]> = [
  ['hot', 'frozen'],
  ['hot', 'cold'],
  ['arid', 'wetland'],
  ['wild', 'settled'],
  ['fertile', 'barren'],
  ['lowland', 'high-altitude'],
  ['dark', 'luminous'],
];

/** Union of tag sources for one tile: biome, any site standing on it, the Draft. */
export function unionTags(...sources: ReadonlyArray<readonly Tag[] | undefined>): Set<Tag> {
  const out = new Set<Tag>();
  for (const source of sources) {
    if (!source) continue;
    for (const tag of source) out.add(tag);
  }
  return out;
}

export function findContradiction(tags: ReadonlySet<Tag>): readonly [Tag, Tag] | null {
  for (const pair of CONTRADICTIONS) {
    if (tags.has(pair[0]) && tags.has(pair[1])) return pair;
  }
  return null;
}
