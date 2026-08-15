/**
 * Skeletal posing for characters.
 *
 * Every sprite in this game was a hand-plotted pose. That is fine for one
 * drawing and it is a wall for animation: four directions times N frames times
 * every action is a combinatorial cost paid in authored pixels, so the walk
 * cycle stopped at four frames and the idle at two — not because four and two
 * are right, but because eight and six were too expensive to write.
 *
 * A rig moves that cost. A character is defined *once* as a set of parts whose
 * offsets are continuous functions of a phase, and a frame is that function
 * sampled. Frame count stops being authoring work and becomes a loop bound:
 * WALK_FRAMES is now a number you can change.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 * **Offsets are fractional here and rounded at the last moment.** The whole game
 * snaps to integer pixels, and it must — but a cycle *computed* in integers can
 * only ever hold as many distinct poses as it has pixels of travel, which is why
 * more frames of the old system would have produced duplicates. Computing in
 * real numbers and rounding per part means eight frames genuinely differ, even
 * where the leg only travels three pixels.
 *
 * **Nothing here draws.** The rig says where the parts are; the sprite
 * generators say what a part looks like. That split is what lets Aldez keep his
 * scar and his rune — the detail work sits in `refine()` and in the body
 * painter, untouched by the fact that the hips now move on a sine.
 */

/**
 * Where every part of a character sits, relative to its rest position, in
 * sprite pixels. Positive y is down, matching everything else.
 */
export interface Rig {
  /** whole-body vertical bob — the single most readable part of a walk */
  bob: number;
  /** whole-body horizontal shift, used for weight transfer and recoil */
  sway: number;
  /** vertical rise of each leg; profile views also use the x values */
  legNearY: number;
  legFarY: number;
  legNearX: number;
  legFarX: number;
  /** arm swing, opposed to the legs */
  armNearY: number;
  armFarY: number;
  armNearX: number;
  armFarX: number;
  /**
   * Horizontal head drift only.
   *
   * There is deliberately no vertical head offset. A head that bobs
   * independently of the torso is right on a large character and wrong here: at
   * sixteen by twenty-four the neck is one pixel, so any relative motion opens a
   * visible gap between the head and the collar. The head rides the torso, and
   * the liveliness comes from the cloak and arms, which have room to lag.
   */
  headX: number;
  /** cloak and hair trail behind the motion */
  trail: number;
  /** shoulder rise from breathing, on the idle only */
  breath: number;
}

const REST: Rig = {
  bob: 0, sway: 0,
  legNearY: 0, legFarY: 0, legNearX: 0, legFarX: 0,
  armNearY: 0, armFarY: 0, armNearX: 0, armFarX: 0,
  headX: 0, trail: 0, breath: 0,
};

export function restRig(): Rig {
  return { ...REST };
}

const TAU = Math.PI * 2;

/**
 * Fraction of the cycle a foot spends on the ground.
 *
 * Real walking is not symmetric: a foot is planted for roughly 60% of the cycle
 * and swings through the remaining 40%, which is why it appears to move slowly
 * backwards and then snap forwards. Animating it as a sine gets this wrong in a
 * way that is subtly lifeless — and, at this resolution, in a way that is also
 * *mechanically* broken: a sine sampled at N points is mirror-symmetric, so
 * sin(60 deg) equals sin(120 deg) and frames 1 and 2 of a six-frame cycle round
 * to identical pixels. The first rig did exactly that and produced six frames
 * containing four distinct poses.
 *
 * Stance and swing being different lengths breaks the symmetry, so every sample
 * is a genuinely different pose — and it is what a walk actually looks like.
 */
const STANCE = 0.62;

/** Horizontal foot travel, +1 forward to -1 back. */
function stride(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  if (p < STANCE) {
    // Planted: the body travels over a stationary foot, so relative to the hips
    // the foot slides steadily backward.
    return 1 - (p / STANCE) * 2;
  }
  // Swing: forward again, eased so the foot accelerates off the ground and
  // decelerates into the next contact rather than snapping.
  const q = (p - STANCE) / (1 - STANCE);
  return -Math.cos(q * Math.PI);
}

/** How far a foot is off the ground. Zero for the whole of stance. */
export function lift(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  if (p < STANCE) return 0;
  return Math.sin(((p - STANCE) / (1 - STANCE)) * Math.PI);
}

