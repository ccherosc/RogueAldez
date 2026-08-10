/**
 * Secondary items — the slot the sword does not occupy.
 *
 * Zelda's shape: the sword is always in hand, and one *selected* item sits in
 * the other. Cycling is a deliberate cost, which is what makes choosing what to
 * carry into a room a decision rather than a formality.
 *
 * Each item here has to justify itself with a distinct answer to a problem the
 * sword cannot solve — otherwise it is a second sword with a different sprite.
 */

export type ItemId = 'bomb' | 'boomerang';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** atlas cell used in the HUD slot */
  icon: string;
  /** null when the item has no ammo — the boomerang always comes back */
  ammo: 'bombs' | null;
  /** what it is *for*, in one line */
  role: string;
}

export const ITEMS: readonly ItemDef[] = [
  {
    id: 'bomb',
    name: 'Ember Charge',
    icon: 'ui.icon.bomb',
    ammo: 'bombs',
    role: 'Answers crowds and anything behind a wall. Hurts you too.',
  },
  {
    id: 'boomerang',
    name: 'Bound Wind',
    icon: 'ui.icon.boomerang',
    ammo: null,
    role: 'Stuns at range and drags loot back. No damage worth the name.',
  },
];

export function itemById(id: ItemId): ItemDef {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item "${id}"`);
  return found;
}

export const MAX_BOMBS = 10;
export const START_BOMBS = 5;

/** Bomb timings, in frames. */
export const BOMB_FUSE = 60;
export const BLAST_FRAMES = 18;
export const BLAST_RADIUS = 34;
export const BOMB_DAMAGE = 3;
/** Standing in your own blast costs half a heart. It should. */
export const BOMB_SELF_DAMAGE = 4;

/** Boomerang flight. */
export const BOOMERANG_SPEED = 3.2;
export const BOOMERANG_REACH = 88;
/**
 * Long enough to close distance and land two swings. At the old 34 the Moblin
 * was often mid-charge again before the player had crossed the gap, which read
 * as "the stun doesn't work".
 */
export const BOOMERANG_STUN = 60;
export const BOOMERANG_DAMAGE = 1;

/**
 * The player's item loadout.
 *
 * Kept separate from the Player so the scene can read and mutate it without
 * reaching into movement state, and so a save can restore it wholesale.
 */
export class Loadout {
  /** unlocked items, in cycle order */
  owned: ItemId[] = ['bomb', 'boomerang'];
  selectedIndex = 0;
  bombs = START_BOMBS;

  get selected(): ItemDef | null {
    const id = this.owned[this.selectedIndex];
    return id ? itemById(id) : null;
  }

  cycle(direction = 1): void {
    if (this.owned.length === 0) return;
    const n = this.owned.length;
    this.selectedIndex = (this.selectedIndex + direction + n) % n;
  }

  /** Remaining uses of the selected item, or null when it needs no ammo. */
  get selectedAmmo(): number | null {
    const item = this.selected;
    if (!item || item.ammo === null) return null;
    return this.bombs;
  }

  canUse(): boolean {
    const item = this.selected;
    if (!item) return false;
    return item.ammo === null || this.bombs > 0;
  }

  consume(): void {
    const item = this.selected;
    if (item?.ammo === 'bombs') this.bombs = Math.max(0, this.bombs - 1);
  }

  addBombs(n: number): void {
    this.bombs = Math.min(MAX_BOMBS, this.bombs + n);
  }

  reset(): void {
    this.bombs = START_BOMBS;
    this.selectedIndex = 0;
  }
}
