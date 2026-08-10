/**
 * The Gazetteer — what exists in Ostreya, forever.
 *
 * This is the half of the world that never changes. Every entry here has the
 * same name, the same nature and the same meaning in every Draft the player will
 * ever see. Where it sits and what condition it is in belong to the Draft (see
 * placement.ts) and are rerolled on every death.
 *
 * That split is the whole design. A map dies with its Draft, so a player cannot
 * usefully memorise one. A *place list* survives, so they memorise this instead —
 * and by the fifth life they know the Ossuary lies under a graveyard and that
 * Veyrhold sits where roads meet, without knowing where any of it is this time.
 *
 * Entries are pure data. Adding the hundredth is an entry in this array and
 * nothing else; if a new place needs a branch in the solver, either the place is
 * badly specified or the schema is missing a field.
 */

import type { Tag } from './tags.ts';

export type SiteKind =
  | 'capital'
  | 'town'
  | 'village'
  | 'keep'
  | 'sanctum'
  | 'dungeon'
  | 'ruin'
  | 'waypoint';

/**
 * A soft preference about where a place belongs.
 *
 * Soft is the operative word. These are scored, never enforced — a coastal
 * village that lands inland is not re-rolled, it is *reported*, and the game
 * says "the harbour wall runs half a mile and there is no water behind it".
 * A thing in the wrong place is the premise, not a bug.
 */
export type Affinity =
  | 'coastal'
  | 'inland'
  | 'high'
  | 'lowland'
  | 'fertile'
  | 'arid'
  | 'cold'
  | 'warm'
  | 'forested'
  | 'open';

export interface GazetteerEntry {
  id: string;
  /** never changes, in any Draft, ever */
  name: string;
  kind: SiteKind;
  affinities: Affinity[];
  /** what standing here contributes to placement contracts */
  provides: Tag[];
  /** rooms across; footprint is roughly square */
  footprint: number;
  /** 0..7 for the eight relic sites; absent otherwise */
  sanctumIndex?: number;
  /**
   * Where in the world this belongs, 0 (near the wake point) to 1 (the edge).
   * Difficulty is distance, so this is also the difficulty dial — and it is what
   * spreads the eight Sanctums into an exploration order without a single gate.
   */
  ring: number;
  /** one line the player can be told about it, before they have ever seen it */
  lore: string;
}

/**
 * The eight Sanctums hold the eight Continuance Relics.
 *
 * Their ring values climb deliberately: the first is nearly underfoot, the last
 * is as far as Ostreya goes. Nothing stops a player walking straight at the
 * eighth on their first life — they simply will not survive it, which is a
 * better teacher than a locked door.
 */
