/**
 * Levels — the part of Aldez that carries across deaths.
 *
 * Gear answers "what am I holding"; a level answers "what am I". It rises with
 * every Erratum unwritten and, like gear, it survives death and dies with the
 * session. Coming back stronger is the whole shape of the loop: the world is
 * rewritten and *you are not*, so each life starts from further along.
 *
 * Two things a level does, and deliberately only two:
 *
 *   **Health.** Hearts are the resource a player actually feels. Levelling into
 *   another heart changes which fights are survivable, which is a real change to
 *   how the game is played.
 *
 *   **Standing.** Merchants stock to your level. A trader in a market town has
 *   no reason to lay out a star-amber blade for someone who walked in with a
 *   rusted sword, and gating the shop this way means the town gets better as you
 *   do without a single quest flag.
 *
 * Damage is *not* on this list. Weapons own damage; if levels scaled it too, the
 * tier curve would be doing the same job twice and neither would be legible.
 */

/** Levels run to 50, matching the gear tiers so "level" and "tier" mean one thing. */
export const MAX_LEVEL = 50;

/**
 * Total experience needed to reach a level.
 *
 * Quadratic-ish: early levels arrive fast enough to teach that killing things
 * pays, later ones slowly enough that reaching 50 is a session's work rather
 * than an afternoon's. Expressed as a formula rather than a table because fifty
 * hand-tuned numbers is fifty things to get wrong.
 */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, level));
  return Math.round(12 * (l - 1) + 2.6 * (l - 1) * (l - 1));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Progress through the current level, 0..1 — what the HUD bar shows. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return (xp - floor) / Math.max(1, next - floor);
}

/**
 * Experience an enemy is worth.
 *
 * Scaled by what it actually costs to kill rather than by a per-variant table,
 * so a new enemy is worth something sensible the moment it exists.
 */
export function xpForKill(maxHp: number, contactDamage: number, isBoss: boolean): number {
  const base = maxHp * 2 + contactDamage;
  return Math.max(1, Math.round(isBoss ? base * 4 : base));
}

/**
 * Bonus hearts from levelling, in whole hearts.
 *
 * One every five levels, capped: an Aldez with twenty hearts is an Aldez who
 * cannot be threatened, and the difficulty curve has nowhere left to go.
 */
export function bonusHearts(level: number): number {
  return Math.min(8, Math.floor((level - 1) / 5));
}

/**
 * The highest gear tier a merchant will lay out for someone of this level.
 *
 * Slightly ahead of the player, so the shop always holds something worth saving
 * for, and never so far ahead that shards can skip the whole curve.
 */
export function merchantTierFor(level: number): number {
  return Math.max(2, Math.min(MAX_LEVEL, level + 3));
}

/** What a piece of gear costs, in amber shards. */
export function priceOf(tier: number, epic: boolean): number {
  return Math.round((8 + tier * tier * 0.45 + tier * 4) * (epic ? 2.5 : 1));
}

/** What a merchant will pay for something. Always less than they sell it for. */
export function sellValue(tier: number, epic: boolean): number {
  return Math.max(1, Math.round(priceOf(tier, epic) * 0.35));
}
