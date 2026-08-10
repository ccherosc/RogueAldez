---
name: zelda-feel
description: The concrete reference bar for SNES A Link to the Past game feel — exact frame counts, pixel speeds, hitbox rules, camera and transition behavior, and the combat verbs. Load this when implementing or tuning movement, sword combat, damage, knockback, camera, room transitions, or when acting as a critic judging whether the game "feels like Zelda". This is the bar the Gauntlet critic measures against; vague targets fail, these numbers do not.
---

# The Zelda Bar — A Link to the Past, quantified

The Gauntlet Loop only works when the bar is concrete. "Make it feel like Zelda" is
unjudgeable. These numbers are. A critic cites a number and a builder changes a number.

All timings are **frames at 60 Hz**. All distances are **pixels at 256×224 internal
resolution**. Never express these in seconds in code — use frame counts.

## Presentation

| Property | Value |
|---|---|
| Internal resolution | 256×224 |
| Tile size | 16×16 (composed of four 8×8 sub-tiles) |
| Screen in tiles | 16 wide × 14 tall |
| Player sprite | 16×24 drawn, 16×16 nominal cell |
| Colors per sprite palette | 15 + transparent |
| Color depth | 5 bits per channel (32 levels) — quantize all generated color |

Quantizing to 5-bit channels is not a detail. Unquantized 8-bit color is the fastest way to
make generated art read as "modern indie" instead of "SNES."

## Movement

| Property | Value |
|---|---|
| Walk speed | 1.5 px/frame orthogonal (~90 px/s) |
| Diagonal speed | 1.0 px/frame per axis — **not** normalized to 1.5 |
| Dash (boots) speed | 4.0 px/frame |
| Dash windup | 30 frames of charge before launch |
| Acceleration | none — instant to full speed, instant to stop |
| Facing directions | 4 (sprite), 8 (movement) |
| Turn cost | 0 frames |

**Instant acceleration is the signature.** Link has no momentum, no ease-in, no ease-out.
Any smoothing, lerping, or velocity ramp on player movement is wrong and will be
immediately visible. Resist the instinct to "improve" this.

Diagonal movement being *slower* in total (1.41 px/frame vs 1.5) is authentic SNES
behavior from per-axis stepping. Keep it.

**Tile-edge assist:** when the player walks into a wall corner within 4px of clearing it,
slide them along the wall to clear it. Without this, doorways feel awful. This is the
single highest-value feel fix in the whole movement system.

## Sword combat

| Phase | Frames | Notes |
|---|---|---|
| Windup | 3 | no hitbox |
| Active arc | 6 | hitbox sweeps 180° front arc |
| Recovery | 6 | movement allowed at frame 4 |
| Total swing | 15 | |
| Buffer window | 8 | input during recovery queues next swing |
| Spin charge | 60 | hold attack |
| Spin active | 12 | 360° hitbox, 2× damage |

- The hitbox is a **swept arc**, not a static rectangle in front of the player. It starts at
  the side the swing originates and sweeps across the front.
- Sword extends ~12px beyond the player's body cell.
- **Hitstop on connect: 4 frames** (8 on a spin or boss hit). Freeze both attacker and
  victim; keep particles and UI running. Hitstop is what makes a hit feel like it landed.
- One enemy may only be hit once per swing. Track hit-IDs per swing instance.

## Damage and invulnerability

| Property | Value |
|---|---|
| Player i-frames after hit | 48 |
| Player flash cadence | visible 2 / hidden 2 |
| Player knockback | 24px over 10 frames, ease-out |
| Player control lockout | 10 frames (matches knockback) |
| Enemy hitstun | 12 frames |
| Enemy knockback | 16px over 8 frames |
| Enemy damage flash | pure white, 6 frames |
| Heart unit | 1 heart = 8 subunits; base damage = 4 (half heart) |

Enemy damage flash is a **full white palette replacement**, not a tint or alpha blend. Do it
in the shader with a flash uniform.

## Camera and transitions

- Camera is **room-locked**, not follow-cam. It sits still while the player moves within a
  room. This is core to the ALTTP feel and people get it wrong constantly.
- On crossing a room boundary, the camera **scrolls** to the next room over **16 frames**,
  linear, while the player is nudged 16px through the doorway and input is locked.
- Vertical transitions scroll over 20 frames (taller distance).
- Dungeon-to-dungeon or floor changes use a **hard cut with a 12-frame black fade**, not a
  scroll.
- No camera easing, no look-ahead, no mouse influence, no shake except from `fx/`.

## Screen shake (fx)

| Event | Amplitude | Frames |
|---|---|---|
| Player takes damage | 2px | 6 |
| Enemy death | 1px | 4 |
| Boss slam | 5px | 12 |
| Bomb | 4px | 10 |

Shake is applied to the render camera only. It must never affect simulation or collision.
Decay linearly. Always snap the shaken camera to integer pixels.

## The combat verbs (MVP set)

Ordered by implementation priority. Each must feel complete before the next starts. The
mechanics below are the ALTTP bar; the *framing* is Formcraft — see [[aldez-lore]]. Aldez
doesn't fire magic, he makes a temporary argument against reality, and player-facing text
should read that way.

1. **Sword** — swing, spin charge, hitstop, arc hitbox.
2. **Ward** (shield) — auto-blocks projectiles from the facing direction while not attacking.
   In fiction: tells force to travel elsewhere.
3. **Charge** (bomb) — throw arc, 60-frame fuse, radial damage, destroys cracked walls.
   Ember salt, destabilized.
4. **Bound Wind** (bow) — projectile, consumes ammo, pins to walls briefly. Wind bound into
   a cutting arc.
5. **Mark** (boomerang) — out-and-return, stuns on hit, retrieves pickups on the way back.
   Marks an enemy so its movement can be anticipated.
6. **Dash boots** — charge, launch, breaks pots, stuns on wall impact.

## Enemy roster (MVP set)

Each needs a distinct *counter*, or combat becomes one-note.

These are **Errata** — discarded possibilities trying to establish themselves as real, not
wildlife. In Amberwake Vale (the inviting phase) they stay readable and near-Zelda, which is
the point; coherence degrades as instability rises. Keep the names as internal identifiers
and give them Ostreyan ones in player-facing text.

- **Octorok** — wanders, stops, spits a projectile along its facing. Counter: ward.
- **Moblin** — walks a patrol, charges on line-of-sight, telegraphs 20 frames. Counter: dodge then punish.
- **Keese** (bat) — erratic sine-wave flight, contact damage only. Counter: timing.
- **Stalfos** — hops toward the player, invulnerable while airborne. Counter: patience.
- **Zol** — splits into two smaller Zols on death. Counter: crowd control / spin.
- **Boss: The Harvest King** — Amberwake's boss, assembled from abandoned scarecrows, farm
  tools, and the memories of villagers sacrificed in an erased famine. Three phases, a husk
  that must be broken with charges, telegraphed slam. Counter: everything learned so far.

## Critic checklist

When judging a build against this bar, verify in this order and report the **largest single
gap** first:

1. Does the player stop instantly on key release? (No slide.)
2. Is the camera room-locked and does it scroll on transition?
3. Does a sword hit produce hitstop and a white enemy flash?
4. Does the player flash and get knocked back on damage?
5. Do sprites sit on integer pixels with no shimmer while moving?
6. Is the palette 5-bit quantized and internally consistent per biome?
7. Does the doorway corner-assist work — can you walk through a door without snagging?
8. Are there at least 3 enemy types requiring different counters on screen together?

Related: [[aldez-architecture]], [[visual-critic]], [[art-synthesis]]
