---
name: dungeon-gen
description: Draft, floor, and room generation for Rogue Aldez — the roguelike structure layered onto Zelda's room grammar and driven by the Chronicle fiction. Load this when working on src/gen/ or src/chronicle/, Draft variables, floor layout, room templates, lock-and-key gating, enemy/loot placement, Continuance Relics, or difficulty pacing. Covers the Draft model, the room-graph algorithm, solvability guarantees, pacing curves, and Anchors.
---

# Dungeon Generation — Zelda rooms, rewritten worlds

Structure: **Draft-based procedural dungeons with Continuance Relic progression.** Hades'
run shape wearing A Link to the Past's clothes, driven by [[aldez-lore]]'s Chronicle fiction.

```
Last Certainty (shrine/inn/camp — where Aldez's existence is firmly established)
 └─ Draft  (a rewritten Ostreya, assembled from historical variables)
     ├─ Floor 1  (8–10 rooms)  → key → boss door → miniboss
     ├─ Floor 2  (10–12 rooms) → new item → gates optional rooms
     ├─ Floor 3  (12–14 rooms) → boss
     └─ death → revision scene → next Draft, relics kept, Draft items lost
```

## The Draft is the unit — read this before writing any generator

> The world is not randomly regenerated without meaning. It is rewritten.
> Every variation should feel like another version of the same history.

This is a **hard constraint on the generator**, not flavor. A layout shuffled by noise fails
it. Generation runs in two stages, and the first stage is the one that matters:

**Stage 1 — write the history.** Roll the Draft's historical variables *first*:

| Variable | Example values |
|---|---|
| Ruler of Ostreya | Maeryn / a Maeryn-descended tyrant / a republic / nobody |
| Faction per region | Crown, Lantern Guild, Ash Choir, Keepers of the Ninth Bell, abandoned |
| Settlement survival | which villages exist at all this Draft |
| Mara's role | archivist / thief / queen / prisoner / healer / rebel / Nagon's student / child / ghost |
| Dungeon history | which past use of the site dominates (temple / prison / mine / war engine) |
| Aldez's reputation | hero / monster / stranger / worshipped god |
| Active cracks | which regions are fracturing |

**Stage 2 — derive the map from that history.** Layout, enemy pools, loot, NPC placement,
and dialogue all read *from* the Draft record. A village that didn't survive isn't a
missing tile — it's a graveyard, a flooded field, or a road that bends around nothing.

Store the Draft record in `src/chronicle/`. It is the input to `src/gen/`, and it must be
serializable so a death can diff the outgoing Draft against the incoming one to drive the
revision scene.

### Anchors constrain the roll

Anchors (see [[aldez-lore]]) persist with essence intact and circumstances changed. The
generator must guarantee:

- Anchor characters appear in *some* role every Draft, never absent, never off-essence.
- The Bell of First Dawn and Veyrhold usually exist — vary them rarely and deliberately.
- An Anchor's Draft-to-Draft change should be **legible**: the player must be able to
  recognize Orra as Orra before being told.

## Room grid

A floor is a graph laid onto a **discrete grid of screen-sized rooms** (16×14 tiles each).
Rooms connect only on cardinal edges. No half-rooms, no rooms spanning cells — this is what
keeps the room-locked camera and the 16-frame scroll transition coherent.

Room cells may be **1×1 or 2×1 / 1×2 / 2×2** for boss and set-piece rooms. The camera treats
a multi-cell room as a single locked view only if it fits the screen; otherwise it scrolls
within the room, which is allowed *only* for boss rooms.

## Generation algorithm

Run in this exact order. Each step's output is the next step's input; each is independently
testable.

1. **Skeleton walk.** Random walk from the entrance to place the critical path
   (`6 + floor*2` rooms). Bias against reversing direction (weight 0.15) to avoid coiled,
   claustrophobic paths.
2. **Branch attachment.** Attach side branches of depth 1–3 to critical-path rooms. Target
   ratio: **60% critical path, 40% optional**. Optional rooms hold the rewards — a run where
   exploring isn't rewarded is a corridor.
3. **Special room assignment.** Place, in priority order: boss (deepest cell, farthest from
   entrance), key room, shop, treasure, mini-challenge. Never place a shop or treasure
   adjacent to the entrance — the first room must not be a reward.
4. **Lock placement.** Choose a critical-path edge, lock it, place the key **in a region
   reachable without crossing that edge.** Verify by flood fill. This is the one hard
   correctness constraint in the whole generator.
5. **Room interior fill.** Instantiate each room from a template (below).
6. **Population.** Enemies and loot per the pacing curve.
7. **Validation.** Solvability check. Regenerate on failure, max 20 attempts, then fall back
   to a known-good hand-authored layout for that floor index.

### Solvability — non-negotiable

Before a floor is returned, prove it:

- Flood fill from the entrance using only currently-owned abilities. The boss room must be
  reachable.
- Every key must be reachable before its lock.
- Every room must be reachable from the entrance.
- No room may have zero exits.
- The player must never be able to enter a state with no path forward (e.g. bombing the only
  route out then having no bombs — so: **bomb walls are never the sole route**, and cracked
  walls always have an alternate path or a bomb pickup in the same room).

Assert these in code and fail the generation, don't warn. A soft-locked run is worse than a
boring one.