/**
 * A walk cycle, sampled at `phase` in [0,1).
 *
 * The body rises twice per cycle because there are two steps in a cycle, and it
 * is highest at mid-stance when the supporting leg is straight under the hips.
 * Getting that relationship wrong is the classic tell of programmer animation:
 * the character appears to hop on one foot.
 *
 * The arms are driven by the opposite leg's phase — not merely inverted — so
 * they inherit the same stance/swing asymmetry and stay in step with the gait.
 */
export function walkRig(phase: number, profile: boolean): Rig {
  const near = phase;
  const far = phase + 0.5;

  const nearStride = stride(near);
  const farStride = stride(far);
  const nearLift = lift(near);
  const farLift = lift(far);

  // Highest at mid-stance for each leg, i.e. twice per cycle, and never below
  // rest — a walker rises off the planted foot, it does not sink into the floor.
  const support = Math.max(1 - nearLift, 1 - farLift);
  const t = phase * TAU;

  return {
    bob: -(support - 0.5) * 1.6,
    // Weight shifts toward whichever foot is planted. Small, and the reason a
    // walk reads as having mass.
    sway: profile ? 0 : (nearLift - farLift) * 0.6,

    // Front-on the stride reads as a lift toward the viewer; in profile it reads
    // as the feet passing each other. One rig, two projections.
    legNearY: profile ? -nearLift * 1.2 : nearLift * 1.4,
    legFarY: profile ? -farLift * 1.2 : farLift * 1.4,
    // Front-on the feet still travel, just far less: a walk seen head-on shows
    // the legs crossing slightly under the hips. Without it, the two frames
    // where both feet are planted are pixel-identical and a six-frame cycle
    // collapses back to four.
    legNearX: profile ? nearStride * 2.6 : nearStride * 0.8,
    legFarX: profile ? farStride * 2.6 : farStride * 0.8,

    // Opposite limbs: the near arm swings with the far leg.
    armNearY: farLift * 0.7,
    armFarY: nearLift * 0.7,
    armNearX: profile ? farStride * 1.8 : farStride * 0.6,
    armFarX: profile ? nearStride * 1.8 : nearStride * 0.6,

    headX: profile ? 0 : Math.sin(t) * 0.25,
    trail: -Math.max(nearLift, farLift) * 1.1,
    breath: 0,
  };
}

/**
 * Standing still, but alive.
 *
 * One slow breath: shoulders and head rise together, the cloak settles a beat
 * later. Small enough that it never reads as a bounce, large enough that a
 * stationary character does not look like a paused one.
 */
export function idleRig(phase: number): Rig {
  const t = phase * TAU;
  const breath = (1 - Math.cos(t)) * 0.5;
  // Each part runs on its own phase offset and its own amplitude, so they cross
  // the rounding boundary at different moments in the cycle. With one shared
  // curve and a sub-pixel amplitude every frame rounded to the same pixels and
  // the "breath" was four identical drawings.
  const lag = (turns: number) => (1 - Math.cos(t - TAU * turns)) * 0.5;
  return {
    ...REST,
    bob: -breath * 1.2,
    breath,
    // The cloak settles a beat after the shoulders, so the figure never moves as
    // one rigid piece.
    // Phase chosen so the trail changes on the samples where the profile view
    // has nothing else moving: front-on there are two arms and a sway to tell
    // frames apart, in profile only the leading arm is drawn, so the cloak has
    // to carry the difference on its own.
    trail: -lag(0.35) * 1.2,
    armNearY: lag(0.15) * 1.1,
    armFarY: lag(0.4) * 1.1,
    headX: 0,
  };
}

/**
 * A hop, for anything that leaves the ground.
 *
 * `phase` runs 0..1 across gather, launch, apex and land. Used by the slime,
 * where the entire animal is this curve.
 */
export function hopRig(phase: number): Rig {
  const lift = Math.sin(Math.min(1, Math.max(0, phase)) * Math.PI);
  return {
    ...REST,
    bob: -lift * 3,
    // Squash on the ground, stretch in the air: the legs compress as the body
    // gathers and extend at the top.
    legNearY: (1 - lift) * 0.8,
    legFarY: (1 - lift) * 0.8,
    trail: -lift * 1.2,
  };
}

/** Round a rig's offsets to whole pixels, at the last possible moment. */
export function snap(rig: Rig): Rig {
  const r = {} as Rig;
  for (const key of Object.keys(rig) as Array<keyof Rig>) {
    r[key] = Math.round(rig[key]);
  }
  return r;
}
