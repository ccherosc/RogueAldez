/**
 * A hand-built test area — four rooms of Amberwake Vale.
 *
 * Temporary. This exists so stage 3 has something real to walk around in and so
 * the tilemap, autotiling, collision and room transitions can be verified against
 * the bar. Once `chronicle/` and `gen/` land, rooms come from Draft generation and
 * these become room templates instead.
 *
 * Legend: G grass  D dirt  W water  F dungeon floor  X wall
 *         b bush   p pot (grass)    P pot (floor)    c chest   t torch
 */

import { World } from './tilemap.ts';

/** North-west: a clearing with a path in from the west, bending south-east. */
const ROOM_00 = [
  'GGGGGGGGGGGGGGGG',
  'GGGGbGGGGGGGGGGG',
  'GGGGGGGGGGGbGGGG',
  'GGGGGGGGGGGGGGGG',
  'DDDDDDDDGGGGGGGG',
  'GGGGGGGDGGGGGGGG',
  'GGbGGGGDGGGGGGbG',
  'GGGGGGGDDDDDDDDD',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGpGGTGGGGGGGG',
  'GGGGGGGGGGGGbGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

/** North-east: the pond. Water is solid, so it also tests collision shape. */
const ROOM_10 = [
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGWWWWWWWGGGGGG',
  'GGWWWWWWWWWGGGGG',
  'GGWWWWWWWWWGGbGG',
  'GGGWWWWWWWGGGGGG',
  'GGGGWWWWWGGGGGGG',
  'DDDDDDDDDDDDDDDD',
  'GGGGGGGGGGGGGGGG',
  'GGbGGGGGGGGGGGGG',
  'GGGGGGGGGGGGbGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGpGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

/** South-west: a dungeon room, entered from the north. */
const ROOM_01 = [
  'XXXXXXXFFXXXXXXX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFtFFFFFFFFtFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFPFFPFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFcFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XFFFFFFFFFFFFFFX',
  'XXXXXXXXXXXXXXXX',
];

/** South-east: open meadow, with training dummies to swing at. */
const ROOM_11 = [
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGbGGGGGGGGGGbGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGTGGGTGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGpGGGGGpGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGbGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
];

export function buildTestArea(): World {
  const world = new World(2, 2);
  world.loadRoom(0, 0, ROOM_00);
  world.loadRoom(1, 0, ROOM_10);
  world.loadRoom(0, 1, ROOM_01);
  world.loadRoom(1, 1, ROOM_11);
  return world;
}

/** Where the player starts, in world pixels (feet position). */
export const SPAWN = { x: 3 * 16 + 8, y: 9 * 16 + 15 };
