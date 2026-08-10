# Rogue Aldez

A roguelike Zelda. Browser, TypeScript, WebGL2, written from scratch. Every tile, sprite,
animation, and sound is generated from code — this project contains no downloaded assets.

Built with the Gauntlet Loop method (somethingbig.ai/gauntlet-loop): a concrete reference
bar, single-owner build passes, and fresh-context critics that judge the running game.

## Skills — read these before working

| Skill | Load when |
|---|---|
| `aldez-architecture` | Before touching anything in `src/` |
| `aldez-lore` | Any player-facing text, NPC, enemy, relic, region, or naming decision |
| `zelda-feel` | Tuning movement, combat, camera, damage — the reference bar |
| `art-synthesis` | Creating or changing any tile, sprite, or palette |
| `dungeon-gen` | Working on Drafts, floors, rooms, relic progression |
| `world-gen` | Biomes, the overworld, placement rules, POIs — the macro world |
| `visual-critic` | Acting as a critic or reviewing build quality |
| `gauntlet-loop` | Running or resuming the iteration loop |

**Story:** `ROGUE_ALDEZ_Story.txt` at the repo root is the canon bible — an immortal trapped
in a kingdom that rewrites itself each time he dies. The `aldez-lore` skill is its
development-facing translation; read the bible directly when you need detail. The story is a
constraint on systems, not a coat of paint: generated worlds are **Drafts** rewritten from
historical variables, not randomized levels.

## Commands

```
npm run dev          # vite dev server
npm run build        # production build
npm run gen:art      # regenerate the sprite/tile atlas (deterministic)
npm run bundle       # single-file build (dist/rogue-aldez.html) for no-network hosts;
                     # republish it to the claude.ai artifact to update the hosted game
npm run capture      # headless screenshots + traces into .captures/
npm run world:sample [seed]   # print one Ostreya: sites, conditions, what is wrong
npm run lint:layers  # enforce subsystem dependency layering
npm run typecheck    # tsc --noEmit
```

## Non-negotiables

- No game engine, no rendering library, no physics library. Zero runtime dependencies.
- No image or audio files. Generated atlas output and deliberate hand-painted overrides in
  `src/art/overrides/` are the only exceptions. `assets/` holds **reference art only** —
  design bible material that nothing loads at runtime.
- No `Math.random()` in `src/` — all randomness comes from seeded streams in `core/rng.ts`.
- Fixed 60 Hz simulation. Timings are expressed in frames, never seconds.
- All rendering snaps to integer pixels at 256×224 internal resolution.
- A builder never grades its own work.

## Current state

**Stages 1–7 of 9** in the `gauntlet-loop` build order are complete. **The full Draft loop
is playable**: a floor generates from the Draft's history, Aldez fights three enemy types,
finds the way down, descends into a harder floor, and when he falls the world is visibly
rewritten and the next Draft begins.

Controls: arrows/WASD move, **Z/Space** swing (hold for a spin), **X/E** lift & throw,
**C/Shift** use item, **Q/Tab** cycle item, **F** fullscreen, **I/F4** invincible (debug),
**F1** debug, **F2** CRT. **Xbox/PS pads work over Bluetooth** — press a button to wake them. Standing still with no swing raises the shield,
which deflects ranged shots back at their owner. In the Reliquary: arrows select, **Z**
awakens, **X** begins. Touch devices get an on-screen pad and buttons automatically.

**ART_SCALE = 4 — HD.** Simulation, layout and UI all speak *world pixels* (a tile is
16, a room 256×224, every zelda-feel number unchanged); the art is authored at **4
texels per world pixel**. Tiles are drawn natively at 64 — real authored detail:
tapered grass blades with root shadows, pebbles with lit crowns and cast shadows,
brick with multi-texel bevels, carved mortar joints, water crests with trailing fades.
Hand-plotted sprites reach density through `upscaleSprite()` (EPX 2×/3× chained).
The framebuffer is `viewport × ART_SCALE` texels; atlas cells and anchors are texels,
divided by `ART_SCALE` in the batcher. Atlas is one 2048×1024 page.

**Tile generators are density-independent.** `len()` scales lengths and noise sample
steps, `dens()` scales scatter counts by area — both keyed off `ART_SCALE`, so feature
size in *world pixels* is invariant and ART_SCALE can move without re-tuning by hand.
Sprite `refine()` marks plot on a **half-world-pixel grid** for the same reason.
`ART_SCALE = 6` was measured and rejected: best at 1080p, but its minimum field needs
1056px of height, collapsing 900p/768p/720p and the artifact frame to a pillarboxed
fallback.

**Sizing (16:9, PC-first).** `computeViewport` walks magnification steps (`ART_SCALE ×
integer scale`) and keeps the **largest** at which the raw field is still ≥ `MIN_VIEW_W`
× `MIN_VIEW_H` (256×176). Height floor is 176, not the room's 224, because the playable
interior is only rows 32..192 — cropping into the barrier band is free and buys a whole
magnification step. Result: 2560×1440 → ×8, 1920×1080 → ×6, 1600×900 → ×4, all ≈1.8
ratio at 98–100% fill, hero 64–128 device px. Phones fall through to ×2 and CSS-shrink
the integer backing (hero ~24px on a 390px screen — the SNES ratio).

