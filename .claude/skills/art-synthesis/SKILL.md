---
name: art-synthesis
description: How Rogue Aldez generates every tile and sprite from code — seeded procedural synthesis baked to a deterministic atlas, with hand-editable PNG overrides. Load this before creating, regenerating, or tweaking ANY visual asset, palette, tileset, or spritesheet. Covers the SNES palette discipline, the 16x16 tile contract, autotiling bitmasks, sprite rigging, the atlas pipeline, and the override system. There are no image files in this project except generated output and deliberate overrides.
---

# Art Synthesis — every pixel is generated

The Gauntlet Loop reference games ship **zero art assets**. Claude of Duty generates all
textures, meshes, and animations at load. *Everything Must Go* — "every texture is drawn in
code, there isn't a single image file." Rogue Aldez follows this, with one deliberate
addition: we **bake to a committed atlas** so art is diffable, reviewable, and hand-editable.

## The pipeline

```
src/art/palettes.ts   ─┐
src/art/tiles/*.ts     ├─ npm run gen:art ─→ public/atlas/atlas.png
src/art/sprites/*.ts  ─┘   (seed = ART_SEED)            atlas.json
                                                         atlas.hash
src/art/overrides/*.png ───────────────────→ composited last, wins
```

- `ART_SEED` is a **fixed constant** in `src/art/seed.ts`. It is *never* the run seed. Art
  must be byte-identical on every machine and every run.
- `gen:art` runs in Node using a headless canvas, writes `atlas.png` + `atlas.json`, and
  writes `atlas.hash` (a hash of generator source + seed + overrides).
- The dev server checks `atlas.hash` on boot and **fails loudly** if the generators changed
  without a regen. Silent art drift is the enemy.
- Anything in `src/art/overrides/` named to match an atlas key replaces that cell verbatim.
  This is your escape hatch: generate everything, then hand-paint the three tiles that
  aren't landing.

## Palette discipline

This is the difference between "SNES" and "generic pixel art." Get it right first; it
constrains everything downstream.

- **Quantize every channel to 5 bits** (32 levels). `q = Math.round(c / 8) * 8` after
  clamping. Do this as the final step of every color computation, no exceptions.
- A palette is **15 colors + transparent**. Not 16. Index 0 is always transparent.
- Build each palette as a **ramp**, not a set of unrelated colors: pick a hue, then generate
  4–5 steps of shadow → midtone → highlight. Shift hue *along* the ramp — shadows go cooler
  and toward blue/purple, highlights go warmer and toward yellow. Pure-value ramps (same hue,
  varying lightness only) look flat and dead, and this is the most common failure.
- Each biome gets one 15-color palette shared across all its tiles. Sprites get their own.
- Define palettes in `src/art/palettes.ts` in **OKLCH**, convert to sRGB, then quantize.
  Perceptually even ramps come out much better than eyeballed hex.

```ts
// A ramp done correctly: hue shifts cool→warm as value rises.
export const GRASS = ramp({
  steps: 5,
  from: { L: 0.28, C: 0.06, H: 155 },   // shadow: cooler, desaturated
  to:   { L: 0.82, C: 0.13, H: 118 },   // highlight: warmer, more chroma
});
```

## Tiles

Every tile is 16×16, drawn by a pure function into a 16×16 buffer.

```ts
export interface TileGen {
  key: string;                    // 'grass.base', 'wall.stone', 'floor.dungeon'
  palette: PaletteRef;
  variants: number;               // 3–4 per tile; break visible repetition
  draw(px: PixelBuffer, rng: Rng, variant: number): void;
}
```

Rules that make generated tiles read as hand-drawn:

- **Tiles must be seamlessly tileable.** Any noise or pattern sampled must wrap: sample
  `noise(x % 16, y % 16)` on a torus, not on open 2D space. Test by drawing a 4×4 grid of
  the same tile and looking for seams.
- **3–4 variants minimum per ground tile.** A single tile repeated across a room is the
  loudest possible "this is procedural" tell. Scatter variants with low-frequency noise so
  they cluster naturally rather than checkerboarding.
