# The World — one Ostreya, endlessly rewritten

The design for replacing the floor stack with a single continuous world: an
Ultima-scale map you cross on foot, holding towns, castles, wilds and dungeons,
which is **the same world every life and never the same shape twice**.

Canon lives in `ROGUE_ALDEZ_Story.txt` (Addendum I). This document is the
engineering translation: what the systems are, why they are split where they
are, and what makes the seeds inexhaustible without being noise.

---

## 1. The central split: identity vs. instantiation

Everything here follows from one separation.

| | **The Gazetteer** | **The Draft** |
|---|---|---|
| Lifetime | Forever. Authored once. | One life. Rerolled on death. |
| Holds | *What exists and what it means* | *Where it is and what state it is in* |
| Examples | Veyrhold is a capital. The Ossuary is a dungeon under a graveyard. Amberwake is a coastal village. | Veyrhold sits at (41, 12), burned, ruled by no one. Amberwake sits inland this time, and is thriving. |
| Seed | `worldSeed` — fixed per save file | `draftSeed` — advances every death |

**The Gazetteer is the memory the player is building.** It is why the second run
is not the first run again: you already know the Ossuary is under a graveyard,
that Veyrhold sits at the meeting of roads, that the Hollowroot Sanctum is deep
and cold. You just don't know *where any of it is this time*.

This is also why the world can be enormous without being exhausting. The player
is not memorising a map — maps die. They are memorising a **place list**, and
place lists survive.

### What a Gazetteer entry is

```
Entry {
  id            'veyrhold'
  name          'Veyrhold'              // never changes, ever
  kind          capital | town | village | keep | sanctum | dungeon | ruin | waypoint
  affinity      soft climate preference: coastal, high, fertile, arid...
  relations     soft: 'downstream of belliron', 'roads to 3+ places'
  tags          what it contributes to placements standing on it
  sanctumIndex? 0..7 for the eight relic sites
}
```

Roughly **60–80 entries**: one capital, four to six towns, a dozen villages,
keeps and waypoints, eight Sanctums, and fifteen or so dungeons. Authored as
pure data, exactly like biomes.

---

## 2. Placing them: soft constraints, and violations become story

The naive approach is to scatter entries at random. That produces nonsense —
a port with no coast, three capitals in a huddle — and nonsense reads as *bug*,
not as *strange*.

The next approach is hard constraints: Amberwake **must** be coastal. That
produces coherence and kills the premise, because then the world is basically
the same map every time.

**We use soft constraints, and we name the violations.**

1. Roll the continuous climate fields from `worldSeed` + `draftSeed`
   (elevation / moisture / temperature — the existing `ClimateMap`, scaled up).
2. Score every candidate cell for every entry against its affinities.
3. Place greedily by *constraint tightness* — Sanctums and the capital first,
   villages last — with jitter proportional to the Draft's **instability**.
4. When an entry lands somewhere its affinity forbids, **do not re-roll it.**
   Record the violation and let the game speak it:

> *Amberwake.* The harbour wall runs for half a mile and there is no water
> behind it.

That is the horror of the premise expressed as a generation rule. A low-
instability Draft looks almost like the world you remember. A high-instability
Draft is a catalogue of things in the wrong place — and the player can *feel*
instability rising across a save without a number ever being shown.

**Violations are content.** This is the single most important mechanic in the
document.

### State

Independently of position, each entry rolls a **condition** from the Draft's
history: `flourishing`, `occupied`, `besieged`, `abandoned`, `burned`,
`drowned`, `buried`, `plagued`. Condition drives tags, NPC roster, enemy
density, music, and the colour grade of the local screens.

The same town, three lives running: a harvest fair; a garrison that turns you
away; a black scar with the bell still standing.

---

## 3. The map itself

**One grid, streamed.** 96×96 rooms of 256×224 world pixels ≈ 24,576 × 21,504
world pixels — several real hours to cross on foot, which is the Ultima feeling.

- Only rooms near the player are ever built. A room is generated on demand from
  `hash(worldSeed, draftSeed, rx, ry)` and discarded when far away.
