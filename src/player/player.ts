/**
 * Player movement and animation.
 *
 * The numbers here come straight from the zelda-feel bar and are deliberately
 * unsmoothed. Aldez has **no acceleration and no deceleration** — full speed on
 * the frame a key goes down, dead stop on the frame it comes up. Every instinct
 * says to add a little easing; don't. Momentum is instantly visible and is the
 * fastest way to stop feeling like a SNES Zelda.
 *
 * Diagonals move 1.0px per axis rather than a normalised 1.06, which makes
 * diagonal travel slightly *slower* overall (1.41 vs 1.5). That is authentic
 * per-axis stepping, not a bug.
 */

import { WALK_FRAMES, IDLE_FRAMES } from '../art/sprites.ts';
import { moveActor } from '../physics/collide.ts';
import type { Actor, SolidQuery } from '../physics/collide.ts';
import type { InputSnapshot } from './input.ts';
import { Sword } from './sword.ts';

export const WALK_SPEED = 1.5;
export const DIAGONAL_SPEED = 1.0;

/**
 * Frames each animation frame is held for.
 *
 * Chosen so the *cycle duration* is unchanged from the four-frame version: the
 * walk still comes round every 24 ticks and the breath every 60. More frames at
 * the old hold would have made Aldez walk slower, which is a change to feel, and
 * feel was already right — the rig is supposed to buy smoothness, not alter the
 * cadence the zelda-feel bar was tuned against.
 */
const WALK_FRAME_HOLD = Math.max(1, Math.round(24 / WALK_FRAMES));
const IDLE_FRAME_HOLD = Math.max(1, Math.round(60 / IDLE_FRAMES));

/** Narrower than the 16px sprite so doorways and tile gaps feel generous. */
const HALF_WIDTH = 5;
const BOX_HEIGHT = 10;

/** 1 heart = 8 subunits; an ordinary enemy hit costs 4, i.e. half a heart. */
export const HEART_UNITS = 8;
export const START_HEARTS = 3;

export const IFRAMES = 48;
export const KNOCKBACK_DISTANCE = 24;
export const KNOCKBACK_FRAMES = 10;
/** Control lockout matches the knockback, so you regain control as you land. */
export const HURT_LOCKOUT = 10;

export type Facing = 'down' | 'up' | 'left' | 'right';

export class Player {
  /** feet position in world pixels */
  x: number;
  y: number;
  facing: Facing = 'down';
  moving = false;
  /** set by the scene during a room transition, when the player is on rails */
  inputLocked = false;
  readonly sword = new Sword();

  maxHealth = START_HEARTS * HEART_UNITS;
  health = START_HEARTS * HEART_UNITS;
  iframes = 0;
  /** relic-driven, set by the scene when the awakened set changes */
  speedMultiplier = 1;
  bonusIframes = 0;

  private knockX = 0;
  private knockY = 0;
  private knockFrames = 0;
  private lockout = 0;
  private animFrame = 0;
  private animTimer = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** set by the scene while a lifted prop is over his head */
  carrying = false;

  get dead(): boolean {
    return this.health <= 0;
  }

  /**
   * The shield is up when Aldez is standing still and not swinging.
   *
   * Passive rather than a held button, which is what makes it a *positional*
   * decision: standing your ground covers the direction you face and costs you
   * mobility, so a ranged enemy becomes a question of where to stand rather than
   * a tax you pay for crossing the room.
   */
  get bracing(): boolean {
    return (
      !this.moving &&
      !this.carrying &&
      !this.sword.swinging &&
      !this.inputLocked &&
      this.knockFrames === 0 &&
      !this.dead
    );
  }

  /** Unit vector for the current facing. */
  get facingVector(): [number, number] {
    switch (this.facing) {
      case 'up': return [0, -1];
      case 'down': return [0, 1];
      case 'left': return [-1, 0];
      case 'right': return [1, 0];
    }
  }

  get invulnerable(): boolean {
    return this.iframes > 0;
  }

  /**
   * Grant i-frames without the hurt that normally buys them.
   *
   * Only ever extends: a room arrival must not cut short the invulnerability the
   * player earned by being hit a moment earlier.
   */
  grantInvulnerability(frames: number): void {
    this.iframes = Math.max(this.iframes, frames);
  }

  /**
   * Flash cadence during i-frames: two frames visible, two hidden. Fast enough to
   * read as "you are hurt", slow enough that you can still track yourself.
   */
  get visible(): boolean {
    if (this.iframes <= 0) return true;
    return Math.floor(this.iframes / 2) % 2 === 0;
  }

