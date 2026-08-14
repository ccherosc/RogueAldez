/**
 * Sprite generators.
 *
 * Sprites are composed from posed parts rather than drawn frame by frame — that
 * is what makes animation tractable without an artist. Left-facing frames are
 * generated and mirrored to the right; generating both independently is a classic
 * tell that art was machine-made.
 *
 * Every sprite gets a 1px outline on all sides so it separates from terrain.
 */

import type { Rng } from '../core/rng.ts';
import { ART_SCALE } from '../core/const.ts';
import { PixelBuffer } from './pixels.ts';
import {
  ci,
  PAL_DUNGEON,
  PAL_KEESE,
  PAL_SLIME,
  PAL_MOBLIN,
  PAL_OCTOROK,
  PAL_PICKUP,
  PAL_PLAYER,
  PAL_PROP,
  PAL_TERRAIN,
} from './palettes.ts';
import type { Palette } from './palettes.ts';

export type Dir = 'down' | 'up' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['down', 'up', 'left', 'right'];

export interface SpriteFrame {
  key: string;
  buffer: PixelBuffer;
  palette: Palette;
  /** origin within the cell, in pixels — sprites anchor at the feet, not the centre */
  anchor: [number, number];
  /**
   * Optional detail pass, run on the *doubled* buffer after Scale2x.
   *
   * EPX can only round what is already there; it cannot invent a cheekbone. This
   * hook lets a sprite add marks that exist solely at 2x — a scar, a pupil, a
   * cloak fold — while all the pose and animation logic stays at the 1x
   * resolution the world coordinates are expressed in.
   */
  refine?: (doubled: PixelBuffer) => void;
  /**
   * Opt out of the global rim-light pass. Flat UI cells and the solid blocks
   * used for dimming and shadows are not objects in the world and must not be
   * shaded like objects.
   */
  lit?: boolean;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function line(px: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px.set(x, y, c);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * The player cell is 32x32 rather than 16x24 so a swung sword — which reaches
 * ~12px past the body per the zelda-feel bar — stays inside its own cell.
 * The 16x24 body is blitted in at BODY_OFF and every frame anchors at the feet.
 */
export const PLAYER_CELL = 32;
const BODY_OFF: [number, number] = [8, 5];
const PLAYER_ANCHOR: [number, number] = [16, 27];

interface Pose {
  /** -1 left leg forward, 0 neutral, 1 right leg forward */
  legPhase: -1 | 0 | 1;
  /** 1px vertical body bob on passing frames — most of the walk-cycle readability */
  bob: 0 | 1;
}

function drawPlayerBody(dir: Dir, pose: Pose): PixelBuffer {
  const P = PAL_PLAYER;
  const skin = (n: number) => ci(P, `skin.${n * 2}`);
  const cloak = (n: number) => ci(P, `cloak.${n * 2}`);
  const scarf = (n: number) => ci(P, `scarf.${n * 2}`);
  const hair = (n: number) => ci(P, `hair.${n * 2}`);
  const streak = ci(P, 'streak');
  const leather = ci(P, 'leather');
  const rune = ci(P, 'rune');
  const OL = ci(P, 'outline');

  const px = new PixelBuffer(16, 24);
  const b = pose.bob;

  /**
   * In profile the two legs sit side by side with no gap, so without a value
   * difference they merge into one slab. The far leg goes a step darker, which
   * separates them and reads as depth.
   */
  const legs = (profile: boolean): void => {
    const lTop = 18 + (pose.legPhase === 1 ? 1 : 0);
    const rTop = 18 + (pose.legPhase === -1 ? 1 : 0);
    const far: [number, number, number] = [5, lTop, profile ? cloak(0) : cloak(1)];
    const near: [number, number, number] = [8, rTop, cloak(1)];

    for (const [x, top, trouser] of [far, near]) {
      px.rect(x, top, 3, 20 - top, trouser);
      px.rect(x, 20, 3, 2, leather);
      px.hline(x, 21, 3, OL); // sole
    }
  };

  if (dir === 'down' || dir === 'up') {
    // Swept brown hair. The silver streak sits front-left and is the single most
    // recognisable thing about him at this size.
    px.rect(6, 2 + b, 4, 1, hair(1));
    px.rect(5, 3 + b, 6, 1, hair(1));
    px.rect(4, 4 + b, 8, 3, hair(1));
    px.hline(4, 4 + b, 8, hair(1));
    px.hline(4, 6 + b, 8, hair(0)); // fringe shadow
    px.set(5, 3 + b, streak);
    px.set(5, 4 + b, streak);
    px.set(6, 4 + b, streak);

    if (dir === 'down') {
      px.rect(5, 7 + b, 6, 4, skin(0));
      px.hline(5, 7 + b, 6, skin(1));
      px.set(6, 8 + b, OL); px.set(9, 8 + b, OL);
      px.hline(6, 10 + b, 4, hair(0)); // beard
    } else {
      px.rect(4, 7 + b, 8, 4, hair(1)); // back of the head
      px.hline(4, 7 + b, 8, hair(0));
    }

    // crimson scarf at the neck
    px.rect(4, 11 + b, 8, 2, scarf(1));
    px.hline(4, 12 + b, 8, scarf(0));

    // cloak — wider than the shoulders so the silhouette reads as a drape
    px.rect(3, 13 + b, 10, 5, cloak(1));
    px.hline(3, 13 + b, 10, cloak(2));
    px.vline(12, 13 + b, 5, cloak(0));
    px.rect(11, 12 + b, 2, 3, cloak(0)); // pauldron, his left shoulder
    px.hline(11, 12 + b, 2, cloak(2));
    px.rect(4, 17 + b, 8, 1, leather); // belt

    // hands; the Formcraft rune glows on the gloved one
    px.rect(3, 15 + b, 1, 3, cloak(1));
    px.rect(3, 17 + b, 1, 1, skin(0));
    px.set(3, 16 + b, rune);
    px.rect(13, 15 + b, 1, 2, cloak(1));
    legs(false);
  } else {
    // profile — hair sweeps back, cloak trails behind
    px.rect(5, 2 + b, 4, 1, hair(1));
    px.rect(4, 3 + b, 6, 1, hair(1));
    px.rect(4, 4 + b, 7, 3, hair(1));
    px.rect(10, 4 + b, 2, 3, hair(0)); // swept-back tail
    px.hline(4, 6 + b, 7, hair(0));
    px.set(4, 3 + b, streak);
    px.set(4, 4 + b, streak);

    px.rect(4, 7 + b, 6, 4, skin(0));
    px.hline(4, 7 + b, 6, skin(1));
    px.set(5, 8 + b, OL); // single visible eye
    px.hline(5, 10 + b, 4, hair(0)); // beard

    px.rect(4, 11 + b, 7, 2, scarf(1));
    px.hline(4, 12 + b, 7, scarf(0));

    px.rect(4, 13 + b, 8, 5, cloak(1));
    px.hline(4, 13 + b, 8, cloak(2));
    px.rect(11, 13 + b, 2, 5, cloak(0)); // cloak trailing behind
    px.rect(4, 17 + b, 7, 1, leather);

    px.rect(3, 15 + b, 1, 3, cloak(1)); // leading arm
    px.set(3, 17 + b, skin(0));
    px.set(3, 16 + b, rune);
    legs(true);
  }

  return px;
}

/**
 * A solid 2px blade from hilt to tip, plus grip and crossguard.
 *
 * Marching along the line and stamping both the centre pixel and its
 * perpendicular neighbour guarantees a continuous blade. Two independent
 * Bresenham runs one pixel apart do *not* — on diagonals they interleave and the
 * sword renders as a dotted line.
 */
function drawSword(px: PixelBuffer, hx: number, hy: number, tx: number, ty: number): void {
  const P = PAL_PLAYER;
  const dx = tx - hx;
  const dy = ty - hy;
  const len = Math.max(1, Math.round(Math.hypot(dx, dy)));
  const nx = dx / len;
  const ny = dy / len;
  const perpX = -ny;
  const perpY = nx;

  for (let i = 0; i <= len; i++) {
    const x = hx + nx * i;
    const y = hy + ny * i;
    // taper the last two pixels to a point
    const tip = i > len - 2;
    // Both blade pixels are bright. A dark shadow edge sounds right but at this
    // scale it merges with the sprite outline, leaving a 1px core that breaks
    // into dashes on any diagonal — the blade has to read as one bright stroke.
    px.set(Math.round(x), Math.round(y), ci(P, 'streak'));
    if (!tip) px.set(Math.round(x + perpX), Math.round(y + perpY), ci(P, 'streak'));
  }

  // grip runs back from the hilt; crossguard sits across it
  line(px, hx - nx * 3, hy - ny * 3, hx - nx, hy - ny, ci(P, 'leather'));
  line(px, hx - perpX * 2, hy - perpY * 2, hx + perpX * 2, hy + perpY * 2, ci(P, 'cloak.4'));
}

type Dir4Name = 'down' | 'up' | 'left' | 'right';

/**
 * Aldez, refined at 2x.
 *
 * Runs on the doubled buffer, so every coordinate here is a *texel* — half a
 * world pixel, a mark the 16px sprite had no room for. This is where the
 * portrait's identifiers finally fit: the amber eyes, the silver streak read as
 * strands rather than a block, the X-scar on his left cheek, folds in the blue
 * cloak, gold trim on the pauldron, and the cyan Formcraft rune on his glove.
 *
 * Only marks *inside the existing silhouette* — the shape is already correct and
 * the physics box is derived from it; this adds detail, never bulk.
 */
function refineAldez(d: PixelBuffer, dir: Dir4Name): void {
  const P = PAL_PLAYER;
  const skin = (n: number) => ci(P, `skin.${n * 2}`);
  const cloak0 = ci(P, 'cloak.0');
  const hair0 = ci(P, 'hair.0');
  const ink = ci(P, 'outline');
  const streak = ci(P, 'streak');
  // Amber eyes and gold trim share the warm accent; see the note in palettes.ts.
  const amber = ci(P, 'scarf.2');
  const gold = ci(P, 'scarf.2');
  const rune = ci(P, 'rune');

  // Everything below is plotted on a *half-world-pixel* grid — the finest mark
  // worth making on a character, and the unit these coordinates were authored
  // in. One grid step is ART_SCALE/2 texels, so the detail keeps its physical
  // size whatever density the art is baked at.
  const HALF = Math.max(1, ART_SCALE / 2);

  // Only paint where the sprite already is — never over transparency.
  const mark = (hx: number, hy: number, c: number): void => {
    const x0 = hx * HALF;
    const y0 = hy * HALF;
    if (d.get(x0, y0) === 0) return;
    for (let i = 0; i < HALF; i++) {
      for (let j = 0; j < HALF; j++) {
        if (d.get(x0 + i, y0 + j) !== 0) d.set(x0 + i, y0 + j, c);
      }
    }
  };

  // The body is a 16x24 buffer blitted at [8,5] of a 32x32 cell, so a body pixel
  // (bx, by) lands at texel (16 + 2*bx, 10 + 2*by). Every constant below is
  // derived from drawPlayerBody rather than eyeballed — the first attempt at
  // this put his eyes in his hair.
  // Body pixel -> half-world-pixel grid. The body is a 16x24 buffer blitted at
  // [8,5] of the 32x32 cell, so a body pixel spans two half-pixels.
  const T = (bx: number, by: number): [number, number] => [(8 + bx) * 2, (5 + by) * 2];

  if (dir === 'down') {
    // Face occupies body y7..10. Eyes are single body pixels at (6,8) and (9,8),
    // which at 2x is a 2x2 block each — enough for an iris with a lash over it.
    for (const bx of [6, 9]) {
      const [ex, ey] = T(bx, 8);
      // Amber fills the eye and the lash sits *above* it, on skin. Splitting the
      // 2x2 half-and-half read as a dark block with a warm smudge — at this size
      // a colour has to own the whole shape to be seen at all.
      mark(ex, ey, amber);     mark(ex + 1, ey, amber);
      mark(ex, ey + 1, amber); mark(ex + 1, ey + 1, ink); // pupil, lower-outer
      mark(ex, ey - 1, ink);   mark(ex + 1, ey - 1, ink); // lash
    }
    // Brow line, and hollows under the cheekbones — weathered, not young.
    const [bxs, brow] = T(5, 7);
    for (let x = bxs; x < bxs + 12; x++) mark(x, brow + 1, skin(0));
    const [chL, chY] = T(5, 9);
    mark(chL, chY, skin(0)); mark(chL + 11, chY, skin(0));
    // The X-scar on his left cheek — screen right when he faces us.
    const [sx, sy] = T(9, 9);
    mark(sx, sy, skin(0)); mark(sx + 1, sy + 1, skin(0)); mark(sx + 2, sy + 2, skin(0));
    mark(sx + 2, sy, skin(0)); mark(sx, sy + 2, skin(0));
    // Silver streak: strands rather than a slab, over the existing block.
    const [stx, sty] = T(5, 3);
    mark(stx, sty, streak); mark(stx + 1, sty - 1, streak);
    mark(stx + 2, sty, streak); mark(stx + 3, sty + 1, streak);
    mark(stx - 1, sty + 2, streak);
  } else if (dir === 'up') {
    // From behind: strand definition across the back of the head.
    const [hx, hy] = T(4, 8);
    for (let x = hx + 1; x < hx + 15; x += 3) {
      mark(x, hy, hair0); mark(x, hy + 1, hair0);
    }
    const [stx, sty] = T(5, 4);
    mark(stx, sty, streak); mark(stx + 1, sty + 1, streak);
  } else {
    // Profile (drawn facing left; 'right' is mirrored downstream).
    const [ex, ey] = T(5, 8);
    mark(ex, ey, ink); mark(ex + 1, ey, ink);
    mark(ex, ey + 1, amber); mark(ex + 1, ey + 1, amber);
    const [jx, jy] = T(5, 10);
    for (let x = jx; x < jx + 8; x += 2) mark(x, jy, skin(0)); // stubble
    const [stx, sty] = T(5, 3);
    mark(stx, sty, streak); mark(stx + 1, sty - 1, streak); mark(stx + 2, sty, streak);
  }

  // Cloak folds: creases down the drape (body y13..17), skipping rows so they
  // read as cloth catching light rather than as painted stripes.
  const [foldX, foldY] = T(3, 13);
  for (let y = foldY; y < foldY + 10; y++) {
    if (y % 3 !== 0) {
      mark(foldX + 6, y, cloak0);
      mark(foldX + 14, y, cloak0);
    }
  }

  // Gold trim along the top of his left pauldron (body 11..12, y12).
  const [px2, py2] = T(11, 12);
  for (let x = px2; x < px2 + 4; x++) mark(x, py2, gold);

  // The Formcraft rune on the gloved hand (body 3,16) — the one cyan thing on
  // him, and the only sign he is more than a swordsman.
  const [rx, ry] = T(3, 16);
  mark(rx, ry, rune); mark(rx + 1, ry, rune);
  mark(rx, ry + 1, rune); mark(rx + 1, ry + 1, rune);
}

export function playerFrames(): SpriteFrame[] {
  const out: SpriteFrame[] = [];

  const compose = (body: PixelBuffer, sword?: (c: PixelBuffer) => void): PixelBuffer => {
    const cell = new PixelBuffer(PLAYER_CELL, PLAYER_CELL);
    cell.blit(body, BODY_OFF[0], BODY_OFF[1]);
    if (sword) sword(cell);
    cell.outline(ci(PAL_PLAYER, 'outline'), 'all');
    return cell;
  };

  const emit = (key: string, buffer: PixelBuffer, dir: Dir4Name): void => {
    out.push({
      key,
      buffer,
      palette: PAL_PLAYER,
      anchor: PLAYER_ANCHOR,
      refine: (d) => refineAldez(d, dir),
    });
  };

  for (const dir of DIRS) {
    const src: Dir = dir === 'right' ? 'left' : dir;
    const mirror = dir === 'right';
    const fix = (p: PixelBuffer) => (mirror ? p.mirrored() : p);

    // idle: 2 frames, a slow breath
    emit(`player.${dir}.idle.0`, fix(compose(drawPlayerBody(src, { legPhase: 0, bob: 0 }))), dir);
    emit(`player.${dir}.idle.1`, fix(compose(drawPlayerBody(src, { legPhase: 0, bob: 1 }))), dir);

    // walk: contact, down, passing, up
    const cycle: Pose[] = [
      { legPhase: -1, bob: 0 },
      { legPhase: 0, bob: 0 },
      { legPhase: 1, bob: 0 },
      { legPhase: 0, bob: 1 },
    ];
    cycle.forEach((pose, i) => {
      emit(`player.${dir}.walk.${i}`, fix(compose(drawPlayerBody(src, pose))), dir);
    });

    // attack: 3 frames matching the 3/6/6 windup-active-recovery phases
    const arcs: Record<Dir, Array<[number, number, number, number]>> = {
      down:  [[22, 16, 26, 6], [22, 20, 26, 30], [10, 22, 4, 28]],
      up:    [[22, 14, 28, 20], [22, 12, 26, 2], [10, 12, 4, 4]],
      left:  [[12, 14, 20, 6], [12, 18, 1, 20], [12, 22, 6, 30]],
      right: [[12, 14, 20, 6], [12, 18, 1, 20], [12, 22, 6, 30]],
    };
    const poses: Pose[] = [
      { legPhase: 0, bob: 1 },
      { legPhase: -1, bob: 0 },
      { legPhase: 0, bob: 0 },
    ];
    arcs[src].forEach((seg, i) => {
      const body = drawPlayerBody(src, poses[i]!);
      emit(
        `player.${dir}.attack.${i}`,
        fix(compose(body, (c) => drawSword(c, seg[0], seg[1], seg[2], seg[3]))),
        dir,
      );
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

const ENEMY_CELL = 16;
const ENEMY_ANCHOR: [number, number] = [8, 15];

function octorokFrame(dir: Dir, frame: number): PixelBuffer {
  const P = PAL_OCTOROK;
  const body = (n: number) => ci(P, `body.${n * 2}`);
  const belly = (n: number) => ci(P, `belly.${n * 2}`);
  const px = new PixelBuffer(ENEMY_CELL, ENEMY_CELL);

  // squat dome body
  px.ellipse(3, 4, 10, 9, body(2));
  px.ellipse(4, 4, 8, 4, body(3)); // lit crown
  px.ellipse(4, 10, 8, 3, body(1)); // shaded underside
  px.ellipse(5, 9, 6, 3, belly(0));

  // four stubby legs; alternate on the two frames
  const lift = frame === 0 ? [0, 1, 0, 1] : [1, 0, 1, 0];
  [3, 6, 9, 12].forEach((lx, i) => {
    px.rect(lx, 12 - lift[i]!, 2, 2 + lift[i]!, body(1));
  });

  // snout points the way it faces
  const snout: Record<Dir, [number, number]> = {
    down: [7, 12], up: [7, 2], left: [1, 8], right: [13, 8],
  };
  const [sx, sy] = snout[dir];
  px.rect(sx, sy, 2, 2, body(0));

  // eyes — only where a face would actually be visible
  if (dir !== 'up') {
    const ex: Record<string, [number, number]> = {
      down: [5, 8], left: [4, 7], right: [9, 7],
    };
    const [x0, y0] = ex[dir === 'right' ? 'right' : dir === 'left' ? 'left' : 'down']!;
    px.set(x0, y0, ci(P, 'eye.0'));
    px.set(x0, y0 + 1, ci(P, 'eye.1'));
    if (dir === 'down') {
      px.set(x0 + 5, y0, ci(P, 'eye.0'));
      px.set(x0 + 5, y0 + 1, ci(P, 'eye.1'));
    }
  }

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function moblinFrame(dir: Dir, frame: number): PixelBuffer {
  const P = PAL_MOBLIN;
  const body = (n: number) => ci(P, `body.${n * 2}`);
  const gear = (n: number) => ci(P, `gear.${n * 2}`);
  const px = new PixelBuffer(ENEMY_CELL, ENEMY_CELL);
  const b = frame === 0 ? 0 : 1;

  // snout-forward head
  px.rect(4, 1 + b, 7, 5, body(2));
  px.hline(4, 1 + b, 7, body(3));
  if (dir === 'down') { px.rect(5, 6 + b, 2, 1, body(0)); px.rect(8, 6 + b, 2, 1, body(0)); }
  if (dir !== 'up') {
    px.set(5, 3 + b, ci(P, 'eye.0'));
    px.set(9, 3 + b, ci(P, 'eye.0'));
  }
  // ears
  px.rect(3, 2 + b, 1, 2, body(1));
  px.rect(11, 2 + b, 1, 2, body(1));

  // torso + belt
  px.rect(4, 7 + b, 7, 5, body(2));
  px.hline(4, 7 + b, 7, body(3));
  px.rect(4, 10 + b, 7, 1, gear(0));

  // legs alternate
  px.rect(4, 12, 3, 4 - (frame === 0 ? 0 : 1), body(1));
  px.rect(8, 12, 3, 4 - (frame === 0 ? 1 : 0), body(1));

  // spear, angled per facing
  const spear: Record<Dir, [number, number, number, number]> = {
    down: [12, 4, 12, 15], up: [12, 12, 12, 1],
    left: [12, 6, 1, 6], right: [12, 6, 1, 6],
  };
  const s = spear[dir];
  line(px, s[0], s[1], s[2], s[3], gear(1));
  line(px, s[2], s[3], s[2], s[3], ci(P, 'metal.2'));

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * A slime, mid-hop or settled.
 *
 * Two frames that squash and stretch rather than walk: frame 0 is the puddle it
 * rests as, frame 1 the rounder shape at the top of a hop. Reading the animation
 * *is* reading the attack, since the hop is the whole of its behaviour — a
 * player who watches one for three seconds knows everything it can do, which is
 * exactly what the first enemy in a game should offer.
 */
function slimeFrame(frame: number): PixelBuffer {
  const P = PAL_SLIME;
  const body = (n: number) => ci(P, `body.${n * 2}`);
  const px = new PixelBuffer(ENEMY_CELL, ENEMY_CELL);

  // Squat and wide at rest, taller and narrower at the top of the hop.
  const w = frame === 0 ? 6 : 5;
  const h = frame === 0 ? 4 : 6;
  const cy = frame === 0 ? 11 : 9;

  px.ellipse(8, cy, w, h, body(1));          // mass
  px.ellipse(8, cy, w - 1, h - 1, body(2));  // interior
  px.ellipse(7, cy - 1, w - 3, h - 3, body(3)); // lit crown, offset up-left

  // A dark seat where it meets the ground, so it sits on the floor rather than
  // hovering — the same contact logic as the shadow, drawn into the sprite.
  px.ellipse(8, cy + h - 1, w - 1, 1, body(0));

  // A bright highlight bead: the one thing that says "wet" at this size.
  // body() tops out at 3 — a 7-step ramp exposes n*2 for n = 0..3.
  px.set(6, cy - h + 2, body(3));
  px.set(7, cy - h + 2, body(3));

  px.set(6, cy, ci(P, 'eye.0'));
  px.set(10, cy, ci(P, 'eye.0'));

  return px;
}

function keeseFrame(frame: number): PixelBuffer {
  const P = PAL_KEESE;
  const body = (n: number) => ci(P, `body.${n * 2}`);
  const px = new PixelBuffer(ENEMY_CELL, ENEMY_CELL);

  // Body sits high in the cell so the wings have room; a small dark bat needs
  // more silhouette than a 4px blob to read at 1x.
  px.ellipse(5, 5, 6, 7, body(2));
  px.ellipse(5, 5, 6, 3, body(3));
  px.rect(6, 3, 1, 2, body(1)); // ears
  px.rect(9, 3, 1, 2, body(1));
  px.set(6, 8, ci(P, 'eye.0'));
  px.set(9, 8, ci(P, 'eye.0'));
  px.set(6, 9, ci(P, 'eye.1'));
  px.set(9, 9, ci(P, 'eye.1'));

  if (frame === 0) {
    // wings down and spread — membrane filled, leading edge darker
    for (const [dx, dir] of [[4, -1], [11, 1]] as const) {
      for (let i = 1; i <= 4; i++) {
        const wx = dx + dir * i;
        px.vline(wx, 6 + Math.floor(i / 2), 3, body(1));
      }
      line(px, dx + dir * 4, 8, dx + dir * 4, 11, body(0));
    }
  } else {
    // wings up
    for (const [dx, dir] of [[4, -1], [11, 1]] as const) {
      for (let i = 1; i <= 4; i++) {
        const wx = dx + dir * i;
        px.vline(wx, 5 - Math.floor(i / 2), 3, body(1));
      }
      line(px, dx + dir * 4, 3, dx + dir * 4, 6, body(0));
    }
  }

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * The Hulk — a 32x32 brute, four tiles of Errata.
 *
 * Big enemies earn their menace from *mass*, so the shapes are heavy: a torso
 * that fills most of the cell, arms like sides of beef, a head that looks like
 * an afterthought. Two frames of weight-shift; a creature this size does not
 * scurry.
 */
function hulkSprite(frame: number): PixelBuffer {
  const P = PAL_MOBLIN;
  const body = (n: number) => ci(P, `body.${n * 2}`);
  const gear = (n: number) => ci(P, `gear.${n * 2}`);
  const px = new PixelBuffer(32, 32);
  const sway = frame === 0 ? 0 : 1;

  // Legs — short pillars under all that weight.
  px.rect(8, 25, 6, 6, body(1));
  px.rect(18, 25, 6, 6, body(1));
  px.rect(7, 29, 8, 2, gear(0));
  px.rect(17, 29, 8, 2, gear(0));

  // Torso: most of the sprite.
  px.ellipse(4, 8 + sway, 24, 18, body(2));
  px.ellipse(6, 9 + sway, 16, 8, body(3)); // lit shoulders
  px.ellipse(9, 18 + sway, 14, 7, body(1)); // gut shadow
  px.rect(6, 20 + sway, 20, 2, gear(0)); // belt

  // Arms — slabs, knuckles at the ground.
  px.rect(1, 10 + sway, 6, 14, body(2));
  px.rect(25, 10 + (1 - sway), 6, 14, body(2));
  px.ellipse(0, 21 + sway, 8, 7, body(1));
  px.ellipse(24, 21 + (1 - sway), 8, 7, body(1));

  // Head, small and low between the shoulders. Tusks read at any size.
  px.ellipse(11, 3 + sway, 10, 8, body(2));
  px.hline(12, 3 + sway, 8, body(3));
  px.set(13, 7 + sway, ci(P, 'eye.0'));
  px.set(18, 7 + sway, ci(P, 'eye.0'));
  px.rect(12, 9 + sway, 1, 2, ci(P, 'metal.2'));
  px.rect(19, 9 + sway, 1, 2, ci(P, 'metal.2'));

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * The Colossus — 48x48, nine tiles of walking masonry.
 *
 * An Errata of buildings: what a keep remembers about itself after being erased.
 * It guards the last floor of an Act. The single burning eye is the only warm
 * colour on it, which is what the player's gaze goes to.
 */
function colossusSprite(frame: number): PixelBuffer {
  const P = PAL_DUNGEON;
  const w = (n: number) => ci(P, `wall.${n * 2}`);
  const f = (n: number) => ci(P, `floor.${n * 2}`);
  const t = (n: number) => ci(P, `torch.${n * 2}`);
  const mortar = ci(P, 'mortar');
  const px = new PixelBuffer(48, 48);
  const sway = frame === 0 ? 0 : 1;

  // Legs: squat towers.
  px.rect(10, 36, 10, 11, w(1));
  px.rect(28, 36, 10, 11, w(1));
  px.hline(10, 36, 10, w(2));
  px.hline(28, 36, 10, w(2));
  px.rect(8, 45, 14, 2, w(0));
  px.rect(26, 45, 14, 2, w(0));

  // Torso: coursed masonry, drawn as brick rows so it reads as *built*.
  for (let row = 0; row < 5; row++) {
    const y = 12 + sway + row * 5;
    const offset = row % 2 === 0 ? 0 : 4;
    for (let bx = 6 + offset; bx < 40; bx += 8) {
      px.rect(bx, y, 7, 4, row < 2 ? w(2) : w(1));
      px.hline(bx, y, 7, w(3));
    }
    px.hline(6, y + 4, 36, mortar);
  }

  // Shoulders and arms: broken columns.
  px.rect(1, 12 + sway, 7, 20, w(2));
  px.rect(40, 12 + (1 - sway), 7, 20, w(2));
  px.hline(1, 12 + sway, 7, w(3));
  px.hline(40, 12 + (1 - sway), 7, w(3));
  px.ellipse(0, 30 + sway, 9, 8, w(1)); // fists
  px.ellipse(39, 30 + (1 - sway), 9, 8, w(1));

  // Head: a keep's turret, with one burning window.
  px.rect(17, 2 + sway, 14, 12, w(1));
  px.hline(17, 2 + sway, 14, w(3));
  for (let i = 0; i < 3; i++) px.rect(17 + i * 5, 0 + sway, 3, 3, w(2)); // crenellations
  px.rect(21, 6 + sway, 6, 5, f(0)); // the window
  px.rect(22, 7 + sway, 4, 3, t(0));
  px.set(23 + (frame === 0 ? 0 : 1), 8 + sway, t(1)); // the eye, flickering

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * The Warden — the first boss, 32x32.
 *
 * An Erratum of a locked door: what a gate remembers about itself after the
 * building around it stopped existing. Reads as *barrier* first and creature
 * second, which is the right first impression for a thing standing between the
 * player and the stairs.
 *
 * The one bright thing on it is the keyhole, and that is where the player must
 * hit it — a boss whose weak point you can see is a boss a first-timer can beat.
 */
function wardenSprite(frame: number, open: boolean): PixelBuffer {
  const P = PAL_DUNGEON;
  const w = (n: number) => ci(P, `wall.${n}`);
  const f = (n: number) => ci(P, `floor.${n}`);
  const t = (n: number) => ci(P, `torch.${n}`);
  const px = new PixelBuffer(32, 32);
  const sway = frame === 0 ? 0 : 1;

  // Squat legs — it walks, but it was never meant to.
  px.rect(7, 26, 6, 5, w(2));
  px.rect(19, 26, 6, 5, w(2));
  px.rect(6, 30, 8, 2, w(0));
  px.rect(18, 30, 8, 2, w(0));

  // The door itself: a slab with banded iron across it.
  px.rect(4, 4 + sway, 24, 23, w(3));
  px.hline(4, 4 + sway, 24, w(5));
  px.vline(4, 4 + sway, 23, w(5));
  px.vline(27, 4 + sway, 23, w(1));
  px.hline(4, 26 + sway, 24, w(0));
  for (const by of [9, 17]) {
    px.rect(4, by + sway, 24, 3, w(1));
    px.hline(4, by + sway, 24, w(4));
    px.hline(4, by + 2 + sway, 24, w(0));
  }

  // Keyhole. Lit when the Warden is recovering and open to a hit.
  const glow = open ? t(2) : f(1);
  px.rect(14, 12 + sway, 4, 4, glow);
  px.rect(15, 15 + sway, 2, 4, glow);
  if (open) {
    px.set(15, 13 + sway, t(1));
    px.set(16, 13 + sway, t(1));
  }

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Townsfolk, 16x24 like the player.
 *
 * Five silhouettes rather than ten portraits: a player must be able to tell a
 * guard from a beggar across a market square, and at this size that is a job for
 * *shape* — a helmet, a hood, an apron, a tall hat — not for faces. The name is
 * on screen when you talk to them; the silhouette only has to say what they are
 * doing today, which is exactly the thing that changes between Drafts.
 */
function folkSprite(kind: 'guard' | 'trader' | 'worker' | 'gentry' | 'poor', frame: number): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 24);
  const w = (n: number) => ci(P, `wood.${n * 2}`);
  const s = (n: number) => ci(P, `stone.${n * 2}`);
  const pot = (n: number) => ci(P, `pot.${n * 2}`);
  const sway = frame === 0 ? 0 : 1;

  // Everyone shares legs and a body block; the head and shoulders carry the role.
  px.rect(5, 18 + sway, 2, 5, w(0));
  px.rect(9, 18 + sway, 2, 5, w(0));
  px.rect(4, 20, 3, 2, ci(P, 'outline'));
  px.rect(9, 20, 3, 2, ci(P, 'outline'));

  const body = kind === 'guard' ? s(2) : kind === 'gentry' ? pot(2) : w(1);
  px.rect(4, 10 + sway, 8, 9, body);
  px.hline(4, 10 + sway, 8, kind === 'gentry' ? pot(2) : w(2));

  // Head.
  px.ellipse(5, 4 + sway, 6, 6, ci(PAL_PROP, 'pot.4'));

  switch (kind) {
    case 'guard':
      // Helmet with a nasal bar, and a spear held upright.
      px.rect(4, 3 + sway, 8, 4, s(2));
      px.hline(4, 3 + sway, 8, s(2));
      px.vline(8, 5 + sway, 3, s(1));
      px.vline(13, 2 + sway, 16, w(1));
      px.rect(12, 1 + sway, 3, 2, s(2));
      break;
    case 'trader':
      // Wide hat and a satchel.
      px.rect(2, 4 + sway, 12, 2, w(0));
      px.rect(5, 2 + sway, 6, 2, w(1));
      px.rect(11, 13 + sway, 4, 4, w(0));
      break;
    case 'worker':
      // Headscarf and an apron.
      px.rect(4, 3 + sway, 8, 3, pot(1));
      px.rect(5, 13 + sway, 6, 6, pot(0));
      break;
    case 'gentry':
      // Tall collar and a circlet: reads as money from across the square.
      px.rect(4, 2 + sway, 8, 3, pot(2));
      px.hline(4, 2 + sway, 8, ci(P, 'flame.4'));
      px.rect(3, 10 + sway, 10, 2, pot(2));
      break;
    case 'poor':
      // Hood pulled forward, hunched.
      px.ellipse(3, 2 + sway, 10, 8, w(0));
      px.rect(5, 7 + sway, 6, 3, ci(PAL_PROP, 'pot.2'));
      break;
  }

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

export function enemyFrames(): SpriteFrame[] {
  const out: SpriteFrame[] = [];
  for (const dir of DIRS) {
    for (let f = 0; f < 2; f++) {
      const src: Dir = dir === 'right' ? 'left' : dir;
      const mir = (p: PixelBuffer) => (dir === 'right' ? p.mirrored() : p);
      out.push({
        key: `octorok.${dir}.walk.${f}`,
        buffer: mir(octorokFrame(src, f)),
        palette: PAL_OCTOROK,
        anchor: ENEMY_ANCHOR,
      });
      out.push({
        key: `moblin.${dir}.walk.${f}`,
        buffer: mir(moblinFrame(src, f)),
        palette: PAL_MOBLIN,
        anchor: ENEMY_ANCHOR,
      });
    }
  }
  for (let f = 0; f < 2; f++) {
    out.push({
      key: `slime.hop.${f}`,
      buffer: slimeFrame(f),
      palette: PAL_SLIME,
      anchor: ENEMY_ANCHOR,
    });
    out.push({
      key: `keese.fly.${f}`,
      buffer: keeseFrame(f),
      palette: PAL_KEESE,
      anchor: ENEMY_ANCHOR,
    });
    out.push({
      key: `warden.walk.${f}`,
      buffer: wardenSprite(f, false),
      palette: PAL_DUNGEON,
      anchor: [16, 31],
    });
    out.push({
      key: `warden.open.${f}`,
      buffer: wardenSprite(f, true),
      palette: PAL_DUNGEON,
      anchor: [16, 31],
    });
    out.push({
      key: `hulk.walk.${f}`,
      buffer: hulkSprite(f),
      palette: PAL_MOBLIN,
      anchor: [16, 31],
    });
    out.push({
      key: `colossus.walk.${f}`,
      buffer: colossusSprite(f),
      palette: PAL_DUNGEON,
      anchor: [24, 47],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pickups and props
// ---------------------------------------------------------------------------

function heartSprite(): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(16, 16);
  const h = (n: number) => ci(P, `heart.${n * 2}`);
  // two lobes over a taper — drawn explicitly; an ellipse pair reads as a blob
  const rows = [
    '..XXX..XXX..',
    '.XXXXXXXXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '.XXXXXXXXXX.',
    '..XXXXXXXX..',
    '...XXXXXX...',
    '....XXXX....',
    '.....XX.....',
  ];
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === 'X') px.set(x + 2, y + 3, h(1));
    });
  });
  px.ellipse(4, 4, 3, 2, h(2)); // specular highlight, upper-left
  px.ellipse(4, 9, 8, 4, h(0));
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === 'X' && px.get(x + 2, y + 3) === 0) px.set(x + 2, y + 3, h(1));
    });
  });
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** An amber shard - the currency of a world that keeps forgetting its coins. */
function shardSprite(): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(16, 16);
  const r = (n: number) => ci(P, `rupee.${n * 2}`);
  // Hexagonal gem. Three distinct vertical facets — lit left, mid, shadowed right —
  // rather than a two-tone split, which just read as a flat oval.
  for (let y = 0; y < 14; y++) {
    const t = y < 4 ? (y + 1) / 4 : y < 10 ? 1 : (14 - y) / 4;
    const half = Math.max(1, Math.round(t * 4));
    for (let x = 8 - half; x <= 7 + half; x++) {
      const across = (x - (8 - half)) / Math.max(1, half * 2 - 1);
      px.set(x, y + 1, across < 0.34 ? r(2) : across < 0.68 ? r(1) : r(0));
    }
  }
  // central ridge catches the light down the middle of the stone
  px.vline(7, 4, 8, r(2));
  px.set(6, 4, r(2));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function potSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const p = (n: number) => ci(P, `pot.${n * 2}`);
  px.ellipse(3, 4, 10, 11, p(1));
  px.rect(4, 2, 8, 3, p(1));
  px.hline(4, 2, 8, p(2)); // rim highlight
  px.ellipse(4, 5, 4, 5, p(2)); // upper-left specular
  px.ellipse(8, 9, 5, 5, p(0)); // lower-right shadow
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function bushSprite(): PixelBuffer {
  // Foliage, so it draws from the terrain greens rather than PAL_PROP's browns —
  // and relating it to the grass ramp is what makes it sit on the ground plane.
  const P = PAL_TERRAIN;
  const px = new PixelBuffer(16, 16);
  const g = (n: number) => ci(P, `grass.${n * 2}`);
  // clustered lobes read as foliage where a single ellipse reads as a rock
  px.ellipse(2, 5, 7, 7, g(1));
  px.ellipse(7, 4, 8, 8, g(1));
  px.ellipse(4, 8, 9, 6, g(1));
  px.ellipse(3, 5, 4, 3, g(3));
  px.ellipse(9, 5, 4, 3, g(3));
  px.ellipse(5, 3, 3, 2, g(4));
  px.ellipse(4, 11, 8, 3, g(0));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function chestSprite(open: boolean): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const w = (n: number) => ci(P, `wood.${n * 2}`);
  const g = (n: number) => ci(PAL_PROP, `stone.${n * 2}`);
  px.rect(2, open ? 7 : 6, 12, open ? 8 : 9, w(1));
  px.hline(2, open ? 7 : 6, 12, w(2));
  px.rect(2, open ? 3 : 6, 12, 3, w(2)); // lid, hinged back when open
  px.hline(2, open ? 3 : 6, 12, w(2));
  px.rect(6, open ? 4 : 8, 4, 3, g(2)); // clasp
  px.set(7, open ? 5 : 9, g(0));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Training dummy — a straw target on a post.
 *
 * Exists so the damage flash and hitstun have something that *survives* being
 * hit. Every other prop dies in one strike, which makes the white flash
 * unobservable and the knockback meaningless.
 */
function dummySprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const w = (n: number) => ci(P, `wood.${n * 2}`);

  px.rect(7, 11, 2, 5, w(0)); // post
  px.vline(7, 11, 5, w(1));

  // Concentric rings. A straw torso with straps read as a tree stump; alternating
  // light/dark rings say "hit this" with no ambiguity at 16px.
  px.ellipse(3, 2, 10, 10, w(1));
  px.ellipse(5, 4, 6, 6, w(0));
  px.ellipse(7, 6, 2, 2, w(2));

  // Rim highlight: a few pixels on the upper-left arc. An ellipse here covered a
  // quarter of the face and read as a metal cap rather than as light.
  for (const [hx, hy] of [[5, 3], [6, 3], [4, 4], [7, 3], [3, 5]] as const) {
    px.set(hx, hy, w(2));
  }

  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Gate bars. Drop across a combat room's exits until it is cleared.
 *
 * Read as *temporary* rather than as architecture: iron over a visible gap, so
 * the player can see the way out is still there and understand that killing
 * things is what opens it.
 */
function barsSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const s = (n: number) => ci(P, `stone.${n * 2}`);

  for (const x of [2, 7, 12]) {
    px.rect(x, 0, 3, 16, s(1));
    px.vline(x, 0, 16, s(2)); // lit left edge
    px.vline(x + 2, 0, 16, s(0));
  }
  for (const y of [3, 11]) {
    px.rect(0, y, 16, 2, s(1));
    px.hline(0, y, 16, s(2));
    px.hline(0, y + 1, 16, s(0));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Biome props.
 *
 * Each exists to make one biome legible at a glance: reeds say wetland, scree
 * says mountain, a stalagmite says underground, and a tombstone says consecrated
 * ground — the tag the whole placement system was built to gate.
 */
function tombstoneSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const s = (n: number) => ci(P, `stone.${n * 2}`);

  px.rect(4, 4, 8, 11, s(1));
  px.ellipse(4, 1, 8, 7, s(1)); // rounded top
  px.vline(4, 4, 11, s(2)); // lit left edge
  px.vline(11, 4, 11, s(0));
  px.hline(4, 14, 8, s(0));
  // An inscription, illegible on purpose — a name nobody remembers.
  px.hline(6, 7, 4, s(0));
  px.hline(6, 9, 3, s(0));
  px.hline(6, 11, 4, s(0));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function rockSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const s = (n: number) => ci(P, `stone.${n * 2}`);
  px.ellipse(2, 6, 12, 9, s(1));
  px.ellipse(3, 6, 6, 4, s(2)); // lit upper-left facet
  px.ellipse(8, 10, 6, 4, s(0));
  px.hline(5, 9, 5, s(0)); // a crack across the face
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function reedsSprite(): PixelBuffer {
  const P = PAL_TERRAIN;
  const px = new PixelBuffer(16, 16);
  const g = (n: number) => ci(P, `grass.${n * 2}`);
  // Vertical stalks of varying height read as reeds; a blob reads as a bush.
  for (const [x, top, shade] of [
    [3, 6, 1], [5, 3, 2], [7, 5, 3], [9, 2, 2], [11, 6, 1], [12, 4, 3],
  ] as const) {
    px.vline(x, top, 15 - top, g(shade));
    px.set(x, top, g(4));
  }
  px.hline(2, 15, 12, g(0));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function stalagmiteSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const s = (n: number) => ci(P, `stone.${n * 2}`);
  for (let y = 0; y < 14; y++) {
    const half = Math.round(1 + (y / 13) * 4);
    for (let x = 8 - half; x <= 7 + half; x++) px.set(x, y + 2, x < 8 ? s(2) : s(1));
  }
  px.vline(8, 2, 14, s(0));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function crateSprite(): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const w = (n: number) => ci(P, `wood.${n * 2}`);
  px.rect(2, 4, 12, 11, w(1));
  px.hline(2, 4, 12, w(2));
  px.vline(2, 4, 11, w(2));
  px.hline(2, 14, 12, w(0));
  px.vline(13, 4, 11, w(0));
  // Diagonal bracing, the universal shorthand for "crate".
  for (let i = 0; i < 10; i++) {
    px.set(3 + i, 5 + i, w(2));
    px.set(12 - i, 5 + i, w(0));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Test teleporter pad. TEMPORARY — see the biome-hopping scaffold in game/scene.
 *
 * Deliberately reads as machinery rather than as scenery: concentric rings and a
 * bright core, so it is obvious it is not part of the world's vocabulary and
 * should be pulled out later.
 */
function teleporterSprite(frame: number): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(16, 16);
  const g = (n: number) => ci(P, `gold.${n * 2}`);
  const b = (n: number) => ci(P, `bomb.${n * 2}`);

  px.ellipse(1, 4, 14, 11, b(0));
  px.ellipse(2, 5, 12, 9, b(1));
  px.ellipse(3, 6, 10, 7, g(0));
  px.ellipse(4, 7, 8, 5, g(1));
  // The core pulses between two frames so it reads as powered.
  px.ellipse(6 - frame, 8 - (frame >> 1), 4 + frame * 2, 3 + frame, g(2));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * A single standing tree, 16x24.
 *
 * Distinct from the `tree.base` barrier tile: this is an *object* in a field, not
 * a wall of canopy. It is deliberately too solid for a sword — only a blast (or,
 * later, an axe) brings it down, which is the first "wrong tool" the game
 * teaches.
 */
function treeSprite(): PixelBuffer {
  const P = PAL_TERRAIN;
  const px = new PixelBuffer(16, 24);
  const g = (n: number) => ci(P, `grass.${n * 2}`);
  const d = (n: number) => ci(P, `dirt.${n * 2}`);

  // Trunk with root flare.
  px.rect(6, 15, 4, 8, d(1));
  px.vline(6, 15, 8, d(2));
  px.vline(9, 15, 8, d(0));
  px.rect(5, 21, 6, 2, d(0));

  // Canopy: three stacked lobes, lit upper-left.
  px.ellipse(2, 5, 12, 10, g(1));
  px.ellipse(1, 8, 8, 8, g(1));
  px.ellipse(7, 7, 8, 9, g(1));
  px.ellipse(4, 1, 9, 8, g(2));
  px.ellipse(3, 3, 5, 4, g(3));
  px.ellipse(5, 2, 4, 3, g(4));
  px.ellipse(6, 11, 8, 4, g(0)); // underside shadow
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** A clutch of blossoms. Set dressing that can still be cut down. */
function flowerSprite(): PixelBuffer {
  const P = PAL_TERRAIN;
  const px = new PixelBuffer(16, 16);
  const g = (n: number) => ci(P, `grass.${n * 2}`);
  const bloom = ci(P, 'bloom');

  for (const [x, y] of [[4, 9], [8, 7], [11, 10]] as const) {
    px.vline(x, y + 2, 13 - y, g(1)); // stem
    px.set(x - 1, y + 3, g(2)); // leaf
    // Four-petal head around a bright centre.
    px.set(x, y - 1, bloom);
    px.set(x - 1, y, bloom);
    px.set(x + 1, y, bloom);
    px.set(x, y + 1, bloom);
    px.set(x, y, g(4));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * Fauna. Not Errata, not enemies — just living things that flee.
 *
 * They exist for exactly one reason: a field with something small moving in it
 * reads as a place, and a field without reads as a level.
 */
function sparrowSprite(frame: number): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const w = (n: number) => ci(P, `wood.${n * 2}`);

  px.ellipse(5, 8, 6, 5, w(1)); // body
  px.ellipse(9, 6, 4, 4, w(2)); // head
  px.set(12, 7, ci(P, 'outline')); // eye
  px.set(13, 8, ci(P, 'flame.2')); // beak
  if (frame === 0) {
    px.ellipse(4, 9, 5, 3, w(0)); // folded wing
    px.rect(3, 11, 2, 1, w(0)); // tail
  } else {
    px.ellipse(3, 4, 6, 4, w(0)); // wing raised — the hop/flight frame
    px.rect(2, 10, 3, 1, w(0));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function frogSprite(frame: number): PixelBuffer {
  const P = PAL_TERRAIN;
  const px = new PixelBuffer(16, 16);
  const g = (n: number) => ci(P, `grass.${n * 2}`);

  if (frame === 0) {
    px.ellipse(4, 8, 8, 6, g(2)); // squat
    px.ellipse(5, 9, 4, 3, g(3));
    px.set(5, 7, ci(P, 'outline'));
    px.set(9, 7, ci(P, 'outline'));
    px.rect(3, 12, 3, 2, g(1)); // haunches
    px.rect(10, 12, 3, 2, g(1));
  } else {
    px.ellipse(4, 5, 8, 7, g(2)); // mid-hop, stretched
    px.ellipse(5, 6, 4, 3, g(3));
    px.set(5, 5, ci(P, 'outline'));
    px.set(9, 5, ci(P, 'outline'));
    px.rect(2, 11, 3, 2, g(1)); // legs extended
    px.rect(11, 11, 3, 2, g(1));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

function torchSprite(frame: number): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const f = (n: number) => ci(P, `flame.${n * 2}`);
  const s = (n: number) => ci(P, `stone.${n * 2}`);
  px.rect(6, 8, 4, 8, s(1));
  px.hline(6, 8, 4, s(2));
  px.vline(9, 8, 8, s(0));
  const flicker = frame === 0 ? 0 : 1;
  px.ellipse(5, 1 + flicker, 6, 8, f(0));
  px.ellipse(6, 3 + flicker, 4, 5, f(1));
  px.ellipse(7, 4 + flicker, 2, 3, f(2));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** Drop shadow, kept as its own sprite so it never bakes into a body. */
function shadowSprite(): PixelBuffer {
  const px = new PixelBuffer(16, 16);
  px.ellipse(3, 11, 10, 4, ci(PAL_PROP, 'outline'));
  return px;
}

/**
 * Larger contact shadows. One 16px blob under a 48px Colossus looked like it
 * was balancing on a coin — grounding is proportional or it is comedy.
 */
function shadowSpriteMid(): PixelBuffer {
  const px = new PixelBuffer(24, 12);
  px.ellipse(2, 5, 20, 6, ci(PAL_PROP, 'outline'));
  return px;
}

function shadowSpriteBig(): PixelBuffer {
  const px = new PixelBuffer(48, 16);
  px.ellipse(3, 6, 42, 9, ci(PAL_PROP, 'outline'));
  return px;
}

/**
 * The shade a wall throws on the ground south of it. Drawn as an overlay strip
 * on the tile below any tree line, cliff or wall: two solid rows, then two
 * dithered, so the light falls off instead of ending.
 */
function wallShadeSprite(): PixelBuffer {
  const px = new PixelBuffer(16, 16);
  const ink = ci(PAL_PROP, 'outline');
  px.rect(0, 0, 16, 2, ink);
  for (let x = 0; x < 16; x++) {
    if (x % 2 === 0) px.set(x, 2, ink);
    if (x % 2 === 1) px.set(x, 3, ink);
  }
  return px;
}

/**
 * Debris and hit sparks.
 *
 * Deliberately tiny and anchored at their centre: particles are read as motion,
 * not as shapes, and anything bigger than ~3px reads as an object being thrown
 * rather than a thing coming apart.
 */
function particleSprite(size: number, colour: number, outline?: number): PixelBuffer {
  const px = new PixelBuffer(8, 8);
  const o = Math.floor((8 - size) / 2);
  px.rect(o, o, size, size, colour);
  if (outline !== undefined && size > 2) {
    px.hline(o, o + size - 1, size, outline);
    px.vline(o + size - 1, o, size, outline);
  }
  return px;
}

/**
 * Aldez's shield, drawn as a separate cell rather than baked into every frame.
 *
 * Overlaying it means one 8x8 sprite covers all four facings (mirrored for
 * left/right) instead of regenerating 4 directions x 9 poses, and it can appear
 * and vanish with the braced state without touching the body animation at all.
 */
function shieldSprite(): PixelBuffer {
  const P = PAL_PLAYER;
  const px = new PixelBuffer(8, 8);
  px.ellipse(1, 0, 6, 8, ci(P, 'cloak.2'));
  px.ellipse(2, 1, 4, 5, ci(P, 'cloak.4'));
  px.set(3, 3, ci(P, 'streak'));
  px.set(4, 3, ci(P, 'streak'));
  px.set(3, 4, ci(P, 'cloak.0'));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** A lit bomb. The fuse spark is the whole tell — it says "this has a timer". */
function bombSprite(lit: boolean): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(16, 16);
  const b = (n: number) => ci(P, `bomb.${n * 2}`);

  px.ellipse(3, 5, 10, 10, b(1));
  px.ellipse(4, 6, 5, 4, b(2)); // upper-left specular
  px.ellipse(7, 10, 5, 4, b(0));
  px.rect(9, 3, 1, 3, b(0)); // fuse
  px.set(10, 2, b(1));
  if (lit) {
    px.set(11, 1, ci(P, 'gold.4'));
    px.set(10, 1, ci(P, 'gold.2'));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * The boomerang, mid-spin.
 *
 * Two frames of an L rotated 90 degrees apart. At 16px a smooth spin is
 * impossible and unnecessary — the eye reads the flicker as rotation.
 */
function boomerangSprite(frame: number): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(16, 16);
  const w = (n: number) => ci(P, `wood.${n * 2}`);

  if (frame === 0) {
    px.rect(4, 5, 7, 2, w(1));
    px.rect(4, 5, 2, 7, w(1));
    px.hline(4, 5, 7, w(2));
    px.vline(4, 5, 7, w(2));
  } else {
    px.rect(5, 9, 7, 2, w(1));
    px.rect(10, 4, 2, 7, w(1));
    px.hline(5, 10, 7, w(0));
    px.vline(11, 4, 7, w(0));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** Expanding blast. Three frames: flash, bloom, smoke. */
function blastSprite(frame: number): PixelBuffer {
  const P = PAL_PROP;
  const px = new PixelBuffer(32, 32);
  const f = (n: number) => ci(P, `flame.${n * 2}`);
  const s = (n: number) => ci(P, `stone.${n * 2}`);

  if (frame === 0) {
    px.ellipse(11, 11, 10, 10, f(2));
    px.ellipse(13, 13, 6, 6, f(1));
  } else if (frame === 1) {
    px.ellipse(4, 4, 24, 24, f(1));
    px.ellipse(8, 8, 16, 16, f(2));
    px.ellipse(13, 13, 6, 6, f(0));
  } else {
    px.ellipse(2, 2, 28, 28, s(1));
    px.ellipse(7, 7, 18, 18, s(0));
    px.ellipse(12, 12, 8, 8, f(0));
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** Octorok spit. Small and dark so it reads against bright terrain. */
function pelletSprite(): PixelBuffer {
  const P = PAL_OCTOROK;
  const px = new PixelBuffer(8, 8);
  px.ellipse(1, 1, 6, 6, ci(P, 'body.2'));
  px.ellipse(2, 2, 3, 3, ci(P, 'body.6'));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * HUD hearts, 8x8 like the SNES original.
 *
 * Drawn as an explicit bitmap rather than from ellipses: at 8px a heart is a
 * specific arrangement of pixels, and anything procedural reads as a blob.
 */
function hudHeart(fill: 'full' | 'half' | 'empty'): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(8, 8);
  const rows = [
    '.XX.XX.',
    'XXXXXXX',
    'XXXXXXX',
    'XXXXXXX',
    '.XXXXX.',
    '..XXX..',
    '...X...',
  ];
  const lit = ci(P, 'heart.2');
  const shade = ci(P, 'heart.0');
  const empty = ci(P, 'bomb.2');

  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c !== 'X') return;
      const filled = fill === 'full' || (fill === 'half' && x < 3);
      px.set(x, y, filled ? lit : empty);
    });
  });
  if (fill !== 'empty') {
    px.set(1, 1, ci(P, 'heart.4'));
    px.set(2, 1, ci(P, 'heart.4'));
    px.set(5, 5, shade);
  }
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/** Star amber — crystallised possibility, the currency that survives a Draft. */
function amberSprite(): PixelBuffer {
  const P = PAL_PICKUP;
  const px = new PixelBuffer(8, 8);
  const g = (n: number) => ci(P, `gold.${n * 2}`);
  for (let y = 0; y < 7; y++) {
    const half = y < 3 ? y + 1 : 7 - y;
    for (let x = 3 - half; x <= 3 + half; x++) px.set(x, y, x < 3 ? g(2) : g(1));
  }
  px.set(3, 2, g(2));
  px.outline(ci(P, 'outline'), 'all');
  return px;
}

/**
 * A 3x5 bitmap font, rows of 3 bits top to bottom.
 *
 * Tiny on purpose: at 256x224 a 3x5 face fits ~50 characters per line, which is
 * what the death-scene revision text needs. Anything larger and a sentence
 * doesn't fit on the screen it is describing.
 */
export const FONT_GLYPHS: Record<string, string> = {
  a: '111101111101101', b: '110101110101110', c: '111100100100111', d: '110101101101110',
  e: '111100110100111', f: '111100110100100', g: '111100101101111', h: '101101111101101',
  i: '111010010010111', j: '001001001101111', k: '101101110101101', l: '100100100100111',
  m: '101111111101101', n: '110101101101101', o: '111101101101111', p: '111101111100100',
  q: '111101101111001', r: '111101110101101', s: '111100111001111', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101',
  y: '101101010010010', z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111',
  ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', '-': '000000111000000',
  "'": '010010000000000', ':': '000010000010000', '!': '010010010000010', '?': '111001010000010',
  // The menu cursor and the "this one is current" marker. Both were being drawn
  // long before either existed here, and `drawText` substitutes '?' for anything
  // it does not have — so every menu in the game has been showing a question
  // mark where its selection arrow should be.
  '>': '100010001010100', '<': '001010100010001', '*': '000101010101000',
};

/** Every glyph the runtime font atlas carries, in a stable order. */
export const FONT_CHARS = Object.keys(FONT_GLYPHS);

function glyphSprite(ch: string, colour: number, shadow: number): PixelBuffer {
  const px = new PixelBuffer(8, 8);
  const bits = FONT_GLYPHS[ch] ?? FONT_GLYPHS['?']!;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (bits[y * 3 + x] !== '1') continue;
      // Shadow first, then the face over it, so the face always wins.
      px.under(x + 1, y + 2, shadow);
      px.set(x, y + 1, colour);
    }
  }
  return px;
}

function digitSprite(d: number): PixelBuffer {
  const P = PAL_PICKUP;
  return glyphSprite(String(d), ci(P, 'gold.4'), ci(P, 'outline'));
}

/** Keys are hex-encoded so punctuation never collides with the atlas key syntax. */
export function fontKey(ch: string): string {
  return `ui.font.${ch.codePointAt(0)!.toString(16)}`;
}

/**
 * Solid 8x8 block and a 1px rule.
 *
 * Screen dimming and strike-through lines need real primitives. Tiling the drop
 * shadow instead produces horizontal banding (it is a flat ellipse in a tall
 * cell), and drawing hyphen glyphs over text produces unreadable mush rather
 * than a struck line.
 */
function blockSprite(colour: number): PixelBuffer {
  const px = new PixelBuffer(8, 8);
  px.rect(0, 0, 8, 8, colour);
  return px;
}

function ruleSprite(colour: number): PixelBuffer {
  const px = new PixelBuffer(8, 8);
  px.hline(0, 0, 8, colour);
  return px;
}

export function fxFrames(): SpriteFrame[] {
  const centre: [number, number] = [4, 4];
  const leafPal = PAL_TERRAIN;
  const propPal = PAL_PROP;

  return [
    { key: 'fx.leaf.0', buffer: particleSprite(3, ci(leafPal, 'grass.2'), ci(leafPal, 'grass.0')), palette: leafPal, anchor: centre },
    { key: 'fx.leaf.1', buffer: particleSprite(2, ci(leafPal, 'grass.6')), palette: leafPal, anchor: centre },
    { key: 'fx.shard.0', buffer: particleSprite(3, ci(propPal, 'pot.2'), ci(propPal, 'pot.0')), palette: propPal, anchor: centre },
    { key: 'fx.shard.1', buffer: particleSprite(2, ci(propPal, 'pot.4')), palette: propPal, anchor: centre },
    { key: 'fx.spark.0', buffer: particleSprite(3, ci(propPal, 'flame.4')), palette: propPal, anchor: centre },
    { key: 'fx.spark.1', buffer: particleSprite(2, ci(propPal, 'flame.2')), palette: propPal, anchor: centre },
    { key: 'fx.splinter.0', buffer: particleSprite(3, ci(propPal, 'wood.2'), ci(propPal, 'wood.0')), palette: propPal, anchor: centre },
    { key: 'fx.splinter.1', buffer: particleSprite(2, ci(propPal, 'wood.4')), palette: propPal, anchor: centre },
    { key: 'fx.gore.0', buffer: particleSprite(3, ci(PAL_OCTOROK, 'body.2'), ci(PAL_OCTOROK, 'body.0')), palette: PAL_OCTOROK, anchor: centre },
    { key: 'fx.gore.1', buffer: particleSprite(2, ci(PAL_OCTOROK, 'body.6')), palette: PAL_OCTOROK, anchor: centre },
    { key: 'fx.pellet', buffer: pelletSprite(), palette: PAL_OCTOROK, anchor: centre },
    { key: 'item.bomb', buffer: bombSprite(true), palette: PAL_PICKUP, anchor: [8, 15] },
    { key: 'pickup.bomb', buffer: bombSprite(false), palette: PAL_PICKUP, anchor: [8, 15] },
    { key: 'fx.boomerang.0', buffer: boomerangSprite(0), palette: PAL_PROP, anchor: [8, 8] },
    { key: 'fx.boomerang.1', buffer: boomerangSprite(1), palette: PAL_PROP, anchor: [8, 8] },
    { key: 'fx.blast.0', buffer: blastSprite(0), palette: PAL_PROP, anchor: [16, 16] },
    { key: 'fx.blast.1', buffer: blastSprite(1), palette: PAL_PROP, anchor: [16, 16] },
    { key: 'fx.blast.2', buffer: blastSprite(2), palette: PAL_PROP, anchor: [16, 16] },
    // HUD copies, anchored top-left. The world versions anchor at the feet or the
    // centre, which puts them mostly off-screen when drawn into a corner slot.
    { key: 'ui.icon.bomb', buffer: bombSprite(true), palette: PAL_PICKUP, anchor: [0, 0] },
    { key: 'ui.icon.boomerang', buffer: boomerangSprite(0), palette: PAL_PROP, anchor: [0, 0] },
    { key: 'player.shield', buffer: shieldSprite(), palette: PAL_PLAYER, anchor: centre },
    { key: 'ui.heart.full', buffer: hudHeart('full'), palette: PAL_PICKUP, anchor: [0, 0] },
    { key: 'ui.heart.half', buffer: hudHeart('half'), palette: PAL_PICKUP, anchor: [0, 0] },
    { key: 'ui.heart.empty', buffer: hudHeart('empty'), palette: PAL_PICKUP, anchor: [0, 0] },
    { key: 'ui.amber', buffer: amberSprite(), palette: PAL_PICKUP, anchor: [0, 0] },
    { key: 'fx.dim', buffer: blockSprite(ci(PAL_PICKUP, 'outline')), palette: PAL_PICKUP, anchor: [0, 0], lit: false },
    { key: 'ui.rule', buffer: ruleSprite(ci(PAL_PICKUP, 'gold.4')), palette: PAL_PICKUP, anchor: [0, 0], lit: false },
    ...Array.from({ length: 10 }, (_, d) => ({
      key: `ui.digit.${d}`,
      buffer: digitSprite(d),
      palette: PAL_PICKUP,
      anchor: [0, 0] as [number, number],
    })),
    ...FONT_CHARS.map((ch) => ({
      key: fontKey(ch),
      buffer: glyphSprite(ch, ci(PAL_PICKUP, 'gold.4'), ci(PAL_PICKUP, 'outline')),
      palette: PAL_PICKUP,
      anchor: [0, 0] as [number, number],
    })),
  ];
}

export function propFrames(): SpriteFrame[] {
  const a: [number, number] = [8, 15];
  return [
    { key: 'pickup.heart', buffer: heartSprite(), palette: PAL_PICKUP, anchor: a },
    { key: 'pickup.shard', buffer: shardSprite(), palette: PAL_PICKUP, anchor: a },
    { key: 'prop.pot', buffer: potSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.bush', buffer: bushSprite(), palette: PAL_TERRAIN, anchor: a },
    { key: 'prop.chest.closed', buffer: chestSprite(false), palette: PAL_PROP, anchor: a },
    { key: 'prop.chest.open', buffer: chestSprite(true), palette: PAL_PROP, anchor: a },
    { key: 'prop.torch.0', buffer: torchSprite(0), palette: PAL_PROP, anchor: a },
    { key: 'prop.torch.1', buffer: torchSprite(1), palette: PAL_PROP, anchor: a },
    { key: 'prop.dummy', buffer: dummySprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.bars', buffer: barsSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.tombstone', buffer: tombstoneSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.rock', buffer: rockSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.reeds', buffer: reedsSprite(), palette: PAL_TERRAIN, anchor: a },
    { key: 'prop.stalagmite', buffer: stalagmiteSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.crate', buffer: crateSprite(), palette: PAL_PROP, anchor: a },
    { key: 'prop.teleporter.0', buffer: teleporterSprite(0), palette: PAL_PICKUP, anchor: a },
    { key: 'prop.teleporter.1', buffer: teleporterSprite(1), palette: PAL_PICKUP, anchor: a },
    { key: 'prop.tree', buffer: treeSprite(), palette: PAL_TERRAIN, anchor: [8, 23] },
    ...(['guard', 'trader', 'worker', 'gentry', 'poor'] as const).flatMap((kind) =>
      [0, 1].map((f) => ({
        key: `folk.${kind}.${f}`,
        buffer: folkSprite(kind, f),
        palette: PAL_PROP,
        anchor: [8, 23] as [number, number],
      }))),
    { key: 'prop.flower', buffer: flowerSprite(), palette: PAL_TERRAIN, anchor: a },
    { key: 'sparrow.0', buffer: sparrowSprite(0), palette: PAL_PROP, anchor: a },
    { key: 'sparrow.1', buffer: sparrowSprite(1), palette: PAL_PROP, anchor: a },
    { key: 'frog.0', buffer: frogSprite(0), palette: PAL_TERRAIN, anchor: a },
    { key: 'frog.1', buffer: frogSprite(1), palette: PAL_TERRAIN, anchor: a },
    { key: 'fx.shadow', buffer: shadowSprite(), palette: PAL_PROP, anchor: a, lit: false },
    { key: 'fx.shadow.mid', buffer: shadowSpriteMid(), palette: PAL_PROP, anchor: [12, 6], lit: false },
    { key: 'fx.shadow.big', buffer: shadowSpriteBig(), palette: PAL_PROP, anchor: [24, 8], lit: false },
    { key: 'fx.wallshade', buffer: wallShadeSprite(), palette: PAL_PROP, anchor: [0, 0], lit: false },
  ];
}

export function allSprites(_rng: Rng): SpriteFrame[] {
  return [...playerFrames(), ...enemyFrames(), ...propFrames(), ...fxFrames()];
}

