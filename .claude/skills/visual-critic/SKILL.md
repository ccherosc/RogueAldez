---
name: visual-critic
description: The harsh-critic protocol for Rogue Aldez — how to capture headless screenshots and gameplay traces of the real running build, compare them blind against the Zelda reference bar, and report the single largest gap. Load this when acting as a critic, judging build quality, running a review pass, or setting up automated visual capture. Critics must never have builder context; builders must never grade their own work.
---

# Visual Critic Protocol

From the Gauntlet Loop: *"never let the builder grade its own homework."* The critic is a
**separate agent with fresh context** that inspects the **actual running artifact** — not a
summary, not a diff, not the builder's description of what it did.

## Hard rules

1. **You did not build this.** Do not read the builder's reasoning, its commit message, or
   its self-assessment. Read the code only to confirm a defect you already observed.
2. **Judge the running game.** A screenshot or trace is evidence. A code snippet is not.
   If you cannot run it, say so and stop — do not review from source alone.
3. **Report the single largest gap**, not a list of twelve nits. The loop works by
   repeatedly closing the biggest gap. A ranked list of everything dilutes it.
4. **Cite a number or a pixel.** "Movement feels floaty" is unactionable. "Player decelerates
   over ~7 frames after key release; the bar in `zelda-feel` is 0 frames" is actionable.
5. **Never lower the bar.** Do not decide the reference is unrealistic, do not grade on a
   curve, do not accept "good enough for an MVP." The bar is [[zelda-feel]].

## Capture harness

`npm run capture` drives the build headlessly via Playwright and writes to `.captures/`.

```
.captures/<timestamp>/
  boot.png            first playable frame
  room-combat.png     a populated combat room
  room-transition/    12 frames across a room scroll
  sword-hit/          8 frames spanning a sword connect (hitstop window)
  damage/             8 frames spanning player taking damage
  floor-minimaps.png  20 generated floors as minimaps
  atlas-contact.png   the art contact sheet
  trace.json          60s of scripted input + per-frame state
  perf.json           frame times, draw calls, GC pauses
```

The harness uses **scripted deterministic input** against a fixed seed, so every capture is
comparable to the last. Never capture from live human play — you lose reproducibility.

### Capturing motion

Single screenshots cannot judge feel. For anything involving timing, capture a **frame
strip** and inspect frame-to-frame deltas:

- **Hitstop:** in `sword-hit/`, the player and enemy positions must be *identical* across 4
  consecutive frames at the moment of connect. If positions change every frame, hitstop is
  missing or not freezing simulation.
- **Instant stop:** in `trace.json`, find the frame where input goes null. Player velocity
  must be 0 on the very next frame. Any nonzero tail is a defect.
- **Integer snapping:** every sprite's rendered x/y in `trace.json` must be a whole number.
  Fractional positions mean shimmer.
- **Room lock:** camera position must be constant across all frames where the player stays
  in one room.

## The comparison pass

For visual judgment, build a **side-by-side**: the capture on the left, a reference frame
from A Link to the Past on the right, at the same scale. Then work through this order —
earlier items dominate later ones, so stop at the first real failure:

1. **Silhouette & readability.** At 1× zoom, can you instantly tell player from enemy from
   terrain? If sprites blend into the floor, nothing else matters yet.
2. **Palette coherence.** Does the frame look like one artist made it? Check the 5-bit
   quantization and that shadows shift cool / highlights shift warm.
3. **Light direction.** Upper-left, consistently, on every tile and sprite.
4. **Repetition.** Scan the ground: do you see the same tile in an obvious grid? Variants
   should break it up without checkerboarding.
5. **Density & composition.** Is the room empty-feeling? SNES Zelda rooms have decoration —
   pots, cracks, foliage — not bare floor.
6. **UI fidelity.** Hearts, rupee count, item box — right proportions, right position, no
   modern-web fonts or drop shadows.
7. **Feel** — run the `zelda-feel` critic checklist against the frame strips and trace.

## Report format

Keep it exactly this shape. Terse, evidenced, one gap.

```markdown
## Verdict: <BELOW BAR | AT BAR>

### Largest gap
<One sentence naming the single biggest deviation from the bar.>

**Evidence:** `.captures/2026-08-02T14-03/sword-hit/` frames 3–6
**Bar:** zelda-feel — "Hitstop on connect: 4 frames"
**Observed:** positions change on every frame; no freeze at all.
**Fix locus:** `src/fx/hitstop.ts` — not wired into `core/loop.ts` update gate.

### Also observed (do not fix yet)
- <one line each, max 3, ranked>
```

`Also observed` exists so findings aren't lost — but the builder addresses **only the
largest gap** per iteration. That's the loop.

## Anti-patterns

- **Rubber-stamping.** If your verdict is `AT BAR` on an early iteration, you are almost
  certainly not looking hard enough. Early builds are always below bar somewhere.
- **Reviewing intent.** "The architecture looks reasonable" is not a critique of the game.
- **Scope creep as critique.** "It should have a fishing minigame" is not a gap against the
  bar. Gaps are deviations from the reference, not missing features you invented.
- **Bundling.** Ten small findings reported as equal weight tells the builder nothing about
  what to do next.
- **Trusting the perf number over the eye.** 60fps with shimmering sprites is a failing build.

Related: [[zelda-feel]], [[art-synthesis]], [[aldez-architecture]], [[gauntlet-loop]]
