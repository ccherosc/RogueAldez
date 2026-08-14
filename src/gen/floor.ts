/**
 * Floor generation.
 *
 * Stage two of the model in dungeon-gen: the Draft's *history* is already
 * decided, and the map is derived from it. Nothing here rolls a historical
 * variable — it reads them.
 *
 * The layout is a room graph on a grid of screen-sized cells. Rooms that are
 * connected get a path between them; rooms that aren't are separated by water,
 * which is solid. That keeps the Vale looking like open country while still
 * being a navigable graph with guaranteed connectivity.
 */

import { ROOM_TILES_H, ROOM_TILES_W } from '../core/const.ts';
import type { Rng } from '../core/rng.ts';
import { TILE } from '../art/tiles.ts';
import { World, TileKind } from '../world/tilemap.ts';
import type { Draft } from '../chronicle/draft.ts';
import type { Act } from '../chronicle/acts.ts';
import { tierFor, difficultyFor, DEFAULT_MODE } from '../chronicle/difficulty.ts';
import type { DifficultyMode } from '../chronicle/difficulty.ts';
import type { Biome } from '../worldgen/biomes.ts';
import { unionTags } from '../worldgen/tags.ts';
import type { Tag } from '../worldgen/tags.ts';
import { pickPlaceable, pickByRole } from '../worldgen/placeables.ts';
import { BIOMES, classify } from '../worldgen/biomes.ts';
import { ClimateMap } from '../worldgen/fields.ts';
import type { WorldPlacement, PlacedSite } from '../worldgen/placement.ts';
import { EdgeMap, boundaryKey } from './edges.ts';
import type { EdgeSpec } from './edges.ts';

export interface RoomNode {
  rx: number;
  ry: number;
  /** manhattan-ish depth from the entrance along the graph */
  depth: number;
  kind: 'entrance' | 'combat' | 'treasure' | 'rest' | 'goal';
  /** connected neighbours as 'n' | 's' | 'e' | 'w' */
  doors: Set<Dir4>;
}

export type Dir4 = 'n' | 's' | 'e' | 'w';

const OPPOSITE: Record<Dir4, Dir4> = { n: 's', s: 'n', e: 'w', w: 'e' };
const STEP: Record<Dir4, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export interface EnemySpawn {
  variant: string;
  x: number;
  y: number;
}

export interface GeneratedFloor {
  world: World;
  rooms: Map<string, RoomNode>;
  entrance: RoomNode;
  goal: RoomNode;
  spawn: { x: number; y: number };
  enemies: EnemySpawn[];
  /** harmless fauna — sparrows, frogs; placed by contract like everything else */
  critters: EnemySpawn[];
  /** The way down. Reaching it ends the floor. */
  exit: { x: number; y: number };
  /** which biome this floor was built from — drives grade, music and the HUD */
  biome: Biome;
  /** the tag set every placement on this floor was checked against */
  tags: ReadonlySet<Tag>;
  /** shared seams, so the scene can bar exactly the tiles that are open */
  edges: EdgeMap;
}

const key = (rx: number, ry: number): string => `${rx},${ry}`;

/**
 * A window onto the continuous world.
 *
 * The overworld is one Ostreya of `gridW x gridH` rooms, far too large to build
 * at once, so play builds the rooms around the player and rebuilds when he
 * leaves them. Every room is generated purely from `(worldSeed, draftSeed, rx,
 * ry)` — no accumulated state, no build order dependence — which is what lets a
 * window be thrown away and rebuilt identically when the player walks back.
 *
 * The differences from a floor are all consequences of continuity:
 *   - **biome is per room**, sampled from the climate field, so biomes form
 *     coastlines and continents you walk into rather than a screen you load;
 *   - **every cell exists and every seam connects** — there is no room graph to
 *     solve because there is nowhere that is not the world;
 *   - **difficulty is ring distance** from the waking place, not depth;
 *   - **there is no exit chest.** You leave a region by walking off it.
 */
export interface RegionRequest {
  draft: Draft;
  placement: WorldPlacement;
  climate: ClimateMap;
  /** top-left room of the window, in world room coordinates */
  originX: number;
  originY: number;
  /** window size in rooms */
  cols: number;
  rows: number;
  /** where in the window the player should appear, if anywhere */
  spawnAt?: { rx: number; ry: number };
}

export interface GeneratedRegion extends Omit<GeneratedFloor, 'entrance' | 'goal' | 'exit'> {
  originX: number;
  originY: number;
  /** sites whose footprint falls inside this window */
  sites: PlacedSite[];
  /** ring threat at the window centre, 0..1 */
  threat: number;
}