**Rim light.** `rimLight()` runs on every sprite after Scale2x: brighten one step up the
pixel's own ramp where the upper-left neighbour is empty, darken where the lower-right
is. One light direction for the whole cast, no colour leaves the palette. Flat cells
(`fx.dim`, shadows, `ui.rule`) opt out with `lit: false`.

**UI scale.** HUD and menu text draw at `UI_SCALE = 0.5` (one texel per world pixel) via
`DrawOptions.scale`. Without it, world-pixel UI grows with magnification and eats a third
of a 1080p screen.

**Map intelligence.** Depth 0 is **always the meadow** — home is the constant the
strangeness is measured against; climate picks the biome from floor two. Every floor
carves a **road along the critical path** (`carveRoad`): it traces the room chain
goal→entrance by decreasing depth, then lays a 2-wide track through each room's real
seam openings, reserving those tiles so decoration can't bury the highway. Spawn is
dressed as the **Last Certainty** — two torches and a crate, placed structurally like
the exit chest rather than via contracts.

**Depth.** Contact shadows are sized to the caster (`fx.shadow` / `.mid` / `.big`,
chosen by `halfW`); trees and critters get them too. Tall terrain — tree, cliff, wall —
throws `fx.wallshade` on the open ground to its south, one light direction applied
consistently. **Character detail** rides `SpriteFrame.refine`, a hook that runs on the
*doubled* buffer after Scale2x: EPX can round a staircase but not invent a cheekbone,
so Aldez's amber eyes, silver strands, scar, cloak folds, pauldron trim and Formcraft
rune are drawn at texel coordinates derived from `drawPlayerBody` geometry. The player
palette stays at its 12-colour cap — eyes and gold trim share `scarf.1`.

**Dynamic lighting.** `render/lights.ts` accumulates a half-resolution light map —
ambient colour plus one additive radial pool per source — which the presenter
multiplies over the graded frame, with a threshold bloom on top. Ambient is *derived
from biome tags* (`Scene.ambientFor`), so a new biome stays one data entry: subterranean
0.34, dark 0.58, daylight 1.0 (outdoors lights only ever add glow). Emitters live in
`Scene.collectLights`: torches with two-sine flicker, teleporter pads, bombs brightening
as the fuse burns, the Colossus eye, blast flashes, and Aldez's Formcraft rune scaled by
how dark the place is. Palette ceiling raised 12 → 28 working colours, and every ramp roughly doubled in
length. The extension is **colour-preserving**: `ramp(2N-1)[2n] === ramp(N)[n]`, so
every index reference was mechanically doubled and existing art is byte-identical —
the new steps sit *between* the old ones, where `brighter()`/`darker()` can reach them.

**Normal-mapped directional light.** `deriveNormals()` builds a normal map per cell
from its own silhouette (chamfer distance transform inward from the edge, normal =
gradient of that field flattened toward the viewer), baked to `atlas-normal.png` with
the same layout. The sprite shader samples it and *modulates* brightness by N·L over
up to 8 lights — it never adds light, because the light-map pass already decides how
bright a place is; this decides which side of a form faces the source. Keeping the two
separate is what stops them double-counting. UI draws with `setNormalMix(0)`.

**Menu** (Esc): Start / Teleport ▸ all biomes / Boss fights ▸ Hulk, Colossus — drawn
over the living hub. Fixtures bypass it. **Dungeon fog:** in `barsRooms` biomes only
the current room renders (plus the previous during the scroll); the rest is black.
**Rebirth hint:** every waking shows one familiar line and one wrong one, drawn from
the Draft's actual variables. Teleporter pads have an arm delay + step-off latch so
arrival can't chain-fire.

**The hub.** Depth 0 of every Draft is a sanctuary: teleporters, fauna, props, zero
enemies. Boot and death both land there; the curve starts on floor two and rises with
depth, Act pressure and instability (enemy HP scales too; Keese stay fragile).

