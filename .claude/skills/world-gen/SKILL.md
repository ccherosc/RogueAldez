---
name: world-gen
description: The macro world architecture for Rogue Aldez — seeded biome fields, the tag-contract system that makes semantic conflicts impossible, site templates for villages/castles/graveyards, and how the world map derives from a Draft. Load this when working on src/worldgen/, biomes, region layout, placement tables, spawn rules, POIs, or anything about how the overworld fits together. For a single dungeon floor's room graph, see dungeon-gen instead.
---

# World Generation — biomes without contradictions

`dungeon-gen` covers one floor. This covers the world those floors sit in: an
expansive, seeded Ostreya of 20–30 biomes that has to stay *coherent* — no
tombstones in open desert, no sand-scorpions in a pine wood, no glacier bordering
a salt flat.

## The governing principle

> Make a conflict **structurally impossible**, not **detected**.

A validator that finds a tombstone in a desert is a strictly worse design than a
placement query that could never have returned that tombstone. Detection scales
badly: every new biome multiplies the pairs you have to check, and the failure
only surfaces on the seed a player happens to roll. Make the generator unable to
express the bad state and the problem disappears at any scale.

Everything below is in service of that.

## Layer 1 — continuous fields (prevents *geographic* nonsense)

Do **not** pick biomes from a list per region. Generate continuous scalar fields
across the world and classify from them:

```
elevation   domain-warped fbm, plus a continental mask
moisture    fbm, biased by distance to water and by prevailing wind off elevation
temperature latitude gradient, minus an elevation lapse rate
fertility   derived: moisture x temperature, penalised by extreme elevation
```

Classify with a Whittaker-style lookup — the standard climate model. Because the
fields are continuous, **impossible neighbours cannot occur**: you never get
desert abutting glacier, because temperature cannot jump. Rain-shadow deserts
land behind mountains for free, swamps land in low wet basins for free, and you
get those for nothing rather than by writing adjacency rules.

Rule: if two biomes must never touch, that is a signal their classifier bands are
wrong — fix the field, don't add a special case.

## Layer 2 — biomes are data, not code

A biome is a record. Adding the twenty-fifth biome must be a data edit, never a
new branch in the generator.

```ts
export interface Biome {
  id: BiomeId;                  // 'pine-wood', 'salt-flat', 'fen'
  band: { elevation: Range; moisture: Range; temperature: Range };
  palette: PaletteRef;
  terrain: { ground: TileKey[]; scatter: TileKey[]; water: TileKey };
  /** tags this biome contributes to every tile in it */
  provides: Tag[];
  /** weighted spawn tables, filtered by the tag contract at query time */
  props: WeightedTable<PropId>;
  enemies: WeightedTable<EnemyId>;
  /** site templates allowed to be stamped here */
  sites: SiteId[];
  ambience: { musicBed: string; loopSfx?: string };
}
```

Registries live in `src/worldgen/biomes/`, one file per biome, exported through
an index. A biome that needs generator changes to work is badly specified.

## Layer 3 — tag contracts (prevents *semantic* nonsense)

This is the part that solves your tombstone problem.

Every placeable declares what context it needs. Every context declares what it
offers. Placement is a filter, and the filter is the whole mechanism.

```ts
export interface Placeable {
  id: string;
  requires: Tag[];   // ALL must be present
  forbids: Tag[];    // NONE may be present
  weight: number;
}

// A tombstone is not "a graveyard prop" by convention — it is unplaceable
// anywhere that does not actively provide `consecrated`.
{ id: 'prop.tombstone', requires: ['consecrated'], forbids: ['flooded'], weight: 3 }
{ id: 'enemy.sand-crawler', requires: ['arid'], forbids: ['forested'], weight: 5 }
{ id: 'prop.cattail',       requires: ['wetland'], forbids: [], weight: 8 }
```

Tags come from three sources, unioned per tile:

1. **Biome** — `pine-wood` provides `forested`, `temperate`, `wild`.
2. **Site** — a stamped graveyard provides `consecrated`, `settled` inside its
   footprint only. This is why tombstones appear in graveyards and *only* there.
3. **Draft** — the historical variables in `chronicle/` provide world-wide tags:
   a `flooded` condition adds `flooded`, an `occupied` Vale adds `patrolled`.

```ts
const tags = union(biome.provides, site?.provides ?? [], draft.tags);
const table = biome.props.filter(p =>
  p.requires.every(t => tags.has(t)) && !p.forbids.some(t => tags.has(t)));
```

**A conflict is now unrepresentable.** There is no code path that places a
tombstone on an unconsecrated tile, so no seed can produce one.

### Tag discipline

- Tags are **vocabulary, not flags**. Keep one canonical list in
  `src/worldgen/tags.ts` with a comment per tag. Two tags meaning the same thing
  is how this system rots.
- Prefer **describing the place**, not naming the content: `arid`, `forested`,
  `wetland`, `consecrated`, `settled`, `ruined`, `subterranean`, `patrolled`,
  `high-altitude`. Never `desert-stuff`.
- If a placeable needs a tag no biome provides, that is a **content bug** and the
  validator should say so loudly — see Layer 5.

## Layer 4 — sites are authored, terrain is generated

Villages, castles, graveyards, monasteries, mines and shrines are **hand-authored
templates** stamped onto valid locations. Procedural buildings read as noise; a
castle has to look built.

```ts
export interface Site {
  id: SiteId;
  footprint: [w: number, h: number];   // in room cells
  requires: Tag[];                      // where it may be stamped
  provides: Tag[];                      // what it grants inside its footprint
  layout: RoomTemplate[];
  anchor?: AnchorId;                    // for Bell of First Dawn, Veyrhold, ...
}
```

