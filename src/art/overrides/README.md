# Hand-painted overrides

Drop a PNG here named exactly after an atlas cell and it replaces the generated art
for that cell, verbatim. This is the tweak path: generate everything from code, then
paint over the handful of cells that aren't landing.

```
src/art/overrides/player.down.idle.0.png   -> replaces that cell
src/art/overrides/grass.base.2.png         -> replaces that cell
```

Then `npm run gen:art`.

Rules:

- The filename must match a cell key exactly. Cell keys are listed in
  `public/atlas/atlas.json`, and a mismatch prints a warning rather than failing
  silently.
- RGBA or RGB, 8 bits per channel, not interlaced.
- Any size — the packer uses the override's dimensions. Keep the anchor in mind
  though: it still comes from the generator, so a differently-sized override will
  shift where the sprite sits relative to its feet.
- **Quantize to 5 bits per channel** (32 levels, multiples of 8.226) or the sprite
  will read as out-of-era next to the generated art. `npm run gen:verify` fails on
  unquantized pixels, including in overrides.
- Overrides are hashed into `atlas.hash`, so editing one correctly invalidates the
  atlas and the dev server will tell you to regenerate.

To go back to the generated version, delete the file and regenerate.
