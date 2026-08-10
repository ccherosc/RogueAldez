---
name: aldez-lore
description: The story compass for Rogue Aldez — how the Chronicle/Draft fiction constrains game systems, naming, NPC voice, tone pacing, and content generation. Load this before writing ANY player-facing text (dialogue, item names, room descriptions, death screens, UI copy), before designing NPCs, enemies, relics, regions, or bosses, and before deciding how a system should be framed to the player. The full bible is ROGUE_ALDEZ_Story.txt at the repo root; this skill is the development-facing translation of it.
---

# Aldez Lore — the compass

Source of truth: **`ROGUE_ALDEZ_Story.txt`** at the repo root. Read it when you need
detail. This skill exists so you don't have to re-derive design decisions from prose every
time.

## The one line everything answers to

> A life does not become worthless because the world forgets it.

Aldez is an immortal warrior-wizard trapped in a kingdom that rewrites itself every time he
dies. He remembers every version. Nobody else does. If a system, a line of dialogue, or an
art choice doesn't serve that feeling, it's decoration.

**The core emotional beat is not combat.** It is returning to a familiar place and finding
it has become something else.

## The tone arc — non-negotiable pacing

> The game should feel inviting before it becomes unsettling.

The player opens on green fields, working windmills, a harvest festival. Warm. Charming
heroic fantasy. *Then* the cracks show: a woman remembers a conversation from another
reality, a village cemetery holds Aldez's own grave, a child draws Nagon's symbol.

This constrains the art and the first ten minutes directly:

- **Amberwake Vale must look genuinely pleasant.** The current warm-green terrain palette
  is correct — do not darken it "for atmosphere." The warmth is what makes the change land.
- Unsettling elements arrive as **single wrong details in an otherwise normal scene**, never
  as a wholesale shift to a spooky biome.
- Never open on grimdark. Ostreya needs warmth so the player cares when it changes.

Alternate between adventure, wonder, humor, mystery, loss, cosmic unease. Not one register.

## The Draft model — how the world varies

A generated world is a **Draft**, never a "run" or a "level" in player-facing text. Drafts
are assembled from *historical variables*, not from layout noise:

- Who rules Ostreya
- Which faction controls each region
- Which settlements survived, which roads exist
- Which characters are alive, and in what role
- Which dungeon history dominates
- Which reality cracks are active
- Which version of Mara exists
- How the kingdom remembers Aldez (hero / monster / stranger / god)

Every Draft must read as **another version of the same history** — not a different world.
See [[dungeon-gen]] for the generator contract that implements this.

### Anchors

Certain people and places have historical weight and survive rewriting with their
*essence* intact and their *circumstances* changed:

| Anchor | Persists as |
|---|---|
| Mara Venn | curiosity — she always eventually notices the world doesn't make sense |
| Orra Flint | always works metal, whatever her age, species, or station |
| Queen Maeryn | responsibility — even when cruel, she believes she's preserving Ostreya |
| Cael Ordan | continuity above any one person |
| Bell of First Dawn | usually exists |
| Veyrhold | usually becomes the capital |

An Anchor whose essence changes is a bug, not variety.

### Errata — what enemies actually are

Enemies are not wildlife. **Errata are discarded possibilities trying to establish
themselves as real.** Some resemble distorted people; others are impossible combinations of
buildings, creatures, machines, and memories.

Design consequence: as the game destabilizes, enemy silhouettes should get *less* coherent —
parts that don't belong together, seams, doubled limbs. The early Amberwake roster can stay
readable and near-Zelda (the inviting phase); Errata weirdness escalates with instability.

### Echo Memory

Repeated exposure to Aldez, star amber, or major fractures lets NPCs start to remember:
dreams of conversations that never happened, grief for people they never met, skills learned
in another life, fear or affection toward Aldez without knowing why.

This is the emotional payoff system. **Aldez is not rebuilding statistics; he is rebuilding
relationships.** Any NPC persistence model must carry Echo Memory state across Drafts.

## Magic is Formcraft — an argument against reality

Never write magic as raw energy. Formcraft **persuades** reality; it does not overrule it.

- A fire spell doesn't create fire. It convinces heat to gather in one place.
- A heal doesn't restore a body. It reminds flesh of its undamaged form.
- A ward doesn't grant invulnerability. It tells force to travel elsewhere.

The stronger the contradiction, the harder to maintain. This is the in-fiction frame for
cooldowns, resource costs, and spell duration — use it in tooltips and item text.

Aldez's canonical Formcraft verbs: redirect a blow, draw heat from flame, bind wind into a
cutting arc, mark an enemy so its movement can be anticipated, place temporary laws on
objects, command a broken mechanism to remember how it once moved.

## Death is a scene, never a Game Over

> Death should never display only "Game Over."

On death, the player watches the world being revised: names crossed out of books, roads
redrawn, portraits changing, rivers moving across a map, a living NPC becoming a gravestone,
a defeated enemy becoming a celebrated hero. *Then* they wake in the next Draft, at the
**Last Certainty** — a shrine, inn, camp, or marker where his existence was firmly established.

This is a required, authored sequence with real art and UI needs. Treat it as a headline
feature, not a transition.

## Relics carry story, not just stats