export function generateRegion(req: RegionRequest, rng: Rng): GeneratedRegion {
  const { draft, placement, climate, originX, originY, cols, rows } = req;

  // Every cell exists and every neighbour connects: open country has no graph.
  const rooms = new Map<string, RoomNode>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const doors = new Set<Dir4>();
      if (x > 0) doors.add('w');
      if (x < cols - 1) doors.add('e');
      if (y > 0) doors.add('n');
      if (y < rows - 1) doors.add('s');
      rooms.set(key(x, y), { rx: x, ry: y, depth: 0, kind: 'combat', doors });
    }
  }

  // Biome per room, from the climate at its *world* coordinate — so the window
  // is a view onto one continuous map rather than a thing of its own, and
  // walking east eventually walks you into a desert.
  const biomeAt = new Map<string, Biome>();
  for (const room of rooms.values()) {
    const c = climate.sample(originX + room.rx, originY + room.ry);
    biomeAt.set(
      key(room.rx, room.ry),
      classify(c.elevation, c.moisture, c.temperature, BIOMES.filter((b) => !b.barsRooms)),
    );
  }
  const centreBiome = biomeAt.get(key(cols >> 1, rows >> 1))!;

  // Seams are keyed by the *world* boundary, so the profile between two rooms is
  // the same whichever window built it — walk away and back and the coastline
  // has not moved.
  const roomKeys = new Set(rooms.keys());
  const connections = new Set<string>();
  for (const room of rooms.values()) {
    for (const dir of room.doors) connections.add(boundaryKey(room.rx, room.ry, dir));
  }
  // Seeded from a *world-constant* stream and offset by the window origin, so
  // every boundary is rolled from its own world coordinate.
  const edges = new EdgeMap(
    roomKeys, connections, true, rng.stream('overworld-seams'),
    { x: originX, y: originY },
    // The world continues past the window. Without this, edge rooms wall
    // themselves off and the same room differs by approach direction.
    true,
  );

  const world = new World(cols, rows);
  world.fillTiles(TileKind.Water);
  const tagsPerRoom = new Map<string, ReadonlySet<Tag>>();

  for (const room of rooms.values()) {
    const biome = biomeAt.get(key(room.rx, room.ry))!;
    carveRoom(
      world, room, biome, edges,
      rng.stream(`room:${originX + room.rx}:${originY + room.ry}`),
    );
    tagsPerRoom.set(key(room.rx, room.ry), unionTags(biome.provides, draftTags(draft)));
  }

  const spawnRoom = req.spawnAt
    ? { rx: req.spawnAt.rx - originX, ry: req.spawnAt.ry - originY }
    : { rx: cols >> 1, ry: rows >> 1 };
  const spawnTx = spawnRoom.rx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2);
  const spawnTy = spawnRoom.ry * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2);

  // Reservation must come from things that are **fixed in the world**, never
  // from where the player happened to walk in. Reserving around the arrival tile
  // made a room's decoration depend on which direction it was approached from —
  // the last thing standing between this and a genuinely streamable world.
  //
  // Two sources qualify: the waking place, which the Draft fixes, and the site
  // footprints, which the solver fixes. An arrival that lands on a bush is a
  // runtime nudge, not a generation constraint.
  const reserved = new Set<string>();
  const reserveAround = (tx: number, ty: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) reserved.add(`${tx + dx},${ty + dy}`);
    }
  };

  const wakeLx = placement.wake.rx - originX;
  const wakeLy = placement.wake.ry - originY;
  if (wakeLx >= 0 && wakeLx < cols && wakeLy >= 0 && wakeLy < rows) {
    reserveAround(
      wakeLx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2),
      wakeLy * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2),
      2,
    );
  }

  for (const room of rooms.values()) {
    const biome = biomeAt.get(key(room.rx, room.ry))!;
    addInterior(
      world, room, biome, draft, tagsPerRoom.get(key(room.rx, room.ry))!, reserved,
      rng.stream(`feat:${originX + room.rx}:${originY + room.ry}`),
    );
    ensurePaths(world, room, biome, edges, reserved);
  }

  // Deliberately no sealUnreachable / pruneStrandingProps here, and no clearing
  // of the arrival tile.
  //
  // Both flood-fill from the player's position, so their result depends on where
  // the *window* was centred — which makes a room's terrain differ depending on
  // which direction the player approached it from. They exist to prove a closed
  // floor is solvable; a continuous world has no boundary for that claim to be
  // about, and positional purity matters more than tidying a pocket of grass
  // nobody can reach. Connectivity along the critical path is guaranteed by the
  // seams instead, which are keyed by world coordinate and so cannot disagree.

  // Sites inside the window. Their ground is claimed before anything decorates,
  // the way the exit chest always was.
  const sites = placement.sites.filter(
    (s) => s.rx >= originX && s.rx < originX + cols && s.ry >= originY && s.ry < originY + rows,
  );
  for (const site of sites) {
    const lx = site.rx - originX;
    const ly = site.ry - originY;
    const tx = lx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2);
    const ty = ly * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2);
    stampSite(world, tx, ty, site, reserved);
  }

  const enemies: EnemySpawn[] = [];
  const critters: EnemySpawn[] = [];
  const centreThreat = ringThreat(placement, originX + (cols >> 1), originY + (rows >> 1));

  for (const room of rooms.values()) {
    const biome = biomeAt.get(key(room.rx, room.ry))!;
    const tags = tagsPerRoom.get(key(room.rx, room.ry))!;
    decorate(
      world, room, biome, tags, reserved,
      rng.stream(`deco:${originX + room.rx}:${originY + room.ry}`),
    );
    placeCritters(
      world, room, tags,
      rng.stream(`fauna:${originX + room.rx}:${originY + room.ry}`), critters,
    );
    // Difficulty is distance. The room the player wakes in is quiet; the edges of
    // Ostreya hold things that were never people.
    const threat = ringThreat(placement, originX + room.rx, originY + room.ry);
    if (room.rx === spawnRoom.rx && room.ry === spawnRoom.ry) continue;
    populateByThreat(
      world, room, tags, threat, reserved,
      rng.stream(`pop:${originX + room.rx}:${originY + room.ry}`), enemies,
    );
  }

  return {
    world,
    rooms,
    spawn: { x: spawnTx * TILE + TILE / 2, y: spawnTy * TILE + TILE - 1 },
    enemies,
    critters,
    biome: centreBiome,
    tags: tagsPerRoom.get(key(spawnRoom.rx, spawnRoom.ry))!,
    edges,
    originX,
    originY,
    sites,
    threat: centreThreat,
  };
}

/**
 * Build a fight rather than scatter a bag of enemies.
 *
 * The old version shuffled the walkable tiles and dropped random legal enemies
 * on the first N of them. Every room was therefore the same room: a handful of
 * things that individually wanted to touch you, in no arrangement.
 *
 * An encounter is a *shape*. Two rules produce nearly all of it:
 *
 *   - **Ranged units need distance to be interesting.** Standing next to an
 *     Octorok, its spit is a worse melee attack. Twelve tiles away, it is a
 *     reason to keep moving. So they take the outermost spots and are spread
 *     apart from each other, which turns two of them into a crossfire.
 *   - **Rushers need to be between you and the thing shooting at you.** Placing
 *     them inward of the ranged units makes the classic screen: close through
 *     the rushers, go around, or answer the shooter with a boomerang. That
 *     decision *is* the encounter, and it is what makes the items matter.
 *
 * Swarm sits in the middle band, where it interrupts whichever answer is chosen.
 */
function composeEncounter(
  spots: Array<[number, number]>,
  room: RoomNode,
  count: number,
  tags: ReadonlySet<Tag>,
  rng: Rng,
  out: EnemySpawn[],
): void {
  // Composition by size. Below three there is no shape to make, so a small room
  // stays a skirmish rather than pretending to be a set piece.
  const ranged = count >= 5 ? 2 : count >= 3 ? 1 : 0;
  const swarm = count >= 4 ? 1 : 0;
  const rushers = Math.max(0, count - ranged - swarm);

  const cx = (room.rx + 0.5) * ROOM_TILES_W;
  const cy = (room.ry + 0.5) * ROOM_TILES_H;
  const byDistance = [...spots].sort(
    (a, b) => Math.hypot(b[0] - cx, b[1] - cy) - Math.hypot(a[0] - cx, a[1] - cy),
  );

  const used: Array<[number, number]> = [];
  /** Take a spot from a band of the distance-sorted list, spaced from the rest. */
  const take = (from: number, to: number, minGap: number): [number, number] | null => {
    const lo = Math.floor(byDistance.length * from);
    const hi = Math.max(lo + 1, Math.floor(byDistance.length * to));
    const band = byDistance.slice(lo, hi);
    rng.shuffle(band);
    for (const s of band) {
      if (used.every((u) => Math.hypot(u[0] - s[0], u[1] - s[1]) >= minGap)) {
        used.push(s);
        return s;
      }
    }
    return band[0] ?? null;
  };

  const emit = (role: 'ranged' | 'rusher' | 'swarm', spot: [number, number] | null): void => {
    if (!spot) return;
    const pick = pickByRole(role, tags, rng);
    if (!pick) return;
    out.push({ variant: pick.key, x: spot[0] * TILE + TILE / 2, y: spot[1] * TILE + TILE - 1 });
  };

  // Outermost third, well separated: two shooters covering different angles.
  for (let i = 0; i < ranged; i++) emit('ranged', take(0, 0.34, 7));
  // Inner half, loosely packed: the screen you have to get through.
  for (let i = 0; i < rushers; i++) emit('rusher', take(0.45, 1, 3));
  // Middle band: arrives while you are dealing with one of the other two.
  for (let i = 0; i < swarm; i++) emit('swarm', take(0.3, 0.7, 4));
}

/** Ring distance from the waking place, 0..1 — the difficulty dial. */
export function ringThreat(placement: WorldPlacement, rx: number, ry: number): number {
  const maxRing = Math.hypot((placement.gridW - 1) / 2, (placement.gridH - 1) / 2);
  return Math.min(1, Math.hypot(rx - placement.wake.rx, ry - placement.wake.ry) / maxRing);
}

