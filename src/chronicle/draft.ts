/**
 * The Draft record.
 *
 * A generated world is a **Draft** — a rewritten history, not a shuffled level.
 * This is the "write the history first" stage from dungeon-gen: roll the
 * historical variables here, and let gen/ derive the map from them. Nothing in
 * this module knows what a tile is.
 *
 * It is deliberately plain data and fully diffable, because the death sequence
 * renders the difference between the outgoing Draft and the incoming one.
 */

import type { Rng } from '../core/rng.ts';

/** How the Vale is doing this time round. Drives palette, hazards and enemy mix. */
export const VALE_CONDITIONS = [
  'harvest',    // prosperous, festival season
  'occupied',   // Crown soldiers hold the roads
  'flooded',    // the river took the low fields
  'overrun',    // Errata in the open
  'abandoned',  // the villages emptied and nobody recorded why
] as const;
export type ValeCondition = (typeof VALE_CONDITIONS)[number];

const RULERS = [
  'Queen Maeryn',
  'the Regency of Bells',
  'Maeryn the Third, a child',
  'no one — the throne stands empty',
  'the Ash Choir',
];

const FACTIONS = [
  'the Crown',
  'the Lantern Guild',
  'the Keepers of the Ninth Bell',
  'the Ash Choir',
  'no one at all',
];

/** Mara is an Anchor: her role varies, her curiosity never does. */
const MARA_ROLES = [
  'royal archivist',
  'a traveling thief',
  'a village healer',
  'a prisoner accused of forbidden magic',
  'the leader of a rebellion',
  'an elderly historian',
  'a child who dreams about Aldez',
];

const REPUTATIONS = [
  'a stranger',
  'a hero of the old wars',
  'the monster who burned Venn Tor',
  'a saint with a shrine on the hill',
  'a name struck from every record',
];

const DUNGEON_HISTORIES = [
  'a mill',
  'a temple',
  'a prison',
  'a mine',
  'a buried war engine',
];

export interface Draft {
  /** 1 for the first world; increments every time Aldez falls */
  index: number;
  seed: number;
  ruler: string;
  faction: string;
  condition: ValeCondition;
  maraRole: string;
  reputation: string;
  dungeonHistory: string;
  /** how unstable reality is here — rises with the Draft index and relic load */
  instability: number;
}

export function rollDraft(index: number, rng: Rng, instability = 0): Draft {
  const r = rng.stream(`draft:${index}`);
  return {
    index,
    seed: r.int(1, 0x7fffffff),
    ruler: r.pick(RULERS),
    faction: r.pick(FACTIONS),
    condition: r.pick(VALE_CONDITIONS),
    maraRole: r.pick(MARA_ROLES),
    reputation: r.pick(REPUTATIONS),
    dungeonHistory: r.pick(DUNGEON_HISTORIES),
    instability,
  };
}

/**
 * Which Errata can appear. This is *content*, not behaviour — which types exist
 * in a Draft is a historical variable, while how they act is ai/'s business. It
 * lives here so gen/ can read a roster without reaching up a layer.
 */
export const ENEMY_TYPES = ['octorok', 'moblin', 'keese'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export function enemyPool(draft: Draft): EnemyType[] {
  const pool: EnemyType[] = [...ENEMY_TYPES];
  // An overrun Vale has more of the things that move unpredictably.
  if (draft.condition === 'overrun') pool.push('keese', 'moblin');
  if (draft.condition === 'occupied') pool.push('moblin');
  return pool;
}

export interface Revision {
  label: string;
  from: string;
  to: string;
}

/**
 * What changed between two Drafts, phrased as the world being rewritten.
 *
 * This is the content of the death scene — the player should be able to read the
 * cost of dying, not just watch a fade. Only differences are returned; a variable
 * that survived the rewrite is not news.
 */
export function diffDrafts(before: Draft, after: Draft): Revision[] {
  const out: Revision[] = [];
  const add = (label: string, a: string, b: string): void => {
    if (a !== b) out.push({ label, from: a, to: b });
  };

  add('Ostreya is ruled by', before.ruler, after.ruler);
  add('Amberwake Vale is held by', before.faction, after.faction);
  add('The Vale remembers', before.condition, after.condition);
  add('Mara Venn is', before.maraRole, after.maraRole);
  add('Aldez is remembered as', before.reputation, after.reputation);
  add('The mill was always', before.dungeonHistory, after.dungeonHistory);
  return out;
}

/** One-line summary for the HUD and debug overlay. */
export function draftSummary(d: Draft): string {
  return `Draft ${d.index} — ${d.condition}, held by ${d.faction}`;
}
