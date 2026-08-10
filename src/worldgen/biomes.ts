/**
 * The biome registry.
 *
 * Every biome is **pure data**. Adding the thirtieth biome must be an entry in
 * this array and nothing else — if a new biome needs a branch in the generator,
 * the biome is badly specified or the schema is missing a field. That constraint
 * is the whole reason this scales.
 *
 * Biomes are classified from continuous climate fields rather than picked from a
 * list, which is what prevents geographic nonsense: you cannot get a glacier
 * bordering a salt flat because temperature cannot jump between neighbouring
 * cells. See fields.ts.
 */

import type { Tag } from './tags.ts';

/** Abstract terrain vocabulary. gen/ maps these onto actual TileKinds. */
export type GroundKind = 'grass' | 'dirt' | 'floor';
/**
 * What separates one screen from the next where it is not passable.
 *
 * Water everywhere made the world read as a chain of islands. A treeline bounds
 * a wood, a rock face bounds a mountain, and masonry bounds a crypt — the
 * barrier should be made of the place it is in.
 */
export type MoatKind = 'water' | 'wall' | 'cliff' | 'forest';
export type FeatureKind = 'pond' | 'grove' | 'clearing' | 'pillars' | 'ruin';

/** Inclusive [min, max] window on a 0..1 climate field. */
export type Band = readonly [number, number];

export interface Biome {
  id: string;
  /** player-facing name, shown on the HUD */
  name: string;
  /** which Act this biome belongs to — gates when the player can reach it */
  act: number;

  /** classification window; the closest fit wins */
  elevation: Band;
  moisture: Band;
  temperature: Band;

  /** what this biome contributes to every tile in it */
  provides: Tag[];

  /** whole-frame colour multiply — the mood */
  grade: readonly [number, number, number];
  ground: GroundKind;
  moat: MoatKind;
  features: FeatureKind[];

  /** density knobs, 0..1 */
  propDensity: number;
  /**
   * Whether combat rooms bar their exits until cleared.
   *
   * Dungeons do this; open country does not. Barring a meadow makes the world
   * feel like a series of arenas rather than a place, and the whole point of the
   * overworld is that you can walk away.
   */
  barsRooms: boolean;
  /** musical mode and root for the ambient bed */
  mode: 'aeolian' | 'dorian' | 'phrygian' | 'lydian' | 'locrian';
  root: number;
}

