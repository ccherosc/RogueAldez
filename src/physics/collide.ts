/**
 * AABB-versus-tile-grid collision.
 *
 * Movement resolves one axis at a time, which is what produces wall sliding for
 * free: blocked horizontally, you keep your vertical motion.
 *
 * The corner assist is the important part. Without it, doorways and tile corners
 * snag constantly and the game feels broken in a way players can't articulate —
 * per zelda-feel it is the single highest-value feel fix in the whole movement
 * system.
 */

import { TILE } from '../art/tiles.ts';

/** How far (px) the player may be nudged perpendicular to clear a corner. */
export const CORNER_ASSIST = 4;

/**
 * Solidity lookup by tile coordinate.
 *
 * Physics takes a query rather than a World so it stays a peer of world/ instead
 * of depending on it — and so collision can be unit-tested against a literal grid
 * with no map, atlas or room machinery involved.
 */
export type SolidQuery = (tx: number, ty: number) => boolean;

export interface Actor {
  /** feet position — x is the centre of the box, y is its bottom edge */
  x: number;
  y: number;
  halfW: number;
  boxH: number;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

/** Does the actor's box at (x, y) overlap any solid tile? */
export function overlapsSolid(isSolid: SolidQuery, a: Actor, x: number, y: number): boolean {
  const left = x - a.halfW;
  const right = x + a.halfW;
  const top = y - a.boxH;
  const bottom = y;

  // EPSILON keeps a box whose edge sits exactly on a tile boundary from claiming
  // the next tile over — otherwise a 16-wide actor in a 16-wide gap never fits.
  const EPS = 0.0001;
  const tx0 = Math.floor(left / TILE);
  const tx1 = Math.floor((right - EPS) / TILE);
  const ty0 = Math.floor(top / TILE);
  const ty1 = Math.floor((bottom - EPS) / TILE);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolid(tx, ty)) return true;
    }
  }
  return false;
}

export function moveActor(
  isSolid: SolidQuery,
  actor: Actor,
  dx: number,
  dy: number,
  cornerAssist = true,
): MoveResult {
  let { x, y } = actor;
  let hitX = false;
  let hitY = false;

  if (dx !== 0) {
    if (!overlapsSolid(isSolid, actor, x + dx, y)) {
      x += dx;
    } else {
      hitX = true;
      if (cornerAssist) {
        // Prefer the smallest nudge that clears. Moving 1px per frame rather than
        // the whole offset at once keeps the slide smooth instead of a snap.
        for (let n = 1; n <= CORNER_ASSIST && hitX; n++) {
          for (const dir of [-1, 1]) {
            if (overlapsSolid(isSolid, actor, x + dx, y + dir * n)) continue;
            y += dir;
            if (!overlapsSolid(isSolid, actor, x + dx, y)) x += dx;
            hitX = false;
            break;
          }
        }
      }
    }
  }

  if (dy !== 0) {
    if (!overlapsSolid(isSolid, actor, x, y + dy)) {
      y += dy;
    } else {
      hitY = true;
      if (cornerAssist) {
        for (let n = 1; n <= CORNER_ASSIST && hitY; n++) {
          for (const dir of [-1, 1]) {
            if (overlapsSolid(isSolid, actor, x + dir * n, y + dy)) continue;
            x += dir;
            if (!overlapsSolid(isSolid, actor, x, y + dy)) y += dy;
            hitY = false;
            break;
          }
        }
      }
    }
  }

  return { x, y, hitX, hitY };
}