/**
 * Mark a Gazetteer site on the ground.
 *
 * A placeholder for the authored footprints in WORLD_DESIGN step 3 — for now a
 * cleared plaza with a marker, which is enough to prove placement lands where
 * the solver said and to give the player something to walk toward.
 */
function stampSite(
  world: World,
  tx: number,
  ty: number,
  site: PlacedSite,
  reserved: Set<string>,
): void {
  const r = 2 + site.entry.footprint;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= world.tilesW || y >= world.tilesH) continue;
      world.setTile(x, y, TileKind.Floor);
      world.removePropsAt(x, y);
      reserved.add(`${x},${y}`);
    }
  }
  // A ring of torches: visible from a distance, and the lighting pass makes a
  // settlement glow on the horizon at night.
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
    world.addProp('prop.torch.0', tx + dx, ty + dy);
  }
  world.addProp(site.entry.kind === 'sanctum' ? 'prop.chest.closed' : 'prop.crate', tx, ty);
}

/** Enemy placement driven by ring distance rather than floor depth. */
function populateByThreat(
  world: World,
  room: RoomNode,
  tags: ReadonlySet<Tag>,
  threat: number,
  reserved: ReadonlySet<string>,
  rng: Rng,
  out: EnemySpawn[],
): void {
  const count = Math.round(1 + threat * 6 + rng.range(-0.5, 1.5));
  if (count <= 0) return;

  const spots: Array<[number, number]> = [];
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  for (let y = MOAT + 1; y < ROOM_TILES_H - MOAT - 1; y++) {
    for (let x = MOAT + 1; x < ROOM_TILES_W - MOAT - 1; x++) {
      if (!world.isWalkable(ox + x, oy + y)) continue;
      if (reserved.has(`${ox + x},${oy + y}`)) continue;
      spots.push([ox + x, oy + y]);
    }
  }
  rng.shuffle(spots);

  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const pick = pickPlaceable('enemy', tags, rng);
    if (!pick) return;
    const [tx, ty] = spots[i]!;
    out.push({ variant: pick.key, x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 1 });
  }
  // The big ones live far out, where the world has stopped making sense.
  if (threat > 0.45 && rng.chance(threat * 0.35) && spots.length > count + 3) {
    const [tx, ty] = spots[count + 1]!;
    out.push({ variant: threat > 0.8 ? 'colossus' : 'hulk', x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 1 });
  }
}

/**
 * The tiles a room's exits get barred at while it is locked in combat.
 *
 * Placed on the **outermost** moat row, not just inside it. The room transition
 * carries the player one tile past the boundary, so a bar line one tile in lands
 * exactly on top of them — solid, and they end up stuck in their own doorway.
 * Barring at the outer edge always leaves the player on the inside.
 */
export function gateBarTiles(room: RoomNode, edges: EdgeMap): Array<[number, number]> {
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  const out: Array<[number, number]> = [];

  // Bar exactly the tiles the seam says are open — with variable openings there
  // is no fixed gate position to assume any more.
  for (const dir of ['n', 's', 'w', 'e'] as Dir4[]) {
    const spec = edges.get(room.rx, room.ry, dir);
    spec.open.forEach((isOpen, i) => {
      if (!isOpen) return;
      if (dir === 'n') out.push([ox + i, oy]);
      else if (dir === 's') out.push([ox + i, oy + ROOM_TILES_H - 1]);
      else if (dir === 'w') out.push([ox, oy + i]);
      else out.push([ox + ROOM_TILES_W - 1, oy + i]);
    });
  }
  return out;
}

/** Path openings are this many tiles wide. Narrower than 3 and doorways snag. */
const GATE_WIDTH = 4;
/** Water band thickness along a closed edge. */
/** How many of the meadow's rooms hold anything at all. */
const MEADOW_OCCUPIED = 0.34;

/**
 * Candidate tiles, filtered to walkable ground. Placing on raw coordinates drops
 * enemies inside ponds and pillars, where they are stuck and unkillable.
 */
function walkableSpots(
  world: World,
  room: RoomNode,
  reserved: ReadonlySet<string>,
): Array<[number, number]> {
  const spots: Array<[number, number]> = [];
  for (let ty = room.ry * ROOM_TILES_H + MOAT + 1; ty < (room.ry + 1) * ROOM_TILES_H - MOAT - 1; ty++) {
    for (let tx = room.rx * ROOM_TILES_W + MOAT + 1; tx < (room.rx + 1) * ROOM_TILES_W - MOAT - 1; tx++) {
      if (reserved.has(`${tx},${ty}`)) continue;
      if (world.isWalkable(tx, ty)) spots.push([tx, ty]);
    }
  }
  return spots;
}

/**
 * Bosses arrive last, on top of a room something else already filled.
 *
 * A Warden is a fight with four readable beats and a window to punish, and none
 * of that survives six Errata throwing themselves at you during the telegraph.
 * The boss room keeps at most two others, so the fight is legible as a fight.
 */
const BOSS_ESCORT = 2;
const BOSSES = new Set(['warden', 'colossus']);

function clearTheBossRoom(enemies: EnemySpawn[]): void {
  const roomOf = (e: EnemySpawn): string =>
    `${Math.floor(e.x / (ROOM_TILES_W * TILE))},${Math.floor(e.y / (ROOM_TILES_H * TILE))}`;

  const bossRooms = new Set(enemies.filter((e) => BOSSES.has(e.variant)).map(roomOf));
  if (bossRooms.size === 0) return;

  const kept = new Map<string, number>();
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]!;
    if (BOSSES.has(e.variant)) continue;
    const room = roomOf(e);
    if (!bossRooms.has(room)) continue;
    const n = kept.get(room) ?? 0;
    if (n >= BOSS_ESCORT) enemies.splice(i, 1);
    else kept.set(room, n + 1);
  }
}

/**
 * Most a single screen may hold. Two to four is the readable band; five or six
 * should be the room you remember, not the room you expect.
 */
export const MAX_PER_ROOM = 6;

const MOAT = 2;

const GROUND_TILE: Record<Biome['ground'], TileKind> = {
  grass: TileKind.Grass,
  dirt: TileKind.Dirt,
  floor: TileKind.Floor,
};

/**
 * Tags contributed by the Draft's history, on top of the biome's own.
 *
 * This is the third tag source from the world-gen skill: geography says what a
 * place *is*, history says what has happened to it. An occupied Vale is
 * `patrolled` whatever biome it sits in.
 */
function draftTags(draft: Draft): Tag[] {
  switch (draft.condition) {
    case 'flooded': return ['wetland'];
    case 'occupied': return ['patrolled', 'settled'];
    case 'abandoned': return ['ruined'];
    case 'overrun': return ['wild'];
    case 'harvest': return ['settled', 'fertile'];
  }
}