export const GAZETTEER: readonly GazetteerEntry[] = [
  // === The seat of things ==================================================
  {
    id: 'veyrhold', name: 'Veyrhold', kind: 'capital',
    affinities: ['inland', 'fertile', 'open'],
    provides: ['settled', 'patrolled'], footprint: 3, ring: 0.35,
    lore: 'Veyrhold usually becomes the capital. Roads find it whether or not anyone builds them.',
  },

  // === Towns ================================================================
  {
    id: 'amberwake', name: 'Amberwake', kind: 'town',
    affinities: ['coastal', 'fertile', 'lowland'],
    provides: ['settled', 'fertile'], footprint: 2, ring: 0.18,
    lore: 'A harbour town. It has a harbour wall in every Draft, and water behind it in most.',
  },
  {
    id: 'glassmere', name: 'Glassmere', kind: 'town',
    affinities: ['coastal', 'lowland'],
    provides: ['settled', 'wetland'], footprint: 2, ring: 0.42,
    lore: 'Built on the mere. The bells are cast so they can be heard through fog.',
  },
  {
    id: 'belliron', name: 'Belliron', kind: 'town',
    affinities: ['high', 'cold'],
    provides: ['settled', 'rocky'], footprint: 2, ring: 0.6,
    lore: 'Where the bells are made. Orra Flint works metal here, in whatever life she has.',
  },
  {
    id: 'hollowroot', name: 'Hollowroot', kind: 'town',
    affinities: ['forested', 'fertile'],
    provides: ['settled', 'forested'], footprint: 2, ring: 0.5,
    lore: 'The wood grew back over it once. Nobody agrees on when.',
  },

  // === Villages =============================================================
  {
    id: 'thistlecomb', name: 'Thistlecomb', kind: 'village',
    affinities: ['fertile', 'open'], provides: ['settled'], footprint: 1, ring: 0.12,
    lore: 'Sheep, mostly. The oldest person here is always eleven years older than the village.',
  },
  {
    id: 'mirefall', name: 'Mirefall', kind: 'village',
    affinities: ['lowland', 'fertile'], provides: ['settled', 'wetland'], footprint: 1, ring: 0.3,
    lore: 'Stilts. Always stilts, even in the Drafts where the water never came.',
  },
  {
    id: 'greyhollow', name: 'Greyhollow', kind: 'village',
    affinities: ['forested', 'cold'], provides: ['settled', 'consecrated'], footprint: 1, ring: 0.4,
    lore: 'A village with a graveyard far too large for it.',
  },
  {
    id: 'saltmarch', name: 'Saltmarch', kind: 'village',
    affinities: ['arid', 'warm'], provides: ['settled', 'arid'], footprint: 1, ring: 0.55,
    lore: 'They mine the flats. In good Drafts they sell salt; in bad ones they eat it.',
  },
  {
    id: 'wintergate', name: 'Wintergate', kind: 'village',
    affinities: ['high', 'cold'], provides: ['settled', 'frozen'], footprint: 1, ring: 0.68,
    lore: 'The last door before the White Reach. Someone always keeps a light in it.',
  },

  // === Keeps and waypoints ==================================================
  {
    id: 'ordan-keep', name: 'Ordan Keep', kind: 'keep',
    affinities: ['high', 'open'], provides: ['patrolled', 'ruined'], footprint: 2, ring: 0.45,
    lore: 'Cael Ordan held it, holds it, or died holding it. Continuity above any one person.',
  },
  {
    id: 'the-lastward', name: 'The Lastward', kind: 'keep',
    affinities: ['inland', 'open'], provides: ['patrolled'], footprint: 2, ring: 0.72,
    lore: 'The furthest garrison anyone has ever bothered to man.',
  },
  {
    id: 'first-dawn-shrine', name: 'The Shrine of First Dawn', kind: 'waypoint',
    affinities: ['open', 'fertile'], provides: ['consecrated', 'luminous'], footprint: 1, ring: 0.08,
    lore: 'Where the Bell was first rung. Aldez wakes near it more often than chance allows.',
  },

  // === Dungeons =============================================================
  {
    id: 'the-ossuary', name: 'The Ossuary', kind: 'dungeon',
    affinities: ['cold', 'forested'], provides: ['subterranean', 'consecrated'], footprint: 1, ring: 0.38,
    lore: 'Beneath a graveyard. It is always beneath a graveyard.',
  },
  {
    id: 'drowned-scriptorium', name: 'The Drowned Scriptorium', kind: 'dungeon',
    affinities: ['coastal', 'lowland'], provides: ['subterranean', 'ruined'], footprint: 1, ring: 0.5,
    lore: 'A library that went under. The Chroniclers did not evacuate it.',
  },
  {
    id: 'belliron-mineheads', name: 'The Belliron Mineheads', kind: 'dungeon',
    affinities: ['high', 'cold'], provides: ['subterranean', 'rocky'], footprint: 1, ring: 0.65,
    lore: 'They dug for bell-metal and found the seam kept moving.',
  },
  {
    id: 'the-undercrown', name: 'The Undercrown', kind: 'dungeon',
    affinities: ['inland'], provides: ['subterranean', 'dark', 'ruined'], footprint: 2, ring: 0.85,
    lore: 'Under whatever the capital is this time. It was there before the capital was.',
  },

  // === The Eight ============================================================
  {
    id: 'sanctum-ember', name: 'The Ember Sanctum', kind: 'sanctum',
    affinities: ['warm', 'open'], provides: ['consecrated', 'luminous'],
    footprint: 1, sanctumIndex: 0, ring: 0.15,
    lore: 'The first thing Aldez refused to let the world forget.',
  },
  {
    id: 'sanctum-tide', name: 'The Tidebound Sanctum', kind: 'sanctum',
    affinities: ['coastal', 'lowland'], provides: ['consecrated', 'wetland'],
    footprint: 1, sanctumIndex: 1, ring: 0.28,
    lore: 'It floods and drains on no tide anyone can name.',
  },
  {
    id: 'sanctum-root', name: 'The Rootbound Sanctum', kind: 'sanctum',
    affinities: ['forested', 'fertile'], provides: ['consecrated', 'forested'],
    footprint: 1, sanctumIndex: 2, ring: 0.4,
    lore: 'The wood grew through the door and then held it shut.',
  },
  {
    id: 'sanctum-ash', name: 'The Ashen Sanctum', kind: 'sanctum',
    affinities: ['arid', 'warm'], provides: ['consecrated', 'barren'],
    footprint: 1, sanctumIndex: 3, ring: 0.52,
    lore: 'Everything in it burned once and none of it is gone.',
  },
  {
    id: 'sanctum-glass', name: 'The Glass Sanctum', kind: 'sanctum',
    affinities: ['cold', 'high'], provides: ['consecrated', 'frozen'],
    footprint: 1, sanctumIndex: 4, ring: 0.63,
    lore: 'You can see every room in it from every other room, and reach none of them.',
  },
  {
    id: 'sanctum-iron', name: 'The Iron Sanctum', kind: 'sanctum',
    affinities: ['high', 'cold'], provides: ['consecrated', 'rocky'],
    footprint: 1, sanctumIndex: 5, ring: 0.74,
    lore: 'A bell hangs in it that has never been rung and is worn smooth.',
  },
  {
    id: 'sanctum-hollow', name: 'The Hollow Sanctum', kind: 'sanctum',
    affinities: ['inland', 'open'], provides: ['consecrated', 'dark'],
    footprint: 1, sanctumIndex: 6, ring: 0.86,
    lore: 'It contains nothing. The relic is in the nothing.',
  },
  {
    id: 'sanctum-last', name: 'The Last Sanctum', kind: 'sanctum',
    affinities: ['high'], provides: ['consecrated', 'barren', 'dark'],
    footprint: 1, sanctumIndex: 7, ring: 0.96,
    lore: 'As far as Ostreya goes. Whatever guards it has never let anyone leave.',
  },
];