## Room templates

A template is a **partial** tile layout with slots, not a finished room. The generator fills
slots based on context.

```ts
export interface RoomTemplate {
  key: string;
  size: [w: number, h: number];     // in room cells
  tags: RoomTag[];                  // 'combat' | 'puzzle' | 'treasure' | 'corridor' | 'boss'
  doors: DoorMask;                  // which edges CAN have doors
  layout: string[];                 // ASCII grid: '#' wall, '.' floor, 'P' pit, '~' water
  slots: Slot[];                    // 'enemy' | 'pot' | 'chest' | 'torch' | 'block'
  weight: number;
}
```

- Hand-author **at least 12 combat templates and 8 puzzle templates** per biome. Pure
  algorithmic room interiors read as noise; templates + procedural population is the mix
  that actually works and is what most successful roguelikes ship.
- Templates are mirrored and rotated at instantiation (4 rotations × 2 mirrors = 8 variants
  each) — but only rotate templates tagged `rotatable`, since some puzzles are orientation-
  dependent.
- A template's doors are a *permission mask*. The graph decides which doors actually exist;
  unused edges get walled.

## Pacing

Difficulty is a **curve across the run**, not a constant multiplier. Flat difficulty is the
most common roguelike generation failure.

| Metric | Floor 1 | Floor 2 | Floor 3 |
|---|---|---|---|
| Enemies per combat room | 2–4 | 3–6 | 4–8 |
| Enemy tier mix | T1 only | T1+T2 | T2+T3 |
| Rooms per floor | 8–10 | 10–12 | 12–14 |
| Heart drops per floor | 3 | 3 | 4 |

Additional rules:

- **Never two combat rooms in a row on the critical path** without a breather (corridor,
  treasure, or puzzle) between them. Tension needs release.
- The room immediately before the boss door is always **safe** — no enemies. Players need a
  moment to prepare and it makes the boss land harder.
- Enemy *composition* is chosen for counter-variety: never fill a room with a single type
  above floor 1. Pair a ranged type with a melee type so the player must prioritize.
- Place at least one destructible (pot/bush) in every combat room — it's the pressure valve
  for healing.

## Progression — Continuance Relics

Persisted in `localStorage` under a versioned key. Migrate or reset on version bump.

- **Continuance Relics (permanent):** the meta-progression. Objects carried through a
  powerful fracture become bound to Aldez rather than to the world, so they survive his
  death. Each needs a gameplay effect, a visual identity, a memory from the reality it came
  from, and a tie to a recurring character or event — see [[aldez-lore]]. A relic with stats
  and no memory is unfinished.
- **Reliquary of Selves:** before a Draft, Aldez awakens a *subset* of his relics. He cannot
  carry them all. This is the loadout system and the reason build variety exists.
- **Draft items (lost on death):** the combat verbs from [[zelda-feel]], keys, bombs, arrows.
- **Star amber:** crystallized possibility, found around fractures. The consumable currency
  for the Continuance Forge (Orra's, once she has Echo Memory enough to build it).
- Guarantee: **every Draft must grant at least some star amber**, even a fast death. A Draft
  that yields nothing teaches nothing and reads as punishment rather than progress.

**Difficulty scales with relics, in fiction.** Powerful builds create stronger
contradictions, so the world destabilizes: enemy tiers rise, Errata silhouettes get less
coherent, generation gets stranger. Do not add a separate abstract difficulty multiplier —
derive it from relic load and say so in the UI.

## Variety — Drafts, not modifiers

The failure mode of procedural generation is not "bad rooms," it's "every run feels the
same." The Draft model is the primary defense; these back it up:

- Track template usage per floor; **never place the same template twice on one floor** unless
  the pool is exhausted.
- Each region carries a **Draft condition** derived from its history — occupied, flooded,
  festival, overrun, abandoned — that changes palette, adds a hazard, and swaps the enemy
  pool. Amberwake Vale's set is listed in the bible; use those, don't invent parallel ones.
- Vary room *shape*, not just contents — pits, water channels, and pillar arrangements change
  how a fight plays far more than swapping which enemy stands where.
- **Do not add arcade-style run modifiers** ("enemies drop double, hearts halved"). They read
  as a roguelike UI convention and actively undercut the fiction that this is a rewritten
  history rather than a randomized run. Variation must be explicable as history.

## The revision scene

Death is not a Game Over screen; it is the transition and a headline feature. Diff the
outgoing Draft against the incoming one and render the differences as the world being
rewritten: names crossed out of books, roads redrawn, portraits changing, a river moving
across a map, a living NPC becoming a gravestone, a defeated enemy becoming a celebrated hero.

This is why the Draft record must be serializable and diffable. Design it for that from the
start — retrofitting a diff onto an opaque generator is painful.

Then Aldez wakes at the **Last Certainty**.

## Verification

- Generate 1000 floors headlessly. Assert: zero solvability failures, zero orphan rooms,
  zero soft-locks.
- Log the distribution of floor sizes and room-type mixes — flag if any template appears in
  more than 20% of floors.
- Render 20 generated floors to a contact sheet as minimaps and eyeball them: do they look
  like *different dungeons*, or the same dungeon with pieces moved?

Related: [[aldez-architecture]], [[zelda-feel]], [[visual-critic]]
