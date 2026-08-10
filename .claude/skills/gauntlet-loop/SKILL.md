---
name: gauntlet-loop
description: Run the Gauntlet Loop on Rogue Aldez — the build/critique iteration method behind Claude of Duty. Load this to start or continue a long autonomous improvement run, or when asked to "run the loop", "iterate", "improve until it matches Zelda", or to orchestrate builder and critic agents. Defines decomposition, the builder/critic split, sequencing strategy, progress reporting, and stopping rules.
---

# The Gauntlet Loop, applied to Rogue Aldez

Source method: Matt Shumer's Gauntlet Loop (somethingbig.ai/gauntlet-loop), the technique
behind Claude of Duty — ~55k lines, 11 subsystems, zero art assets, built by orchestrated
agents against a concrete reference bar.

## The loop

```
   decompose ─→ build one piece ─→ fresh critic vs. the bar ─→ largest gap?
        ↑                                                          │
        └──────────────────── yes: fix that one gap ───────────────┘
                              no: next piece
```

1. **Decompose** the goal into the smallest pieces that can be *judged independently*.
   Decompose by subsystem (see [[aldez-architecture]]), never by file type. "Make the sword
   feel right" is a piece. "Update all the TypeScript files" is not.
2. **Build** one piece. One owner. Complete it.
3. **Critique** with a fresh-context agent running [[visual-critic]] against [[zelda-feel]].
   The critic sees the running game, not the builder's account of it.
4. **Fix the single largest gap.** Not the list. The largest one.
5. **Repeat** until the critic says AT BAR, then move to the next piece.

## Sequential over parallel — read this before fanning out

Shumer's own retro on Claude of Duty: **"Sequential single-owner passes beat parallel
fan-out decisively"** — one focused agent outperformed three rounds of parallel work. Most
people copying this method miss that line and fan out by default.

Apply it here:

- **Default to sequential.** One subsystem, one owner, taken to AT BAR before the next.
- **Fan out only for genuinely independent, non-integrating work** — e.g. generating six
  unrelated enemy behaviors that share no state, or authoring room templates.
- **Never fan out across a shared interface.** Two agents editing `render/` and `player/`
  simultaneously will produce a merge that neither validated.
- After any fan-out, run a **smoothing pass**: one agent reads all the parallel output and
  makes it consistent — naming, tuning values, visual coherence. Skipping this is why
  fanned-out work looks like it was made by a committee.

## Build order for this project

Dependency-ordered. Each stage must be *playable and verifiable* before the next begins —
never build three subsystems before running the game once.

| # | Piece | Done when |
|---|---|---|
| 1 | `core` + `render` + a white square | A square moves on screen at a locked 60Hz, integer-snapped |
| 2 | `art` synthesis + atlas | `contact.png` shows recognizable tiles and a player sprite |
| 3 | `world` tilemap + `physics` | Player walks a tiled room, collides with walls, corner-assist works |
| 4 | `player` sword + `fx` hitstop | Swinging at a dummy produces hitstop + white flash |
| 5 | `ai` enemies | 3 enemy types with distinct counters, fightable |
| 6 | `chronicle` + `gen` floors | A Draft rolls its history, a floor derives from it, is solvable, room transitions work |
| 7 | `ui` + `game` Draft loop | Hearts, the revision scene on death, Last Certainty, relics persist |
| 8 | `audio` | Synthesized SFX on every verb; adaptive music |
| 9 | Polish gauntlet | Loop stages 1–8 against the bar until AT BAR everywhere |

## Progress reporting

Maintain `PROGRESS.html` at the repo root — a self-contained live page the user can open in
a browser tab and refresh without interrupting the run. This is the Gauntlet Loop's
observability requirement, and it matters more than it sounds: a long run you can't watch is
a long run you can't trust.

It must show, per piece: current status, iteration count, last critic verdict, the current
largest gap, and thumbnails of the latest captures.

## Stopping rules

The loop does not converge on its own — **the human is the brake.** But stop and surface to
the user when any of these hit:

- The critic returns AT BAR on the same piece twice consecutively.
- The same gap survives **3 consecutive fix attempts** → stop fixing, change strategy, and
  say so explicitly. Repeating a failing approach is the loop's main failure mode.
- A change requires a decision the bar can't settle (a design/flair question that's the
  user's call, not a fidelity question).
- Anything irreversible or outside the repo.

Never stop merely because a piece "seems good enough." Never silently lower the bar.

## Guardrails

- Every iteration ends with the game **running**. A broken build is not an iteration.
- Run `npm run lint:layers` and `tsc --noEmit` before declaring a piece done.
- Never let a builder mark its own work AT BAR.
- Do not invent scoring rubrics, point systems, or round ledgers — judge against the bar.
- Do not add dependencies, engines, or asset files to shortcut a gap. Closing a gap by
  importing a library defeats the exercise.

Related: [[aldez-architecture]], [[zelda-feel]], [[art-synthesis]], [[dungeon-gen]], [[visual-critic]]
