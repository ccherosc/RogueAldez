/**
 * Everything the world can put on the ground, and the contract that decides
 * where it may go.
 *
 * Placement is a **filter**, and the filter is the whole mechanism. A tombstone
 * is not "a graveyard prop" by convention — it is unplaceable anywhere that does
 * not actively provide `consecrated`. There is deliberately no escape hatch, no
 * "place anyway" flag: the moment one exists, it gets used, and the guarantee is
 * gone.
 */

import type { Rng } from '../core/rng.ts';
import type { Tag } from './tags.ts';

export type PlaceableKind = 'prop' | 'enemy' | 'critter';

export interface Placeable {
  id: string;
  kind: PlaceableKind;
  /** atlas cell for props; variant id for enemies and critters */
  key: string;
  /** ALL of these must be present on the tile */
  requires: Tag[];
  /** NONE of these may be present */
  forbids: Tag[];
  weight: number;
  /** props only: can the player pick it up and throw it */
  liftable?: boolean;
  /** props only: does the sword break it */
  breakable?: boolean;
  /** props only: blocks movement. Defaults true; a bush you wade through is false */
  solid?: boolean;
  /**
   * What this enemy *does to the player's position*, which is the only thing
   * that matters when composing a fight.
   *
   *   ranged  punishes standing still, and is only interesting with distance
   *   rusher  punishes committing to a swing, and must be able to reach you
   *   swarm   punishes tunnel vision; individually trivial
   *
   * Three of one role is one fight repeated three times. Roles mixed *and placed
   * with intent* is a problem: a ranged unit behind two rushers means closing
   * through them or going around, and that decision is the encounter.
   */
  role?: EnemyRole;
}

export type EnemyRole = 'ranged' | 'rusher' | 'swarm';

export const PLACEABLES: readonly Placeable[] = [
  // --- vegetation -----------------------------------------------------------
  {
    // You wade through a bush; it slows nothing and hides nothing, but it can
    // still be cut down or picked up and thrown. Walk-through-but-destructible
    // is what makes undergrowth feel like undergrowth instead of furniture.
    id: 'bush', kind: 'prop', key: 'prop.bush', weight: 10,
    requires: ['fertile'], forbids: ['subterranean', 'frozen', 'arid'],
    liftable: true, breakable: true, solid: false,
  },
  {
    // Too big for a blade. A blast fells it (an axe will too, once axes exist) —
    // the first thing in the game that teaches "wrong tool".
    id: 'tree', kind: 'prop', key: 'prop.tree', weight: 6,
    requires: ['fertile'], forbids: ['subterranean', 'wetland', 'barren'],
    breakable: true,
  },
  {
    id: 'flower', kind: 'prop', key: 'prop.flower', weight: 7,
    requires: ['fertile', 'luminous'], forbids: ['subterranean'],
    breakable: true, solid: false,
  },
  {
    id: 'reeds', kind: 'prop', key: 'prop.reeds', weight: 9,
    requires: ['wetland'], forbids: ['subterranean', 'frozen'],
    liftable: true, breakable: true,
  },

  // --- settlement -----------------------------------------------------------
  {
    id: 'pot', kind: 'prop', key: 'prop.pot', weight: 8,
    requires: [], forbids: ['wild'],
    liftable: true, breakable: true,
  },
  {
    id: 'crate', kind: 'prop', key: 'prop.crate', weight: 6,
    requires: ['settled'], forbids: ['wetland'],
    liftable: true, breakable: true,
  },
  {
    id: 'chest', kind: 'prop', key: 'prop.chest.closed', weight: 2,
    requires: [], forbids: [],
    breakable: false,
  },
  {
    id: 'torch', kind: 'prop', key: 'prop.torch.0', weight: 5,
    requires: ['dark'], forbids: [],
    breakable: false,
  },

  // --- stone ----------------------------------------------------------------
  {
    id: 'rock', kind: 'prop', key: 'prop.rock', weight: 9,
    requires: ['rocky'], forbids: [],
    liftable: true, breakable: true,
  },
  {
    // Wind-scoured stacks. Barren ground has nothing growing on it, so its
    // scenery has to come from the geology instead.
    id: 'cairn', kind: 'prop', key: 'prop.stalagmite', weight: 7,
    requires: ['barren'], forbids: ['wetland', 'forested'],
    breakable: false,
  },
  {
    id: 'driftwood', kind: 'prop', key: 'prop.crate', weight: 6,
    requires: ['coastal'], forbids: ['subterranean'],
    liftable: true, breakable: true,
  },
  {
    id: 'fallen-log', kind: 'prop', key: 'prop.rock', weight: 7,
    requires: ['forested'], forbids: ['subterranean'],
    liftable: true, breakable: true,
  },
  {
    id: 'rubble', kind: 'prop', key: 'prop.rock', weight: 8,
    requires: ['ruined'], forbids: [],
    liftable: true, breakable: true,
  },
  {
    id: 'stalagmite', kind: 'prop', key: 'prop.stalagmite', weight: 8,
    requires: ['subterranean'], forbids: ['luminous'],
    breakable: false,
  },

  // --- the case this whole system exists for --------------------------------
  // Only an ossuary or a stamped graveyard provides `consecrated`. No seed, in
  // any biome, can put this anywhere else.
  {
    id: 'tombstone', kind: 'prop', key: 'prop.tombstone', weight: 12,
    requires: ['consecrated'], forbids: ['wetland'],
    breakable: false,
  },

  // --- fauna ----------------------------------------------------------------
  // Not Errata. Harmless living things that flee — placed so that a field has
  // something in it besides what wants to kill you.
  {
    id: 'sparrow', kind: 'critter', key: 'sparrow', weight: 8,
    requires: ['fertile'], forbids: ['subterranean', 'frozen'],
  },
  {
    id: 'frog', kind: 'critter', key: 'frog', weight: 8,
    requires: ['wetland'], forbids: ['subterranean', 'frozen'],
  },

  // --- Errata ---------------------------------------------------------------
  {
    id: 'octorok', kind: 'enemy', key: 'octorok', role: 'ranged', weight: 10,
    requires: [], forbids: ['frozen'],
  },
  {
    id: 'moblin', kind: 'enemy', key: 'moblin', role: 'rusher', weight: 9,
    requires: [], forbids: [],
  },
  {
    id: 'keese', kind: 'enemy', key: 'keese', role: 'swarm', weight: 10,
    requires: [], forbids: ['luminous'],
  },
  {
    id: 'slime', kind: 'enemy', key: 'slime', role: 'rusher', weight: 6,
    requires: [], forbids: ['frozen'],
  },
];

