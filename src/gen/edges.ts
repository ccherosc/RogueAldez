/**
 * Edge matching.
 *
 * The problem: if each room decides its own borders, the terrain on one side of a
 * seam will not line up with the other, and the world reads as a grid of
 * unrelated screens. The old generator dodged this by making every border an
 * identical moat with an identical gate — which matched perfectly and looked like
 * a chain of islands.
 *
 * The fix is to stop treating a border as something a room owns. A boundary
 * belongs to the *pair* of rooms that share it: it is generated once, keyed by
 * the boundary rather than by either room, and both sides read the same answer.
 * Matching is then structural — there is no code path that can produce a mismatch,
 * so no check is needed and no seam can ever be wrong.
 *
 * That also unlocks the thing islands could not do: a boundary can be *entirely*
 * open, so you walk from one screen to the next through unbroken grass.
 */

import { ROOM_TILES_H, ROOM_TILES_W } from '../core/const.ts';
import type { Rng } from '../core/rng.ts';

export type Dir4 = 'n' | 's' | 'e' | 'w';

/**
 * Tiles at each end of a seam that can never be an opening.
 *
 * Must be at least the barrier band thickness in floor.ts, including its jitter,
 * or a corner opening can be sealed by the band of the edge it meets.
 */
export const CORNER_MARGIN = 3;

/** How much of a shared boundary is walkable. */
export type Openness =
  /** the whole seam — open country, no barrier at all */
  | 'full'
  /** most of it, with barrier at the corners */
  | 'wide'
  /** a doorway */
  | 'gate'
  /** natural gaps, as through a thinning wood */
  | 'ragged'
  /** impassable */
  | 'closed';

export interface EdgeSpec {
  /** one entry per tile along the seam; true = walkable */
  open: boolean[];
  openness: Openness;
  /**
   * Which of the biome's barrier materials fills this seam's closed span.
   *
   * Chosen per boundary rather than per biome. One material everywhere is what
   * made the meadow read as a chain of moated islands — the same shoreline on
   * all four sides of every screen. A field bounded by a treeline here, a
   * hedgerow of rock there, and open water only sometimes reads as country.
   */
  material: number;
}

/** Length of a seam, in tiles. Vertical seams run along X, horizontal along Y. */
export function seamLength(axis: 'h' | 'v'): number {
  return axis === 'v' ? ROOM_TILES_W : ROOM_TILES_H;
}

/**
 * Boundary key. `h:x,y` is the seam between (x,y) and (x+1,y); `v:x,y` is the
 * seam between (x,y) and (x,y+1). Both rooms compute the same key, which is the
 * whole mechanism.
 */
export function boundaryKey(rx: number, ry: number, dir: Dir4): string {
  switch (dir) {
    case 'e': return `h:${rx},${ry}`;
    case 'w': return `h:${rx - 1},${ry}`;
    case 's': return `v:${rx},${ry}`;
    case 'n': return `v:${rx},${ry - 1}`;
  }
}

export function boundaryAxis(dir: Dir4): 'h' | 'v' {
  return dir === 'e' || dir === 'w' ? 'h' : 'v';
}

const CLOSED_WEIGHTS: Array<[Openness, number]> = [
  ['full', 3],
  ['wide', 4],
  ['ragged', 3],
  ['gate', 2],
];

/**
 * Roll a seam.
 *
 * `openWorld` biases hard toward wide and full openings; dungeons want doorways.
 * The distinction is what makes a meadow feel like country you cross and a crypt
 * feel like rooms you enter.
 */