export const BIOMES: readonly Biome[] = [
  // === Act 0 — Amberwake Vale ==============================================
  {
    id: 'meadow', name: 'Amberwake Meadow', act: 0,
    elevation: [0.25, 0.55], moisture: [0.35, 0.65], temperature: [0.5, 0.8],
    provides: ['grassland', 'temperate', 'fertile', 'lowland', 'wild', 'luminous'],
    grade: [1.03, 1.02, 0.94], ground: 'grass', moat: 'water',
    features: ['clearing', 'grove', 'pond'], propDensity: 0.5, barsRooms: false,
    mode: 'lydian', root: 146.83,
  },
  {
    id: 'orchard', name: 'The Orchards', act: 0,
    elevation: [0.3, 0.55], moisture: [0.5, 0.8], temperature: [0.55, 0.85],
    provides: ['grassland', 'temperate', 'fertile', 'lowland', 'settled', 'luminous'],
    grade: [1.05, 1.0, 0.9], ground: 'grass', moat: 'water',
    features: ['clearing', 'grove'], propDensity: 0.7, barsRooms: false,
    mode: 'lydian', root: 164.81,
  },
  {
    id: 'fen', name: 'Amberwake Fen', act: 0,
    elevation: [0.15, 0.35], moisture: [0.7, 1.0], temperature: [0.45, 0.75],
    provides: ['wetland', 'temperate', 'lowland', 'fertile', 'wild'],
    grade: [0.93, 1.0, 0.92], ground: 'grass', moat: 'water',
    features: ['pond', 'pond', 'grove'], propDensity: 0.5, barsRooms: false,
    mode: 'dorian', root: 138.59,
  },

  // === Act 1 — Hollowroot Wood =============================================
  {
    id: 'pinewood', name: 'Pinewood', act: 1,
    elevation: [0.35, 0.65], moisture: [0.4, 0.7], temperature: [0.3, 0.6],
    provides: ['forested', 'temperate', 'fertile', 'wild'],
    grade: [0.86, 0.96, 0.88], ground: 'grass', moat: 'forest',
    features: ['grove', 'grove', 'clearing'], propDensity: 0.8, barsRooms: false,
    mode: 'dorian', root: 130.81,
  },
  {
    id: 'deepwood', name: 'The Deepwood', act: 1,
    elevation: [0.35, 0.6], moisture: [0.55, 0.85], temperature: [0.25, 0.55],
    provides: ['forested', 'cold', 'wild', 'dark', 'fertile'],
    grade: [0.72, 0.86, 0.8], ground: 'grass', moat: 'forest',
    features: ['grove', 'grove', 'ruin'], propDensity: 0.9, barsRooms: false,
    mode: 'aeolian', root: 123.47,
  },
  {
    id: 'bogwood', name: 'The Rootbound Bog', act: 1,
    elevation: [0.2, 0.4], moisture: [0.75, 1.0], temperature: [0.35, 0.65],
    provides: ['forested', 'wetland', 'lowland', 'wild', 'dark'],
    grade: [0.78, 0.9, 0.82], ground: 'grass', moat: 'forest',
    features: ['pond', 'grove', 'ruin'], propDensity: 0.7, barsRooms: false,
    mode: 'phrygian', root: 116.54,
  },

  // === Act 2 — Glassmere ====================================================
  {
    id: 'shallows', name: 'Glassmere Shallows', act: 2,
    elevation: [0.1, 0.3], moisture: [0.8, 1.0], temperature: [0.35, 0.65],
    provides: ['wetland', 'coastal', 'lowland', 'temperate', 'wild'],
    grade: [0.86, 0.97, 1.12], ground: 'grass', moat: 'water',
    features: ['pond', 'pond', 'clearing'], propDensity: 0.4, barsRooms: false,
    mode: 'aeolian', root: 123.47,
  },
  {
    id: 'reedflat', name: 'The Reed Flats', act: 2,
    elevation: [0.15, 0.35], moisture: [0.7, 0.95], temperature: [0.4, 0.7],
    provides: ['wetland', 'lowland', 'fertile', 'wild', 'coastal'],
    grade: [0.9, 1.0, 1.05], ground: 'grass', moat: 'water',
    features: ['pond', 'grove'], propDensity: 0.8, barsRooms: false,
    mode: 'dorian', root: 110.0,
  },
  {
    id: 'drowned-ruin', name: 'The Drowned Scriptorium', act: 2,
    elevation: [0.2, 0.4], moisture: [0.75, 1.0], temperature: [0.3, 0.6],
    provides: ['wetland', 'ruined', 'lowland', 'dark', 'coastal'],
    grade: [0.8, 0.92, 1.08], ground: 'floor', moat: 'water',
    features: ['ruin', 'ruin', 'pond'], propDensity: 0.6, barsRooms: true,
    mode: 'locrian', root: 103.83,
  },

  // === Act 3 — The Belliron Peaks ==========================================
  {
    id: 'scree', name: 'The Scree', act: 3,
    elevation: [0.7, 0.95], moisture: [0.1, 0.4], temperature: [0.2, 0.5],
    provides: ['rocky', 'high-altitude', 'barren', 'cold', 'wild'],
    grade: [0.92, 0.9, 0.98], ground: 'dirt', moat: 'cliff',
    features: ['pillars', 'pillars', 'clearing'], propDensity: 0.5, barsRooms: false,
    mode: 'phrygian', root: 110.0,
  },
  {
    id: 'snowfield', name: 'The White Reach', act: 3,
    elevation: [0.8, 1.0], moisture: [0.3, 0.6], temperature: [0.0, 0.25],
    provides: ['rocky', 'high-altitude', 'frozen', 'barren', 'wild', 'luminous'],
    grade: [0.98, 1.0, 1.12], ground: 'dirt', moat: 'cliff',
    features: ['pillars', 'clearing'], propDensity: 0.3, barsRooms: false,
    mode: 'aeolian', root: 98.0,
  },
  {
    // Rain shadow. The climate model puts low moisture downwind of high
    // elevation without being told to, so a dry waste behind the peaks is where
    // the fields naturally produce one.
    id: 'saltflat', name: 'The Ember Flats', act: 3,
    elevation: [0.55, 0.8], moisture: [0.0, 0.2], temperature: [0.55, 0.85],
    provides: ['arid', 'hot', 'barren', 'rocky', 'wild', 'luminous'],
    grade: [1.08, 1.0, 0.82], ground: 'dirt', moat: 'cliff',
    features: ['clearing', 'pillars'], propDensity: 0.35, barsRooms: false,
    mode: 'phrygian', root: 116.54,
  },
  {
    id: 'minehead', name: 'The Belliron Mineheads', act: 3,
    elevation: [0.6, 0.85], moisture: [0.2, 0.5], temperature: [0.25, 0.55],
    provides: ['rocky', 'high-altitude', 'settled', 'subterranean', 'dark', 'barren'],
    grade: [0.94, 0.88, 0.86], ground: 'floor', moat: 'wall',
    features: ['ruin', 'pillars'], propDensity: 0.8, barsRooms: true,
    mode: 'phrygian', root: 103.83,
  },

  // === Act 4 — The Undercrown ==============================================
  {
    id: 'undercity', name: 'The Undercity', act: 4,
    elevation: [0.4, 0.7], moisture: [0.2, 0.5], temperature: [0.35, 0.65],
    provides: ['subterranean', 'ruined', 'dark', 'settled', 'barren'],
    grade: [1.02, 0.88, 0.74], ground: 'floor', moat: 'wall',
    features: ['ruin', 'ruin', 'pillars'], propDensity: 0.8, barsRooms: true,
    mode: 'locrian', root: 98.0,
  },
  {
    id: 'vaults', name: 'The Sealed Vaults', act: 4,
    elevation: [0.45, 0.75], moisture: [0.1, 0.4], temperature: [0.3, 0.6],
    provides: ['subterranean', 'ruined', 'dark', 'barren'],
    grade: [0.94, 0.86, 0.8], ground: 'floor', moat: 'wall',
    features: ['ruin', 'pillars', 'pillars'], propDensity: 0.6, barsRooms: true,
    mode: 'locrian', root: 87.31,
  },
  {
    // The reason the tag system exists. Nothing else provides `consecrated`,
    // so tombstones appear here and demonstrably nowhere else.
    id: 'ossuary', name: 'The Ossuary', act: 4,
    elevation: [0.4, 0.7], moisture: [0.15, 0.45], temperature: [0.2, 0.5],
    provides: ['subterranean', 'consecrated', 'dark', 'ruined', 'barren'],
    grade: [0.88, 0.84, 0.92], ground: 'floor', moat: 'wall',
    features: ['ruin', 'pillars'], propDensity: 0.9, barsRooms: true,
    mode: 'phrygian', root: 92.5,
  },
];