export function generateFloor(
  draft: Draft,
  act: Act,
  biome: Biome,
  rng: Rng,
  depth = 0,
  mode: DifficultyMode = DEFAULT_MODE,
): GeneratedFloor {
  // Open country sprawls; dungeons stay tight. 5x4 rooms of overworld is what
  // makes a biome feel like a region you cross rather than a screen you clear —
  // and it costs nothing, since every system downstream is size-agnostic.
  const openWorld = !biome.barsRooms;
  const gridW = openWorld ? 5 : 3;
  const gridH = openWorld ? 4 : 3;

  // The tag set every placement contract is checked against. Contradictions are
  // possible here (a flooded Draft over an arid biome) and are resolved by the
  // contract itself: nothing requiring `arid` will pass while `wetland` is set.
  const tags = unionTags(biome.provides, draftTags(draft));

  // --- 1. room graph ------------------------------------------------------
  const rooms = buildGraph(gridW, gridH, rng.stream(`layout:${draft.seed}`));

  // Extra links between adjacent rooms. A pure spanning walk gives a corridor;
  // loops are what make somewhere feel like country you can wander.
  const loopRng = rng.stream(`loops:${draft.seed}`);
  if (!biome.barsRooms) {
    for (const room of rooms.values()) {
      for (const dir of ['e', 's'] as Dir4[]) {
        const [dx, dy] = STEP[dir];
        const other = rooms.get(key(room.rx + dx, room.ry + dy));
        if (!other || room.doors.has(dir)) continue;
        if (!loopRng.chance(0.55)) continue;
        room.doors.add(dir);
        other.doors.add(OPPOSITE[dir]);
      }
    }
  }

  // --- 1b. shared seams ----------------------------------------------------
  // Generated once per boundary so both neighbours read the same profile.
  const roomKeys = new Set(rooms.keys());
  const connections = new Set<string>();
  for (const room of rooms.values()) {
    for (const dir of room.doors) connections.add(boundaryKey(room.rx, room.ry, dir));
  }
  const edges = new EdgeMap(
    roomKeys, connections, !biome.barsRooms, rng.stream(`edges:${draft.seed}`),
  );
  const entrance = [...rooms.values()].find((r) => r.kind === 'entrance')!;
  const goal = [...rooms.values()].reduce((a, b) => (b.depth > a.depth ? b : a));
  goal.kind = 'goal';

  // --- 2. carve terrain ---------------------------------------------------
  // Start as open water. Grid cells the walk never visited then stay lake rather
  // than becoming walkable islands with no way in — those read as bugs to the
  // player and strand hundreds of tiles per floor.
  const world = new World(gridW, gridH);
  world.fillTiles(biome.moat === 'wall' ? TileKind.Wall : TileKind.Water);

  for (const room of rooms.values()) {
    carveRoom(world, room, biome, edges, rng.stream(`room:${draft.seed}:${room.rx}:${room.ry}`));
  }

  // --- 3. populate --------------------------------------------------------
  // Reserve the tiles the player and the exit occupy *before* anything is
  // scattered, otherwise Aldez wakes up inside a bush he then has to cut his way
  // out of — and props are solid, so a bad roll can wall him in entirely.
  const reserved = new Set<string>();
  const reserve = (tx: number, ty: number, radius: number): void => {
    for (let y = ty - radius; y <= ty + radius; y++) {
      for (let x = tx - radius; x <= tx + radius; x++) reserved.add(`${x},${y}`);
    }
  };
  const spawnTx = entrance.rx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2);
  const spawnTy = entrance.ry * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2);
  reserve(spawnTx, spawnTy, 2);

  // The way down is claimed before anything is populated. Adding it afterwards
  // drops a solid chest on whatever already stood there — usually an enemy.
  const exitTx = goal.rx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2);
  const exitTy = goal.ry * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2);
  reserve(exitTx, exitTy, 1);

  // Interior features first, then guarantee the gates still connect. Carving the
  // paths afterwards is what lets features be placed freely — constraining them
  // to quadrants around a 4-wide gate corridor leaves almost no usable room in a
  // 16x14 space, and every room ends up looking the same anyway.
  for (const room of rooms.values()) {
    addInterior(
      world, room, biome, draft, tags, reserved,
      rng.stream(`feat:${draft.seed}:${room.rx}:${room.ry}`),
    );
    ensurePaths(world, room, biome, edges, reserved);
  }

  // Anything the player cannot walk to is not ground. Sealing unreachable
  // pockets makes "every walkable tile is reachable" true by construction
  // instead of a property the validator has to keep checking a threshold on.
  sealUnreachable(world, spawnTx, spawnTy, BARRIER_TILE[biome.moat]);

  // The road: one worn track running the whole critical path, entrance to the
  // way down. A generated map reads as *designed* the moment it has a spine —
  // the land no longer looks rolled, it looks like people have been crossing it
  // toward somewhere, and that somewhere is exactly where the player must go.
  carveRoad(
    world, rooms, entrance, goal, edges, biome, reserved,
    rng.stream(`road:${draft.seed}`),
  );

  // The Last Certainty: the spawn is a camp, not a coordinate. Two standing
  // torches and a supply crate — placed structurally, like the exit chest, so
  // no contract needs to pretend a meadow is dark.
  world.addProp('prop.torch.0', spawnTx - 2, spawnTy - 1);
  world.addProp('prop.torch.0', spawnTx + 2, spawnTy - 1);
  world.addProp('prop.crate', spawnTx - 2, spawnTy + 1);

  const enemies: EnemySpawn[] = [];
  const critters: EnemySpawn[] = [];
  for (const room of rooms.values()) {
    decorate(
      world, room, biome, tags, reserved,
      rng.stream(`deco:${draft.seed}:${room.rx}:${room.ry}`),
    );
    // Fauna goes everywhere, entrance included — arriving to a bird taking off
    // is exactly the "this place was here before me" note the entrance wants.
    placeCritters(world, room, tags, rng.stream(`fauna:${draft.seed}:${room.rx}:${room.ry}`), critters);
    if (room.kind === 'entrance') continue; // never ambush the player on arrival
    populate(
      world, room, act, tags, draft, depth, reserved,
      rng.stream(`pop:${draft.seed}:${room.rx}:${room.ry}`), enemies, mode,
    );
  }

  const spawn = {
    x: entrance.rx * ROOM_TILES_W * TILE + (ROOM_TILES_W / 2) * TILE,
    y: entrance.ry * ROOM_TILES_H * TILE + (ROOM_TILES_H / 2) * TILE,
  };

  // The way down sits at the centre of the deepest room, so finding it always
  // means crossing the floor rather than stumbling onto it beside the entrance.
  world.setTile(exitTx, exitTy, TileKind.Floor);
  world.addProp('prop.chest.closed', exitTx, exitTy);
  const exit = { x: exitTx * TILE + TILE / 2, y: exitTy * TILE + TILE - 1 };

  // An Act's last floor is guarded: the Colossus stands over the way down, and
  // it does not wander. Every Act ends with the same shape — a huge silhouette
  // between you and the next region.
  // Every dungeon floor from the first ends with a Warden on the stairs. A floor
  // that just stops is a floor with no ending; a boss is what turns "I got
  // through" into "I beat it".
  if (biome.barsRooms && depth + 1 < act.floors) {
    // Try posts around the stairs and take the first walkable one. The first
    // version fell back to a fixed tile without checking it, and the solvability
    // sweep found the seed where that tile was wall — a boss inside a wall is
    // unkillable, and the floor unfinishable.
    const posts: Array<[number, number]> = [
      [exitTx, exitTy + 3], [exitTx, exitTy + 2],
      [exitTx + 3, exitTy], [exitTx - 3, exitTy], [exitTx, exitTy - 3],
    ];
    for (const [gx, gy] of posts) {
      if (!world.isWalkable(gx, gy)) continue;
      enemies.push({ variant: 'warden', x: gx * TILE + TILE / 2, y: gy * TILE + TILE - 1 });
      break;
    }
  }

  if (depth + 1 >= act.floors) {
    // First walkable post near the chest wins; a floor with no ground for a
    // 48px guard anywhere around its exit does not get one.
    const posts: Array<[number, number]> = [
      [exitTx, exitTy + 3], [exitTx + 3, exitTy], [exitTx - 3, exitTy], [exitTx, exitTy - 3],
    ];
    for (const [gx, gy] of posts) {
      if (!world.isWalkable(gx, gy)) continue;
      enemies.push({ variant: 'colossus', x: gx * TILE + TILE / 2, y: gy * TILE + TILE - 1 });
      break;
    }
  }

  clearTheBossRoom(enemies);

  // Decoration can undo what sealUnreachable guaranteed: a tight cluster of
  // solid trees can fence off ground that the terrain pass left open. Prune the
  // fence rather than tolerate the pocket.
  pruneStrandingProps(world, spawnTx, spawnTy);

  return { world, rooms, entrance, goal, spawn, enemies, critters, exit, biome, tags, edges };
}