- **Generation must be positionally pure**: room (41,12) built now and built in
  an hour must be byte-identical. That rules out any global mutable state in the
  generator and is worth a `world:check` guarantee of its own.
- The existing edge system (`gen/edges.ts`) already generates a boundary from
  the boundary's own key, so it extends to an infinite grid unchanged. This is
  the one piece of current architecture that scales to this without edits.

**Biome per room comes from the climate field**, not from a list — so biomes form
continents and coastlines rather than a patchwork, and a desert is somewhere you
walk *into*.

**Sites overwrite terrain.** Where a Gazetteer entry lands, its footprint (1–4
rooms for a village, up to 12 for the capital) is authored structure — walls,
streets, gates — not scattered props. Procedural buildings read as noise; a
castle has to look built.

### Dungeons are interiors

Dungeon and Sanctum entries put a **door** on the overworld. Entering swaps to a
separate, non-streamed interior map — and that is where the current
room-by-room fog, barred doors and 3×3 grid all still apply, unchanged. The
overworld is open and continuous; interiors are tight and hidden. The contrast
is the point, and it means none of the existing dungeon work is thrown away.

---

## 4. Difficulty is distance

No gates. The whole world is walkable from the first step.

```
threat(room) = ringDistance(room, wakePoint) / WORLD_RADIUS   // 0..1
```

Threat drives roster (which Errata exist), scale (HP, count, size), and
coherence — near the wake point the Errata are near-people; at the edges they
are combinations that were never alive. Big Errata become common where threat is
high; Sanctum guardians ignore threat and are simply hard.

Two consequences worth stating:

- **The player is never told where they may go, only shown what it costs.** That
  is a stronger teacher than a locked door and it is how Zelda 1 and Ultima both
  worked.
- **The wake point moves between Drafts**, so the safe region is somewhere new
  each life. The world is not "easy in the south". It is easy *near you*, and
  you are somewhere else now.

The eight Sanctums are seeded at spread ring distances — roughly 0.15 to 0.95 —
so an exploration order emerges from pressure alone, and a bold player can go
for a far relic early and probably die doing it.

---

## 5. Finding things without a map

The map resets every death. That is the loop, and it is only bearable if the
world is *legible*:

- **Roads** connect settlements — the existing `carveRoad` generalises from
  "critical path" to "between Gazetteer entries". Roads are the primary
  wayfinding tool and they visibly lead somewhere.
- **Signposts** at junctions naming the next place and its direction.
- **Landmark silhouettes**: a castle, a peak, a burning town visible from
  several rooms away, drawn on a horizon layer.
- **A Draft map** that fills in as you walk and is destroyed on death.
- **The Chronicle**: what Aldez has *learned*, which never resets. Not a map —
  a list of truths. "The Ossuary lies beneath a graveyard." "Mara always
  eventually notices."

The pain of losing the map is the design. The Chronicle is what stops it being
merely annoying.

---

## 6. Why the seeds don't run out

The space is combinatorial, and — more importantly — the axes are *independent*,
which is what stops variety collapsing into sameness:

| Axis | Rough range |
|---|---|
| Climate fields | continuous; effectively unbounded |
| Position of ~70 entries | astronomically many arrangements |
| Condition per entry | 8 states each |
| Anchor roles | ~6 roles × ~10 Anchors |
| Ruler / faction / era | the existing Draft variables |
| Road topology | derived, differs with every placement |
| Dungeon interiors | seeded per entry per Draft |

But the honest answer to "will it feel endless" is not the arithmetic. It is:

**Variety must be legible, not merely present.** A player cannot perceive 10^40
seeds. They perceive *"Veyrhold is a swamp this time"*. So every axis above has
to produce a difference someone could **say out loud** — which is exactly why
condition, violated affinities and Anchor roles matter more than terrain noise.

That is the design rule for everything added later: **if a variation cannot be
put into a sentence, it is not variety, it is texture.**

---

## 7. Build order

Each step is playable on its own and none of them throws away existing work.

1. **Gazetteer + placement solver.** Data file, soft-constraint placement, a
   `world:check` guarantee that every entry lands and Sanctums are reachable.