export function biomeById(id: string): Biome {
  const found = BIOMES.find((b) => b.id === id);
  if (!found) throw new Error(`unknown biome "${id}"`);
  return found;
}

export function biomesForAct(act: number): Biome[] {
  return BIOMES.filter((b) => b.act === act);
}

/** Distance from a value to a band; 0 when inside it. */
function bandDistance(value: number, [lo, hi]: Band): number {
  if (value < lo) return lo - value;
  if (value > hi) return value - hi;
  return 0;
}

/**
 * Closest-fit classification.
 *
 * Nearest-band rather than first-match, so the map never has a hole: any climate
 * triple resolves to *some* biome, and biomes whose bands overlap simply compete.
 * Restricting the candidate pool to one Act is what gates progression.
 */
export function classify(
  elevation: number,
  moisture: number,
  temperature: number,
  pool: readonly Biome[] = BIOMES,
): Biome {
  if (pool.length === 0) throw new Error('classify: empty biome pool');
  let best = pool[0]!;
  let bestScore = Infinity;
  for (const biome of pool) {
    const score =
      bandDistance(elevation, biome.elevation) * 1.2 +
      bandDistance(moisture, biome.moisture) +
      bandDistance(temperature, biome.temperature);
    if (score < bestScore) {
      bestScore = score;
      best = biome;
    }
  }
  return best;
}
