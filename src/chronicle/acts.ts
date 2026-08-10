/**
 * Acts — the spine of long-term progression.
 *
 * Each Act is a region of Ostreya with its own terrain, palette mood, enemy
 * roster and difficulty. Completing an Act unlocks the next permanently, and a
 * death returns Aldez to the *start of his current Act*, never to the beginning.
 * Progress through the world is kept; progress within an Act is what a death costs.
 *
 * Regions and their order come from the bible: the Vale is the warm, inviting
 * opening, and the deeper Acts get progressively less like a place anyone lives.
 */

import type { EnemyType } from './draft.ts';
import type { ValeCondition } from './draft.ts';

export interface Act {
  index: number;
  id: string;
  /** player-facing region name */
  name: string;
  /**
   * Whole-frame colour grade, applied in the presenter. This is the cheapest
   * possible biome mood: one multiply changes how a place *feels* without
   * regenerating a single tile.
   */
  grade: [number, number, number];
  /** ground the rooms are built from */
  ground: 'grass' | 'dirt' | 'floor';
  /** what separates rooms — water reads as open country, wall as interior */
  moat: 'water' | 'wall';
  /** which interior features suit the region */
  features: Array<'pond' | 'grove' | 'clearing' | 'pillars' | 'ruin'>;
  enemies: EnemyType[];
  conditions: ValeCondition[];
  /** floors to descend before the next Act unlocks */
  floors: number;
  /** flat bonus to enemies per room, on top of depth */
  pressure: number;
  /** musical mode — the mood of the ambient bed */
  mode: 'aeolian' | 'dorian' | 'phrygian' | 'lydian' | 'locrian';
  /** root note in Hz for this Act's drone */
  root: number;
}

export const ACTS: readonly Act[] = [
  {
    index: 0,
    id: 'amberwake',
    name: 'Amberwake Vale',
    // Warm and green. The bible is explicit that the opening must look genuinely
    // pleasant — the warmth is what makes the later Acts land.
    grade: [1.03, 1.02, 0.94],
    ground: 'grass',
    moat: 'water',
    features: ['clearing', 'grove', 'pond'],
    enemies: ['octorok', 'keese'],
    conditions: ['harvest', 'occupied', 'flooded'],
    floors: 3,
    pressure: 0,
    mode: 'lydian',
    root: 146.83, // D3
  },
  {
    index: 1,
    id: 'hollowroot',
    name: 'Hollowroot Wood',
    // Deep green, light drops. A forest that remembers more than people do.
    grade: [0.82, 0.94, 0.86],
    ground: 'grass',
    moat: 'water',
    features: ['grove', 'grove', 'clearing', 'ruin'],
    enemies: ['octorok', 'keese', 'moblin'],
    conditions: ['abandoned', 'overrun', 'harvest'],
    floors: 4,
    pressure: 1,
    mode: 'dorian',
    root: 130.81, // C3
  },
  {
    index: 2,
    id: 'glassmere',
    name: 'Glassmere',
    // Cold and bright — a drowned archive under a wide lake.
    grade: [0.86, 0.97, 1.12],
    ground: 'grass',
    moat: 'water',
    features: ['pond', 'pond', 'ruin', 'clearing'],
    enemies: ['keese', 'moblin', 'octorok'],
    conditions: ['flooded', 'flooded', 'abandoned'],
    floors: 4,
    pressure: 2,
    mode: 'aeolian',
    root: 123.47, // B2
  },
  {
    index: 3,
    id: 'belliron',
    name: 'The Belliron Peaks',
    // Grey and thin. Stone instead of soil, and walls instead of water.
    grade: [0.92, 0.90, 0.98],
    ground: 'dirt',
    moat: 'wall',
    features: ['pillars', 'pillars', 'ruin', 'clearing'],
    enemies: ['moblin', 'moblin', 'keese'],
    conditions: ['occupied', 'abandoned', 'overrun'],
    floors: 5,
    pressure: 3,
    mode: 'phrygian',
    root: 110.0, // A2
  },
  {
    index: 4,
    id: 'undercrown',
    name: 'The Undercrown',
    // Buried capitals stacked on buried capitals. Lamplight and dust.
    grade: [1.02, 0.88, 0.74],
    ground: 'floor',
    moat: 'wall',
    features: ['ruin', 'ruin', 'pillars'],
    enemies: ['moblin', 'octorok', 'keese'],
    conditions: ['abandoned', 'overrun', 'occupied'],
    floors: 6,
    pressure: 4,
    mode: 'locrian',
    root: 98.0, // G2
  },
];

export function actAt(index: number): Act {
  return ACTS[Math.max(0, Math.min(ACTS.length - 1, index))]!;
}

export const FINAL_ACT = ACTS.length - 1;

/** True when this floor is the last one standing between Aldez and the next Act. */
export function isActFinale(act: Act, depth: number): boolean {
  return depth + 1 >= act.floors;
}
