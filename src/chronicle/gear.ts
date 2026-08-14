/**
 * Weapons, armour and treasure — what Aldez carries.
 *
 * Fifty tiers is not fifty authored weapons. That way lies a content problem
 * nobody can balance and nobody can name. A piece of gear here is a **type**
 * (what it does) crossed with a **tier** (how much of it), and both the numbers
 * and the name are derived. Ten materials times five steps covers 1..50, so the
 * hundredth sword is still recognisably a sword and still has a name a player
 * can say out loud.
 *
 * The materials climb the fiction rather than a generic metal ladder: bell-metal
 * is what Belliron casts, star amber is what the Chroniclers write in, and the
 * top band is Unwritten because by then Aldez is carrying something the world
 * has no record of.
 *
 * Layer 2 on purpose: pure data and arithmetic, no runtime state. The container
 * that holds what the player actually owns is game/inventory.ts.
 */

export type GearKind = 'weapon' | 'armour' | 'treasure';

/**
 * Four weapon types, deliberately. Each must answer a question the others do
 * not, or it is a re-skin:
 *
 *   sword  the baseline arc. Fast, forgiving, no special property.
 *   axe    slow and heavy, and the only blade that fells a standing tree —
 *          which is the "wrong tool" lesson the game already teaches with bombs.
 *   spear  reach. Hits a tile further out and gives up the wide arc for it.
 *   bow    range, at the cost of damage. Fires along the facing.
 */
export type WeaponType = 'sword' | 'axe' | 'spear' | 'bow';

export const WEAPON_TYPES: readonly WeaponType[] = ['sword', 'axe', 'spear', 'bow'];

export const MAX_TIER = 50;
const BAND_SIZE = 5;

/**
 * One name per five tiers. The band is the adjective, the type is the noun, so
 * "bell-metal axe" and "star-amber bow" fall out without a naming table per item.
 */
const BANDS: readonly string[] = [
  'rusted',        //  1..5
  'iron',          //  6..10
  'bell-metal',    // 11..15
  'tempered',      // 16..20
  'silvered',      // 21..25
  'amberbound',    // 26..30
  'star-amber',    // 31..35
  'formcraft',     // 36..40
  'chronicle',     // 41..45
  'unwritten',     // 46..50
];

export function bandFor(tier: number): string {
  const clamped = Math.max(1, Math.min(MAX_TIER, tier));
  return BANDS[Math.min(BANDS.length - 1, Math.floor((clamped - 1) / BAND_SIZE))]!;
}

export interface WeaponStats {
  /** damage per connecting hit */
  damage: number;
  /** multiplier on swing frames; above 1 is slower */
  swing: number;
  /** extra reach in world pixels beyond the base arc */
  reach: number;
  /** does it fell a standing tree, which a sword cannot */
  fellsTrees: boolean;
  /** fires a projectile along the facing rather than swinging */
  ranged: boolean;
}

/**
 * Stats from type and tier.
 *
 * Damage climbs sub-linearly on purpose. A tier-50 weapon should make the early
 * game trivial — that is the reward for playing on — without making the *late*
 * game trivial too, which is what a linear curve does. Roughly: tier 1 kills a
 * meadow Erratum in one hit, tier 50 kills a Colossus in four.
 */
export function weaponStats(type: WeaponType, tier: number): WeaponStats {
  const t = Math.max(1, Math.min(MAX_TIER, tier));
  const scale = 1 + Math.floor((t - 1) / 4); // 1..13 across the range

  switch (type) {
    case 'sword':
      return { damage: scale, swing: 1, reach: 0, fellsTrees: false, ranged: false };
    case 'axe':
      return {
        // Hits appreciably harder and swings appreciably slower. The trade has
        // to be felt or the axe is just a better sword.
        damage: Math.round(scale * 1.5),
        swing: 1.35,
        reach: 0,
        fellsTrees: true,
        ranged: false,
      };
    case 'spear':
      return { damage: scale, swing: 0.9, reach: 6, fellsTrees: false, ranged: false };
    case 'bow':
      return {
        damage: Math.max(1, Math.round(scale * 0.7)),
        swing: 1.15,
        reach: 0,
        fellsTrees: false,
        ranged: true,
      };
  }
}

/** Damage reduction from armour, in the same units as enemy contact damage. */
export function armourReduction(tier: number): number {
  const t = Math.max(1, Math.min(MAX_TIER, tier));
  // Caps below the weakest enemy's damage so armour never trivialises contact.
  return Math.min(3, Math.floor((t - 1) / 12));
}

export interface GearItem {
  /** unique per instance, so two identical axes are still two axes */
  uid: number;
  kind: GearKind;
  name: string;
  tier: number;
  /** weapons only */
  type?: WeaponType;
  /** treasure only: what a trader would pay */
  value?: number;
}

let nextUid = 1;

export function makeWeapon(type: WeaponType, tier: number): GearItem {
  return {
    uid: nextUid++,
    kind: 'weapon',
    type,
    tier,
    name: `${bandFor(tier)} ${type}`,
  };
}

export function makeArmour(tier: number): GearItem {
  return { uid: nextUid++, kind: 'armour', tier, name: `${bandFor(tier)} mail` };
}

export function makeTreasure(tier: number): GearItem {
  const value = 5 + tier * 3;
  return { uid: nextUid++, kind: 'treasure', tier, name: `${bandFor(tier)} relic-coin`, value };
}

/**
 * What a drop at this difficulty should be worth.
 *
 * Tier tracks the curve rather than the clock, so a player who dives deep early
 * finds better gear and a player who grinds the meadow does not. The spread is
 * deliberately wide: an occasional find well above your level is the single
 * cheapest source of excitement in a loot game.
 */
export function dropTier(difficultyTier: number, roll: number): number {
  const base = 1 + difficultyTier * 3;
  const lucky = roll < 0.08 ? 6 : roll < 0.3 ? 2 : 0;
  return Math.max(1, Math.min(MAX_TIER, base + lucky + Math.floor(roll * 3)));
}

/** True when `candidate` is a straight upgrade on what is equipped. */
export function isUpgrade(candidate: GearItem, current: GearItem | null): boolean {
  if (!current) return true;
  if (candidate.kind !== current.kind) return false;
  if (candidate.kind === 'weapon' && candidate.type && current.type) {
    return weaponStats(candidate.type, candidate.tier).damage
      > weaponStats(current.type, current.tier).damage;
  }
  return candidate.tier > current.tier;
}