  /** Returns true if the hit landed (i.e. was not absorbed by i-frames). */
  damage(amount: number, fromX: number, fromY: number): boolean {
    if (this.iframes > 0 || this.dead) return false;

    this.health = Math.max(0, this.health - amount);
    this.iframes = IFRAMES + this.bonusIframes;
    this.lockout = HURT_LOCKOUT;
    this.sword.interrupt();

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.knockX = (dx / len) * KNOCKBACK_DISTANCE;
    this.knockY = (dy / len) * KNOCKBACK_DISTANCE;
    this.knockFrames = KNOCKBACK_FRAMES;
    return true;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.health = this.maxHealth;
    this.iframes = 0;
    this.knockFrames = 0;
    this.lockout = 0;
    this.facing = 'down';
    this.moving = false;
    this.inputLocked = false;
    this.carrying = false;
    this.sword.interrupt();
    this.resetAnimation();
  }

  get actor(): Actor {
    return { x: this.x, y: this.y, halfW: HALF_WIDTH, boxH: BOX_HEIGHT };
  }

  /** One fixed simulation step. */
  update(input: InputSnapshot, isSolid: SolidQuery): void {
    if (this.iframes > 0) this.iframes--;

    // Knockback overrides everything: you are being thrown, not walking.
    if (this.knockFrames > 0) {
      const t = this.knockFrames / KNOCKBACK_FRAMES;
      const step = (t * 2) / (KNOCKBACK_FRAMES + 1);
      const result = moveActor(isSolid, this.actor, this.knockX * step, this.knockY * step);
      this.x = result.x;
      this.y = result.y;
      this.knockFrames--;
    }
    if (this.lockout > 0) {
      this.lockout--;
      this.moving = false;
      this.advanceAnimation();
      return;
    }

    // No swinging with both hands full — carrying commits you to the throw.
    if (!this.inputLocked && !this.carrying) this.sword.update(input);

    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const wantsMove =
      !this.inputLocked && !this.sword.movementLocked && (ix !== 0 || iy !== 0);

    if (wantsMove) {
      // Horizontal wins on a diagonal, matching how the 4-direction sprite set
      // reads best in motion.
      if (iy < 0) this.facing = 'up';
      if (iy > 0) this.facing = 'down';
      if (ix < 0) this.facing = 'left';
      if (ix > 0) this.facing = 'right';

      const base = ix !== 0 && iy !== 0 ? DIAGONAL_SPEED : WALK_SPEED;
      const speed = base * this.speedMultiplier;
      const result = moveActor(isSolid, this.actor, ix * speed, iy * speed);
      this.x = result.x;
      this.y = result.y;
    }

    this.moving = wantsMove;
    this.advanceAnimation();
  }

  private advanceAnimation(): void {
    if (this.moving) {
      this.animTimer++;
      if (this.animTimer >= WALK_FRAME_HOLD) {
        this.animTimer = 0;
        this.animFrame = (this.animFrame + 1) % WALK_FRAMES;
      }
    } else {
      this.animTimer++;
      if (this.animTimer >= IDLE_FRAME_HOLD) {
        this.animTimer = 0;
        this.animFrame = (this.animFrame + 1) % IDLE_FRAMES;
      }
    }
  }

  /** Reset the cycle so a stop always lands on the neutral pose. */
  resetAnimation(): void {
    this.animFrame = 0;
    this.animTimer = 0;
  }

  spriteKey(): string {
    // A spin cycles the *facing* rather than the pose: the attack frames already
    // hold the blade out to one side, so stepping through down/right/up/left is
    // what actually reads as turning through 360 degrees.
    if (this.sword.isSpin) {
      const order: Facing[] = ['down', 'right', 'up', 'left'];
      const step = order[Math.floor(this.sword.frame / 3) % 4]!;
      return `player.${step}.attack.1`;
    }
    // A swing overrides walk and idle entirely — the attack frames carry their own
    // body pose, so blending them with the walk cycle would fight itself.
    if (this.sword.swinging) {
      return `player.${this.facing}.attack.${this.sword.animFrame}`;
    }
    const anim = this.moving ? 'walk' : 'idle';
    const frame = this.moving ? this.animFrame : this.animFrame % 2;
    return `player.${this.facing}.${anim}.${frame}`;
  }

  /** Nudge used by room transitions to carry the player through a doorway. */
  nudge(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }
}
