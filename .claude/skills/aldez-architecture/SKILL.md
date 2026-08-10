---
name: aldez-architecture
description: Subsystem layout, module boundaries, and coding conventions for Rogue Aldez. Load this BEFORE writing or modifying any game code — it defines which subsystem owns what, the dependency rules that keep parallel agents from colliding, the fixed-timestep loop contract, and the determinism rules. Triggers on: adding a system, touching src/, "where does this go", refactoring, wiring a new feature, any file under src/.
---

# Rogue Aldez — Architecture

Modeled on Claude of Duty's 11-subsystem decomposition. The point of this layout is that
**one agent can own one subsystem and work without reading the others.** If you find
yourself needing to read three subsystems to make a change, the boundary is wrong — fix
the boundary, don't route around it.

## Stack

- TypeScript, strict mode, no `any` (use `unknown` + narrowing).
- Vite dev server / build. `npm run dev`, `npm run build`, `npm run gen:art`.
- WebGL2 renderer written from scratch. No Three.js, no Phaser, no engine.
- Zero runtime dependencies in `src/`. Dev dependencies only (vite, typescript, playwright).
- Web Audio API synthesis. No audio files, ever.

## Subsystems

Each is a directory under `src/`. The number in brackets is its **layer** — a module may
only import from a *strictly lower* layer, never sideways, never up.

```
src/
  core/       [0]  seeded RNG, math, fixed-step loop, event bus, asset registry, time
  render/     [1]  WebGL2 context, sprite batcher, palette LUT, camera, post FX (CRT/bloom)
  art/        [1]  procedural tile + sprite synthesis, atlas packer, palette definitions
  audio/      [1]  Web Audio synthesis — SFX voices, adaptive music tracker
  chronicle/  [2]  the Draft record: historical variables, Anchors, Echo Memory, diffing
  world/      [2]  tilemap, room graph, collision grid, chunk activation, transitions
  physics/    [2]  AABB sweep, tile collision, knockback resolution, spatial hash
  gen/        [3]  floor/room generation from a Draft, layout solver, loot + enemy placement
  entity/     [3]  ECS-lite: component stores, entity lifecycle, queries
  player/     [4]  input mapping, state machine, sword arcs, items, inventory
  ai/         [4]  enemy behavior trees, aggro, pathing on the collision grid
  fx/         [4]  particles, hitstop, screen shake, damage numbers, flashes
  ui/         [5]  HUD, hearts, menus, minimap, pause, death/meta screens
  game/       [6]  run state machine, meta-progression, save/load, scene orchestration
main.ts       [7]  boot: init subsystems in layer order, start loop
```

**Layer rule, concretely:** `player/` (4) may import `core/`, `render/`, `world/`,
`physics/`, `entity/`. It may **not** import `ai/`, `fx/`, or `ui/`. If the player needs to
spawn a particle, it emits an event on the `core/` bus; `fx/` subscribes.

`chronicle/` sits below `gen/` on purpose: the Draft's *history* is decided first, and the
map is derived from it. A generator that reaches back up into `chronicle/` to mutate the
record mid-layout has inverted the model — see [[dungeon-gen]]. `chronicle/` is also the
only subsystem that must be fully serializable and diffable, because the death sequence
renders the difference between two Drafts.

A CI check enforces this. Run `npm run lint:layers` — it fails the build on a violation.

## Cross-subsystem communication

Exactly two mechanisms. Nothing else.

1. **Direct import downward.** Cheap, typed, synchronous. Use for everything you can.
2. **Event bus (`core/bus.ts`)** for upward or sideways signals. Events are plain data,
   past-tense named, and must be safe to drop.

```ts
bus.emit('entity:damaged', { id, amount, dir, crit });
bus.on('entity:damaged', e => spawnHitSparks(e));
```

Never put behavior in an event payload. Never rely on handler ordering. If two handlers
must run in order, that ordering is a subsystem's job, not the bus's.

## The loop contract

`core/loop.ts` runs a **fixed 60 Hz simulation** with a decoupled render, accumulator
style. This is not optional — SNES-accurate game feel depends on frame-counted timings
(i-frames, sword arcs, hitstop all use frame counts, not seconds).

```ts
const STEP = 1 / 60;
let acc = 0;
function frame(now: number) {
  acc += Math.min(now - last, 250) / 1000;   // clamp: never spiral after a tab-out
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(acc / STEP);                         // alpha for interpolation
  requestAnimationFrame(frame);
}
```

Rules:
- `update()` is **pure with respect to wall-clock time**. Never read `Date.now()` or
  `performance.now()` inside simulation. Never use raw `Math.random()`.
- `render()` **never mutates simulation state**. It reads and interpolates. If a renderer
  needs to change state, it's a bug.
- Positions are interpolated between previous and current at render time using `alpha`.

## Determinism

A run is fully reproducible from `(seed, input sequence)`. This is what makes the critic
loop work — a critic can replay a failure exactly.

- All randomness flows from `core/rng.ts` (a seeded PCG32 or xorshift128+). Never
  `Math.random()`. A lint rule bans it in `src/`.
- Each system draws from its **own named stream**: `rng.stream('dungeon')`,
  `rng.stream('loot')`, `rng.stream('fx')`. Adding a particle effect must not shift dungeon
  layout. This is the single most common determinism bug — take it seriously.
- Art generation uses a **fixed seed constant**, not the run seed. Art must be identical
  across every run and every machine.

## Rendering conventions

- Internal resolution is **256×224** (SNES). Everything renders to an offscreen target at
  that size, then upscales integer-first to the window with a CRT/scanline post pass.
- **All sprite and tile positions snap to integer pixels** at the internal resolution
  before drawing. Sub-pixel sprite positions cause shimmer and instantly read as "not
  SNES." Snap in the batcher, not at call sites.
- The camera position also snaps to integers. Interpolate, *then* snap.
- One draw call per atlas page per layer, batched. Target: under 20 draw calls per frame.
- Palette swaps happen in the fragment shader via a palette LUT texture — never by
  regenerating textures at runtime.

## File conventions

- One responsibility per file, aim for under ~300 lines. Split before you sprawl.
- Named exports only. No default exports.
- Every subsystem has an `index.ts` that defines its **public surface**. Other subsystems
  import from `world/` — never from `world/internal/chunkCache.ts`.
- Types live next to their implementation. Only genuinely shared types go in `core/types.ts`.
- Tunable constants go in a `tuning.ts` per subsystem, exported as a flat frozen object,
  so a critic can point at a single number and a builder can change it in one place.

## What NOT to do

- Do not add a game engine, ECS library, physics library, or tweening library.
- Do not add image or audio files. See the `art-synthesis` skill — everything is generated.
- Do not introduce `async` into the simulation path. Loading is async; the game loop is not.
- Do not build an editor, level-design tool, or asset browser unless explicitly asked.
- Do not create abstraction layers for a second renderer/platform that doesn't exist.

Related: [[art-synthesis]], [[zelda-feel]], [[dungeon-gen]], [[visual-critic]]