/**
 * Carve the road along the critical path.
 *
 * Walks the room chain from the goal back to the entrance (each step to a
 * neighbour one depth shallower), then in every room on that chain lays a
 * two-wide dirt track between the seam openings it entered and left by, bending
 * through the room centre with a little jitter so it reads as worn rather than
 * surveyed. Road tiles are reserved, which keeps decoration from parking a bush
 * in the middle of the king's highway.
 */
function carveRoad(
  world: World,
  rooms: Map<string, RoomNode>,
  entrance: RoomNode,
  goal: RoomNode,
  edges: EdgeMap,
  biome: Biome,
  reserved: Set<string>,
  rng: Rng,
): void {
  // Trace the chain goal -> entrance by strictly decreasing depth.
  const chain: RoomNode[] = [goal];
  let cur = goal;
  let guard = 0;
  while (cur !== entrance && guard++ < 64) {
    let next: RoomNode | null = null;
    for (const dir of cur.doors) {
      const [dx, dy] = STEP[dir];
      const cand = rooms.get(key(cur.rx + dx, cur.ry + dy));
      if (cand && cand.depth === cur.depth - 1) { next = cand; break; }
    }
    if (!next) return; // should not happen; leave the land unroaded rather than loop
    chain.push(next);
    cur = next;
  }

  const roadTile = biome.ground === 'floor' ? TileKind.Floor : TileKind.Dirt;

  // Way-point inside a room for the seam toward `dir`, at the opening's centre.
  const gatePoint = (room: RoomNode, dir: Dir4): [number, number] => {
    const spec = edges.get(room.rx, room.ry, dir);
    const open = spec.open.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
    const centre = open.length > 0 ? open[Math.floor(open.length / 2)]! : 8;
    const ox = room.rx * ROOM_TILES_W;
    const oy = room.ry * ROOM_TILES_H;
    switch (dir) {
      case 'n': return [ox + centre, oy];
      case 's': return [ox + centre, oy + ROOM_TILES_H - 1];
      case 'w': return [ox, oy + centre];
      case 'e': return [ox + ROOM_TILES_W - 1, oy + centre];
    }
  };

  const lay = (x: number, y: number): void => {
    for (const [px2, py2] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const) {
      if (px2 < 0 || py2 < 0 || px2 >= world.tilesW || py2 >= world.tilesH) continue;
      // A causeway may cross a pond; it must never breach a room barrier — that
      // would punch holes the seam system knows nothing about.
      const t = world.at(px2, py2);
      if (t === TileKind.Tree || t === TileKind.Cliff || t === TileKind.Wall) continue;
      world.setTile(px2, py2, roadTile);
      world.removePropsAt(px2, py2);
      reserved.add(`${px2},${py2}`);
    }
  };

  // Jittered manhattan walk between two points.
  const walk = (from: [number, number], to: [number, number]): void => {
    let [x, y] = from;
    lay(x, y);
    let guard2 = 0;
    while ((x !== to[0] || y !== to[1]) && guard2++ < 200) {
      const dx = Math.sign(to[0] - x);
      const dy = Math.sign(to[1] - y);
      // Prefer the axis with more distance left, and only rarely wobble off it.
      // At 0.85 the track meandered enough to paint a dirt *field* rather than a
      // road — the 2-tile brush turns every wobble into width.
      const horizontal = Math.abs(to[0] - x) > Math.abs(to[1] - y)
        ? rng.chance(0.97)
        : !rng.chance(0.97);
      if (horizontal && dx !== 0) x += dx;
      else if (dy !== 0) y += dy;
      else if (dx !== 0) x += dx;
      lay(x, y);
    }
  };

  for (let i = 0; i < chain.length; i++) {
    const room = chain[i]!;
    const prev = chain[i + 1]; // one step toward the entrance
    const next = chain[i - 1]; // one step toward the goal
    const centre: [number, number] = [
      room.rx * ROOM_TILES_W + Math.floor(ROOM_TILES_W / 2) - 1,
      room.ry * ROOM_TILES_H + Math.floor(ROOM_TILES_H / 2) - 1,
    ];
    const points: Array<[number, number]> = [];
    if (prev) points.push(gatePoint(room, dirBetween(room, prev)));
    points.push(centre);
    if (next) points.push(gatePoint(room, dirBetween(room, next)));
    for (let p = 0; p + 1 < points.length; p++) walk(points[p]!, points[p + 1]!);
  }
}

function dirBetween(from: RoomNode, to: RoomNode): Dir4 {
  if (to.rx > from.rx) return 'e';
  if (to.rx < from.rx) return 'w';
  if (to.ry > from.ry) return 's';
  return 'n';
}

/**
 * Remove solid props that strand walkable ground.
 *
 * Flood-fills with props treated as walls; any solid prop bordering an
 * unreachable tile is part of the fence and comes out. Loops because removing
 * one fence can expose another, but in practice one pass clears it.
 */
function pruneStrandingProps(world: World, spawnTx: number, spawnTy: number): void {
  for (let iteration = 0; iteration < 5; iteration++) {
    const solidProp = new Set<number>();
    for (const p of world.props) {
      if (p.solid) solidProp.add(p.ty * world.tilesW + p.tx);
    }

    const seen = new Uint8Array(world.tilesW * world.tilesH);
    const stack: number[] = [spawnTy * world.tilesW + spawnTx];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (seen[idx] === 1) continue;
      const x = idx % world.tilesW;
      const y = Math.floor(idx / world.tilesW);
      if (world.isSolid(x, y) || solidProp.has(idx)) continue;
      seen[idx] = 1;
      if (x + 1 < world.tilesW) stack.push(idx + 1);
      if (x > 0) stack.push(idx - 1);
      if (y + 1 < world.tilesH) stack.push(idx + world.tilesW);
      if (y > 0) stack.push(idx - world.tilesW);
    }

    let removed = 0;
    for (let y = 0; y < world.tilesH; y++) {
      for (let x = 0; x < world.tilesW; x++) {
        const idx = y * world.tilesW + x;
        if (seen[idx] === 1 || world.isSolid(x, y) || solidProp.has(idx)) continue;
        // Stranded ground: clear every solid prop in its 8-neighbourhood.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (solidProp.has((y + dy) * world.tilesW + (x + dx))) {
              world.removePropsAt(x + dx, y + dy);
              removed++;
            }
          }
        }
      }
    }
    if (removed === 0) return;
  }
}

