/**
 * What townsfolk say.
 *
 * Lives beside townsfolk.ts in worldgen/ rather than in chronicle/ because these
 * lines are *content about the world's people*, and the layer rule forbids a
 * sideways import between the two. Colocating the cast and its voice also means
 * adding a person is one file open, not two.
 *
 * Lines are composed from three sources rather than authored per character:
 *
 *   the **condition** — what has happened to this town
 *   the **role** — what this person is doing about it
 *   the **essence** — who they are underneath, which never changes
 *
 * Authored dialogue trees do not survive a world that reshuffles its cast every
 * life; you would need a line for every person in every role in every condition,
 * which is hundreds of lines nobody will read twice. Composition means Orra
 * sounds like Orra whether she is a smith or a beggar, because the essence layer
 * is speaking either way.
 *
 * The fourth source is **memory**. A person the player has met across several
 * Drafts starts saying things they should not be able to know. That is Echo
 * Memory, and it is the payoff the whole structure exists for.
 */

import type { Essence, Role, TownCondition } from './townsfolk.ts';

/** What the role is preoccupied with today. */
const ROLE_LINES: Record<Role, string[]> = {
  merchant: ['everything has a price, and mine are fair', 'buying, selling, mostly waiting'],
  smith: ['the forge is lit. it usually is', 'bring me metal and i will make it useful'],
  innkeeper: ['beds upstairs, if you can pay', 'people tell me things. i keep most of them'],
  guard: ['move along, or do not. it is a quiet post', 'nothing happens here. i intend to keep it that way'],
  noble: ['you are not from the vale', 'i hold what my family held. that is all anyone does'],
  farmer: ['the ground gives what it gives', 'rain would help. rain always would'],
  priest: ['the bell is rung at dawn, whoever is left to hear it', 'i keep the hours. someone has to'],
  child: ['are you a soldier? you have a soldier face', 'nobody tells me anything'],
  beggar: ['a shard, if you have one spare', 'i had a trade once. i still have the hands'],
  scavenger: ['plenty here, if you are not particular', 'what is left is left for anyone'],
  soldier: ['stay behind the line', 'we hold until we are told otherwise'],
  healer: ['i have run out of most things', 'keep your distance and you will be fine'],
  drunk: ['it was better before. it is always better before', 'you have the look of someone who has been here'],
};

/** What the condition has done to everyone, regardless of role. */
const CONDITION_LINES: Record<TownCondition, string[]> = {
  flourishing: ['good years. we have had worse and we will again', 'the market runs till dark'],
  occupied: ['keep your voice down near the gate', 'they took the granary first. they always do'],
  besieged: ['the gates are shut and they stay shut', 'we are counting days now, not sacks'],
  abandoned: ['most walked out. i did not see the point', 'you are the first face in a long while'],
  burned: ['it went up in a night', 'the bell tower stood. i wish it had not'],
  plagued: ['do not touch the doors with chalk on them', 'we bury at dusk, together, quickly'],
};

/** Who they are underneath. Said when the player has met them before. */
const ESSENCE_LINES: Record<Essence, string[]> = {
  curious: [
    'does this place feel right to you? it does not to me',
    'i keep thinking i have stood here before, facing the other way',
  ],
  makes: ['give me a week and a forge and i will be fine anywhere', 'my hands know work my head does not remember'],
  keeps: ['somebody has to count everyone', 'i will be here when you come back. i usually am'],
  trades: ['i can find a buyer for anything, in any year', 'value moves. i move with it'],
  believes: ['it is not for us to know why', 'i have been certain in worse places than this'],
  endures: ['i am still here. that is the whole of it', 'i have seen this town go, more than once'],
};

/** Lines only a person who half-remembers the last world would say. */
const MEMORY_LINES: string[] = [
  'have we spoken before? i cannot place where',
  'i dreamt of you. you were dressed differently',
  'you were here when it happened. i do not know how i know that',
  'i keep a name in my head that nobody in this town answers to',
];

export interface Voice {
  role: Role;
  essence: Essence;
  condition: TownCondition;
  /** how many Drafts this person has met Aldez in */
  met: number;
  /** deterministic 0..1 for this person, this Draft */
  roll: number;
}

const pick = <T>(items: readonly T[], roll: number): T =>
  items[Math.min(items.length - 1, Math.floor(roll * items.length))]!;

/**
 * One line, chosen by how well they know Aldez.
 *
 * The progression is the point. A stranger talks about their work. Someone who
 * has met you talks about the town. Someone who has met you many times starts
 * saying things that do not belong to this life — and that is the moment the
 * player understands what the game is about.
 */
export function speak(v: Voice): string {
  if (v.met >= 4 && v.roll < 0.55) return pick(MEMORY_LINES, v.roll * 1.8);
  if (v.met >= 2 && v.roll < 0.45) return pick(ESSENCE_LINES[v.essence], v.roll * 2.2);
  if (v.roll < 0.45) return pick(CONDITION_LINES[v.condition], v.roll * 2.2);
  return pick(ROLE_LINES[v.role], v.roll * 1.9);
}

/** Shown under the name, so the player can see the role move between lives. */
export function roleLabel(role: Role): string {
  return role;
}
