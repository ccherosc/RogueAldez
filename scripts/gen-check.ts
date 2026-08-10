/**
 * npm run gen:check
 *
 * Generates a large batch of floors headlessly and proves each one is playable.
 *
 * A layout bug that strands the player behind a pond shows up once every few
 * hundred seeds — far too rare to catch by playing, and fatal when it happens.
 * This is the "generate 1000 floors, assert zero failures" check from dungeon-gen.
 */

import { ROOM_TILES_H, ROOM_TILES_W } from '../src/core/const.ts';
import { makeRng } from '../src/core/rng.ts';
import { TILE } from '../src/art/tiles.ts';
import { TileKind } from '../src/world/tilemap.ts';
import type { World } from '../src/world/tilemap.ts';
import { rollDraft } from '../src/chronicle/draft.ts';
import { ACTS, actAt } from '../src/chronicle/acts.ts';
import { BIOMES } from '../src/worldgen/biomes.ts';
import { generateFloor } from '../src/gen/floor.ts';

const COUNT = Number(process.argv[2] ?? 600);

interface Failure {
  seed: number;
  draft: number;
  depth: number;
  reason: string;
}

/** Walkable = not solid terrain and not covered by a solid prop. */
function buildWalkable(world: World): (tx: number, ty: number) => boolean {
  const blocked = new Set<number>();
  for (const p of world.props) {
    if (p.solid) blocked.add(p.ty * world.tilesW + p.tx);
  }
  return (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= world.tilesW || ty >= world.tilesH) return false;
    // Ask the world rather than listing kinds here — a new barrier type must not
    // be able to slip past the check by being forgotten in a second list.
    if (world.isSolid(tx, ty)) return false;
    return !blocked.has(ty * world.tilesW + tx);
  };
}

function floodFrom(world: World, sx: number, sy: number): Set<number> {
  const walkable = buildWalkable(world);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[sx, sy]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const idx = y * world.tilesW + x;
    if (seen.has(idx) || !walkable(x, y)) continue;
    seen.add(idx);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

const failures: Failure[] = [];
let roomsTotal = 0;
let featuresSeen = 0;

for (let i = 0; i < COUNT; i++) {
  const rng = makeRng(0x1000 + i);
  const depth = i % 4;
  // Sweep every Act: each has its own ground, moat material and feature mix, so
  // a layout bug can easily exist in the Undercrown and nowhere else.
  const act = actAt(i % ACTS.length);
  // Sweep every biome, not just every Act: ground material, moat material and
  // prop eligibility all vary per biome, so a layout bug can live in exactly one.
  const biome = BIOMES[i % BIOMES.length]!;
  const draft = rollDraft(1 + (i % 7), rng, i % 5);
  const floor = generateFloor(draft, act, biome, makeRng(draft.seed + depth * 0x9e37), depth);
  const world = floor.world;

  const spawnTx = Math.floor(floor.spawn.x / TILE);
  const spawnTy = Math.floor(floor.spawn.y / TILE);
  const note = (reason: string): void => {
    failures.push({ seed: draft.seed, draft: draft.index, depth, reason });
  };

  const walkable = buildWalkable(world);
  if (!walkable(spawnTx, spawnTy)) {
    note(`spawn tile ${spawnTx},${spawnTy} is not walkable`);
    continue;
  }

  const reached = floodFrom(world, spawnTx, spawnTy);

  // The way down must be reachable, or the floor is a dead end.
  const exitTx = Math.floor(floor.exit.x / TILE);
  const exitTy = Math.floor(floor.exit.y / TILE);
  const exitReachable =
    reached.has(exitTy * world.tilesW + exitTx) ||
    // The exit tile itself carries a solid chest; standing next to it counts.
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      reached.has((exitTy + dy!) * world.tilesW + (exitTx + dx!)));
  if (!exitReachable) note(`exit ${exitTx},${exitTy} unreachable from spawn`);

  // Every room must be enterable. Testing the exact centre tile is wrong — a
  // bush legitimately sits there sometimes — so the property is "some walkable
  // tile in this room is reachable".
  for (const room of floor.rooms.values()) {
    roomsTotal++;
    let walkableInRoom = 0;
    let reachedInRoom = 0;
    for (let ty = room.ry * ROOM_TILES_H; ty < (room.ry + 1) * ROOM_TILES_H; ty++) {
      for (let tx = room.rx * ROOM_TILES_W; tx < (room.rx + 1) * ROOM_TILES_W; tx++) {
        if (!walkable(tx, ty)) continue;
        walkableInRoom++;
        if (reached.has(ty * world.tilesW + tx)) reachedInRoom++;
      }
    }
    if (walkableInRoom === 0) {
      note(`room ${room.rx},${room.ry} (${room.kind}) has no walkable ground`);
    } else if (reachedInRoom === 0) {
      note(`room ${room.rx},${room.ry} (${room.kind}) sealed off from spawn`);
    } else if (reachedInRoom < walkableInRoom * 0.5) {
      // Most of a room being cut off means the player can enter but not use it.
      note(`room ${room.rx},${room.ry} only ${reachedInRoom}/${walkableInRoom} tiles reachable`);
    }
  }

  // No isolated walkable pockets anywhere on the floor.
  let stranded = 0;
  for (let ty = 0; ty < world.tilesH; ty++) {
    for (let tx = 0; tx < world.tilesW; tx++) {
      if (walkable(tx, ty) && !reached.has(ty * world.tilesW + tx)) stranded++;
    }
  }
  // A handful of tiles behind scenery is normal; a large pocket is a real fault.
  if (stranded > 24) note(`${stranded} walkable tiles stranded from spawn`);

  // Enemies must not be sealed inside scenery either.
  for (const e of floor.enemies) {
    if (!walkable(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) {
      note(`enemy ${e.variant} spawned in a solid tile`);
      break;
    }
  }

  if (world.props.length > 0) featuresSeen++;
}

console.log(`generated ${COUNT} floors, ${roomsTotal} rooms`);
console.log(`${featuresSeen}/${COUNT} floors had props placed`);

if (failures.length === 0) {
  console.log('ok  every floor solvable: spawn walkable, all rooms and the exit reachable');
  process.exit(0);
}

console.error(`\nFAIL  ${failures.length} problem(s) across ${COUNT} floors:\n`);
for (const f of failures.slice(0, 12)) {
  console.error(`  draft ${f.draft} depth ${f.depth} seed ${f.seed}: ${f.reason}`);
}
process.exit(1);
