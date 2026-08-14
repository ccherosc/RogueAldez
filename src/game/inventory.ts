/**
 * What Aldez is carrying, this session.
 *
 * The persistence rule is deliberate and unusual, so it is worth stating: gear
 * **survives death and is lost when the window closes.** It is never written to
 * the save.
 *
 * That is not an oversight, it is the shape of the fiction. Continuance Relics
 * are bound to Aldez and persist for ever; a sword is a thing he picked up in a
 * world that no longer exists, and the Chronicle has no record of it. Mechanically
 * it also gives a session an arc — you get stronger across several Drafts, and
 * starting fresh tomorrow is a real restart rather than a formality.
 *
 * Relics stay in the save. Weapons, armour and treasure live and die here.
 */

import type { GearItem, WeaponType } from '../chronicle/gear.ts';
import { makeWeapon, weaponStats, armourReduction, isUpgrade } from '../chronicle/gear.ts';

/** Above this the pack is full and the weakest thing is dropped to make room. */
const CAPACITY = 24;

export class Inventory {
  private items: GearItem[] = [];
  equippedWeapon: GearItem | null = null;
  equippedArmour: GearItem | null = null;
  /** newest first, for the "picked up" banner */
  lastPickup: GearItem | null = null;

  constructor() {
    // Aldez is never unarmed. A rusted sword is the floor, not a reward.
    const starter = makeWeapon('sword', 1);
    this.items.push(starter);
    this.equippedWeapon = starter;
  }

  get all(): readonly GearItem[] {
    return this.items;
  }

  get weapons(): GearItem[] {
    return this.items.filter((i) => i.kind === 'weapon');
  }

  /** Total value of carried treasure — what a trader would pay for the lot. */
  get treasureValue(): number {
    return this.items.reduce((sum, i) => sum + (i.kind === 'treasure' ? (i.value ?? 0) : 0), 0);
  }

  /**
   * Take something. Auto-equips a strict upgrade, because making the player open
   * a menu to accept an obviously better sword is friction with no decision in
   * it — the interesting choice is *sword versus axe*, not *better versus worse*.
   */
  add(item: GearItem): { equipped: boolean } {
    this.items.push(item);
    this.lastPickup = item;

    let equipped = false;
    if (item.kind === 'weapon' && isUpgrade(item, this.equippedWeapon)) {
      this.equippedWeapon = item;
      equipped = true;
    }
    if (item.kind === 'armour' && isUpgrade(item, this.equippedArmour)) {
      this.equippedArmour = item;
      equipped = true;
    }

    this.trim();
    return { equipped };
  }

  equip(uid: number): void {
    const item = this.items.find((i) => i.uid === uid);
    if (!item) return;
    if (item.kind === 'weapon') this.equippedWeapon = item;
    if (item.kind === 'armour') this.equippedArmour = item;
  }

  drop(uid: number): void {
    // Never leave Aldez unarmed or the pack in a state the UI cannot represent.
    if (this.equippedWeapon?.uid === uid && this.weapons.length <= 1) return;
    this.items = this.items.filter((i) => i.uid !== uid);
    if (this.equippedWeapon?.uid === uid) this.equippedWeapon = this.weapons[0] ?? null;
    if (this.equippedArmour?.uid === uid) this.equippedArmour = null;
  }

  /** Damage of the current weapon, before spin and relic multipliers. */
  get weaponDamage(): number {
    const w = this.equippedWeapon;
    if (!w?.type) return 1;
    return weaponStats(w.type, w.tier).damage;
  }

  get weaponType(): WeaponType {
    return this.equippedWeapon?.type ?? 'sword';
  }

  /** Can the equipped weapon fell a standing tree? Only the axe can. */
  get fellsTrees(): boolean {
    const w = this.equippedWeapon;
    return w?.type ? weaponStats(w.type, w.tier).fellsTrees : false;
  }

  get damageReduction(): number {
    return this.equippedArmour ? armourReduction(this.equippedArmour.tier) : 0;
  }

  /**
   * Keep the pack bounded by discarding the least useful thing.
   *
   * Equipped gear and treasure are never dropped; among the rest the lowest tier
   * goes. A full-pack prompt would be the correct systems answer and the wrong
   * game answer — it interrupts a fight to ask about a rusted spear.
   */
  private trim(): void {
    while (this.items.length > CAPACITY) {
      const droppable = this.items
        .filter((i) => i.kind !== 'treasure'
          && i.uid !== this.equippedWeapon?.uid
          && i.uid !== this.equippedArmour?.uid)
        .sort((a, b) => a.tier - b.tier);
      const worst = droppable[0];
      if (!worst) return;
      this.items = this.items.filter((i) => i.uid !== worst.uid);
    }
  }
}