export function entryById(id: string): GazetteerEntry {
  const found = GAZETTEER.find((e) => e.id === id);
  if (!found) throw new Error(`gazetteer: no entry "${id}"`);
  return found;
}

export const SANCTUMS: readonly GazetteerEntry[] = GAZETTEER
  .filter((e) => e.sanctumIndex !== undefined)
  .sort((a, b) => a.sanctumIndex! - b.sanctumIndex!);

/**
 * Condition a place is found in. Rolled per entry per Draft, independent of
 * where it landed — the same town is a harvest fair, then a garrison that turns
 * you away, then a black scar with the bell still standing.
 */
export const CONDITIONS = [
  'flourishing', 'occupied', 'besieged', 'abandoned',
  'burned', 'drowned', 'buried', 'plagued',
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Tags a condition contributes, on top of the entry's own. */
export const CONDITION_TAGS: Record<Condition, Tag[]> = {
  flourishing: ['settled', 'fertile'],
  occupied: ['settled', 'patrolled'],
  besieged: ['patrolled', 'ruined'],
  abandoned: ['ruined', 'wild'],
  burned: ['ruined', 'barren'],
  drowned: ['wetland', 'ruined'],
  buried: ['subterranean', 'ruined'],
  plagued: ['ruined', 'dark'],
};