/**
 * Weighted pick restricted to a role, falling back to any legal enemy.
 *
 * The fallback matters: a biome that forbids Keese must still be able to build a
 * fight. An encounter that asked for a swarm and got a rusher is a worse
 * encounter than intended but still a legal one — whereas returning null would
 * silently produce an empty room, which is the failure nobody notices.
 */
export function pickByRole(
  role: EnemyRole,
  tags: ReadonlySet<Tag>,
  rng: Rng,
): Placeable | null {
  const pool = eligible('enemy', tags).filter((p) => p.role === role);
  if (pool.length === 0) return pickPlaceable('enemy', tags, rng);

  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = rng.next() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return pool[pool.length - 1]!;
}

export function placeableById(id: string): Placeable {
  const found = PLACEABLES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown placeable "${id}"`);
  return found;
}

/** Does this placeable's contract hold against the tags actually present? */
export function contractHolds(p: Placeable, tags: ReadonlySet<Tag>): boolean {
  for (const tag of p.requires) if (!tags.has(tag)) return false;
  for (const tag of p.forbids) if (tags.has(tag)) return false;
  return true;
}

/** Everything of a kind that may legally stand on a tile with these tags. */
export function eligible(kind: PlaceableKind, tags: ReadonlySet<Tag>): Placeable[] {
  return PLACEABLES.filter((p) => p.kind === kind && contractHolds(p, tags));
}

/**
 * Weighted pick from the eligible set. Returns null when nothing qualifies,
 * which is a legitimate answer — a barren frozen scree has no vegetation, and
 * the generator should place nothing rather than reach for a fallback that
 * quietly violates the contract.
 */
export function pickPlaceable(
  kind: PlaceableKind,
  tags: ReadonlySet<Tag>,
  rng: Rng,
): Placeable | null {
  const pool = eligible(kind, tags);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = rng.next() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return pool[pool.length - 1]!;
}
