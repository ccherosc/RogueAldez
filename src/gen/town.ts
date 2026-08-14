/**
 * Amberwake, rebuilt.
 *
 * The town has the same plan in every Draft — a walled square, a well at the
 * centre, a main street running gate to gate, buildings on plots either side —
 * and the *condition* decides what state that plan is in. Nothing here rolls a
 * different town; it rolls a different **year** of the same town.
 *
 * That is what makes a bustling market and a burned shell read as the same
 * place: the well is in the same spot, the street runs the same way, and the
 * player recognises where they are standing before they understand what has
 * happened to it. Randomising the layout instead would produce six towns that
 * happen to share a name, which is exactly the thing to avoid.
 */

import { ROOM_TILES_H, ROOM_TILES_W } from '../core/const.ts';
import type { Rng } from '../core/rng.ts';
import { TILE } from '../art/tiles.ts';
import { World, TileKind } from '../world/tilemap.ts';
import { CONDITION_PROFILES, TOWNSFOLK, roleFor, trades } from '../worldgen/townsfolk.ts';
import type { TownCondition, Role } from '../worldgen/townsfolk.ts';

/** Towns are three rooms wide and two tall: big enough to have districts. */
export const TOWN_COLS = 3;
export const TOWN_ROWS = 2;

export interface TownResident {
  id: string;
  name: string;
  role: Role;
  essence: string;
  truth: string;
  anchor: boolean;
  x: number;
  y: number;
  /** merchants and smiths will trade */
  shop: boolean;
}

export interface GeneratedTown {
  world: World;
  condition: TownCondition;
  residents: TownResident[];
  /** where the player arrives, just inside the south gate */
  spawn: { x: number; y: number };
  /** walk onto this to leave */
  gate: { x: number; y: number };
}

/** A building footprint on the fixed town plan. Same plots every Draft. */
interface Plot {
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** doors face the street */
  doorSide: 'n' | 's';
}

/**
 * The plan. Authored once, in tiles, relative to the town's top-left corner.
 *
 * Hand-placed rather than generated on purpose: a town the player must learn is
 * a town that has to be worth learning, and procedural street layout reads as
 * noise at this scale. The variation comes from condition, not from geometry.
 */
const PLOTS: readonly Plot[] = [
  { tx: 4, ty: 4, w: 7, h: 5, doorSide: 's' },
  { tx: 13, ty: 4, w: 6, h: 5, doorSide: 's' },
  { tx: 21, ty: 3, w: 8, h: 6, doorSide: 's' },
  { tx: 32, ty: 4, w: 7, h: 5, doorSide: 's' },
  { tx: 4, ty: 16, w: 6, h: 5, doorSide: 'n' },
  { tx: 12, ty: 16, w: 8, h: 5, doorSide: 'n' },
  { tx: 22, ty: 17, w: 6, h: 4, doorSide: 'n' },
  { tx: 30, ty: 16, w: 9, h: 5, doorSide: 'n' },
];

