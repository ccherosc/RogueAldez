/**
 * The thread through the first half hour.
 *
 * A roguelike whose world is rewritten every life cannot hand out a quest log —
 * there is nothing stable to point at, and the whole premise is that Aldez does
 * not know this version of the kingdom either. But "you are free, go anywhere"
 * is not a substitute for direction, it is the absence of one, and the honest
 * report from playing was that you wander until something happens.
 *
 * So the thread is *what Aldez is currently trying to do*, in his own words,
 * derived from the state of the run rather than from a script. It never branches
 * and it cannot be failed. Its whole job is that a player who looks up from a
 * fight always knows what they were in the middle of.
 *
 * The beats are deliberately mundane at first — reach the town, find someone who
 * will talk, find the way down — because the story this game has to tell only
 * lands once the player has seen a place twice and found it different. The
 * strangeness needs somewhere ordinary to be measured against, which is the same
 * reason the meadow never scales.
 */

export type Beat =
  | 'wake'
  | 'reach-town'
  | 'meet-someone'
  | 'trade'
  | 'find-descent'
  | 'first-boss'
  | 'deeper';

export interface ThreadState {
  /** has the player set foot in Amberwake this life */
  visitedTown: boolean;
  /** has anyone been spoken to this life */
  spokeToAnyone: boolean;
  /** has anything been bought or sold this life */
  traded: boolean;
  depth: number;
  /** a Warden or Colossus is alive on this floor */
  bossAlive: boolean;
  draftsLived: number;
}

/**
 * The one thing Aldez is trying to do, right now.
 *
 * Ordered by what the player can act on soonest, not by importance: a goal you
 * cannot currently pursue is noise. The depth check comes first because once
 * you are underground the town is not the answer to anything.
 */
export function beatFor(s: ThreadState): Beat {
  if (s.depth > 0) {
    if (s.bossAlive) return 'first-boss';
    return s.depth >= 2 ? 'deeper' : 'find-descent';
  }
  if (!s.visitedTown) return 'reach-town';
  if (!s.spokeToAnyone) return 'meet-someone';
  if (!s.traded) return 'trade';
  return 'find-descent';
}

const LINES: Record<Beat, string> = {
  wake: 'get your bearings',
  'reach-town': 'find amberwake',
  'meet-someone': 'find someone who will talk',
  trade: 'see what the market has',
  'find-descent': 'find the way down',
  'first-boss': 'something guards the stairs',
  deeper: 'go deeper',
};

export function objectiveLine(beat: Beat): string {
  return LINES[beat];
}

/**
 * A longer line for the moment a beat first becomes current.
 *
 * Said once, as a thought, so the objective in the corner has somewhere it came
 * from. On a later life the wording admits Aldez has done this before, which is
 * the cheapest possible way for the game to remember something the world does
 * not.
 */
export function beatThought(beat: Beat, draftsLived: number): string {
  const again = draftsLived > 1;
  switch (beat) {
    case 'reach-town':
      return again
        ? 'amberwake, again. it is never where i left it'
        : 'there is a road. roads go somewhere';
    case 'meet-someone':
      return again
        ? 'i know these faces. they will not know mine'
        : 'someone here must know what year this is';
    case 'trade':
      return 'they will want shards. everyone always wants shards';
    case 'find-descent':
      return again
        ? 'down, then. it is always down'
        : 'the ground opens somewhere. it always does';
    case 'first-boss':
      return 'something is standing between me and the stairs';
    case 'deeper':
      return 'further than last time. that is the only measure i have';
    case 'wake':
      return 'awake. again';
  }
}
