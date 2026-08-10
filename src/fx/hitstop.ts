/**
 * Hitstop — the few frames of frozen simulation on a connecting hit.
 *
 * This is the single cheapest thing that makes a hit feel like it landed. Four
 * frames is imperceptible as a pause and unmistakable as impact.
 *
 * Crucially it freezes *actors only*. Particles, screen shake and UI keep running
 * through it — if everything stops the frame reads as a dropped frame or a stutter
 * rather than as weight.
 */

export const HITSTOP_NORMAL = 4;
export const HITSTOP_HEAVY = 8;

export class Hitstop {
  private frames = 0;

  /** Longest request wins; a spin hit landing during a normal hit shouldn't shorten it. */
  request(frames: number): void {
    if (frames > this.frames) this.frames = frames;
  }

  get active(): boolean {
    return this.frames > 0;
  }

  get remaining(): number {
    return this.frames;
  }

  /**
   * Advance one simulation step. Returns whether actors should update this frame.
   * Call exactly once per step, before anything else in the scene.
   */
  step(): boolean {
    if (this.frames > 0) {
      this.frames--;
      return false;
    }
    return true;
  }

  clear(): void {
    this.frames = 0;
  }
}
