# Rogue Aldez — the long play

Where this is, what it needs, and the order I would build it in. Written to be
argued with: the sequencing is a claim, not a schedule.

## The honest read on where we are

The **infrastructure is ahead of the game**. Rendering, generation, the world
builder, the Draft loop and the verification harness are all in good shape and
provably correct. What is thin is the part a player actually experiences: one
combat verb, three enemies, no bosses, no NPCs, no reason to explore beyond the
next chest.

That is a much better position to be in than the reverse — content stacks onto
sound foundations cheaply, and foundations retrofitted under content are
agonising — but it should be named. **The next year of work is content and feel,
not architecture.**

Two exceptions where architecture is still owed, both listed in Phase 1.

---

## Phase 1 — finish the combat vocabulary (weeks)

The single-verb problem. Everything below is cheap because the systems exist.

1. ~~**Bombs and boomerang**, with a selectable item slot.~~ **Done.** Bomb has a
   60-frame fuse, a 34px blast that hurts the player too, and destroys props;
   boomerang flies 88px, turns at walls, stuns, drags pickups back, and costs no
   ammo. Nine capture checks cover them.
2. **Bow and dash boots**, completing the six verbs from `zelda-feel`.
   Bombs still need **cracked walls** to open — the classic secret-room use — which
   is a generator feature, not an item one.
3. **A boss.** The Harvest King is already designed in the bible. Runs currently
   have no climax — you descend until you die, which means no mastery payoff and
   no "I almost had it".
4. **Frame-stepped harness.** Capture input is still wall-clock, so checks are
   robust rather than frame-exact. A step-mode that advances exactly N ticks
   would make timing assertions provable rather than probable.
5. **Enemy sprite pass.** The weakest art in the game; heavy outlines make
   everything read as a blob at gameplay scale.

**Done when:** a run has an arc — build a loadout, use four verbs, fight a boss,
win or lose for reasons you can name.

## Phase 2 — make the world inhabited (months)

This is where it stops being a toy. The world builder was designed for exactly
this and none of it is built yet.

1. **Sites.** Villages, graveyards, shrines, mineheads — hand-authored templates
   stamped onto valid biome locations that *inject tags* into their footprint.
   The tag machinery already supports this; `world-gen` has the schema.
2. **NPCs with Echo Memory.** Orra at her forge, Mara leaving notes for herself.
   Per the bible this is the emotional payoff of the entire premise, and nothing
   else in the design substitutes for it.
3. **Randomised side quests.** Generated from the same contract system: a quest
   requires tags to be satisfiable, so "clear the wolves from the north wood"
   cannot be offered where there is no wood. Quests are content, not code.
4. **Region streaming.** A world bigger than memory. Region seeds are already
   keyed by coordinate, which is the hard part.
5. **Scale to 20–30 biomes.** Pure data at that point.

**Done when:** you can walk somewhere for a reason that is not "the exit is that
way".

## Phase 3 — the story lands (months)

1. **The five named dungeons and bosses** from the bible.
2. **Relic depth** — 25–30 relics that change how you play, not just your numbers.
3. **The Anchors paying off** — recurring characters whose changes across Drafts
   the player notices unprompted. This is the moment the premise stops being a
   mechanic and becomes the point.
4. **The four endings**, and the Margin.

## Phase 4 — shippable (months)

Title screen, settings, remappable controls, save slots, accessibility
(colourblind palettes, reduced flashing, difficulty modifiers), performance pass,
and a proper audio mix.

---

## Standing principles

These have earned their place and should survive any replan.

- **Verify, don't assume.** Every guarantee this project claims is a test that
  runs: `gen:check` for solvability, `world:check` for the world builder's
  contracts, `capture` for the running game. Adding a system means adding its
  proof.
- **Make bad states unrepresentable.** The tag system is the model: a tombstone
  cannot appear on unconsecrated ground because no code path can express it.
  Prefer this to detection every time.
- **Data over code.** Biomes, relics, placeables and Acts are all pure data.
  Adding the thirtieth of anything must not touch a generator.
- **The layer linter is not bureaucracy.** It has caught four genuine design
  errors — `physics`→`world`, `gen`→`ai`, `ui`→`game`, and unknown subsystems.
  When it complains, the design is usually wrong.
- **Builders don't grade their own work.** Fresh-context critics against the
  concrete bar in `zelda-feel`.
- **Fixtures over scripted playthroughs.** If a check needs a world state, build
  a fixture for it.

## Known debt

| Item | Cost of leaving it |
|---|---|
| Test teleporters in the opening room | Cosmetic; remove when biomes are reachable by play |
| Capture input is wall-clock, not frame-stepped | Timing checks are robust, not exact |
| 7 tags provided but unused | None — reserved vocabulary, flagged as a warning |
| Enemy art | Readability at gameplay scale |
| No audio mix | Everything is at one level; no ducking |
| Portrait phones letterbox | Landscape is the intended orientation |
