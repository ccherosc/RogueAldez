/**
 * The people of Ostreya's towns — who they are, forever, and who they are today.
 *
 * This is the Gazetteer principle applied to a cast. A town keeps its name and
 * its people across every Draft; what the rewriting changes is the **condition**
 * of the place and therefore the **role** each person holds in it.
 *
 * Orra Flint always works metal. In a flourishing Draft she is the smith with an
 * apprentice and a queue; in a besieged one she is forging bar-stock for the
 * barricades; in a beggar's Draft she is selling her own tools. Same woman, same
 * essence, unrecognisable circumstances. That recognition — *I know you, and you
 * are not who you were* — is the entire emotional mechanic of the game, and this
 * is where the player meets it first.
 *
 * An Anchor whose essence changes is a bug, not variety. The `essence` field is
 * therefore load-bearing: it constrains which roles a person may hold, and every
 * line they speak is written from it.
 */

import type { Tag } from './tags.ts';

/** The face a town wears this Draft. Drives layout, roster and tone together. */
export type TownCondition =
  | 'flourishing'
  | 'occupied'
  | 'besieged'
  | 'abandoned'
  | 'burned'
  | 'plagued';

export const TOWN_CONDITIONS: readonly TownCondition[] = [
  'flourishing', 'occupied', 'besieged', 'abandoned', 'burned', 'plagued',
];

/** What a person is doing here today. */
export type Role =
  | 'merchant' | 'smith' | 'innkeeper' | 'guard' | 'noble'
  | 'farmer' | 'priest' | 'child' | 'beggar' | 'scavenger'
  | 'soldier' | 'healer' | 'drunk';

/**
 * What a person is, underneath whatever they are doing.
 *
 * Deliberately abstract: an essence has to survive being a queen and being a
 * gravedigger, so it cannot be a job.
 */
export type Essence =
  | 'curious'      // eventually notices the world does not make sense
  | 'makes'        // works with their hands, whatever they are called
  | 'keeps'        // holds things together; responsibility above comfort
  | 'trades'       // finds the value in things and moves them
  | 'believes'     // certain of something, correct or not
  | 'endures';     // outlasts

export interface Townsperson {
  id: string;
  /** never changes, in any Draft */
  name: string;
  essence: Essence;
  /** true for people the bible names as surviving the rewriting intact */
  anchor?: boolean;
  /** one line about who they always are, shown once the player has met them often */
  truth: string;
}

/**
 * The cast of Amberwake, the first town. Ten people is enough to feel inhabited
 * and few enough that a player learns their names — which is the precondition for
 * noticing that their roles have moved.
 */
export const TOWNSFOLK: readonly Townsperson[] = [
  {
    id: 'mara', name: 'Mara Venn', essence: 'curious', anchor: true,
    truth: 'she always ends up asking the question nobody else will',
  },
  {
    id: 'orra', name: 'Orra Flint', essence: 'makes', anchor: true,
    truth: 'she works metal in every life, whatever they call her',
  },
  {
    id: 'cael', name: 'Cael Ordan', essence: 'keeps', anchor: true,
    truth: 'he holds the line for whoever is behind it',
  },
  { id: 'brede', name: 'Brede Hollow', essence: 'trades', truth: 'he can price anything' },
  { id: 'sella', name: 'Sella Marsh', essence: 'believes', truth: 'she is certain, always' },
  { id: 'tam', name: 'Tam Ryke', essence: 'endures', truth: 'he is still here' },
  { id: 'ona', name: 'Ona Dell', essence: 'makes', truth: 'her hands are never still' },
  { id: 'hessa', name: 'Hessa Crowe', essence: 'keeps', truth: 'she counts everyone twice' },
  { id: 'pell', name: 'Pell', essence: 'curious', truth: 'too young to know what not to ask' },
  { id: 'ruen', name: 'Ruen Ash', essence: 'endures', truth: 'he has buried this town before' },
];

/**
 * Which roles a condition can support, and how many people are about.
 *
 * This is what stops a beggar's Draft containing three nobles and a jeweller.
 * The role pool *is* the town's character — change nothing else and a place
 * already reads completely differently.
 */
export interface ConditionProfile {
  label: string;
  /** the line under the town name on arrival */
  mood: string;
  roles: Role[];
  /** how many townsfolk are outdoors */
  population: number;
  /** buildings standing, 0..1 — drives how ruined the layout looks */
  intact: number;
  /** market stalls, banners, braziers */
  bustle: number;
  /** how many guards, and how hard they come for you */
  guards: number;
  provides: Tag[];
}

