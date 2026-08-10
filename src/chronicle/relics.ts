/**
 * Continuance Relics.
 *
 * Objects carried through a fracture become bound to Aldez rather than to the
 * world, so they survive his death. This is the permanent progression: amber
 * spent here makes the *next* Draft different from the last, which is the whole
 * reason to start another one.
 *
 * Lives in chronicle/ because relics are *content* — the Reliquary screen in ui/
 * and the simulation in game/ both read this table, and neither may import the
 * other. Same reason the enemy roster sits here rather than in ai/.
 *
 * Per aldez-lore, a relic is incomplete without all four of: a gameplay effect,
 * a visual identity, a memory from the reality it came from, and a tie to a
 * recurring character or event. A relic with stats and no memory is a stat.
 */

export type RelicId =
  | 'ember-vial'
  | 'wardens-step'
  | 'belliron-edge'
  | 'margin-note'
  | 'severed-ending'
  | 'lantern-chart'
  | 'ninth-toll'
  | 'crackscript-shard';

export interface Relic {
  id: RelicId;
  name: string;
  cost: number;
  /** one line of mechanical truth, shown under the name */
  effect: string;
  /** the memory it carries — the reality it was found in */
  memory: string;
  /** atlas cell used as its icon */
  icon: string;
}

export const RELICS: readonly Relic[] = [
  {
    id: 'ember-vial',
    name: 'Ember Salt Vial',
    cost: 12,
    effect: 'One more heart.',
    memory: 'Orra pressed it into his hand and said she would not ask again.',
    icon: 'pickup.heart',
  },
  {
    id: 'wardens-step',
    name: "Pathwarden's Step",
    cost: 10,
    effect: 'Move a quarter faster.',
    memory: 'The roads he walked before any of this had a name.',
    icon: 'fx.spark.0',
  },
  {
    id: 'belliron-edge',
    name: 'Belliron Edge',
    cost: 16,
    effect: 'The sword bites for one more.',
    memory: 'Orra forged it twice. She only remembers the second time.',
    icon: 'ui.amber',
  },
  {
    id: 'margin-note',
    name: "Mara's Margin Note",
    cost: 14,
    effect: 'The way down is marked.',
    memory: 'Trust the sadness you feel when he says your name.',
    icon: 'ui.font.6d',
  },
  {
    id: 'severed-ending',
    name: 'The Severed Ending',
    cost: 18,
    effect: 'Longer mercy after a wound.',
    memory: 'Sereth broke her quill and struck one sentence from the Chronicle.',
    icon: 'player.shield',
  },
  {
    id: 'lantern-chart',
    name: 'Lantern Guild Chart',
    cost: 10,
    effect: 'Every kill yields more amber.',
    memory: 'They hid the old maps behind the walls when the roads began to move.',
    icon: 'pickup.rupee',
  },
  {
    id: 'ninth-toll',
    name: 'Toll of the Ninth Bell',
    cost: 12,
    effect: 'The dead give up their hearts more often.',
    memory: 'Rung for the dead. Lately it rings a tenth time, and no bell is found.',
    icon: 'prop.bars',
  },
  {
    id: 'crackscript-shard',
    name: 'Crackscript Shard',
    cost: 20,
    effect: 'The spin gathers twice as fast.',
    memory: 'Two truths in one place. Nagon calls the wound it leaves freedom.',
    icon: 'fx.gore.0',
  },
];

export function relicById(id: RelicId): Relic {
  const found = RELICS.find((r) => r.id === id);
  if (!found) throw new Error(`unknown relic "${id}"`);
  return found;
}

/**
 * The awakened set, resolved into the numbers the simulation actually reads.
 *
 * Computed once when the set changes rather than queried per frame — every one
 * of these is read inside the update loop.
 */
export interface RelicEffects {
  bonusHearts: number;
  speedMultiplier: number;
  swordDamage: number;
  bonusIframes: number;
  amberPerKill: number;
  heartDropBonus: number;
  spinChargeMultiplier: number;
  marksExit: boolean;
}

export function resolveEffects(owned: ReadonlySet<RelicId>): RelicEffects {
  return {
    bonusHearts: owned.has('ember-vial') ? 1 : 0,
    speedMultiplier: owned.has('wardens-step') ? 1.25 : 1,
    swordDamage: 1 + (owned.has('belliron-edge') ? 1 : 0),
    bonusIframes: owned.has('severed-ending') ? 18 : 0,
    amberPerKill: 1 + (owned.has('lantern-chart') ? 1 : 0),
    heartDropBonus: owned.has('ninth-toll') ? 0.25 : 0,
    spinChargeMultiplier: owned.has('crackscript-shard') ? 2 : 1,
    marksExit: owned.has('margin-note'),
  };
}