2. **Streamed overworld grid.** Positionally-pure room generation; retire the
   floor stack; keep interiors as they are.
3. **Sites as authored footprints.** Villages, keeps, the capital.
4. **Distance threat curve.** Replace depth-based scaling.
5. **Roads, signposts, landmarks, the Draft map.**
6. **The Eight + Sanctum guardians.** Relic persistence across death.
7. **Anchors, conditions, and the Chronicle.**
8. **The Library and the Chronicler of Endings.**

Steps 1–2 are the foundation and the riskiest; everything after is content
riding on them.

---

## 8. Progress

**Step 1 is done.** `worldgen/gazetteer.ts` (25 named places including the eight
Sanctums) and `worldgen/placement.ts` (soft-affinity solver, recorded violations,
ring threat). Seven guarantees in `world:check` cover it: every entry places, no
two overlap, all eight Sanctums exist, they spread outward (mean threat
0.21 → 0.90), violations stay rare (~4 per world), the same seed rebuilds
identically, and a new Draft moves every site. `npm run world:sample [seed]`
prints one Ostreya.

**Step 2 is half done.** `gen/floor.ts :: generateRegion()` builds a window of
continuous overworld: biome per room from the climate field, every seam
connected, difficulty from ring distance, Gazetteer sites stamped where the
solver put them. It is **not yet wired into play** — the floor stack still runs
the game.

### The one thing blocking step 2

**Windows must agree about ground they share.** Two properties are already true:
a window rebuilds byte-identically, and seams are keyed by *world* boundary
coordinate so two windows roll the same coastline. Two more are not:

- `sealUnreachable` / `pruneStrandingProps` flood-fill from the player, so their
  result depends on where the window was centred. **Removed from the region
  path** — they exist to prove a *closed floor* is solvable and a continuous
  world has no boundary for that claim to be about.
- **Something still differs, and it is not any of the obvious three.** Ruled out
  so far, each verified by a separate change that did not fix it:
  1. *Seam keying* — profiles are now seeded from the boundary's world key.
  2. *Global flood fills* — `sealUnreachable` and `pruneStrandingProps` removed
     from the region path, along with the write that forced the arrival tile to
     ground. All three were window-relative; none was the cause.
  3. *Reservation* — `reserved` now derives only from world-fixed things (the
     waking place, site footprints), not from where the player walked in.

  **Next suspects, in order:** (a) `rng.stream()` mixes the *parent's live state*
  into the substream seed (`buildSfc32(hash(name), sb ^ hash(name), sc, sd)`), so
  any call that advances the parent before a stream is taken shifts every stream
  after it — the fix would be to derive substreams from the name alone;
  (b) `decorate`/`addInterior` may consult neighbouring tiles that fall outside
  the window and therefore read as barrier at one origin and ground at another —
  a genuine edge-of-window problem that needs a one-room generation margin.

  4. *Missing apron* — edge rooms had no neighbour in the window, so their outer
     seams rolled closed and a room came out interior from one approach and
     walled from another. `EdgeMap` now takes `assumeNeighbours`, and the world
     correctly continues past the window (walkability rose 70% → 75%, confirming
     it took effect). **Still not the cause.**

  **Where to look next.** Four plausible causes are eliminated, each by a change
  that was independently correct and is worth keeping. The remaining candidate is
  `rng.stream()`: it seeds a substream as
  `buildSfc32(hash(name), sb ^ hash(name), sc, sd)` — mixing in the parent's
  *live* state. Every substream in a region is therefore a function of how many
  numbers the parent had drawn when it was taken, which is stable within one
  window and has no reason to be stable across two. Deriving substreams from the
  name alone would make every generator in the project positionally pure, not
  just this one, and is the first thing to try.

  Worth stating plainly: a windowed generator is only correct if **every write is
  a pure function of world coordinates**. Each fix above removed one violation of
  that rule. The discipline is right even though the bug is still open.

Until that lands, `world:check` reports the disagreement as a **warning**, so the
suite keeps telling the truth about what is shipped without hiding the gap.