export const CONDITION_PROFILES: Record<TownCondition, ConditionProfile> = {
  flourishing: {
    label: 'in good years',
    mood: 'the market is loud and the bells are rung for nothing at all',
    roles: ['merchant', 'smith', 'innkeeper', 'noble', 'farmer', 'child', 'priest', 'guard'],
    population: 9, intact: 1, bustle: 8, guards: 2,
    provides: ['settled', 'fertile'],
  },
  occupied: {
    label: 'under the crown',
    mood: 'someone else decides who may walk here after dark',
    roles: ['guard', 'soldier', 'merchant', 'smith', 'innkeeper', 'farmer', 'noble'],
    population: 7, intact: 0.95, bustle: 4, guards: 5,
    provides: ['settled', 'patrolled'],
  },
  besieged: {
    label: 'behind the barricades',
    mood: 'the gates are shut and nobody will say against what',
    roles: ['soldier', 'smith', 'healer', 'priest', 'guard', 'beggar'],
    population: 6, intact: 0.8, bustle: 2, guards: 4,
    provides: ['patrolled', 'ruined'],
  },
  abandoned: {
    label: 'left behind',
    mood: 'the doors stand open and the wind has been through every room',
    roles: ['scavenger', 'beggar', 'drunk', 'priest'],
    population: 3, intact: 0.6, bustle: 0, guards: 0,
    provides: ['ruined', 'wild'],
  },
  burned: {
    label: 'after the fire',
    mood: 'the bell tower still stands, which everyone finds harder than if it did not',
    roles: ['scavenger', 'beggar', 'healer', 'priest', 'drunk'],
    population: 4, intact: 0.35, bustle: 1, guards: 1,
    provides: ['ruined', 'barren'],
  },
  plagued: {
    label: 'shuttered',
    mood: 'chalk marks on the doors, and nobody stands close to anybody',
    roles: ['healer', 'priest', 'beggar', 'guard', 'drunk'],
    population: 4, intact: 0.9, bustle: 1, guards: 2,
    provides: ['settled', 'dark'],
  },
};

/**
 * Roles an essence will accept.
 *
 * The constraint that makes the trick work. Orra "makes" — so she can be a
 * smith, a farmer, a scavenger or a beggar selling her tools, but never a noble.
 * Without this the shuffle is random and the recognition never lands, because
 * nothing about the person survived to be recognised.
 */
const ESSENCE_ROLES: Record<Essence, Role[]> = {
  curious: ['child', 'priest', 'merchant', 'scavenger', 'healer', 'beggar'],
  makes: ['smith', 'farmer', 'scavenger', 'beggar', 'innkeeper'],
  keeps: ['guard', 'soldier', 'innkeeper', 'noble', 'priest', 'healer'],
  trades: ['merchant', 'innkeeper', 'noble', 'scavenger', 'beggar'],
  believes: ['priest', 'healer', 'noble', 'soldier', 'beggar'],
  endures: ['farmer', 'drunk', 'beggar', 'scavenger', 'guard', 'soldier'],
};

/** The role this person holds in a town in this condition, or null if absent. */
/**
 * May this person hold this role at all?
 *
 * The same table `roleFor` filters on, exposed so a caller that has to *repair*
 * a town can do it without inventing a person who could never exist. Orra makes
 * things; she can be a scavenger picking usable metal out of a ruin, and she can
 * never be a noble.
 */
export function essenceAllows(essence: Essence, role: Role): boolean {
  return ESSENCE_ROLES[essence].includes(role);
}

export function roleFor(
  person: Townsperson,
  condition: TownCondition,
  pick: <T>(items: readonly T[]) => T,
): Role | null {
  const allowed = CONDITION_PROFILES[condition].roles
    .filter((r) => ESSENCE_ROLES[person.essence].includes(r));
  if (allowed.length === 0) return null;
  return pick(allowed);
}

/** Merchants and smiths will trade; nobody else has anything to sell. */
/**
 * Who will do business with you.
 *
 * Scavengers and beggars are on this list, and that is the whole point. The
 * first version had only merchants, smiths and innkeepers — roles that a ruined
 * town has no room for — so abandoned, burned and plagued Amberwake produced
 * *no trader at all*, in forty towns out of forty. The objective told the player
 * to go and see what the market had, and there was no market, in four of the six
 * years the town can be in.
 *
 * A place does not stop trading because it has burned. It trades worse, and out
 * of worse things, and with someone who was doing something else last year —
 * which is a better scene than a shuttered town anyway. The condition decides
 * *who* is selling and *what*; it does not get to decide whether commerce
 * exists.
 */
export function trades(role: Role): boolean {
  return role === 'merchant' || role === 'smith' || role === 'innkeeper'
    || role === 'scavenger' || role === 'beggar';
}
