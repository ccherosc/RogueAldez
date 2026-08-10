/**
 * Room-locked camera.
 *
 * This is *not* a follow camera, and that is the single most-often-missed part of
 * the ALTTP feel. The camera sits perfectly still while the player moves around a
 * room; when the player crosses a boundary it scrolls, linearly, over a fixed
 * number of frames while input is locked. No easing, no look-ahead, no deadzone.
 */

export const SCROLL_FRAMES_H = 16;
export const SCROLL_FRAMES_V = 20;

export class Camera {
  /** top-left of the view, in world pixels */
  x = 0;
  y = 0;

  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private scrollFrame = 0;
  private scrollTotal = 0;

  private shakeAmp = 0;
  private shakeFrame = 0;
  private shakeTotal = 0;
  private shakeOffX = 0;
  private shakeOffY = 0;

  get transitioning(): boolean {
    return this.scrollFrame < this.scrollTotal;
  }

  /** Progress through the current scroll, 0..1. */
  get scrollProgress(): number {
    return this.scrollTotal === 0 ? 1 : this.scrollFrame / this.scrollTotal;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.scrollFrame = 0;
    this.scrollTotal = 0;
  }

  scrollTo(x: number, y: number, frames: number): void {
    this.fromX = this.x;
    this.fromY = this.y;
    this.toX = x;
    this.toY = y;
    this.scrollFrame = 0;
    this.scrollTotal = frames;
  }

  /** Amplitude in pixels, duration in frames. Render-only — never affects collision. */
  shake(amplitude: number, frames: number): void {
    // Don't let a small shake stomp a larger one already running.
    if (amplitude * frames < this.shakeAmp * (this.shakeTotal - this.shakeFrame)) return;
    this.shakeAmp = amplitude;
    this.shakeFrame = 0;
    this.shakeTotal = frames;
  }

  /** Advance one fixed simulation step. */
  update(): void {
    if (this.transitioning) {
      this.scrollFrame++;
      const t = this.scrollFrame / this.scrollTotal;
      this.x = this.fromX + (this.toX - this.fromX) * t;
      this.y = this.fromY + (this.toY - this.fromY) * t;
      if (!this.transitioning) {
        this.x = this.toX;
        this.y = this.toY;
      }
    }

    if (this.shakeFrame < this.shakeTotal) {
      this.shakeFrame++;
      // Linear decay. Deterministic oscillation rather than rng, so a replayed
      // capture shakes identically.
      const decay = 1 - this.shakeFrame / this.shakeTotal;
      const a = this.shakeAmp * decay;
      this.shakeOffX = Math.round(Math.sin(this.shakeFrame * 2.7) * a);
      this.shakeOffY = Math.round(Math.cos(this.shakeFrame * 3.4) * a);
    } else {
      this.shakeOffX = 0;
      this.shakeOffY = 0;
    }
  }

  /** Interpolate, *then* snap — snapping first would jitter during a scroll. */
  get viewX(): number {
    return Math.round(this.x) + this.shakeOffX;
  }

  get viewY(): number {
    return Math.round(this.y) + this.shakeOffY;
  }
}