/**
 * Fauna placement, through the same contract filter as everything else — frogs
 * in a fen, sparrows in a meadow, and nothing at all where nothing would live.
 */
function placeCritters(
  world: World,
  room: RoomNode,
  tags: ReadonlySet<Tag>,
  rng: Rng,
  out: EnemySpawn[],
): void {
  const count = rng.int(0, 2);
  for (let i = 0; i < count; i++) {
    const pick = pickPlaceable('critter', tags, rng);
    if (!pick) return;
    const tx = room.rx * ROOM_TILES_W + rng.int(MOAT + 1, ROOM_TILES_W - MOAT - 2);
    const ty = room.ry * ROOM_TILES_H + rng.int(MOAT + 1, ROOM_TILES_H - MOAT - 2);
    if (!world.isWalkable(tx, ty)) continue;
    out.push({ variant: pick.key, x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 1 });
  }
}

/**
 * Random walk for the critical path, then attach branches.
 *
 * Every room is reachable by construction — the walk only ever extends from a
 * room already in the graph — so connectivity needs no separate flood fill.
 */
function buildGraph(gridW: number, gridH: number, rng: Rng): Map<string, RoomNode> {
  const rooms = new Map<string, RoomNode>();

  const start: RoomNode = {
    rx: rng.int(0, gridW - 1),
    ry: gridH - 1,
    depth: 0,
    kind: 'entrance',
    doors: new Set(),
  };
  rooms.set(key(start.rx, start.ry), start);

  let cursor = start;
  let lastDir: Dir4 | null = null;
  const target = gridW * gridH - rng.int(0, 2);

  let guard = 0;
  while (rooms.size < target && guard++ < 400) {
    const options = (['n', 's', 'e', 'w'] as Dir4[]).filter((d) => {
      const [dx, dy] = STEP[d];
      const nx = cursor.rx + dx;
      const ny = cursor.ry + dy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return false;
      // Bias against doubling straight back — reversing coils the path into a knot.
      if (lastDir && d === OPPOSITE[lastDir] && rng.chance(0.85)) return false;
      return true;
    });
    if (options.length === 0) break;

    const dir = rng.pick(options);
    const [dx, dy] = STEP[dir];
    const nx = cursor.rx + dx;
    const ny = cursor.ry + dy;
    const k = key(nx, ny);

    let next = rooms.get(k);
    if (!next) {
      next = { rx: nx, ry: ny, depth: cursor.depth + 1, kind: 'combat', doors: new Set() };
      rooms.set(k, next);
    }
    cursor.doors.add(dir);
    next.doors.add(OPPOSITE[dir]);
    lastDir = dir;
    cursor = next;
  }

  // Room roles: the deepest is the goal, one mid room is a reward, one is a breather.
  const ordered = [...rooms.values()].sort((a, b) => a.depth - b.depth);
  if (ordered.length > 2) ordered[Math.floor(ordered.length / 2)]!.kind = 'treasure';
  // Never two fights in a row on the way in: the room before the deepest is safe.
  if (ordered.length > 3) ordered[ordered.length - 2]!.kind = 'rest';

  return rooms;
}

const BARRIER_TILE: Record<Biome['moat'], TileKind> = {
  water: TileKind.Water,
  wall: TileKind.Wall,
  cliff: TileKind.Cliff,
  forest: TileKind.Tree,
};

/**
 * The materials a biome may bound a screen with, most characteristic first.
 *
 * Water on every seam of every meadow is what made the overworld read as a chain
 * of moated islands however open the seams were — the same shoreline four times a
 * screen, forever. A place keeps its dominant material (the roll is weighted) but
 * gains hedgerow and outcrop, which is what real country is bounded by.
 * Dungeons are exempt: masonry is masonry.
 */
function barrierPalette(biome: Biome): TileKind[] {
  const primary = BARRIER_TILE[biome.moat];
  if (biome.barsRooms || biome.moat === 'wall') return [primary, primary, primary];
  const alternates: TileKind[] = [];
  if (biome.moat !== 'forest') alternates.push(TileKind.Tree);
  if (biome.moat !== 'cliff') alternates.push(TileKind.Cliff);
  if (biome.moat !== 'water') alternates.push(TileKind.Water);
  return [primary, alternates[0] ?? primary, alternates[1] ?? primary];
}

/**
 * Carve a room from its four *shared* seams.
 *
 * The room no longer decides its own borders — it reads them from the EdgeMap,
 * which generated each boundary once for the pair of rooms that share it. Both
 * neighbours therefore carve the same profile from opposite sides, and the
 * terrain lines up across the seam by construction rather than by luck.
 *
 * A seam may be entirely open, which is what lets the overworld read as country
 * you walk across rather than as a chain of islands.
 */
function carveRoom(
  world: World,
  room: RoomNode,
  biome: Biome,
  edges: EdgeMap,
  rng: Rng,
): void {
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  const palette = barrierPalette(biome);
  const ground = GROUND_TILE[biome.ground];

  // Claim the whole cell as ground; barriers are then cut back into it.
  for (let y = 0; y < ROOM_TILES_H; y++) {
    for (let x = 0; x < ROOM_TILES_W; x++) world.setTile(ox + x, oy + y, ground);
  }

  const specs = {
    n: edges.get(room.rx, room.ry, 'n'),
    s: edges.get(room.rx, room.ry, 's'),
    w: edges.get(room.rx, room.ry, 'w'),
    e: edges.get(room.rx, room.ry, 'e'),
  };

  // Barrier band along each side, skipping the tiles the seam says are open.
  // Thickness is jittered per column so a treeline or shore has a ragged inner
  // face instead of a ruled edge.
  for (let x = 0; x < ROOM_TILES_W; x++) {
    const jitterN = specs.n.openness === 'closed' ? rng.int(0, 1) : 0;
    const jitterS = specs.s.openness === 'closed' ? rng.int(0, 1) : 0;
    for (let d = 0; d < MOAT + jitterN; d++) {
      if (!specs.n.open[x]) world.setTile(ox + x, oy + d, palette[specs.n.material] ?? palette[0]!);
    }
    for (let d = 0; d < MOAT + jitterS; d++) {
      if (!specs.s.open[x]) world.setTile(ox + x, oy + ROOM_TILES_H - 1 - d, palette[specs.s.material] ?? palette[0]!);
    }
  }
  for (let y = 0; y < ROOM_TILES_H; y++) {
    const jitterW = specs.w.openness === 'closed' ? rng.int(0, 1) : 0;
    const jitterE = specs.e.openness === 'closed' ? rng.int(0, 1) : 0;
    for (let d = 0; d < MOAT + jitterW; d++) {
      if (!specs.w.open[y]) world.setTile(ox + d, oy + y, palette[specs.w.material] ?? palette[0]!);
    }
    for (let d = 0; d < MOAT + jitterE; d++) {
      if (!specs.e.open[y]) world.setTile(ox + ROOM_TILES_W - 1 - d, oy + y, palette[specs.e.material] ?? palette[0]!);
    }
  }

  // Trodden ground through *gates* only. A wide seam is 10+ tiles of country —
  // painting dirt across it produced field-sized brown aprons at every crossing.
  // A path is narrow or it is not a path.
  for (const [dir, spec] of Object.entries(specs) as Array<[Dir4, EdgeSpec]>) {
    if (spec.openness !== 'gate') continue;
    const along = dir === 'n' || dir === 's' ? ROOM_TILES_W : ROOM_TILES_H;
    for (let i = 0; i < along; i++) {
      if (!spec.open[i]) continue;
      for (let d = 0; d < MOAT + 1; d++) {
        if (dir === 'n') world.setTile(ox + i, oy + d, TileKind.Dirt);
        else if (dir === 's') world.setTile(ox + i, oy + ROOM_TILES_H - 1 - d, TileKind.Dirt);
        else if (dir === 'w') world.setTile(ox + d, oy + i, TileKind.Dirt);
        else world.setTile(ox + ROOM_TILES_W - 1 - d, oy + i, TileKind.Dirt);
      }
    }
  }
}

