/**
 * The first person Aldez meets.
 *
 * A generated world has no opening cutscene and should not want one, but it does
 * need someone to say what the game is about — and the cheapest, oldest way to
 * do that is a stranger on the road who has clearly been walking a long time.
 *
 * He is on the first screen, unarmed, with nothing hostile near him, because the
 * opening minute should teach *talking* before it teaches fighting. Everything
 * he says is true, and none of it is instructions: he does not explain controls
 * or name objectives. He says what he has seen, and what he has seen is the
 * premise — a kingdom that is not where he left it, and a man who keeps turning
 * up in it.
 *
 * The lines change with how many lives Aldez has lived, which is the one place
 * the game can quietly admit it remembers something the world does not.
 */

export interface TravellerScene {
  name: string;
  /** what he is, under the name — the same slot the townsfolk use */
  title: string;
  lines: readonly string[];
}

const FIRST_LIFE: readonly string[] = [
  'you are awake. i wondered if you would be',
  'i walk this road every year and every year it is a different road',
  'the hills move. the rivers change their minds',
  'only the names hold. amberwake is still amberwake, wherever it has got to',
  'go and find it. someone there will know what year they think it is',
  'and when the ground opens - it always opens - you will want a better blade first',
];

const SECOND_LIFE: readonly string[] = [
  'you again. or someone wearing the same face',
  'i have had this conversation before. i can never remember which parts',
  'amberwake moved again. it does that',
  'you go down and you do not come back up, and then you are here, and we talk',
  'i am not complaining. it is the only part that repeats',
];

const LATER_LIVES: readonly string[] = [
  'still going, then',
  'the world is thinner this time. can you feel it? like paper held to a window',
  'you have been further than anyone. that is not a compliment',
  'find the town. find the way down. you know all this',
  'i only stand here so somebody says it out loud',
];

/**
 * Lines chosen by how many lives have been lived.
 *
 * Three tiers rather than a per-life script: the point is that he *notices*, not
 * that the game tracks a counter. A fourth variant would be content nobody sees.
 */
export function travellerFor(draftsLived: number): TravellerScene {
  const lines = draftsLived <= 1 ? FIRST_LIFE
    : draftsLived === 2 ? SECOND_LIFE
      : LATER_LIVES;
  return {
    name: 'the walker',
    title: draftsLived > 2 ? 'you have met him before' : 'a traveller',
    lines,
  };
}
