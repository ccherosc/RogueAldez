/**
 * What Aldez says to himself.
 *
 * The world is generated, so it cannot lean on a hand-placed signpost, and it is
 * rewritten every life, so it cannot lean on the player remembering where things
 * were. Without something in between, the honest description of play is "walk
 * into every room until you find the one that matters" — which is exactly what
 * exploring is *not* supposed to feel like.
 *
 * The fix is a voice rather than a map. A compass arrow would answer the
 * question outright and turn the world into a corridor; a man muttering "i hear
 * commotion to the east" answers it in the register the game is already written
 * in, and leaves the walking to the player. It also costs nothing to be wrong
 * about the details — Aldez is guessing at a kingdom that keeps changing, and a
 * line that says *what he notices* can be flavourful where a compass can only be
 * accurate.
 *
 * Every line here must name the real direction. The one thing this system is not
 * allowed to be is decorative: a hint that points the wrong way is worse than
 * silence, because the player will trust it once and then stop trusting all of
 * them.
 */

import type { Rng } from '../core/rng.ts';

export type HintTarget = 'town' | 'descent' | 'boss' | 'relic';

/**
 * Eight-point compass from a vector, in screen terms — +y is south.
 *
 * Eight rather than four because four makes a diagonal walk feel like the hint
 * lied, and sixteen names directions no one says out loud.
 */
export function bearing(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here';
  const angle = Math.atan2(dy, dx);
  const i = Math.round((angle * 4) / Math.PI + 8) % 8;
  return ['east', 'south-east', 'south', 'south-west',
    'west', 'north-west', 'north', 'north-east'][i]!;
}

/** How far, in rooms, said the way people say it rather than in numbers. */
export function distanceWord(rooms: number): string {
  if (rooms <= 1) return 'close';
  if (rooms <= 2) return 'not far';
  return 'a way off';
}

const LINES: Record<HintTarget, readonly string[]> = {
  // The town is the loud one: it is the thing a lost player most needs to find,
  // and the only target that announces itself through more than one sense.
  town: [
    'i hear commotion to the {dir}',
    'smoke to the {dir}. someone still lights fires there',
    'there are people that way, {dir}. i think there are',
    'bells, maybe. {dir}, and {dist}',
    'a road runs {dir}. roads go somewhere',
  ],
  descent: [
    'the air comes up cold from the {dir}',
    'a draught from the {dir}. something is open down there',
    'the floor gives way somewhere {dir}',
    'down, then. {dir}, and {dist}',
  ],
  boss: [
    'something heavy is breathing to the {dir}',
    'the quiet to the {dir} is the wrong kind',
    'whatever guards the way is {dir} of me',
  ],
  relic: [
    'something of mine is {dir} of here',
    'i left something {dir}. or i will',
  ],
};

/**
 * A line naming a real direction.
 *
 * `{dist}` is only substituted where a line asks for it, so most lines stay
 * short — a hint that reads like a status report stops sounding like a person.
 */
export function selfTalk(target: HintTarget, dx: number, dy: number, roomsAway: number, rng: Rng): string {
  const pool = LINES[target];
  return rng.pick(pool)
    .replace('{dir}', bearing(dx, dy))
    .replace('{dist}', distanceWord(roomsAway));
}

/**
 * Lines for when there is nothing in particular to point at.
 *
 * Deliberately directionless. Inventing a bearing with no target behind it is
 * the failure this whole module exists to avoid.
 */
export const IDLE_LINES: readonly string[] = [
  'i have been here before. it was not this shape',
  'none of this is where i left it',
  'keep walking. it changes if you stand still',
  'i knew this place once',
];