**Big Errata.** `hulk` (32×32, scarce, floor 3+) and `colossus` (48×48, guards every
Act's finale exit). Both use the brute brain — slow walk, 26-frame telegraph, lunge —
and mass-scaled knockback (`Entity.knockScale`). Big kills pay bonus amber, a heart,
and a real screen shake. Per-biome ambient weather drifts across every screen: leaves,
snow, embers, motes (`Particles.drift`, dedicated rng stream).

**Open-world floors are 5×4 rooms** (dungeons stay 3×3). Bushes and flowers are
walk-through but cuttable; lone trees (`prop.tree`) are **armored** — blades and
boomerangs clink off, only a blast fells them. Fauna (sparrows, frogs) is placed
through the same tag contracts as everything else, flees the player, and never spawns
under a fixture. The boomerang stun is 60 frames, interrupts a Moblin's charge, and
stunned enemies visibly shiver.

**Long-term plan:** `ROADMAP.md`. **HD reskin path and music design:** `ART_AND_AUDIO.md`.

**⚠ The world is being rebuilt.** `WORLD_DESIGN.md` is the agreed architecture: one
continuous Ultima-scale Ostreya replacing the floor stack. The governing split is
**Gazetteer (identity, forever) vs Draft (position + condition, per life)** — the same
named places every life, never in the same shape. Placement uses *soft* affinities and
**names the violations** ("a harbour wall with no water behind it") because a thing in
the wrong place is the premise, not a bug. Difficulty is **ring distance from the wake
point**, not depth; there are no gates. Dungeons become interiors entered from the
overworld and keep the existing room-by-room fog. Eight Sanctums hold the eight relics;
the eighth transports you to the Library. Canon: `ROGUE_ALDEZ_Story.txt` Addendum I.

**Edge-matched terrain.** A boundary between two rooms is generated **once**, keyed by
the boundary rather than by either room (`gen/edges.ts`), so both sides carve the same
profile and seams cannot mismatch. Seams may be `full`, `wide`, `gate`, `ragged` or
`closed`; open country prefers the wide ones, which is what stops the world reading as a
chain of islands. Barrier material comes from the biome — water, treeline, cliff or
masonry. Openings never occur within `CORNER_MARGIN` of an edge's ends, because corners
belong to two edges at once and the perpendicular band would seal them.

**⚠ Temporary test scaffold:** three teleporter pads spawn in the opening room and jump
to a random biome with monsters seeded around the arrival. Search `TEMPORARY` in
`game/scene.ts` to remove.

**Acts** are the spine of progression: five regions, each with its own terrain, colour
grade, enemy roster and musical mode. Clearing an Act's floors unlocks the next
permanently — a death costs the floors inside an Act, never the Acts themselves.

**Audio** is synthesised (no files): SFX are wired to the `core/` event bus, and the
ambient bed is a modal drone whose mode and root change per Act.

Done:
- `core/` — seeded sfc32 rng with named substreams, OKLCH→5-bit colour, fixed-60Hz loop, event bus
- `art/` — palettes, tile + sprite generators, atlas packer, contact sheet, dependency-free PNG codec
- `render/` — WebGL2 context, atlas loader, sprite batcher (integer-snapped, flash + alpha),
  room-locked camera with scroll and shake, integer-scaled CRT presenter
- `world/` — tile grid, room addressing, corner-based autotile lookup, ASCII room templates
- `physics/` — AABB tile collision with the doorway corner-assist
- `player/` — input with edge latching, ALTTP-exact movement, walk/idle animation,
  sword with 3/6/6 phases, swept-arc hitbox, input buffering and spin charge
- `entity/` — flat entity store: enemies, projectiles, destructibles, pickups, flash,
  hitstun, knockback
- `ai/` — Octorok (lines up and spits), Moblin (telegraphs then charges), Keese (erratic
  sine flight); brains keyed by entity id so entity/ stays below ai/
- `fx/` — hitstop gate (freezes actors, never particles) and a pooled particle system
- `chronicle/` — the Draft record: historical variables, enemy roster, and a diff that
  drives the death scene
- `worldgen/` — the world builder: tag vocabulary, 16 biomes as pure data, the
  contract filter that makes semantic conflicts unrepresentable, and continuous
  climate fields (elevation/moisture/temperature) that biomes are classified from
- `gen/` — room-graph floor generation derived from the Draft and the biome,
  moat-bounded rooms with four-tile gates, pacing-aware enemy placement
- `ui/` — bitmap font, hearts/amber HUD, banners, and the revision scene
- `game/` — the Draft loop (play → descend → death → revision → next Draft), the
  room-clear lock, and versioned `localStorage` persistence
- 205 atlas cells: 22 base tiles, 47 autotile transitions, 136 sprites/UI cells
- `npm run check` (typecheck + layers + art + 600 generated floors proved solvable)
- `npm run capture` — 33 checks against the running game, each on its own fixture

**Fixture mode.** `?fixture=<id>` loads a sealed, deterministic scenario (see
`src/game/fixtures.ts`): pinned seed, Act, biome, depth, and an exact hand-placed
set of enemies and props. Every capture check runs against one on a fresh page.
The previous harness played one long scripted run and could never be reliable —
proving "you can win a fight" and "a fight can kill you" from a single playthrough
are mutually exclusive. If a check needs a world state, add a fixture for it.
Fixtures never read or write the player's save.
- `npm run gen:check [n]` — generates n floors and proves every room and the exit reachable
- `npm run world:check [n]` — proves the world-builder guarantees: contract coverage,
  reachable tags, placement legality across ~25k placements, climate adjacency sanity,
  and determinism. **Run this after adding a biome** — see the recipe in `world-gen`.

`src/world/area.ts` is the hand-built four-room fixture from stage 3. Nothing loads it now
that floors are generated; it is kept as the worked example of the ASCII room-template
format (`World.loadRoom`) that authored templates will use.

Not started: `audio`. No `PROGRESS.html` yet — it gets created when a long loop starts.

Next: **stage 8** — audio. Web Audio synthesis for sword, hit, break, pickup, damage and
death, plus an adaptive music bed. Then **stage 9**, the polish gauntlet.
See `GAUNTLET_PROMPT.md` to run the loop.