type Feature = 'pond' | 'grove' | 'clearing' | 'pillars' | 'ruin';

/**
 * Features come from the Act (which region this is) crossed with the Draft
 * (what happened to it this time). Geography and history both get a say.
 */
function featurePool(biome: Biome, draft: Draft, room: RoomNode): Feature[] {
  const pool: Feature[] = [...biome.features];
  switch (draft.condition) {
    case 'flooded': pool.push('pond', 'ruin'); break;
    case 'abandoned': pool.push('grove', 'ruin'); break;
    case 'overrun': pool.push('grove'); break;
    case 'occupied': pool.push('pillars'); break;
    case 'harvest': pool.push('clearing'); break;
  }
  if (room.kind === 'goal') pool.push('ruin', 'ruin');
  return pool;
}

const INNER_X0 = MOAT + 1;
const INNER_Y0 = MOAT + 1;

function addInterior(
  world: World,
  room: RoomNode,
  biome: Biome,
  draft: Draft,
  tags: ReadonlySet<Tag>,
  reserved: ReadonlySet<string>,
  rng: Rng,
): void {
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  const innerX1 = ROOM_TILES_W - MOAT - 2;
  const innerY1 = ROOM_TILES_H - MOAT - 2;

  const pool = featurePool(biome, draft, room);
  const ground = GROUND_TILE[biome.ground];
  const count = room.kind === 'entrance' ? 1 : rng.int(1, 2);

  const put = (x: number, y: number, kind: TileKind): void => {
    if (x < INNER_X0 || y < INNER_Y0 || x > innerX1 || y > innerY1) return;
    if (reserved.has(`${ox + x},${oy + y}`)) return;
    world.setTile(ox + x, oy + y, kind);
  };

  for (let n = 0; n < count; n++) {
    const feature = rng.pick(pool);
    const cx = rng.int(INNER_X0 + 1, innerX1 - 1);
    const cy = rng.int(INNER_Y0 + 1, innerY1 - 1);

    switch (feature) {
      case 'pond':
      case 'clearing': {
        const kind = feature === 'pond' ? TileKind.Water : TileKind.Dirt;
        const rx = rng.int(2, 3);
        const ry = rng.int(1, 2);
        for (let y = -ry; y <= ry; y++) {
          for (let x = -rx; x <= rx; x++) {
            // Ellipse with a jittered rim so pools don't read as stamped ovals.
            if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1 + rng.range(-0.15, 0.15)) continue;
            put(cx + x, cy + y, kind);
          }
        }
        break;
      }
      case 'grove': {
        // Whatever vegetation this place actually supports — reeds in a fen,
        // bushes in a meadow, nothing at all on a frozen scree.
        for (const [gx, gy] of scatterAround(rng, cx, cy, rng.int(4, 7), 3)) {
          if (reserved.has(`${ox + gx},${oy + gy}`)) continue;
          if (gx < INNER_X0 || gy < INNER_Y0 || gx > innerX1 || gy > innerY1) continue;
          if (world.at(ox + gx, oy + gy) !== ground) continue;
          const plant = pickPlaceable('prop', tags, rng);
          if (plant) world.addProp(plant.key, ox + gx, oy + gy, plant.solid ?? true, plant.id);
        }
        break;
      }
      case 'pillars': {
        const n2 = rng.int(2, 4);
        for (let i = 0; i < n2; i++) {
          put(cx + i * 2 - n2, cy + rng.int(-1, 1), TileKind.Wall);
        }
        break;
      }
      case 'ruin': {
        const w = rng.int(3, 5);
        const h = rng.int(2, 3);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) put(cx - 1 + x, cy - 1 + y, TileKind.Floor);
        }
        // A broken wall along one edge — a ruin, not a tidy room.
        for (let x = 0; x < w; x++) {
          if (rng.chance(0.6)) put(cx - 1 + x, cy - 2, TileKind.Wall);
        }
        break;
      }
    }
  }
}

function scatterAround(
  rng: Rng,
  cx: number,
  cy: number,
  count: number,
  spread: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    out.push([cx + rng.int(-spread, spread), cy + rng.int(-spread, spread)]);
  }
  return out;
}

/**
 * Carve a walkable path from every gate to the room centre.
 *
 * Run after features, so a pond or a ruin can never seal a room. Connectivity by
 * construction beats a solvability check that can only tell you the floor is
 * broken after the fact.
 */
function ensurePaths(
  world: World,
  room: RoomNode,
  biome: Biome,
  edges: EdgeMap,
  reserved: Set<string>,
): void {
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  const cx = Math.floor(ROOM_TILES_W / 2);
  const cy = Math.floor(ROOM_TILES_H / 2);
  // Carve back to the Act's walkway, not always dirt — a dirt track through a
  // buried palace looks like a bug.
  const path = biome.ground === 'floor' ? TileKind.Floor : TileKind.Dirt;

  const clear = (x: number, y: number): void => {
    // Anything solid, not just water and masonry. Adding tree and cliff barriers
    // without widening this left forest and mountain rooms with uncarvable
    // routes — which the solvability sweep caught on 3 floors in 400.
    if (world.isSolid(ox + x, oy + y)) world.setTile(ox + x, oy + y, path);
    // Props are solid too. Clearing the tile but leaving a bush on it is exactly
    // how a room ends up sealed while the terrain looks perfectly walkable.
    world.removePropsAt(ox + x, oy + y);
    // Reserve it. In biomes whose ground *is* dirt the carved path is the same
    // material as everything around it, so decoration cannot tell a route from
    // open ground and will happily bury it.
    reserved.add(`${ox + x},${oy + y}`);
  };

  // Route from the middle of each *actual* opening, not from an assumed gate
  // position — with variable seams the opening can be anywhere along the edge.
  const openingCentre = (dir: Dir4): number | null => {
    const spec = edges.get(room.rx, room.ry, dir);
    const indices = spec.open.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
    if (indices.length === 0) return null;
    return indices[Math.floor(indices.length / 2)]!;
  };

  for (const dir of ['n', 's', 'w', 'e'] as Dir4[]) {
    const centre = openingCentre(dir);
    if (centre === null) continue;
    const gates: Record<Dir4, [number, number]> = {
      n: [centre, MOAT],
      s: [centre, ROOM_TILES_H - MOAT - 1],
      w: [MOAT, centre],
      e: [ROOM_TILES_W - MOAT - 1, centre],
    };
    const [gx, gy] = gates[dir];
    // L-shaped route: along y first, then x. Two tiles wide so the player never
    // has to thread a 1px gap.
    const stepY = Math.sign(cy - gy);
    for (let y = gy; y !== cy + stepY; y += stepY || 1) {
      clear(gx, y);
      clear(gx + 1, y);
      if (stepY === 0) break;
    }
    const stepX = Math.sign(cx - gx);
    for (let x = gx; x !== cx + stepX; x += stepX || 1) {
      clear(x, cy);
      clear(x, cy + 1);
      if (stepX === 0) break;
    }
  }

  // Keep the centre itself open — every route passes through it.
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) clear(x, y);
  }
}

