/**
 * Deterministic test scenarios, selected with `?fixture=<id>`.
 *
 * The capture harness used to play one long scripted run and assert everything
 * from it. That could never be reliable: proving "you can win a fight" and "a
 * fight can kill you" from a single playthrough are mutually exclusive, and the
 * scripted bot was fighting real enemies with emergent behaviour. Tuning the bot
 * made it flakier, not steadier.
 *
 * The fix is to control the world instead. Each fixture pins the seed, Act,
 * biome and depth, then replaces whatever generation produced with an exact,
 * hand-placed scenario. One fixture per behaviour, one fresh page per fixture.
 *
 * This is a dev entry point, not a cheat: fixtures are only reachable by an
 * explicit URL parameter and nothing in normal play consults them.
 */

import type { TownCondition } from '../worldgen/townsfolk.ts';

export interface FixtureSpawn {
  variant: string;
  /** offset from the player's spawn, in pixels */
  dx: number;
  dy: number;
}

export interface FixtureProp {
  key: string;
  dx: number;
  dy: number;
}

export interface Fixture {
  id: string;
  description: string;
  seed: number;
  act: number;
  /** biome to force; must exist in the Act's pool */
  biomeId: string;
  depth: number;
  /** replaces every generated enemy on the floor */
  enemies?: FixtureSpawn[];
  /** placed after generation, near the spawn */
  props?: FixtureProp[];
  /** clear generated props so the scenario is exactly what is listed */
  clearProps?: boolean;
  /**
   * Freeze enemy brains. A sealed scenario must not move on its own schedule —
   * a check that has to *hit* something cannot depend on where it wandered to.
   */
  freezeAi?: boolean;
  health?: number;
  amber?: number;
  relics?: string[];
  /**
   * Enter Amberwake immediately, in this exact year.
   *
   * A town is the one scenario the enemy/prop lists cannot express, because what
   * is being pinned is a whole generated settlement rather than a few things
   * placed near the spawn. Pinning the condition is the point: "flourishing" and
   * "burned" are different enough that a check written against one proves
   * nothing about the other.
   */
  town?: TownCondition;
  /** starting level, for anything that reads off merchant standing */
  level?: number;
}

export const FIXTURES: Record<string, Fixture> = {
  /** A populated floor, brains running, used to prove enemies stay put. */
  rooms: {
    id: 'rooms',
    description: 'a generated floor with its own enemies, brains live',
    seed: 0x3c19b,
    act: 1,
    biomeId: 'meadow',
    depth: 2,
    health: 24,
  },

  /** Amberwake in its good years: houses standing, street busy, merchants trading. */
  town: {
    id: 'town',
    description: 'Amberwake flourishing, the player on the market street',
    seed: 0x7a3b1,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    town: 'flourishing',
    level: 17,
    amber: 600,
  },

  /** The same town, the same people, after it burned. Proves the year changes it. */
  townBurned: {
    id: 'townBurned',
    description: 'Amberwake burned, the same cast in worse roles',
    seed: 0x7a3b1,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    town: 'burned',
    level: 17,
    amber: 600,
  },

  /** One enemy at arm's length. Sword phases, hitstop, flash, knockback. */
  combat: {
    id: 'combat',
    description: 'a single Moblin two tiles east, nothing else alive',
    seed: 0x51e9d,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    clearProps: true,
    enemies: [{ variant: 'moblin', dx: 34, dy: 0 }],
    health: 24,
  },

  /** Props in reach and no enemies. Break, lift, carry, throw. */
  props: {
    id: 'props',
    description: 'a pot and a bush beside the player, no enemies',
    seed: 0x9c0f7,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    clearProps: true,
    enemies: [],
    props: [
      { key: 'prop.pot', dx: 24, dy: 0 },
      { key: 'prop.bush', dx: -24, dy: 0 },
      { key: 'prop.chest.closed', dx: 0, dy: -28 },
    ],
    health: 24,
  },

  /**
   * Three enemies and a single heart of health. Contact damage, i-frames, the
   * revision scene and the Reliquary all follow from dying quickly and reliably.
   */
  lethal: {
    id: 'lethal',
    description: 'three enemies pressed against a player on one heart',
    seed: 0x1e7a41,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    clearProps: true,
    enemies: [
      { variant: 'octorok', dx: 18, dy: 0 },
      { variant: 'octorok', dx: -18, dy: 0 },
      { variant: 'moblin', dx: 0, dy: 20 },
    ],
    // A heart and a half: he survives two hits, so a full 48-frame invulnerability
    // window actually elapses before the third kills him. At one heart he dies on
    // the first contact and the i-frames are never observable.
    health: 12,
    amber: 40, // enough to awaken a relic in the Reliquary
  },

  /** A dungeon biome, so the room bars. Clear it and the bars drop. */
  barred: {
    id: 'barred',
    description: 'a subterranean room with two weak enemies; bars engage',
    seed: 0xba77e,
    act: 4,
    biomeId: 'undercity',
    depth: 0,
    clearProps: true,
    enemies: [
      { variant: 'keese', dx: 26, dy: -8 },
      { variant: 'keese', dx: -26, dy: 8 },
    ],
    health: 40,
  },

  /**
   * Secondary items. Two foes far enough away that neither can interrupt the
   * throw, and pots to prove a blast destroys what the sword would have to reach.
   */
  items: {
    id: 'items',
    description: 'room to use a bomb and a boomerang without being interrupted',
    seed: 0x17e45,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    clearProps: true,
    enemies: [{ variant: 'octorok', dx: 56, dy: 0 }],
    // A sealed scenario must not contain something that moves on its own
    // schedule. The boomerang check has to *hit* this foe, and a wandering
    // target made the check fail on a working game — which is worse than no
    // check. Frozen, the throw either connects or the mechanic is broken.
    freezeAi: true,
    props: [
      { key: 'prop.pot', dx: 26, dy: 0 },
      { key: 'prop.pot', dx: 26, dy: 18 },
    ],
    health: 40,
  },

  /** Open world, enemies present, no bars anywhere. */
  openworld: {
    id: 'openworld',
    description: 'a meadow with enemies; nothing should ever bar',
    seed: 0x0be14,
    act: 0,
    biomeId: 'meadow',
    depth: 0,
    enemies: [
      { variant: 'octorok', dx: 40, dy: 10 },
      { variant: 'keese', dx: -40, dy: -10 },
    ],
    health: 24,
  },
};

export function fixtureById(id: string): Fixture | null {
  return FIXTURES[id] ?? null;
}

/** Read `?fixture=` off the current URL. Returns null in normal play. */
export function fixtureFromLocation(search: string): Fixture | null {
  const params = new URLSearchParams(search);
  const id = params.get('fixture');
  return id ? fixtureById(id) : null;
}