- **Detail belongs at the 2×2 pixel scale, not 1×1.** Single-pixel noise reads as dithering
  artifacts / video noise. Clumped 2×2 detail reads as texture.
- **Interior contrast should stay low; edges carry the contrast.** Flat-ish interior with a
  crisp darker bottom/right edge is what sells depth in a top-down SNES tileset.
- Dark outline on the **bottom and right** only (light source is upper-left). Consistency of
  light direction across every tile matters more than any individual tile's quality.

### Autotiling

Terrain transitions use a **47-tile blob autotile set** driven by an 8-bit neighbor mask.
Generate all 47 from the base + edge generators — do not hand-enumerate them.

```ts
const mask = (n<<0)|(ne<<1)|(e<<2)|(se<<3)|(s<<4)|(sw<<5)|(w<<6)|(nw<<7);
const tile = BLOB47[maskToBlobIndex(mask)];
```

Corner cases (`ne` set but `n` and `e` clear) must resolve to an inner-corner tile, not the
full-edge tile. Getting this wrong produces the classic "chewed edges" look.

## Sprites

Sprites are generated from a **skeleton + part** description, not drawn frame by frame. This
is what makes animation tractable without an artist.

```ts
export interface SpriteGen {
  key: string;                    // 'player', 'octorok', 'moblin'
  cell: [w: number, h: number];   // 16x24 for player, 16x16 typical enemy
  palette: PaletteRef;
  dirs: 4;                        // down, up, left, right (right = mirrored left)
  anims: Record<string, AnimGen>; // 'idle' | 'walk' | 'attack' | 'hurt' | 'die'
}
```

- Build a **part hierarchy** (torso, head, arm, weapon), pose it per frame with small
  integer offsets, and rasterize. A 4-frame walk cycle is: contact, down, passing, up —
  with a **1px vertical body bob** on the passing frames. That bob is 80% of the readability.
- **Mirror left→right.** Never generate both; asymmetric mirroring is a classic tell.
- Every sprite gets a **1px dark outline** on all sides — sprites need to separate from
  tiles, unlike tiles which only outline bottom/right.
- Reserve palette index 1 as the outline color and index 14/15 as the flash-white pair so
  the damage-flash shader can swap deterministically.
- Generate a **shadow** as a separate 2-frame ellipse sprite; don't bake it into the body.

### Required animation set (MVP)

| Anim | Frames | Notes |
|---|---|---|
| idle | 2 | slow, 30-frame hold each |
| walk | 4 | 6-frame hold, 1px bob |
| attack | 3 | matches the 3/6/6 sword phases |
| hurt | 1 | plus shader flash |
| die | 4 | ends on a puff of particles |

## The atlas

- Pack with a **shelf/skyline packer**, power-of-two page, 2px transparent gutter between
  cells to kill bleeding at non-integer UVs.
- `atlas.json` maps `key → {page, x, y, w, h, anchor}`. Anchors matter: a 16×24 player
  sprite anchors at `(8, 22)` — feet, not center.
- Keep pages under 2048×2048. Prefer one page.
- Emit a **contact sheet** at `public/atlas/contact.png` — every cell labeled, laid out in a
  grid. The visual critic reads this to judge art without launching the game.

## Verification before you call art done

1. Regenerate twice, diff the PNGs — must be byte-identical. If not, you have unseeded randomness.
2. Tile a 4×4 grid of each ground tile — no visible seams, no obvious repetition.
3. Confirm every color in the atlas is 5-bit quantized (script it; don't eyeball).
4. Check light direction is upper-left on every tile and sprite.
5. Open `contact.png` — can you tell what each sprite is at 1× zoom, no labels?
6. Put the player sprite on each biome's ground tile — does it separate clearly? If a sprite
   disappears into the floor, the sprite palette needs more value contrast against terrain.

## What NOT to do

- Do not download, embed, or base64 any external art.
- Do not use `Math.random()` in a generator. Use the passed `rng`.
- Do not add a runtime art generation path — art is baked at build time and loaded as a texture.
- Do not skip variants "for now." Repetition is the defining flaw of generated tilesets and
  it is much harder to retrofit than to build in.

Related: [[aldez-architecture]], [[zelda-feel]], [[visual-critic]]
