/**
 * Persistent meta-progression.
 *
 * Everything here survives closing the tab. Star amber is *crystallised
 * possibility* — it is bound to Aldez, not to the world, so it is exactly the
 * kind of thing that should outlive a rewrite (see the Continuance Relic rules
 * in aldez-lore).
 *
 * The schema is versioned and resets rather than guessing at a migration: a
 * half-migrated save is a much worse bug than a lost one, and there is nothing
 * here yet a player would mourn.
 */

import { DEFAULT_MODE } from '../chronicle/difficulty.ts';
import type { DifficultyMode } from '../chronicle/difficulty.ts';

const STORAGE_KEY = 'rogue-aldez:save';
// Not bumped for `mode`. The field is optional and absent means DEFAULT_MODE, so
// an existing save reads correctly — and nobody should lose their amber and
// their Acts over a difficulty setting that did not exist when they saved.
const SCHEMA_VERSION = 2;

export interface SaveData {
  version: number;
  /**
   * Chosen difficulty. Deliberately outside the Draft: a mode is a statement
   * about the player, not about this life, so dying must not reset it.
   */
  mode?: DifficultyMode;
  /** star amber carried across every Draft */
  amber: number;
  /** how many Drafts Aldez has been through */
  draftsLived: number;
  /** deepest floor reached in any single Draft */
  bestDepth: number;
  totalKills: number;
  roomsCleared: number;
  /** seed of the very first Draft, so a whole history can be replayed */
  worldSeed: number;
  /**
   * Highest Act unlocked, and the one Aldez currently walks. Progress through
   * the world is permanent — a death costs the floors inside an Act, never the
   * Acts themselves.
   */
  actIndex: number;
  /** relic ids awakened in the Reliquary; these outlive every rewrite */
  relics: string[];
  /** tutor lessons the player has demonstrated; never taught twice */
  taught?: string[];
  /**
   * Echo Memory: how many Drafts each townsperson has met Aldez in.
   *
   * The one thing the Chronicle cannot erase, and the reason to play a sixth
   * life. Persisted where gear is not, because a relationship is not loot.
   */
  met?: Record<string, number>;
}

export function emptySave(worldSeed: number): SaveData {
  return {
    version: SCHEMA_VERSION,
    amber: 0,
    draftsLived: 1,
    bestDepth: 1,
    totalKills: 0,
    roomsCleared: 0,
    worldSeed,
    actIndex: 0,
    relics: [],
    mode: DEFAULT_MODE,
  taught: [],
  met: {},
  };
}

function storage(): Storage | null {
  try {
    // Private browsing and some embedded webviews throw on access, not on use.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSave(worldSeed: number): SaveData {
  const store = storage();
  if (!store) return emptySave(worldSeed);

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return emptySave(worldSeed);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (parsed.version !== SCHEMA_VERSION) return emptySave(worldSeed);

    const base = emptySave(worldSeed);
    return {
      ...base,
      // Coerce each field: a hand-edited or truncated save must not produce NaN
      // that then propagates into every counter for the rest of the session.
      amber: num(parsed.amber, base.amber),
      draftsLived: num(parsed.draftsLived, base.draftsLived),
      bestDepth: num(parsed.bestDepth, base.bestDepth),
      totalKills: num(parsed.totalKills, base.totalKills),
      roomsCleared: num(parsed.roomsCleared, base.roomsCleared),
      worldSeed: num(parsed.worldSeed, worldSeed),
      actIndex: num(parsed.actIndex, base.actIndex),
      relics: Array.isArray(parsed.relics) ? parsed.relics.filter((r) => typeof r === 'string') : [],
    taught: Array.isArray(parsed.taught) ? parsed.taught.filter((r) => typeof r === 'string') : [],
    met: typeof parsed.met === 'object' && parsed.met !== null
      ? (parsed.met as Record<string, number>) : {},
    };
  } catch {
    return emptySave(worldSeed);
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function writeSave(data: SaveData): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota or a locked-down browser. Losing the save is survivable; taking the
    // game down over it is not.
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
