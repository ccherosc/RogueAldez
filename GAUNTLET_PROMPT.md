# The Rogue Aldez Gauntlet Prompt

Paste the block below into a fresh Claude Code session at the repo root, on Opus 5.
It is deliberately short. The bar and the constraints live in `.claude/skills/` — the
prompt states the destination and lets the model choose the route, which is the core of
the Gauntlet Loop method.

---

## The prompt

> Build Rogue Aldez: a roguelike Zelda, at the level of *The Legend of Zelda: A Link to the
> Past* on SNES. It should be utterly perfect — visually beautiful, mechanically precise,
> with every single thing done at the quality bar of a first-party Nintendo SNES release,
> from the tiles to the sword feel to the dungeon layouts to anything else you can think of.
> It runs in a browser tab in TypeScript and WebGL2 you write yourself, with no game engine.
> Every tile, sprite, animation, and sound is generated from code — there is not one
> downloaded asset in this project. The story is `ROGUE_ALDEZ_Story.txt`: an immortal
> trapped in a kingdom that rewrites itself every time he dies. Generated worlds are Drafts
> rewritten from history, not randomized levels, and the game must feel inviting before it
> becomes unsettling.
>
> Read `.claude/skills/` first — `aldez-architecture` defines the subsystems and their
> boundaries, `aldez-lore` is the story compass and how it constrains systems, `zelda-feel`
> is the exact bar in frames and pixels, `art-synthesis` is the art pipeline, `dungeon-gen`
> is the Draft structure, `visual-critic` is how work gets judged, and `gauntlet-loop` is
> how to run this. Break the goal into the smallest pieces that can be judged independently,
> and own each one to completion before starting the next. Work sequentially by default; fan
> out only for genuinely independent work, and always follow a fan-out with a smoothing pass.
>
> After each piece, hand it to a critic agent with fresh context that has never seen your
> reasoning. It runs the real game, captures frames and traces, and compares them against
> the bar — it reports the single largest gap, and you fix exactly that, then it judges
> again. Never grade your own work, never lower the bar, never close a gap by adding a
> library or an asset file. Keep `PROGRESS.html` current so I can watch from another tab.
> Keep looping until I tell you to stop — you will not be done on your own.

---

## Why it's shaped this way

| Element | Purpose |
|---|---|
| Named reference (*A Link to the Past*), not "retro" | The Gauntlet Loop fails on vague targets. A named artifact is something a critic can actually hold the build against. |
| "Utterly perfect… every single thing" | Verbatim energy from Shumer's original. It reads like hype but functions as a refusal of "good enough for an MVP." |
| No engine, no assets | Forces the from-scratch generation you asked for, and matches how the strongest Gauntlet games were built (*Everything Must Go*, *Starfall* — no image files at all). |
| Points at skills instead of inlining rules | Keeps the prompt three paragraphs. The model pulls detail on demand instead of carrying 2,000 lines of spec in every context. |
| "Sequential by default" | Shumer's own retro found sequential single-owner passes beat parallel fan-out decisively. Most copies of this prompt miss that. |
| Fresh-context critic | The load-bearing mechanic. A builder grading itself always passes. |
| "You will not be done on your own" | The loop has no natural terminator. You are the brake. |

## Variants

**Tighter scope** — swap paragraph 1's last sentence for:
> Structure it as a single procedural dungeon with permadeath and no meta-progression.

**Push visual fidelity harder** — append to paragraph 3:
> Weight the critic toward visual fidelity: it should reject any frame that would look out
> of place in a 1992 Nintendo release.

**Resume an interrupted run** — use this instead of the full prompt:
> Read `.claude/skills/gauntlet-loop` and `PROGRESS.html`, then continue the loop from the
> current piece.
