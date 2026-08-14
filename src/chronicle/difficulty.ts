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

/**
 * The four modes, and what a mode is allowed to be.
 *
 * A mode is a set of multipliers on the curve, not a second curve. The shape of
 * the ramp — gentle meadow, readable first dungeon, pressure that arrives with
 * depth — is a design decision, and it should survive the player picking an
 * easier game. Casual is the same game with the volume down, not a different
 * one.
 *
 * Two traps live in this table, both of which come from assuming "harder means
 * every number goes up":
 *
 *  - `telegraph` is *inverted*. It multiplies wind-up frames, so a longer
 *    telegraph is an easier fight. Insano shortens it; casual stretches it.
 *  - `hp` scales a **cap**, not a value. It floors at 1 elsewhere, because a cap
 *    that rounds to zero does not make enemies weak, it makes them spawn dead.
 *
 * `damage` is on the player's side of the ledger: what a hit costs Aldez. It is
 * the one number that separates "I have time to learn this" from "I do not",
 * and it moves further across the range than anything else here.
 */
export const DIFFICULTY_MODES = ['casual', 'easy', 'hard', 'insano'] as const;
export type DifficultyMode = (typeof DIFFICULTY_MODES)[number];

// Easy by default. The people who want the tuned curve will go and find it in
// the menu; the people who bounce off an unfamiliar game in the first ten
// minutes never see the menu at all.
export const DEFAULT_MODE: DifficultyMode = 'easy';

export interface ModeScale {
  /** shown in the menu */
  label: string;
  /** one line under it, in the player's terms rather than the designer's */
  blurb: string;
  hp: number;
  count: number;
  speed: number;
  /** multiplies wind-up frames: higher is *easier* */
  telegraph: number;
  big: number;
  /** multiplies damage taken by the player */
  damage: number;
}

export const MODE_SCALES: Record<DifficultyMode, ModeScale> = {
  casual: {
    label: 'casual',
    blurb: 'for seeing the world. hits barely sting',
    hp: 0.5, count: 0.6, speed: 0.8, telegraph: 1.4, big: 0.3, damage: 0.5,
  },
  easy: {
    label: 'easy',
    blurb: 'forgiving, but it can still kill you',
    hp: 0.75, count: 0.8, speed: 0.9, telegraph: 1.2, big: 0.65, damage: 0.75,
  },
  hard: {
    label: 'hard',
    blurb: 'the game as it was tuned',
    hp: 1, count: 1, speed: 1, telegraph: 1, big: 1, damage: 1,
  },
  insano: {
    label: 'insano',
    blurb: 'they hit twice as hard and they do not wait',
    hp: 1.5, count: 1.35, speed: 1.15, telegraph: 0.7, big: 1.6, damage: 2,
  },
};

/** What a hit costs Aldez under this mode. Applied after armour, never below 1. */
export function damageScale(mode: DifficultyMode): number {
  return MODE_SCALES[mode].damage;
}

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
 * Act pressure plus floor depth.
 *
 * Depth 0 returns tier 0 unconditionally, whatever the Act. This docstring has
 * claimed the waking place is "always the gentlest thing in the game" since it
 * was written, and the formula quietly disagreed: Act pressure lifted the hub
 * along with everything else, so a player who had unlocked four Acts woke into
 * a meadow holding six to nine Errata per screen and no way to have earned it.
 *
 * The meadow is the constant the strangeness is measured against. It cannot be
 * the constant and also scale.
 */
export function tierFor(actPressure: number, depth: number): number {
  if (depth === 0) return 0;
  return actPressure * 2 + depth;
}

export function difficultyFor(tier: number, mode: DifficultyMode = DEFAULT_MODE): Difficulty {
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
  const base = tier < table.length ? table[tier]! : (() => {
    const over = tier - table.length + 1;
    return {
      maxHp: 4 + Math.floor(over / 2),
      count: Math.min(7, 4 + Math.floor(over / 2)),
      speed: 1.0,
      telegraph: 1.0,
      bigChance: Math.min(0.4, 0.2 + over * 0.04),
    };
  })();

  return scaleBy(base, MODE_SCALES[mode]);
}

/**
 * Apply a mode to a curve row.
 *
 * Both counts floor at 1: a mode that scales a room down to zero enemies has
 * stopped being an easier game and started being an empty one, and a maxHp cap
 * of zero would make every enemy spawn already dead.
 */
function scaleBy(base: Difficulty, m: ModeScale): Difficulty {
  return {
    maxHp: Math.max(1, Math.round(base.maxHp * m.hp)),
    count: Math.max(1, Math.round(base.count * m.count)),
    speed: base.speed * m.speed,
    telegraph: base.telegraph * m.telegraph,
    // A mode must not invent big Errata where the curve says there are none:
    // multiplying zero keeps tier 0 and 1 clean even on insano.
    bigChance: Math.min(1, base.bigChance * m.big),
  };
}