Placement: score candidate locations by biome fit and distance from other sites,
take the best, stamp, then re-derive tags in the footprint. A graveyard stamped
into a pine wood makes its own tiles `consecrated` while the surrounding wood
stays `wild` — so tombstones cluster inside the wall and never outside it.

**Anchors** (see [[aldez-lore]]) are sites with an `anchor` id. Their placement is
constrained rather than free: the Bell of First Dawn and Veyrhold must exist in
almost every Draft, so they are placed *first*, and the terrain accommodates them.

## Layer 5 — seeds and determinism

The whole world derives from one seed via named substreams (`core/rng.ts`
already supports this):

```
worldSeed
 ├─ stream('fields')       elevation / moisture / temperature
 ├─ stream('sites')        site selection and placement
 ├─ stream(`region:${x},${y}`)   local terrain and scatter
 └─ stream(`floor:${siteId}:${depth}`)  dungeon interiors
```

Two rules, both load-bearing:

- **Region streams are keyed by coordinate, never by visit order.** Region (4,7)
  must generate identically whether the player reaches it first or fiftieth, or
  the world changes behind them.
- **Never draw the world from a stream something else also uses.** Adding a
  particle effect must not shift where a castle lands. This is the single most
  common determinism bug and the reason substreams exist.

A seed string is the whole world. `?seed=ostreya-7` reproduces it exactly — that
is the share-and-replay feature, and it costs nothing if the rules above hold.

## How this meets the Draft model

Geography is part of the rewrite. The bible is explicit: rivers change direction,
villages move, a dungeon appears where a lake was. So:

```
Draft (chronicle/)  ->  worldSeed  ->  fields  ->  biomes  ->  sites  ->  regions
```

Each Draft regenerates the map. What survives is the **Anchors** — essence intact,
circumstances changed. Veyrhold is usually the capital; which biome it sits in,
and whether it is a thriving city or a ruin, is the Draft's business.

## Validation — Layer 3 makes conflicts impossible, this proves it

Extend `scripts/gen-check.ts`. Generate thousands of worlds and assert:

1. **Contract coverage** — every placeable's `requires` set is satisfiable by at
   least one biome+site combination. Catches content that can never appear, which
   is silent and invisible in play.
2. **No orphan tags** — every tag in the vocabulary is provided by something and
   required by something.
3. **Placement legality** — sample placed entities and re-check their contract
   against the tags actually present. This should be *impossible* to fail; if it
   ever does, a placement path bypassed the filter.
4. **Biome adjacency sanity** — record the adjacency matrix over many seeds and
   flag pairs that should never touch. A hit means a classifier band is wrong.
5. **Reachability** — every site reachable from spawn without noclip.
6. **Determinism** — generate the same seed twice, deep-compare.

## Adding a biome — the recipe

This is a **data edit**. If you find yourself changing `gen/floor.ts` to make a
biome work, either the biome is badly specified or the schema is missing a field —
fix that instead, or every future biome pays the same tax.

**1. Add the entry** to `src/worldgen/biomes.ts`:

```ts
{
  id: 'ashfall', name: 'The Ashfall Barrens', act: 3,
  // Where it sits in climate space. Overlapping other biomes is fine — the
  // classifier takes the closest fit, so they simply compete.
  elevation: [0.5, 0.8], moisture: [0.0, 0.25], temperature: [0.6, 0.9],
  // What the *place* is. Never what is in it.
  provides: ['arid', 'hot', 'barren', 'rocky', 'wild'],
  grade: [1.08, 0.94, 0.8],     // the mood, one multiply over the whole frame
  ground: 'dirt', moat: 'wall',
  features: ['clearing', 'pillars'],
  propDensity: 0.4,
  mode: 'phrygian', root: 116.54,
}
```

**2. Run `npm run world:check`.** It will tell you if:
- nothing can spawn there (`every biome supports at least one enemy`)
- the tags contradict each other (`no biome contradicts itself`)
- it made an impossible neighbour (`no climatically impossible biome adjacency`)

**3. Add content only if the biome needs its own.** A new placeable declares what
kind of place it belongs in, never which biome:

```ts
{ id: 'ash-drift', kind: 'prop', key: 'prop.rock', weight: 8,
  requires: ['arid'], forbids: ['wetland'] }
```

Several placeables may share one sprite — rubble, a fallen log and a boulder are
all `prop.rock`. The generator records which *placeable* authorised each
placement (`Prop.sourceId`), because a sprite key cannot identify the contract.

**4. Re-run `npm run check`.** `gen:check` sweeps every biome for solvability;
`world:check` re-inspects tens of thousands of placements against the tags that
were actually present.

### Things that mean you got it wrong

| Symptom | What it actually means |
|---|---|
| A biome needs a special case in the generator | The schema is missing a field |
| Two biomes must never touch | A classifier band is wrong — fix the field, not the adjacency |
| Content needs a "place anyway" flag | The contract is wrong. There is deliberately no escape hatch |
| A tag means the same as another | Delete one now; two names for one idea is how this rots |
| `every tag content depends on is reachable` fails | You wrote a rule that can never fire |

## Build order, when this lands

Do not build all thirty biomes at once. The infrastructure is the hard part; the
biomes are then cheap and additive.

1. Fields + classifier with **three** biomes (field, wood, marsh). Prove the
   pipeline end to end.
2. Tag vocabulary + contract filter, with the validator from Layer 5 in place
   before content volume grows.
3. Site stamping with one site (a village), then a graveyard specifically to
   prove `consecrated` gating works.
4. Region streaming so the world is bigger than memory.
5. *Then* scale to 20–30 biomes as pure data.

Related: [[dungeon-gen]], [[aldez-lore]], [[aldez-architecture]]