/**
 * Scatter props through the contract filter.
 *
 * Nothing here names a prop. It asks the world what may legally stand on this
 * kind of ground and takes a weighted pick — which is why a fen grows reeds, a
 * minehead gets crates and stalagmites, and an ossuary is the only place in the
 * game that can produce a tombstone.
 */
/**
 * Fill every walkable tile that cannot be reached from the spawn.
 *
 * Runs before anything is populated, so decoration and enemies only ever see
 * ground the player can actually stand on. Costs one flood fill and removes an
 * entire class of "looks connected, is not" defect.
 */
function sealUnreachable(
  world: World,
  spawnTx: number,
  spawnTy: number,
  barrier: TileKind,
): void {
  const seen = new Uint8Array(world.tilesW * world.tilesH);
  const stack: number[] = [spawnTy * world.tilesW + spawnTx];

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (seen[idx] === 1) continue;
    const x = idx % world.tilesW;
    const y = Math.floor(idx / world.tilesW);
    if (world.isSolid(x, y)) continue;
    seen[idx] = 1;
    if (x + 1 < world.tilesW) stack.push(idx + 1);
    if (x > 0) stack.push(idx - 1);
    if (y + 1 < world.tilesH) stack.push(idx + world.tilesW);
    if (y > 0) stack.push(idx - world.tilesW);
  }

  for (let y = 0; y < world.tilesH; y++) {
    for (let x = 0; x < world.tilesW; x++) {
      if (seen[y * world.tilesW + x] === 1) continue;
      if (!world.isSolid(x, y)) world.setTile(x, y, barrier);
    }
  }
}

function decorate(
  world: World,
  room: RoomNode,
  biome: Biome,
  tags: ReadonlySet<Tag>,
  reserved: ReadonlySet<string>,
  rng: Rng,
): void {
  const ox = room.rx * ROOM_TILES_W;
  const oy = room.ry * ROOM_TILES_H;
  const ground = GROUND_TILE[biome.ground];

  const free: Array<[number, number]> = [];
  for (let y = MOAT + 1; y < ROOM_TILES_H - MOAT - 1; y++) {
    for (let x = MOAT + 1; x < ROOM_TILES_W - MOAT - 1; x++) {
      if (reserved.has(`${ox + x},${oy + y}`)) continue;
      if (world.at(ox + x, oy + y) === ground) free.push([x, y]);
    }
  }
  rng.shuffle(free);

  const budget = Math.round((room.kind === 'treasure' ? 8 : 5) * biome.propDensity) + 1;
  let i = 0;
  for (let n = 0; n < budget && i < free.length; n++, i++) {
    const pick = pickPlaceable('prop', tags, rng);
    // Null is a legitimate answer: a frozen barren scree supports nothing, and
    // the right response is to place nothing rather than reach for a default.
    if (!pick) break;
    const [x, y] = free[i]!;
    world.addProp(pick.key, ox + x, oy + y, pick.solid ?? true, pick.id);
  }

  if (room.kind === 'treasure' && i < free.length) {
    const [x, y] = free[i]!;
    world.addProp('prop.chest.closed', ox + x, oy + y);
  }
}

/**
 * Enemy placement.
 *
 * Composition matters more than count: pairing a ranged type with a melee type
 * forces the player to prioritise, where three of the same type is one fight
 * repeated three times.
 */
function populate(
  world: World,
  room: RoomNode,
  act: Act,
  tags: ReadonlySet<Tag>,
  draft: Draft,
  depth: number,
  reserved: ReadonlySet<string>,
  rng: Rng,
  out: EnemySpawn[],
  mode: DifficultyMode,
): void {
  if (room.kind === 'rest') return;

  const tier = tierFor(act.pressure, depth);
  const diff = difficultyFor(tier, mode);

  // The waking meadow is no longer empty. It was a sanctuary on the theory that
  // arriving to nothing is peaceful; in practice a player holding a sword with
  // nothing to hit learns nothing and wanders. One weak Erratum in some rooms
  // gives the first minute a verb to practise, and tier 0 caps at a single hit,
  // so it teaches without threatening.
  // The waking meadow, in full.
  //
  // Half the rooms held two to four Errata drawn from the whole roster, which
  // over twenty rooms is thirty-odd things to fight before the player has found
  // anything to fight *for*. The complaint it earned — "they overwhelm you fast"
  // — is really about density rather than difficulty: a screen you can cross is
  // what makes a place feel like somewhere you are exploring instead of a series
  // of arenas.
  //
  // So: a third of the rooms, one or two slimes in each, and nothing else in the
  // bestiary. A player should be able to walk the meadow, read the land, and
  // find the road to Amberwake without a fight they did not choose.
  if (depth === 0) {
    if (room.kind === 'entrance' || !rng.chance(MEADOW_OCCUPIED)) return;

    const spots = walkableSpots(world, room, reserved);
    if (spots.length === 0) return;
    const n = rng.chance(0.35) ? 2 : 1;
    for (let i = 0; i < Math.min(n, spots.length); i++) {
      const [tx, ty] = spots[Math.floor((i + 1) * spots.length / (n + 1))]!;
      out.push({ variant: 'slime', x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 1 });
    }
    return;
  }

  // Ceiling on what one screen may hold, applied after every bonus.
  //
  // The pieces are all individually defensible — a treasure room earns a guard,
  // an unstable Draft earns pressure, jitter keeps rooms from feeling stamped —
  // and they stack. Nine on a screen is not a hard fight, it is a screen you
  // cannot read, and the player has to fight their way across every room of the
  // floor to learn anything about it.
  const count = Math.min(
    MAX_PER_ROOM,
    Math.max(
      1,
      diff.count
        + (room.kind === 'treasure' ? 1 : 0)
        + Math.min(2, Math.floor(draft.instability / 3))
        + rng.int(0, 1),
    ),
  );

  const spots = walkableSpots(world, room, reserved);
  if (spots.length === 0) return;

  // The big ones are scarce on purpose. Rarity is what makes that silhouette
  // mean something when it finally fills a doorway — and the curve now decides,
  // so they cannot turn up in the first dungeon by accident.
  //
  // Decided *before* the room is filled, and it costs two of the regulars. A
  // hulk used to be added on top of a full room, which is how a screen capped at
  // six ended up holding seven with the largest thing in the game among them.
  const big = diff.bigChance > 0 && room.kind === 'combat'
    && rng.chance(diff.bigChance) && spots.length > count + 4;
  const regulars = big ? Math.max(1, count - 2) : count;

  composeEncounter(spots, room, regulars, tags, rng, out);

  if (big) {
    const [tx, ty] = spots[regulars + 1]!;
    out.push({ variant: 'hulk', x: tx * TILE + TILE / 2, y: ty * TILE + TILE - 1 });
  }
}