export function rollEdge(
  axis: 'h' | 'v',
  connected: boolean,
  openWorld: boolean,
  rng: Rng,
): EdgeSpec {
  const len = seamLength(axis);
  // Weighted toward the biome's primary material so a place still has a
  // dominant character; the alternates are accents, not a random mix.
  const material = rng.pick([0, 0, 0, 1, 1, 2]);
  if (!connected) {
    return { open: new Array(len).fill(false), openness: 'closed', material };
  }

  const openness = openWorld
    ? rng.pick(['full', 'full', 'wide', 'wide', 'ragged'] as Openness[])
    : weightedPick(CLOSED_WEIGHTS, rng);

  const open = new Array<boolean>(len).fill(false);

  switch (openness) {
    case 'full':
      open.fill(true);
      break;

    case 'wide': {
      // Leave a couple of tiles of barrier at each end so the seam still reads as
      // a shape rather than as an absence.
      const inset = rng.int(1, 3);
      for (let i = inset; i < len - inset; i++) open[i] = true;
      break;
    }

    case 'gate': {
      const width = rng.int(4, 6);
      const start = rng.int(1, Math.max(1, len - width - 1));
      for (let i = start; i < start + width; i++) open[i] = true;
      break;
    }

    case 'ragged': {
      // Two or three gaps with barrier between: a treeline you pick your way through.
      const gaps = rng.int(2, 3);
      for (let g = 0; g < gaps; g++) {
        const width = rng.int(2, 4);
        const start = rng.int(0, Math.max(0, len - width));
        for (let i = start; i < start + width; i++) open[i] = true;
      }
      break;
    }

    case 'closed':
      break;
  }

  // Corners belong to two edges at once. An opening within the margin sits where
  // the perpendicular barrier band also runs, and that band will seal it — the
  // room then looks connected on the map and is not. Openings live strictly in
  // the interior span.
  for (let i = 0; i < CORNER_MARGIN; i++) {
    open[i] = false;
    open[len - 1 - i] = false;
  }

  // A connected seam that rolled shut would strand a room. Force a doorway.
  if (!open.some(Boolean)) {
    const mid = Math.floor(len / 2);
    for (let i = mid - 2; i <= mid + 1; i++) {
      if (i >= CORNER_MARGIN && i < len - CORNER_MARGIN) open[i] = true;
    }
  }
  return { open, openness, material };
}

function weightedPick(weights: Array<[Openness, number]>, rng: Rng): Openness {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [value, w] of weights) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return weights[weights.length - 1]![0];
}

/**
 * All boundaries of a floor, generated once.
 *
 * Every room later reads its four seams out of this map, so two neighbours
 * cannot disagree about the ground between them.
 */
export class EdgeMap {
  private specs = new Map<string, EdgeSpec>();

  /**
   * @param origin world-room coordinate of local (0,0). Seam *profiles* are
   *   seeded from the boundary's **world** key, so the same boundary generates
   *   the same coastline no matter which streaming window builds it. Lookups
   *   stay local. Without this a player walking east and back finds the shore
   *   has moved, because each window had rolled its own seams.
   */
  constructor(
    rooms: ReadonlySet<string>,
    connections: ReadonlySet<string>,
    openWorld: boolean,
    rng: Rng,
    origin: { x: number; y: number } = { x: 0, y: 0 },
    /**
     * Treat every neighbour as present, even outside the set.
     *
     * A streaming window's edge rooms have no neighbour *in the window*, so
     * without this their outer seams roll closed — and the same room comes out
     * interior when approached from one side and walled when approached from
     * the other. The world beyond a window is not absent, it is merely unbuilt.
     */
    assumeNeighbours = false,
  ) {
    for (const key of rooms) {
      const [rx, ry] = key.split(',').map(Number) as [number, number];
      for (const dir of ['e', 's'] as Dir4[]) {
        const bKey = boundaryKey(rx, ry, dir);
        if (this.specs.has(bKey)) continue;
        const nx = dir === 'e' ? rx + 1 : rx;
        const ny = dir === 's' ? ry + 1 : ry;
        const neighbourExists = assumeNeighbours || rooms.has(`${nx},${ny}`);
        const connected = neighbourExists && (assumeNeighbours || connections.has(bKey));
        const worldKey = boundaryKey(rx + origin.x, ry + origin.y, dir);
        this.specs.set(
          bKey,
          rollEdge(boundaryAxis(dir), connected, openWorld, rng.stream(`edge:${worldKey}`)),
        );
      }
    }
  }

  /** The seam on one side of a room. Closed when there is nothing beyond it. */
  get(rx: number, ry: number, dir: Dir4): EdgeSpec {
    const key = boundaryKey(rx, ry, dir);
    const spec = this.specs.get(key);
    if (spec) return spec;
    return {
      open: new Array(seamLength(boundaryAxis(dir))).fill(false),
      openness: 'closed',
      material: 0,
    };
  }

  /** True when this room can be left in this direction at all. */
  isOpen(rx: number, ry: number, dir: Dir4): boolean {
    return this.get(rx, ry, dir).open.some(Boolean);
  }
}
