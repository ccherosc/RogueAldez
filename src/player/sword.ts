/**
 * The sword swing.
 *
 * Phase timings are the zelda-feel bar exactly: 3 windup, 6 active, 6 recovery.
 * Two details do most of the work and are easy to get wrong:
 *
 *  - The hitbox is a **swept arc**, not a rectangle parked in front of the player.
 *    It starts at the side the swing originates and sweeps across the front, which
 *    is why a swing can catch something diagonally behind your shoulder.
 *  - An input during recovery **buffers** the next swing rather than being dropped.
 *    Without that, chained attacks feel like the game is ignoring you.
 */

import type { Facing } from './player.ts';
import type { InputSnapshot } from './input.ts';

export const WINDUP_FRAMES = 3;
export const ACTIVE_FRAMES = 6;
export const RECOVERY_FRAMES = 6;
export const SWING_FRAMES = WINDUP_FRAMES + ACTIVE_FRAMES + RECOVERY_FRAMES;

/** Movement returns partway through recovery, not at the end of it. */
export const MOVE_UNLOCK_FRAME = WINDUP_FRAMES + ACTIVE_FRAMES + 4;

/** An attack pressed within this many frames of the end queues the next swing. */
export const BUFFER_FRAMES = 8;

export const SPIN_CHARGE_FRAMES = 60;
export const SPIN_ACTIVE_FRAMES = 12;

/** Reach past the body centre, in pixels. */
const BLADE_REACH = 15;
/** Height above the feet that the swing pivots around. */
const PIVOT_HEIGHT = 9;

export type SwordPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'spin';

export interface HitCircle {
  x: number;
  y: number;
  r: number;
}

const FACING_ANGLE: Record<Facing, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

export class Sword {
  phase: SwordPhase = 'idle';
  /** frames elapsed within the current swing */
  frame = 0;
  /**
   * Increments on every swing. Entities record the id that last hit them, which
   * is how "one enemy may only be hit once per swing" is enforced without
   * clearing a set every frame.
   */
  swingId = 0;
  spinCharge = 0;
  /** relic-driven: how fast the spin gathers */
  chargeMultiplier = 1;

  private buffered = false;

  get swinging(): boolean {
    return this.phase !== 'idle';
  }

  /** True while the arc can connect. */
  get hitboxActive(): boolean {
    if (this.phase === 'spin') return true;
    return this.phase === 'active';
  }

  get isSpin(): boolean {
    return this.phase === 'spin';
  }

  /** Movement is locked through windup and active, and most of recovery. */
  get movementLocked(): boolean {
    if (this.phase === 'spin') return true;
    return this.swinging && this.frame < MOVE_UNLOCK_FRAME;
  }

  /** Which of the three attack sprite frames to draw. */
  get animFrame(): number {
    if (this.phase === 'spin') return 1;
    if (this.phase === 'windup') return 0;
    if (this.phase === 'active') return 1;
    return 2;
  }

  /** Progress through the active window, 0..1. */
  private get arcT(): number {
    if (this.phase === 'spin') return this.frame / SPIN_ACTIVE_FRAMES;
    return Math.min(1, Math.max(0, (this.frame - WINDUP_FRAMES) / ACTIVE_FRAMES));
  }

  update(input: InputSnapshot): void {
    // Charge accumulates for as long as attack is held, *through* the swing that
    // the initial press started. Only counting while idle meant a held button
    // just produced one swing and then sat there: the charge was reset by the
    // very swing the press triggered, so the spin could never fire.
    if (input.attack && this.phase !== 'spin') {
      this.spinCharge += this.chargeMultiplier;
    } else if (!input.attack) {
      this.spinCharge = 0;
    }

    if (this.phase === 'idle') {
      // Tap to swing, hold to spin — the press swings immediately so the tap
      // stays responsive, and the spin fires once the hold has earned it.
      if (this.spinCharge >= SPIN_CHARGE_FRAMES) {
        this.startSpin();
        return;
      }
      if (input.attackPressed || this.buffered) {
        this.buffered = false;
        this.start();
      }
      return;
    }

    this.frame++;

    if (input.attackPressed) {
      const remaining = (this.phase === 'spin' ? SPIN_ACTIVE_FRAMES : SWING_FRAMES) - this.frame;
      if (remaining <= BUFFER_FRAMES) this.buffered = true;
    }

    if (this.phase === 'spin') {
      if (this.frame >= SPIN_ACTIVE_FRAMES) this.end();
      return;
    }

    if (this.frame < WINDUP_FRAMES) this.phase = 'windup';
    else if (this.frame < WINDUP_FRAMES + ACTIVE_FRAMES) this.phase = 'active';
    else if (this.frame < SWING_FRAMES) this.phase = 'recovery';
    else this.end();
  }

  private start(): void {
    this.phase = 'windup';
    this.frame = 0;
    this.swingId++;
    // Deliberately does *not* clear spinCharge: the charge belongs to the button
    // being held, not to this swing.
  }

  private startSpin(): void {
    this.phase = 'spin';
    this.frame = 0;
    this.swingId++;
    this.spinCharge = 0;
  }

  private end(): void {
    this.phase = 'idle';
    this.frame = 0;
    if (this.buffered) {
      this.buffered = false;
      this.start();
    }
  }

  /** Cancel everything — used when the player is damaged or a room transition starts. */
  interrupt(): void {
    this.phase = 'idle';
    this.frame = 0;
    this.buffered = false;
    this.spinCharge = 0;
  }

  /**
   * The blade as a few circles along its length at the current sweep angle.
   * Circles rather than a rotated box because a swept circle test is cheap and
   * exact enough at this scale, and it degrades gracefully at the arc extremes.
   */
  hitCircles(px: number, py: number, facing: Facing): HitCircle[] {
    const pivotX = px;
    const pivotY = py - PIVOT_HEIGHT;
    const base = FACING_ANGLE[facing];

    // Sweep 180 degrees across the front; a spin goes all the way around.
    const angle = this.phase === 'spin'
      ? base + this.arcT * Math.PI * 2
      : base - Math.PI / 2 + this.arcT * Math.PI;

    const out: HitCircle[] = [];
    for (const reach of [7, 11, BLADE_REACH]) {
      out.push({
        x: pivotX + Math.cos(angle) * reach,
        y: pivotY + Math.sin(angle) * reach,
        r: 4,
      });
    }
    return out;
  }
}
