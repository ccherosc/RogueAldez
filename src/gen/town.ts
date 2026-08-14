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
import {
  CONDITION_PROFILES, TOWNSFOLK, roleFor, trades, essenceAllows,
} from '../worldgen/townsfolk.ts';
import type { TownCondition, Role, Essence } from '../worldgen/townsfolk.ts';

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
  // North side, doors onto the square.
  { tx: 4, ty: 3, w: 7, h: 6, doorSide: 's' },
  { tx: 13, ty: 3, w: 7, h: 6, doorSide: 's' },
  { tx: 28, ty: 3, w: 7, h: 6, doorSide: 's' },
  { tx: 37, ty: 3, w: 7, h: 6, doorSide: 's' },
  // South side, doors onto the square.
  { tx: 4, ty: 20, w: 7, h: 5, doorSide: 'n' },
  { tx: 13, ty: 20, w: 7, h: 5, doorSide: 'n' },
  { tx: 28, ty: 20, w: 7, h: 5, doorSide: 'n' },
  { tx: 37, ty: 20, w: 7, h: 5, doorSide: 'n' },
];

/**
 * Tiles no building may stand on: the gate-to-gate avenue, the main street, and
 * the square where they meet.
 *
 * This exists because the authored plan and the street carving disagreed, and
 * buildings are stamped *after* the streets — so a plot sitting on the avenue
 * silently replaced it with roof. One did. Walking in through the south gate you
 * got three tiles before hitting a wall, in every condition, on almost every
 * seed: the town was fully connected and completely unreadable, because the way
 * in led straight into the back of a house.
 *
 * Stated as a predicate rather than fixed by moving the plots alone, so the
 * check can prove it and a future plot cannot quietly reintroduce it.
 */
export function isStreet(tx: number, ty: number, w: number, h: number): boolean {
  const gateX = Math.floor(w / 2);
  const streetY = Math.floor(h / 2);
  const onAvenue = tx >= gateX - 2 && tx <= gateX + 2;
  const onStreet = ty >= streetY - 2 && ty <= streetY + 2;
  const inSquare = tx >= gateX - 6 && tx <= gateX + 6
    && ty >= streetY - 5 && ty <= streetY + 5;
  return onAvenue || onStreet || inSquare;
}

/** Every tile a plot would cover. */
export function plotTiles(plot: Plot): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = plot.ty; y < plot.ty + plot.h; y++) {
    for (let x = plot.tx; x < plot.tx + plot.w; x++) out.push([x, y]);
  }
  return out;
}

export const TOWN_PLOTS = PLOTS;

