# Art and audio — the upgrade path

Two questions asked directly: *can this be reskinned to better graphics later*, and
*what is the plan for music*. Both answers are "yes, and here is the shape of it".

---

## Can this be reskinned to HD?

**Yes, and cheaply — because nothing in the game knows what a sprite looks like.**

Every draw call is an atlas *key*: `player.down.walk.2`, `tree.base.1`,
`prop.tombstone`. The simulation deals in world units and never touches pixels.
That indirection is the whole reason a reskin is a swap rather than a rewrite.

### What is already safe

| Layer | Status |
|---|---|
| Simulation (movement, combat, AI, generation) | Works in **world units**, never pixels |
| Atlas keys | Stable strings; art can change behind them freely |
| Anchors | Data in `atlas.json`, not hardcoded |
| Palettes | Generated from OKLCH; a new palette is a data edit |
| Overrides | `src/art/overrides/*.png` already replaces any cell by hand |

### What a 2x or 4x upgrade actually needs

1. **An `ART_SCALE` constant** in the art pipeline. Generators draw into buffers
   of `TILE * ART_SCALE`, the packer emits a proportionally larger atlas, and
   `atlas.json` records the scale. The renderer divides UVs by it. Gameplay
   constants stay in world units and do not move.
2. **Generators become resolution-aware.** This is the real work: art drawn for
   16px does not automatically look better at 64px, it looks like 16px art that
   was enlarged. Each generator needs detail that only appears at higher scale —
   this is where an artist or a much richer procedural pass earns its keep.
3. **Drop the 5-bit quantisation** for the HD path. It exists to make generated
   art read as SNES; at HD it just bands gradients.
4. **Re-tune the CRT pass.** Scanlines at 4x source resolution are wrong; the
   presenter should scale the scanline period with `ART_SCALE` or turn it off.

### The order to do it in

Do **not** start by upscaling everything. Take one biome and one actor to HD
first, run them side by side with the 16px set, and confirm the pipeline holds.
The atlas verification (`gen:verify`) already proves packing, gutters and anchors,
so a scale bug shows up as a failing check rather than as a subtly wrong game.

### The one thing that would make this hard later

Hardcoded pixel offsets in gameplay code. There are a few today — the sword
pivot height, the carry offset, HUD margins. They are all named constants, and
they should stay that way: the moment a literal `16` appears in a collision test
the reskin gets expensive. Worth a sweep before any HD work starts.

---

## Music

The bed is already modal and per-biome (`audio/music.ts`): a drone plus sparse
notes drawn from a church mode, with mode and root chosen by the biome. That was
the right foundation and it stays. What follows is how it becomes *memorable*
rather than merely atmospheric.

### The principle

> A place should be recognisable by its sound before you read its name.

That is the bar. If you can teleport somewhere with your eyes shut and know where
you are, the music is doing its job.

### Layer 1 — stems, not tracks

Replace the single bed with three synthesised layers mixed independently:

| Stem | Role | Driven by |
|---|---|---|
| **Drone** | the ground the place stands on | biome mode + root |
| **Motion** | sparse plucked notes | exploration; density rises with instability |
| **Pressure** | low pulse, percussive | combat — barred rooms, low health |

Cross-fading stems rather than swapping tracks is what makes combat feel like the
*same place getting worse*, instead of a different song starting.

### Layer 2 — motifs that recur

This is what makes a soundtrack rather than a texture. Three, deliberately few:

- **The Bell of First Dawn** — a falling perfect fourth. Plays at a Draft's
  beginning and, *reversed*, when Aldez dies. The bible has it ringing backward
  when reality breaks; the music should do the same thing literally.
- **Mara's interval** — a rising minor sixth, unresolved. Appears wherever she
  does, in whatever role, at whatever tempo the scene wants. The player should
  come to recognise it before they know why.
- **The Chronicle** — a slow four-note descent, used only for Nagon and the
  Chroniclers. Rare enough to stay unsettling.

Motifs are transposed into the current biome's mode, so they belong to the place
they appear in without losing their shape.

### Layer 3 — the Draft itself as an instrument

The premise is a world being rewritten, and the score can say so:

- Each Draft picks a small **tuning offset** (a few cents) and a **tempo drift**.
  Successive Drafts are recognisably the same music, slightly wrong — which is
  exactly what the player is experiencing.
- Instability detunes the drone further. By the fifth Draft the world sounds
  like a recording that has been copied too many times.

### Layer 4 — the revision scene

Silence, then a single struck tone per line as it is struck through. No bed. The
loudest thing in the game should be the moment the world stops.

### What stays true

- **Synthesised, no files.** Same rule as the art. It also makes the tuning and
  tempo drift above trivial, which sample playback would not.
- **Modal, never major/minor.** Lydian for the Vale is bright and pastoral;
  Locrian for the Undercrown barely resolves. That is the character.
- **It has to survive an hour.** Density stays low by default. A tune you notice
  on minute one is a tune you hate by minute forty.