Permanent progression = **Continuance Relics** bound to Aldez rather than to the world. Each
one needs four things, and a relic missing any of them is incomplete:

1. A gameplay effect
2. A visual identity
3. A short memory from the reality where it was found
4. A connection to a recurring character or historical event

Aldez selects which to awaken from his **Reliquary of Selves** before a journey. The
collection is a physical representation of his accumulated burden.

**Difficulty scales with relics** — powerful builds create stronger contradictions, so the
world gets more unstable. That is the in-fiction reason enemies get harder and generation
gets stranger. Use it; don't invent a separate difficulty curve.

## Character reference art

`assets/Portrait_Aldez.png` is the **colour and design bible for Aldez**. It is a
reference image, not a runtime asset — nothing loads it, and the zero-assets rule still
holds for everything the game draws. `assets/` is for reference material only; if a file
there ever gets loaded at runtime, that's a bug.

Aldez, from the portrait — hold these when drawing or describing him:

| Feature | Detail |
|---|---|
| Hair | brown, swept, with a **silver-white streak** at the front |
| Eyes | amber/gold |
| Face | weathered, stubbled beard, an **X-shaped scar** on his left cheek |
| Cloak | deep blue, hooded |
| Scarf | crimson, at the throat |
| Armour | dark steel pauldron with gold trim, his left shoulder |
| Body | brown leather straps and belts |
| Magic | a **glowing cyan rune on his gloved hand** — this is Formcraft, visible |

He is emphatically **not** a green-tunic Link analogue. The silver streak, crimson scarf
and blue cloak are the silhouette; at 16px they are what makes him recognisable, which is
why the sprite palette spends its budget there and drops the gold trim and steel tones.

## Naming and voice

Ostreyan names are short, hard-consonant, slightly Anglo-Norse: *Aldez, Mara Venn, Orra
Flint, Cael Ordan, Maeryn, Veyrhold, Venn Tor, Amberwake, Hollowroot, Glassmere, Belliron*.
Chronicler names are softer and vowel-led: *Elowen, Ilyra, Torren, Velis, Sereth, Nagon, Avara*.

Materials are compound-concrete: *bell iron, moonflax, ember salt, glassfish, hollowroot
resin, star amber*. Follow that pattern when inventing.

Time is measured in **bells** (First opens the gates, Third begins trade, Sixth is the
evening meal, Ninth is rung for the dead). Since the fractures, some settlements hear a
**Tenth Bell** at midnight. No physical bell has ever been found. Use bells for any
time-of-day reference.

### Character voice

- **Aldez** — capable, dryly humorous, deeply tired. Not a chosen hero and not a brooder.
  Understatement. He has died enough times to find most threats tedious rather than terrifying.
- **Nagon** — calm, articulate, almost never visibly angry. Speaks through mirrors, still
  water, blank pages, the mouths of defeated Errata, statues whose faces change. He believes
  he is granting freedom, and his argument is genuinely persuasive: *"You call this world
  broken because it changes without your permission. Before me, it remained unchanged without
  theirs."*
- **Mara** — skeptical, sharp, challenges Aldez rather than admiring him.
- **Orra** — warmth and humor, carrying real grief underneath. She sets four extra places at
  dinner and can't remember why.
- **Pell** — a black paper moth of torn Chronicle. **Speaks in incomplete sentences because
  portions of his text are missing.** Comic, misunderstands ordinary phrases. Secretly a
  fragment of Avara, the erased Chronicler of Choice — never telegraph this.

## Hard canon — do not contradict

- Aldez has **no written ending**. He can be wounded and killed; reality cannot finalize his
  absence. He feels every death and remembers all of them.
- Sereth did not write that Aldez survived. She **removed the statement that he died.** The
  distinction matters and pays off in Act Four.
- Chroniclers are **not omnipotent**. Reality resists writing that contradicts what exists;
  change requires a believable chain of causes. A king cannot simply vanish — there must be
  an assassin, an illness, a forgotten war.
- Crackscript writes two mutually exclusive truths into one place. Reality can accept
  neither and discard neither. That is what a crack is.
- Mortals worship the **Seven Hands**, softened religious versions of the Chroniclers. Public
  knowledge that the Chroniclers are physically real would destabilize every institution in
  Ostreya.
- The Empty Seat belonged to **Avara, Chronicler of Choice**. This is a late-game reveal.

## Licensed to invent

Freely: villagers, minor Errata, side dungeons, regional customs, folk songs, recipes,
graffiti, Lantern Guild map annotations, Draft-specific rumors, relic memories for new relics.

Ask first: new Chroniclers, changes to the seven regions or five named bosses, anything that
resolves the Avara mystery early, anything that gives Aldez a written ending.

## Recurring light touches — use these

The bible names them and they're load-bearing for tone: a chef who invents a different
terrible stew every reality; **a dog that always recognizes Aldez**; two elderly rivals who
are friends, enemies, or spouses depending on the Draft; a musician performing songs about
events that never happened; children arguing over contradictory versions of the same folk
hero; Orra increasingly annoyed that Aldez keeps bringing her impossible weapons.

Related: [[dungeon-gen]], [[zelda-feel]], [[art-synthesis]], [[aldez-architecture]]