export function generateTown(condition: TownCondition, rng: Rng): GeneratedTown {
  const profile = CONDITION_PROFILES[condition];
  const world = new World(TOWN_COLS, TOWN_ROWS);
  const W = TOWN_COLS * ROOM_TILES_W;
  const H = TOWN_ROWS * ROOM_TILES_H;

  // Ground: grass everywhere, inside the walls as well as out.
  //
  // The first version paved the whole interior in packed earth, which put a
  // uniform tan field under everything and left roofs, street and ground reading
  // as three shades of the same brown. Yards and gardens between the houses give
  // the eye somewhere to rest and make the cobbled street actually read as a
  // street, because it is the only paved thing in view.
  world.fillTiles(TileKind.Grass);

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
    for (let dy = -2; dy <= 2; dy++) world.setTile(x, streetY + dy, TileKind.Cobble);
  }
  for (let y = streetY - 5; y <= streetY + 5; y++) {
    for (let x = gateX - 6; x <= gateX + 6; x++) {
      if (x > 2 && x < W - 3 && y > 2 && y < H - 3) world.setTile(x, y, TileKind.Cobble);
    }
  }
  // The approach through both gates is paved too, so the road reads as continuing
  // through the wall rather than stopping at it.
  for (let d = -2; d <= 2; d++) {
    world.setTile(gateX + d, 1, TileKind.Cobble);
    world.setTile(gateX + d, H - 2, TileKind.Cobble);
    for (let y = 2; y < streetY; y++) world.setTile(gateX + d, y, TileKind.Cobble);
    for (let y = streetY; y < H - 2; y++) world.setTile(gateX + d, y, TileKind.Cobble);
  }

  // Buildings. `intact` decides whether a plot is a house, a shell or rubble —
  // the single number that turns a market town into a burned one.
  for (const plot of PLOTS) {
    const standing = rng.next() < profile.intact;
    // One roof material for the whole plot, chosen once. Left to the position
    // hash, a single house came out speckled with all three — which reads as a
    // rendering fault rather than as a street where people built at different
    // times out of whatever was to hand.
    const material = rng.int(1, 3);

    for (let y = plot.ty; y < plot.ty + plot.h; y++) {
      for (let x = plot.tx; x < plot.tx + plot.w; x++) {
        if (standing) {
          world.setMaterial(x, y, material);
          // A house seen from above is a roof. Drawing it as a hollow ring of
          // wall with a floor inside is what a *dungeon room* is, and it made
          // Amberwake read as a ruin with furniture even in its good years.
          world.setTile(x, y, TileKind.Roof);
        } else {
          // A burned plot is a broken footprint you can walk through: some
          // standing masonry, the rest bare ground where the floor used to be.
          const edge = x === plot.tx || x === plot.tx + plot.w - 1
            || y === plot.ty || y === plot.ty + plot.h - 1;
          world.setTile(x, y, edge && rng.chance(0.5) ? TileKind.Wall : TileKind.Dirt);
        }
      }
    }

    // The doorstep, on the street side: a paved threshold under the eaves so
    // every building visibly addresses the road.
    const doorY = plot.doorSide === 's' ? plot.ty + plot.h - 1 : plot.ty;
    const doorX = plot.tx + Math.floor(plot.w / 2);
    const step = plot.doorSide === 's' ? doorY + 1 : doorY - 1;
    world.setTile(doorX, step, TileKind.Cobble);
    if (standing) {
      // Doorsteps are off the avenue by construction now, but guard it anyway:
      // the plots may move again and a torch is solid.
      if (doorX + 1 < gateX - 2 || doorX + 1 > gateX + 2) {
        world.addProp('prop.torch.0', doorX + 1, step);
      }
      if (doorX - 1 < gateX - 2 || doorX - 1 > gateX + 2) {
        world.addProp('prop.crate', doorX - 1, step);
      }
    }
  }

  // The well: the fixed point of the town, in every condition. Recognising it is
  // how the player knows this is Amberwake before they know what year it is.
  //
  // Offset from the crossing rather than dead centre: the well *was* on the
  // gate-to-gate line, which put a solid prop in the middle of the only way in.
  const wellX = gateX + 4;
  const wellY = streetY;
  world.addProp('prop.stalagmite', wellX, wellY);

  // Bustle: stalls, crates, braziers along the street.
  //
  // Nothing solid may stand on the avenue. The plots were moved off it and the
  // walk in was *still* blocked on some seeds, because decoration is placed by a
  // different loop with its own rules and a crate blocks a doorway exactly as
  // well as a house does. One reservation, applied everywhere something solid
  // gets put down.
  const blocksTheWay = (x: number, y: number): boolean =>
    x >= gateX - 2 && x <= gateX + 2;

  for (let i = 0; i < profile.bustle; i++) {
    const x = 6 + rng.int(0, W - 14);
    const y = streetY + rng.pick([-4, -3, 3, 4]);
    if (blocksTheWay(x, y) || !world.isWalkable(x, y)) continue;
    world.addProp(rng.pick(['prop.crate', 'prop.pot', 'prop.crate']), x, y);
  }
  // Fire damage: charred stumps where the market was.
  if (condition === 'burned') {
    for (let i = 0; i < 10; i++) {
      const x = 5 + rng.int(0, W - 12);
      const y = 4 + rng.int(0, H - 10);
      if (blocksTheWay(x, y) || !world.isWalkable(x, y)) continue;
      world.addProp('prop.stalagmite', x, y);
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

  // Somebody is always selling something.
  //
  // Widening the trading roles took the empty-market case from 40 towns in 40
  // down to a handful, which is the difference between a broken feature and an
  // occasional disappointment — and an occasional disappointment is still a
  // player following an objective to a town that cannot satisfy it. Roles are
  // rolled per person, so "usually someone trades" can always come up empty.
  //
  // The fallback promotes whoever is already there rather than adding a
  // stranger, and only to a role their essence allows, so the guarantee cannot
  // produce the one thing the cast rules exist to prevent: a person being
  // someone they could never be.
  if (!residents.some((r) => r.shop)) {
    const candidate = residents.find((r) => essenceAllows(r.essence as Essence, 'scavenger'))
      ?? residents.find((r) => essenceAllows(r.essence as Essence, 'beggar'));
    if (candidate) {
      candidate.role = essenceAllows(candidate.essence as Essence, 'scavenger')
        ? 'scavenger' : 'beggar';
      candidate.shop = true;
    }
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
