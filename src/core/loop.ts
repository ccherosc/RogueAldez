/**
 * Fixed 60 Hz simulation with a decoupled render.
 *
 * This is not a style preference. SNES-accurate feel depends on frame-counted
 * timings — i-frames, sword phases and hitstop are all expressed in frames — and
 * those only hold if the simulation steps at a fixed rate regardless of display
 * refresh. On a 144 Hz monitor the sim still runs 60 steps a second; the extra
 * display frames get interpolated positions.
 */

export const STEP_HZ = 60;
export const STEP = 1 / STEP_HZ;

/** Longest wall-clock gap we will try to catch up on, in seconds. */
const MAX_FRAME = 0.25;

export interface LoopStats {
  /** display frames per second, smoothed */
  fps: number;
  /** simulation steps executed on the last display frame */
  steps: number;
  /** ms spent in update() on the last display frame */
  updateMs: number;
  /** ms spent in render() on the last display frame */
  renderMs: number;
  /** total simulation steps since boot — the canonical clock for frame counts */
  tick: number;
}

export interface LoopHandle {
  stop(): void;
  readonly stats: Readonly<LoopStats>;
}

export interface LoopCallbacks {
  /** Advance the simulation exactly one fixed step. Must not read wall-clock time. */
  update(): void;
  /** Draw. `alpha` in [0,1) interpolates between previous and current state. */
  render(alpha: number): void;
}

export function startLoop(cb: LoopCallbacks): LoopHandle {
  const stats: LoopStats = { fps: 0, steps: 0, updateMs: 0, renderMs: 0, tick: 0 };

  let last = performance.now();
  let accumulator = 0;
  let running = true;
  let raf = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;

  const frame = (now: number): void => {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    // Clamping matters: after a tab-out the gap can be minutes, and without this
    // the accumulator would try to run thousands of steps and lock the page.
    const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    accumulator += elapsed;

    const t0 = performance.now();
    let steps = 0;
    while (accumulator >= STEP) {
      cb.update();
      accumulator -= STEP;
      stats.tick++;
      steps++;
    }
    const t1 = performance.now();

    cb.render(accumulator / STEP);
    const t2 = performance.now();

    stats.steps = steps;
    stats.updateMs = t1 - t0;
    stats.renderMs = t2 - t1;

    fpsAccum += elapsed;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      stats.fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }
  };

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    stats,
  };
}
