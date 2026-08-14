/**
 * The difficulty curve, in one place.
 *
 * It used to be three unrelated expressions scattered across generation and
 * spawning — an HP bonus here, a count formula there, a big-Errata roll
 * somewhere else — which is why the first dungeon shipped harder than the third.
 * Nobody could see the curve, so nobody could tell it was wrong.
 *
 * The governing rule, stated once so it can be checked: **nothing but a boss
 * takes more than two hits until the player has cleared an Act.** Early enemies
 * are there to teach the verbs. A three-hit Moblin in the first dungeon does not
 * teach anything except that swinging is slow.
 *
 * `tier` is the single input: Act pressure plus depth. Everything else is a
 * function of it, so the whole curve can be read — and tested — as a table.
 */

export interface Difficulty {
  /** hard cap on any non-boss enemy's health */
  maxHp: number;
  /** typical enemies per combat room, before jitter */
  count: number;
  /** multiplier on enemy walk speed — slow and readable early */
  speed: number;
  /** multiplier on wind-up frames; longer is more readable */
  telegraph: number;
  /** chance a room gets a big Erratum at all */
  bigChance: number;
}

/**
 * Act pressure plus floor depth. Depth 0 is the waking place and always the
 * gentlest thing in the game.
 */
export function tierFor(actPressure: number, depth: number): number {
  return actPressure * 2 + depth;
}

export function difficultyFor(tier: number): Difficulty {
  // Hand-authored for the first few tiers, then extrapolated. The early rows are
  // the ones a player actually judges the game by, and they are too important to
  // leave to a formula.
  const table: Difficulty[] = [
    // tier 0 — the meadow. Something to practise the sword on, nothing more.
    { maxHp: 1, count: 1, speed: 0.55, telegraph: 1.6, bigChance: 0 },
    // tier 1 — the first dungeon. Still two hits, still readable.
    { maxHp: 2, count: 2, speed: 0.7, telegraph: 1.45, bigChance: 0 },
    { maxHp: 2, count: 3, speed: 0.8, telegraph: 1.3, bigChance: 0 },
    { maxHp: 3, count: 3, speed: 0.9, telegraph: 1.15, bigChance: 0.08 },
    { maxHp: 3, count: 4, speed: 1.0, telegraph: 1.0, bigChance: 0.14 },
    { maxHp: 4, count: 4, speed: 1.0, telegraph: 1.0, bigChance: 0.2 },
  ];
  if (tier < table.length) return table[tier]!;

  const over = tier - table.length + 1;
  return {
    maxHp: 4 + Math.floor(over / 2),
    count: Math.min(7, 4 + Math.floor(over / 2)),
    speed: 1.0,
    telegraph: 1.0,
    bigChance: Math.min(0.4, 0.2 + over * 0.04),
  };
}