export function generateTown(condition: TownCondition, rng: Rng): GeneratedTown {
  const profile = CONDITION_PROFILES[condition];
  const world = new World(TOWN_COLS, TOWN_ROWS);
  const W = TOWN_COLS * ROOM_TILES_W;
  const H = TOWN_ROWS * ROOM_TILES_H;

  // Ground: packed earth inside the walls, grass beyond.
  world.fillTiles(TileKind.Grass);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) world.setTile(x, y, TileKind.Dirt);
  }

  // The curtain wall, with a gate south and north. The wall is what makes a town
  // feel like somewhere you *enter* rather than somewhere the grass stops.
  const gateX = Math.floor(W / 2);
  for (let x = 1; x < W - 1; x++) {
    world.setTile(x, 1, TileKind.Wall);
    world.setTile(x, H - 2, TileKind.Wall);
  }
  for (let y = 1; y < H - 1; y++) {
    world.setTile(1, y, TileKind.Wall);
    world.setTile(W - 2, y, TileKind.Wall);
  }
  for (let d = -2; d <= 2; d++) {
    world.setTile(gateX + d, 1, TileKind.Dirt);
    world.setTile(gateX + d, H - 2, TileKind.Dirt);
  }

  // The main street: paved, gate to gate, with the square in the middle.
  const streetY = Math.floor(H / 2);
  for (let x = 2; x < W - 2; x++) {
    for (let dy = -2; dy <= 2; dy++) world.setTile(x, streetY + dy, TileKind.Floor);
  }
  for (let y = streetY - 5; y <= streetY + 5; y++) {
    for (let x = gateX - 6; x <= gateX + 6; x++) {
      if (x > 2 && x < W - 3 && y > 2 && y < H - 3) world.setTile(x, y, TileKind.Floor);
    }
  }

  // Buildings. `intact` decides whether a plot is a house, a shell or rubble —
  // the single number that turns a market town into a burned one.
  for (const plot of PLOTS) {
    const state = rng.next();
    const standing = state < profile.intact;
    const material = standing ? TileKind.Wall : TileKind.Cliff;

    for (let y = plot.ty; y < plot.ty + plot.h; y++) {
      for (let x = plot.tx; x < plot.tx + plot.w; x++) {
        const edge = x === plot.tx || x === plot.tx + plot.w - 1
          || y === plot.ty || y === plot.ty + plot.h - 1;
        if (standing) {
          world.setTile(x, y, edge ? material : TileKind.Floor);
        } else if (rng.chance(0.55)) {
          // A ruin is a broken outline, not a filled block: you should be able to
          // walk through what is left and see it was a room.
          world.setTile(x, y, edge && rng.chance(0.6) ? material : TileKind.Dirt);
        } else {
          world.setTile(x, y, TileKind.Dirt);
        }
      }
    }

    // The door, always on the street side, so every building addresses the road.
    const doorY = plot.doorSide === 's' ? plot.ty + plot.h - 1 : plot.ty;
    const doorX = plot.tx + Math.floor(plot.w / 2);
    world.setTile(doorX, doorY, TileKind.Floor);
    if (standing) world.addProp('prop.torch.0', doorX + 1, doorY);
  }

  // The well: the fixed point of the town, in every condition. Recognising it is
  // how the player knows this is Amberwake before they know what year it is.
  const wellX = gateX;
  const wellY = streetY;
  world.addProp('prop.stalagmite', wellX, wellY);

  // Bustle: stalls, crates, braziers along the street.
  for (let i = 0; i < profile.bustle; i++) {
    const x = 6 + rng.int(0, W - 14);
    const y = streetY + rng.pick([-4, -3, 3, 4]);
    if (!world.isWalkable(x, y)) continue;
    world.addProp(rng.pick(['prop.crate', 'prop.pot', 'prop.crate']), x, y);
  }
  // Fire damage: charred stumps where the market was.
  if (condition === 'burned') {
    for (let i = 0; i < 10; i++) {
      const x = 5 + rng.int(0, W - 12);
      const y = 4 + rng.int(0, H - 10);
      if (world.isWalkable(x, y)) world.addProp('prop.stalagmite', x, y);
    }
  }

  // --- the cast ------------------------------------------------------------
  const residents: TownResident[] = [];
  const roster = [...TOWNSFOLK];
  rng.shuffle(roster);

  const spots: Array<[number, number]> = [];
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      // Outdoors, on the street or the square, and not on the well.
      if (!world.isWalkable(x, y)) continue;
      if (Math.abs(y - streetY) > 6) continue;
      if (Math.abs(x - wellX) < 2 && Math.abs(y - wellY) < 2) continue;
      spots.push([x, y]);
    }
  }
  rng.shuffle(spots);

  let placed = 0;
  for (const person of roster) {
    if (placed >= Math.min(profile.population, spots.length)) break;
    const role = roleFor(person, condition, (items) => rng.pick(items));
    if (!role) continue; // their essence has no place in this year
    const [tx, ty] = spots[placed]!;
    residents.push({
      id: person.id,
      name: person.name,
      role,
      essence: person.essence,
      truth: person.truth,
      anchor: person.anchor ?? false,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE - 1,
      shop: trades(role),
    });
    placed++;
  }

  // Guards stand at the gate, because that is where guards stand.
  for (let i = 0; i < profile.guards; i++) {
    const gx = gateX + (i % 2 === 0 ? -3 : 3);
    const gy = H - 5 - Math.floor(i / 2) * 2;
    if (!world.isWalkable(gx, gy)) continue;
    residents.push({
      id: `guard-${i}`,
      name: 'town guard',
      role: 'guard',
      essence: 'keeps',
      truth: 'they are always at the gate',
      anchor: false,
      x: gx * TILE + TILE / 2,
      y: gy * TILE + TILE - 1,
      shop: false,
    });
  }

  return {
    world,
    condition,
    residents,
    spawn: { x: gateX * TILE + TILE / 2, y: (H - 4) * TILE },
    gate: { x: gateX * TILE + TILE / 2, y: (H - 2) * TILE },
  };
}
