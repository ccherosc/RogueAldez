/**
 * Scene orchestration: the Draft loop.
 *
 * Owns the Draft record, the generated world, entities, player, camera, effects
 * and UI, and runs the state machine between them:
 *
 *   playing -> (health hits zero) -> revising -> playing (next Draft)
 *
 * Cross-subsystem work lives here by design. Sword resolution reads the player
 * and writes to entities and fx; room transitions span camera, player and input.
 * Those subsystems sit either side of each other in the layer order and must not
 * import one another, so the orchestration is the scene's job.
 */

import { ROOM_TILES_H, ROOM_TILES_W, viewport } from '../core/const.ts';
import { bus } from '../core/bus.ts';
import { makeRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import { TILE } from '../art/tiles.ts';
import { Camera, SCROLL_FRAMES_H, SCROLL_FRAMES_V } from '../render/camera.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { World, tileKey, TileKind } from '../world/tilemap.ts';
import { EntityStore, ENEMY_HITSTUN_FRAMES } from '../entity/store.ts';
import type { Entity } from '../entity/store.ts';
import { Player, HEART_UNITS, START_HEARTS } from '../player/player.ts';
import type { InputSnapshot } from '../player/input.ts';
import {
  Loadout, BOMB_FUSE, BLAST_FRAMES, BLAST_RADIUS, BOMB_DAMAGE, BOMB_SELF_DAMAGE,
  BOOMERANG_SPEED, BOOMERANG_REACH, BOOMERANG_STUN, BOOMERANG_DAMAGE,
} from '../player/items.ts';
import { Brains } from '../ai/brains.ts';
import { Hitstop, HITSTOP_HEAVY, HITSTOP_NORMAL } from '../fx/hitstop.ts';
import { Particles } from '../fx/particles.ts';
import { rollDraft, diffDrafts, draftSummary } from '../chronicle/draft.ts';
import type { Draft, Revision } from '../chronicle/draft.ts';
import { actAt, isActFinale, FINAL_ACT } from '../chronicle/acts.ts';
import type { Act } from '../chronicle/acts.ts';
import { biomesForAct, classify, BIOMES } from '../worldgen/biomes.ts';
import { pickPlaceable } from '../worldgen/placeables.ts';
import type { Biome } from '../worldgen/biomes.ts';
import { ClimateMap } from '../worldgen/fields.ts';
import { RELICS, resolveEffects } from '../chronicle/relics.ts';
import type { RelicEffects, RelicId } from '../chronicle/relics.ts';
import { drawReliquary } from '../ui/reliquary.ts';
import { sfx } from '../audio/sfx.ts';
import { music } from '../audio/music.ts';
import {
  tierFor, difficultyFor, damageScale, DEFAULT_MODE, DIFFICULTY_MODES,
} from '../chronicle/difficulty.ts';
import type { DifficultyMode } from '../chronicle/difficulty.ts';
import { beatFor, objectiveLine, beatThought } from '../chronicle/thread.ts';
import type { Beat } from '../chronicle/thread.ts';
import { selfTalk, IDLE_LINES } from '../chronicle/hints.ts';
import type { HintTarget } from '../chronicle/hints.ts';
import { generateFloor, gateBarTiles } from '../gen/floor.ts';
import type { GeneratedFloor } from '../gen/floor.ts';
import { loadSave, writeSave, emptySave } from './save.ts';
import type { SaveData } from './save.ts';
import type { Fixture } from './fixtures.ts';
import { biomeById } from '../worldgen/biomes.ts';
import { drawHud } from '../ui/hud.ts';
import { drawTextCentred } from '../ui/text.ts';
import type { LightBuffer } from '../render/lights.ts';
import { drawMenu, menuLength, BOSS_ITEMS } from '../ui/menu.ts';
import { Tutor, LESSON_IDS } from '../ui/tutor.ts';
import { drawPack, drawOffer } from '../ui/pack.ts';
import { drawTalk } from '../ui/talk.ts';
import { drawShop } from '../ui/shop.ts';
import {
  levelForXp, levelProgress, xpForKill, bonusHearts, merchantTierFor, priceOf, sellValue,
  xpForLevel,
} from '../chronicle/level.ts';
import { generateTown, TOWN_COLS, TOWN_ROWS } from '../gen/town.ts';
import type { TownResident } from '../gen/town.ts';
import { CONDITION_PROFILES, TOWN_CONDITIONS } from '../worldgen/townsfolk.ts';
import type { TownCondition } from '../worldgen/townsfolk.ts';
import { speak } from '../worldgen/voices.ts';
import { Inventory } from './inventory.ts';
import {
  dropTier, makeWeapon, makeArmour, makeTreasure, makeEpicWeapon, makeEpicArmour, WEAPON_TYPES,
  MAX_TIER,
} from '../chronicle/gear.ts';
import type { GearItem } from '../chronicle/gear.ts';
import type { MenuState, PadStatus } from '../ui/menu.ts';
import { drawRevision, revisionReadyAt } from '../ui/revision.ts';
import type { SolidQuery } from '../physics/collide.ts';

/** What Amberwake adds to your name each time you draw on someone in it. */
const BOUNTY_PER_OFFENCE = 5;

/** How long each region sits behind the title before the next one. */
const TITLE_CYCLE = 420;

/** Distance at which the gate explains itself, and at which it opens. */
const TOWN_GATE_PROMPT = 44;
const TOWN_GATE_ENTER = 18;

/** Invulnerable frames granted on arriving in a new room. Quarter of a second. */
const ARRIVAL_GRACE = 15;

const ROOM_PX_W = ROOM_TILES_W * TILE;
const ROOM_PX_H = ROOM_TILES_H * TILE;
const DOORWAY_NUDGE = 16;
const SHADOW_ALPHA = 0.32;
const PICKUP_RADIUS = 10;

interface PropStats {
  solid: boolean;
  breakable: boolean;
  debris: string;
  liftable?: boolean;
  hp?: number;
  drop?: string;
  dropChance?: number;
  /** becomes an open chest and spills loot rather than shattering */
  opens?: boolean;
  /** blades and boomerangs clink off; only a blast harms it */
  armored?: boolean;
}

/** How far in front of Aldez a prop can be and still be grabbed. */
/**
 * Bosses that always leave a named trophy. The name is the reward as much as
 * the numbers are - `warden cleaver` is a story, `iron axe` is an item.
 */
const BOSS_TROPHY: Record<string, string> = {
  warden: 'warden',
  hulk: 'hulk',
  colossus: 'colossus',
};

const LIFT_REACH = 18;
/** Moat thickness in tiles — mirrors gen/floor.ts. */
const MOAT = 2;
const THROW_SPEED = 2.8;
const THROW_LIFETIME = 44;
const THROWN_DAMAGE = 2;

const PROP_STATS: Record<string, PropStats> = {
  // Undergrowth: you wade straight through it, but it still cuts, lifts and throws.
  'prop.bush': { solid: false, breakable: true, liftable: true, debris: 'fx.leaf', drop: 'pickup.heart', dropChance: 0.25 },
  'prop.flower': { solid: false, breakable: true, debris: 'fx.leaf' },
  // A standing tree shrugs off blades — only a blast (or a future axe) fells it.
  'prop.tree': { solid: true, breakable: true, armored: true, hp: 2, debris: 'fx.splinter' },
  'prop.pot': { solid: true, breakable: true, liftable: true, debris: 'fx.shard', drop: 'pickup.shard', dropChance: 0.5 },
  // Chests take a hit to open rather than to break — breakable so the sword
  // registers, but they turn into an open chest and spill loot instead of dying.
  'prop.chest.closed': { solid: true, breakable: true, debris: 'fx.spark', hp: 1, opens: true },
  'prop.torch.0': { solid: true, breakable: false, debris: 'fx.spark' },
  'prop.dummy': { solid: true, breakable: true, debris: 'fx.splinter', hp: 9999 },
};

interface Drawable {
  key: string;
  x: number;
  y: number;
  /**
   * Painter-sort key, when it differs from the draw position. A shield or a
   * carried pot is drawn above the feet but must sort *with* the body, not by
   * where its pixels land.
   */
  sortY?: number;
  alpha?: number;
  flash?: number;
}

export type SceneMode = 'playing' | 'revising' | 'reliquary' | 'menu' | 'pack' | 'offer' | 'talk' | 'shop';

export class Scene {
  world!: World;
  entities!: EntityStore;
  readonly player: Player;
  readonly camera = new Camera();
  readonly hitstop = new Hitstop();
  readonly particles = new Particles();

  draft!: Draft;
  mode: SceneMode = 'playing';
  readonly menu: MenuState = { screen: 'root', cursor: 0 };
  /** live pad readout for the controls screen; main.ts fills it each frame */
  padStatus: PadStatus | undefined;
  /** rebirth hint lines, shown for hintFrames after each waking */
  private hintLines: [string, string] | null = null;
  private hintFrames = 0;
  tick = 0;
  /**
   * Debug: walk through anything that would hurt you. Terrain still stops you,
   * so this is for exploring the map, not for clipping through it.
   */
  invincible = false;
  /** how deep into the current Draft — resets when Aldez falls */
  depth = 0;
  amber = 0;
  propsBroken = 0;
  enemiesKilled = 0;
  /** lifetime counters, mirrored into the save */
  metaKills = 0;
  metaRoomsCleared = 0;

  private brains!: Brains;
  private floor!: GeneratedFloor;
  private isSolid!: SolidQuery;
  private readonly rng: Rng;
  private roomX = 0;
  private roomY = 0;
  /** the room being left, drawn during a transition scroll in fogged dungeons */
  private prevRoomX = 0;
  private prevRoomY = 0;
  private nudgeX = 0;
  private nudgeY = 0;
  private nudgeFrames = 0;
  readonly loadout = new Loadout();
  /**
   * Gear survives death and dies with the window. Relics are bound to Aldez and
   * live in the save; a sword is something he picked up in a world that no
   * longer exists, and the Chronicle has no record of it.
   */
  readonly pack = new Inventory();
  private packCursor = 0;
  /** gear awaiting a yes/no swap decision */
  private offer: GearItem | null = null;
  private offerYes = true;
  /** the town, when standing in one */
  private town: { condition: TownCondition; residents: TownResident[]; gate: { x: number; y: number } } | null = null;
  private talkingTo: TownResident | null = null;
  private talkLine = '';
  private nearFolk: TownResident | null = null;
  /** guards hunting the player after an assault */
  private townAlarm = 0;
  /**
   * Experience, and therefore level. Session-scoped like gear: the world is
   * rewritten and Aldez is not, so every life starts further along than the last.
   */
  xp = 0;
  private shopStock: GearItem[] = [];
  private shopSide: 'buy' | 'sell' = 'buy';
  private shopCursor = 0;
  private levelBanner = 0;
  /** A one-line confirmation that a setting took, and what it changed. */
  private notice = '';
  private noticeFrames = 0;
  /**
   * Aldez's own voice: a line on arriving somewhere new, then a long cooldown.
   * Named apart from the rebirth `hint*` fields above, which are a different
   * thing that happens once per waking.
   */
  private mutter = '';
  private mutterFrames = 0;
  private mutterCooldown = 0;
  private roomsVisited = new Set<string>();
  private inTown = false;
  /** the road marker in the meadow that leads to Amberwake */
  private townGate: Entity | null = null;
  /** person-Draft pairs already counted toward Echo Memory */
  private metThisDraft = new Set<string>();
  private pickupBanner = 0;
  /** contextual teaching; learned flags persist so a veteran is never re-taught */
  readonly tutor: Tutor;
  private movedOnce = false;
  private musicLevel = 0;
  private stepPhase = 0;
  private stepFoot = 0;
  private swungOnce = false;
  private liftedOnce = false;
  private usedItemOnce = false;
  private carriedId: number | null = null;
  private boomerang: {
    id: number;
    outbound: boolean;
    travelled: number;
    /** unique per throw — see hitToken */
    token: number;
  } | null = null;
  /**
   * Strike token for thrown weapons, unique per throw.
   *
   * Entities are pooled, so their ids are reused. Using the entity id as the
   * "swing id" meant a boomerang could inherit an id whose target had already
   * recorded that strike, and `hit()` would reject the blow as a duplicate — the
   * throw passed straight through and stunned nothing. Counting down from a
   * value no sword swing will ever reach keeps the two spaces apart.
   */
  private hitToken = -1000;
  /** transient blast sprites, purely visual */
  private blasts: Array<{ x: number; y: number; frame: number }> = [];
  /** rooms whose fight is already won, so re-entering never re-locks or re-rewards */
  private clearedRooms = new Set<string>();
  private barredRoom: string | null = null;
  private barIds: number[] = [];
  /** frames of the "cleared" flourish remaining */
  private clearPulse = 0;
  /** frames the "you have reached X" Act banner stays up */
  private actBanner = 0;
  private revisionFrame = 0;
  private revisions: Revision[] = [];
  private pendingDraft: Draft | null = null;
  private readonly drawList: Drawable[] = [];
  private readonly hitScratch: Entity[] = [];

  readonly save: SaveData;
  act: Act;
  biome!: Biome;
  private readonly climate: ClimateMap;
  private readonly fixture: Fixture | null;
  /** dedicated stream so the weather can never shift world generation */
  private readonly ambientRng: Rng;
  owned: Set<RelicId>;
  effects: RelicEffects;
  reliquaryCursor = 0;

  constructor(seed = 0x414c445a, fixture: Fixture | null = null) {
    this.fixture = fixture;
    // A fixture is a sealed scenario: it must not inherit a save, or the test
    // result depends on how much the developer happened to have played.
    this.save = fixture ? emptySave(fixture.seed) : loadSave(seed);
    if (fixture) {
      this.save.actIndex = fixture.act;
      if (fixture.amber !== undefined) this.save.amber = fixture.amber;
      if (fixture.relics) this.save.relics = [...fixture.relics];
    }
    // Resume the same world across sessions: the saved seed is the world, so a
    // returning player continues their Ostreya rather than getting a new one.
    this.rng = makeRng(this.save.worldSeed);
    // The climate map is the world's geography and derives from the world seed
    // alone — the same seed always grows the same Ostreya.
    this.climate = new ClimateMap(this.save.worldSeed);
    // Fixtures skip teaching entirely: a sealed scenario must not have prompts
    // appearing over the thing a capture check is measuring.
    this.tutor = new Tutor(this.fixture ? LESSON_IDS : (this.save.taught ?? []));
    this.ambientRng = this.rng.stream('ambient-weather');
    this.amber = this.save.amber;
    this.metaKills = this.save.totalKills;
    this.metaRoomsCleared = this.save.roomsCleared;
    this.owned = new Set(this.save.relics as RelicId[]);
    this.effects = resolveEffects(this.owned);
    this.act = actAt(this.save.actIndex);
    this.player = new Player(0, 0);
    this.draft = rollDraft(this.save.draftsLived, this.rng, this.save.draftsLived - 1);
    this.loadDraft(this.draft);
    // Boot lands on the menu. Fixtures skip it — a test must land in gameplay
    // immediately.
    // Order matters: loadDraft ends by setting mode to 'playing', so the
    // showcase has to be loaded before the menu is raised over it.
    if (!this.fixture) {
      this.showcase();
      this.mode = 'menu';
    }
  }

  /**
   * Load a random region to sit behind the title.
   *
   * The menu used to be drawn over the hub, which meant the first thing anyone
   * ever saw was the same meadow every time — and the meadow is deliberately the
   * least remarkable place in the game. Sixteen biomes, big Errata and a whole
   * enemy roster existed and none of it was on the title screen.
   *
   * It is scenery, not a level: a deeper floor so the roster is interesting, and
   * a fresh one each time the player backs out to the menu. `start` throws it
   * away and loads the real meadow, so nothing here can leak into a run.
   */
  private showcase(): void {
    // Keyed on the life as well as the visit count. The world seed is a fixed
    // constant, so without draftsLived every player's first title screen would
    // be the same region forever.
    const rng = this.rng.stream(`showcase:${this.save.draftsLived}:${this.showcaseCount++}`);
    this.forcedBiome = rng.pick(BIOMES).id;
    this.loadDraft(this.draft, 3 + rng.int(0, 3));
  }

  private showcaseCount = 0;
  /**
   * True until the player starts a run.
   *
   * The pause menu and the title are the same screen, and only one of them may
   * throw the world away to load a new backdrop. Without this flag, pressing Esc
   * mid-run would eventually destroy the floor being played.
   */
  /** Thread state: what Aldez has actually done this life. */
  private visitedTown = false;
  private spokeToAnyone = false;
  private traded = false;
  private lastBeat: Beat | null = null;

  private atTitle = true;
  private titleTimer = 0;

  /** Recompute cached relic numbers and push the ones the player owns. */
  private applyRelics(): void {
    this.effects = resolveEffects(this.owned);
    this.player.maxHealth = (START_HEARTS + this.effects.bonusHearts) * HEART_UNITS;
    this.player.speedMultiplier = this.effects.speedMultiplier;
    this.player.bonusIframes = this.effects.bonusIframes;
    this.player.sword.chargeMultiplier = this.effects.spinChargeMultiplier;
  }

  /** Buy or awaken the highlighted relic. */
  awakenSelected(): boolean {
    const relic = RELICS[this.reliquaryCursor];
    if (!relic || this.owned.has(relic.id) || this.amber < relic.cost) return false;
    this.amber -= relic.cost;
    this.owned.add(relic.id);
    this.save.relics = [...this.owned];
    this.applyRelics();
    this.player.health = this.player.maxHealth;
    this.persist();
    sfx.relic();
    return true;
  }

  /** Fold live counters into the save and write it out. */
  private persist(): void {
    // Fixtures are sealed scenarios — a test run must never overwrite the
    // player's real save.
    if (this.fixture) return;
    this.save.amber = this.amber;
    // What the player has proved they know. Carrying this across Drafts is the
    // difference between teaching and nagging.
    this.save.taught = this.tutor.known;
    this.save.draftsLived = this.draft.index;
    this.save.bestDepth = Math.max(this.save.bestDepth, this.depth + 1);
    this.save.totalKills = this.metaKills;
    this.save.roomsCleared = this.metaRoomsCleared;
    this.save.actIndex = this.act.index;
    this.save.relics = [...this.owned];
    writeSave(this.save);
  }

  // -------------------------------------------------------------------------
  // Draft lifecycle
  // -------------------------------------------------------------------------

  private loadDraft(draft: Draft, depth = 0): void {
    this.depth = depth;
    // Seed per (draft, act, depth) so descending gives a genuinely different
    // floor while the whole run stays reproducible from the Draft seed alone.
    const floorRng = makeRng(draft.seed + depth * 0x9e37 + this.act.index * 0x51ed);

    // Geography first: sample the climate at this floor's coordinate and let the
    // biome fall out of it, restricted to the Acts the player has reached. The
    // fields are continuous, so consecutive floors drift through related biomes
    // rather than teleporting between unrelated ones.
    if (this.fixture) {
      this.biome = biomeById(this.fixture.biomeId);
    } else if (this.forcedBiome) {
      this.biome = biomeById(this.forcedBiome);
      this.forcedBiome = null;
    } else if (depth === 0) {
      // Home is grassland, always. Waking in a fen one Draft and a bog the next
      // made every rebirth feel like a different game — the meadow is the
      // constant the strangeness is measured against. Climate takes over from
      // floor two.
      this.biome = biomeById('meadow');
    } else {
      const pool = biomesForAct(this.act.index);
      const climate = this.climate.sample(this.act.index * 7 + depth * 1.7, depth * 2.3);
      this.biome = classify(climate.elevation, climate.moisture, climate.temperature, pool);
    }

    this.floor = generateFloor(draft, this.act, this.biome, floorRng, depth, this.difficulty);
    music.setMood(this.biome.mode, this.biome.root);
    this.world = this.floor.world;
    this.entities = new EntityStore(this.world.tilesW);
    this.brains = new Brains(floorRng.stream('brains'));
    this.particles.clear();
    this.hitstop.clear();

    for (const prop of this.world.props) {
      const stats = PROP_STATS[prop.key] ?? { solid: true, breakable: false, debris: 'fx.spark' };
      this.entities.spawn({
        kind: 'prop',
        spriteKey: prop.key,
        x: prop.tx * TILE + TILE / 2,
        y: prop.ty * TILE + TILE - 1,
        halfW: 6,
        boxH: 12,
        hp: stats.hp ?? 1,
        solid: stats.solid,
        breakable: stats.breakable,
        liftable: stats.liftable ?? false,
        armored: stats.armored ?? false,
        debris: stats.debris,
      });
    }
    this.carriedId = null;

    // The ramp: the same Octorok that dies in two hits on floor two takes four
    // in the Belliron Peaks. Keese stay fragile — a tanky bat is just tedious.
    const diff = difficultyFor(tierFor(this.act.pressure, depth), this.difficulty);
    // Pacing is a property of the floor, so it is set once here rather than
    // re-derived per enemy.
    this.brains.setPacing(diff.speed, diff.telegraph);
    for (const spawn of this.floor.enemies) {
      const e = this.entities.spawn(Brains.spawnInit(spawn.variant, spawn.x, spawn.y));
      // The cap is the promise: nothing but a boss takes more than two hits
      // until the player has cleared an Act. Bosses are exempt — a Colossus you
      // can kill in two swings is not a Colossus.
      if (e.variant !== 'hulk' && e.variant !== 'colossus') {
        e.hp = Math.min(e.hp, diff.maxHp);
      }
      this.registerIn(e);
    }

    // Fauna — but never under a fixture. Critters wander, and a sealed test
    // scenario must not contain anything that moves on its own schedule.
    if (!this.fixture) {
      for (const spawn of this.floor.critters) {
        const c = this.entities.spawn(Brains.critterInit(spawn.variant, spawn.x, spawn.y));
        this.brains.register(c);
      }
    }

    // Terrain solidity comes from the tile grid, prop solidity from the entity
    // store. Composing here keeps physics/ ignorant of both.
    this.isSolid = (tx, ty) => this.world.isSolid(tx, ty) || this.entities.solidAt(tx, ty);

    // The Last Certainty: Aldez always wakes where his existence was firmly
    // established, which is the entrance room of the new Draft. Descending keeps
    // whatever health he arrived with; only a rewrite restores him.
    const carriedHealth = depth > 0 ? this.player.health : 0;
    this.player.reset(this.floor.spawn.x, this.floor.spawn.y);
    this.applyRelics();
    this.player.health = depth > 0 ? carriedHealth : this.player.maxHealth;

    // Belt and braces on top of the generator's reservation: if anything solid
    // still overlaps the spawn, clear it. Waking up stuck inside scenery is the
    // worst possible first impression of a new Draft.
    for (const e of this.entities.all) {
      if (!e.alive || !e.solid) continue;
      const dx = Math.abs(e.x - this.player.x);
      const dy = Math.abs(e.y - this.player.y);
      if (dx < 14 && dy < 14) this.entities.kill(e);
    }

    // No test pads in the opening any more.
    //
    // Three gold rings and a wall of biome names were the first thing a new
    // player ever saw, in the one room whose whole job is to establish that this
    // is a place. Debug scaffolding in the first ten seconds costs more than it
    // saves — and nothing is lost, because Esc -> Teleport reaches every biome
    // from anywhere, which is strictly better for testing anyway.
    if (this.fixture) this.applyFixture(this.fixture);
    // A town fixture bypasses the gate entirely: walking there would make the
    // check depend on pathfinding across the meadow, which is not what it tests.
    if (this.fixture?.town && !this.inTown) {
      if (this.fixture.level !== undefined) this.xp = xpForLevel(this.fixture.level);
      this.enterTown(this.fixture.town);
    }
    // The road to Amberwake. Depth 0 only: the meadow is the one place with a
    // way out that is not downward, which is what makes the town feel like a
    // destination rather than another floor.
    if (!this.fixture && depth === 0 && !this.inTown) {
      const gx = this.floor.spawn.x + 120;
      const gy = this.floor.spawn.y - 40;
      this.townGate = this.entities.spawn({
        kind: 'prop', spriteKey: 'prop.teleporter.0',
        x: gx, y: gy, halfW: 8, boxH: 8, solid: false, breakable: false,
      });
    } else {
      this.townGate = null;
    }
    this.teleportCooldown = 50;
    this.wasOnPad = true; // assume arrival on a pad until proven otherwise
    const room = this.world.roomAt(this.player.x, this.player.y);
    this.roomX = room.rx;
    this.roomY = room.ry;
    this.camera.snapTo(this.roomX * ROOM_PX_W, this.roomY * ROOM_PX_H);
    // The thread is per life, like everything else the world forgets.
    this.visitedTown = false;
    this.spokeToAnyone = false;
    this.traded = false;
    this.lastBeat = null;
    this.clearedRooms.clear();
    this.barredRoom = null;
    this.barIds = [];
    this.clearPulse = 0;
    this.mode = 'playing';
  }

  /**
   * Replace whatever generation produced with the fixture's exact scenario.
   *
   * Applied after a normal load so the floor is still a real, solvable floor —
   * only the things being tested are pinned. That keeps fixtures honest: they
   * exercise the actual generator, not a stub.
   */
  private applyFixture(fixture: Fixture): void {
    if (fixture.enemies) {
      for (const e of this.entities.all) {
        if (e.alive && e.kind === 'enemy') this.entities.kill(e);
      }
      for (const spawn of fixture.enemies) {
        const e = this.entities.spawn(
          Brains.spawnInit(spawn.variant, this.player.x + spawn.dx, this.player.y + spawn.dy),
        );
        this.registerIn(e);
      }
    }

    if (fixture.clearProps) {
      for (const e of this.entities.all) {
        if (e.alive && e.kind === 'prop') this.entities.kill(e);
      }
    }

    for (const prop of fixture.props ?? []) {
      const stats = PROP_STATS[prop.key] ?? { solid: true, breakable: false, debris: 'fx.spark' };
      this.entities.spawn({
        kind: 'prop',
        spriteKey: prop.key,
        x: this.player.x + prop.dx,
        y: this.player.y + prop.dy,
        halfW: 6,
        boxH: 12,
        hp: stats.hp ?? 1,
        solid: stats.solid,
        breakable: stats.breakable,
        liftable: stats.liftable ?? false,
        armored: stats.armored ?? false,
        debris: stats.debris,
      });
    }

    if (fixture.health !== undefined) this.player.health = fixture.health;
  }

  // =========================================================================
  // TEMPORARY — biome test scaffold. Remove once biomes are reachable by play.
  //
  // Three pads in the very first room, each jumping to a random biome so every
  // one can be looked at without descending fifteen floors to reach it. Gated to
  // the opening room of a fresh session, and skipped entirely under a fixture so
  // it can never perturb a test.
  // =========================================================================

  private teleporterIds: number[] = [];
  /** which biome each pad leads to, so the label can say so before you commit */
  private teleporterTargets = new Map<number, Biome>();
  /** biome to force on the next load, set by stepping on a pad */
  private forcedBiome: string | null = null;

  private placeTestTeleporters(): void {
    this.teleporterIds = [];
    this.teleporterTargets.clear();

    // Roll destinations up front and label them. A pad whose destination is a
    // surprise is useless for testing — you cannot go and look at the one you
    // actually want to see.
    const roll = this.rng.stream(`pads:${this.draft.seed}:${this.biome.id}:${this.depth}`);
    const pool = BIOMES.filter((b) => b.id !== this.biome.id);
    roll.shuffle(pool);

    const offsets: Array<[number, number]> = [[-46, -30], [0, -38], [46, -30]];
    offsets.forEach(([dx, dy], i) => {
      const pad = this.entities.spawn({
        kind: 'prop',
        spriteKey: 'prop.teleporter.0',
        x: this.player.x + dx,
        y: this.player.y + dy,
        halfW: 7,
        boxH: 8,
        solid: false,
        breakable: false,
        debris: 'fx.spark',
      });
      this.teleporterIds.push(pad.id);
      const target = pool[i % pool.length];
      if (target) this.teleporterTargets.set(pad.id, target);
    });
  }

  /** frames before the pads arm after a load — you must be able to arrive on one */
  private teleportCooldown = 0;
  private wasOnPad = false;

  /** Standing on a pad rolls a biome and rebuilds the floor in it. */
  private checkTeleporters(): void {
    if (this.teleporterIds.length === 0) return;
    // Arm only after a beat, and only after the player has stepped off any pad.
    // Without both, walking across the hub chain-fires teleports: arrive, be
    // standing near a fresh pad, instantly leave again.
    if (this.teleportCooldown > 0) {
      this.teleportCooldown--;
      return;
    }
    const onPadNow = this.teleporterIds.some((id) => {
      const pad = this.entities.all.find((e) => e.id === id);
      if (!pad || !pad.alive) return false;
      const dx = pad.x - this.player.x;
      const dy = pad.y - this.player.y;
      return dx * dx + dy * dy <= 12 * 12;
    });
    if (this.wasOnPad) {
      this.wasOnPad = onPadNow;
      return;
    }
    this.wasOnPad = onPadNow;
    if (!onPadNow) return;

    for (const id of this.teleporterIds) {
      const pad = this.entities.all.find((e) => e.id === id);
      if (!pad || !pad.alive) continue;
      const dx = pad.x - this.player.x;
      const dy = pad.y - this.player.y;
      if (dx * dx + dy * dy > 12 * 12) continue;

      const target = this.teleporterTargets.get(id);
      if (!target) continue;
      this.forcedBiome = target.id;
      this.teleporterIds = [];
      this.particles.burst(this.player.x, this.player.y - 8, {
        key: 'fx.spark', count: 20, speed: 2.0, lift: 2.4,
      });
      sfx.stairs(true);
      this.act = actAt(target.act);
      this.loadDraft(this.draft, 0);
      this.seedArrivalFoes();
      return;
    }
  }

  /**
   * Put something to fight in the arrival room.
   *
   * The entrance is normally kept empty on purpose — never ambush a player on
   * arrival — but a teleport exists to *show* a biome, and an empty field shows
   * only half of it. Picked through the contract filter so the Errata still suit
   * the place.
   */
  private seedArrivalFoes(): void {
    const roll = this.rng.stream(`arrival:${this.biome.id}`);
    const ring: Array<[number, number]> = [[64, 0], [-64, 0], [0, 56], [0, -56]];
    for (const [dx, dy] of ring) {
      const pick = pickPlaceable('enemy', this.floor.tags, roll);
      if (!pick) return; // nothing suits this biome; leave it empty rather than lie
      const x = this.player.x + dx;
      const y = this.player.y + dy;
      if (!this.world.isWalkable(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      const e = this.entities.spawn(Brains.spawnInit(pick.key, x, y));
      this.registerIn(e);
    }
  }

  // -------------------------------------------------------------------------
  // Secondary items
  // -------------------------------------------------------------------------

  private useItem(): void {
    if (this.player.carrying || this.player.sword.swinging) return;
    const item = this.loadout.selected;
    if (!item || !this.loadout.canUse()) return;

    if (item.id === 'bomb') {
      this.loadout.consume();
      // Dropped at the feet, not thrown: the whole tension of a bomb is having to
      // leave before it goes off.
      this.entities.spawn({
        kind: 'projectile',
        spriteKey: 'item.bomb',
        variant: 'bomb',
        owner: 'player',
        x: this.player.x,
        y: this.player.y,
        halfW: 6,
        boxH: 10,
        hp: BOMB_FUSE,
        solid: false,
        breakable: false,
        debris: 'fx.spark',
      });
      sfx.lift();
      bus.emit('item:used', { item: 'bomb', x: this.player.x, y: this.player.y });
      return;
    }

    // One boomerang in the air at a time, like the original.
    if (this.boomerang !== null) return;
    const [fx, fy] = this.player.facingVector;
    const thrown = this.entities.spawn({
      kind: 'projectile',
      spriteKey: 'fx.boomerang.0',
      variant: 'boomerang',
      owner: 'player',
      x: this.player.x + fx * 8,
      y: this.player.y - 8 + fy * 8,
      halfW: 5,
      boxH: 8,
      hp: 600,
      solid: false,
      breakable: false,
      vx: fx * BOOMERANG_SPEED,
      vy: fy * BOOMERANG_SPEED,
    });
    this.boomerang = { id: thrown.id, outbound: true, travelled: 0, token: this.hitToken-- };
    sfx.throw();
    bus.emit('item:used', { item: 'boomerang', x: this.player.x, y: this.player.y });
  }

  /**
   * Boomerang flight, steered from here rather than from the entity.
   *
   * Only one can be airborne, so a single piece of scene state is simpler and
   * cheaper than three more fields on every entity in the game.
   */
  private updateBoomerang(): void {
    if (this.boomerang === null) return;
    const e = this.entities.all.find((x) => x.id === this.boomerang?.id);
    if (!e || !e.alive) {
      this.boomerang = null;
      return;
    }

    if (this.boomerang.outbound) {
      this.boomerang.travelled += BOOMERANG_SPEED;
      const tx = Math.floor(e.x / TILE);
      const ty = Math.floor(e.y / TILE);
      // Turn back on reach or on a wall — it should never simply vanish.
      if (this.boomerang.travelled >= BOOMERANG_REACH || this.world.isSolid(tx, ty)) {
        this.boomerang.outbound = false;
      }
    } else {
      // Home on the player, who has probably moved since the throw.
      const dx = this.player.x - e.x;
      const dy = this.player.y - 8 - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.vx = (dx / len) * BOOMERANG_SPEED;
      e.vy = (dy / len) * BOOMERANG_SPEED;
      if (len < 12) {
        this.entities.kill(e);
        this.boomerang = null;
        return;
      }
    }

    // Stun what it touches and drag pickups home.
    //
    // The radius is generous on purpose. The boomerang flies at chest height
    // while entities anchor at the feet, so a tight circle left roughly six
    // horizontal pixels of overlap — at 3.2px per frame the throw could pass
    // clean through a standing enemy without ever registering, which is exactly
    // the "the stun doesn't work" report.
    for (const other of this.entities.overlapCircle(e.x, e.y + 6, 18, this.hitScratch)) {
      if (other.kind === 'enemy') {
        if (this.entities.hit(other, this.boomerang.token, BOOMERANG_DAMAGE, e.vx, e.vy)) {
          // Applied AFTER hit(), which set the ordinary 12 — the stun is the
          // boomerang's whole identity, so it overrides rather than adds.
          other.hitstunFrames = BOOMERANG_STUN;
          this.onHit(other, false);
          this.boomerang.outbound = false;
        }
      } else if (other.kind === 'prop' && other.armored) {
        // Clink off a tree and turn back — wood the sword cannot cut, the
        // boomerang cannot either.
        if (other.lastHitSwing !== this.boomerang.token) {
          other.lastHitSwing = this.boomerang.token;
          sfx.hitBlocked();
          this.boomerang.outbound = false;
        }
      } else if (other.kind === 'pickup') {
        // Retrieval: the reason to throw it across a pond.
        other.x += (this.player.x - other.x) * 0.35;
        other.y += (this.player.y - other.y) * 0.35;
      }
    }
  }

  /** Fuse burns down, then a radial blast that does not care whose side you are on. */
  private explodeBomb(e: Entity): void {
    this.entities.kill(e);
    this.blasts.push({ x: e.x, y: e.y - 6, frame: 0 });
    this.camera.shake(4, 12);
    this.hitstop.request(HITSTOP_HEAVY);
    sfx.blast();
    this.particles.burst(e.x, e.y - 6, { key: 'fx.spark', count: 20, speed: 2.2, lift: 2.4 });

    for (const target of this.entities.overlapCircle(e.x, e.y - 6, BLAST_RADIUS, this.hitScratch)) {
      if (target.kind !== 'enemy' && target.kind !== 'prop') continue;
      if (!target.breakable) continue;
      if (this.entities.hit(target, -e.id, BOMB_DAMAGE, target.x - e.x, target.y - e.y)) {
        this.onHit(target, true);
      }
    }

    // Standing in your own blast hurts. It is the cost that makes bombs a
    // decision rather than a free answer to every room.
    const dx = this.player.x - e.x;
    const dy = this.player.y - 6 - e.y;
    if (!this.invincible && dx * dx + dy * dy < BLAST_RADIUS * BLAST_RADIUS) {
      if (this.player.damage(BOMB_SELF_DAMAGE, e.x, e.y)) this.onPlayerHurt();
    }
  }

  /** Frames an enemy flounders before it goes under. */
  private static readonly DROWN_FRAMES = 42;

  /**
   * Anything knocked into deep water drowns.
   *
   * Knockback deliberately bypasses collision — that impact should not be
   * stopped by geometry — which means a hard hit can put an Octorok in a lake.
   * Rather than suppress that, it becomes a way to kill things: shove them in.
   */
  private updateDrowning(): void {
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy') continue;
      const inWater = this.world.isDrowning(Math.floor(e.x / TILE), Math.floor(e.y / TILE));

      if (!inWater) {
        e.drowning = 0;
        continue;
      }

      if (e.drowning === 0) {
        this.particles.burst(e.x, e.y - 4, { key: 'fx.spark', count: 6, speed: 1.2, lift: 1.4 });
        sfx.hitFlesh();
      }
      e.drowning++;
      // Frozen while it struggles: it cannot fight, cannot flee, cannot be saved.
      e.hitstunFrames = Math.max(e.hitstunFrames, 2);

      if (e.drowning >= Scene.DROWN_FRAMES) {
        this.entities.kill(e);
        this.brains.forget(e.id);
        this.enemiesKilled++;
        this.metaKills++;
        this.amber += this.effects.amberPerKill;
        // A splash, not gore — nothing comes back up.
        this.particles.burst(e.x, e.y - 2, { key: 'fx.spark', count: 14, speed: 1.6, lift: 2.0 });
        this.camera.shake(1, 5);
        bus.emit('entity:died', { id: e.id, x: e.x, y: e.y });
      }
    }
  }

  /**
   * The weather. One drifting particle every third of a second, chosen from the
   * biome's tags: leaves on the wind over fertile ground, snow on the White
   * Reach, embers rising off the Flats, dust motes hanging in the dark.
   *
   * This is the single cheapest "the world is alive" effect in the game —
   * something is always moving that wants nothing from the player.
   */
  private spawnAmbient(): void {
    if (this.tick % 20 !== 0) return;
    const r = this.ambientRng;
    const x = this.camera.viewX + r.range(-20, viewport.w + 20);
    const y = this.camera.viewY + r.range(-20, viewport.h + 20);
    const tags = this.floor.tags;

    if (tags.has('frozen')) {
      this.particles.drift(x, y, 'fx.shard.1', 0.12, 0.3, 240);
    } else if (tags.has('arid') || tags.has('hot')) {
      this.particles.drift(x, y, 'fx.spark.1', 0.05, -0.22, 160);
    } else if (tags.has('subterranean') || tags.has('dark')) {
      this.particles.drift(x, y, 'fx.shard.1', 0.03, 0.02, 280);
    } else if (tags.has('wetland')) {
      this.particles.drift(x, y, 'fx.leaf.1', 0.08, -0.06, 220);
    } else {
      // Open country: leaves on a westward wind.
      this.particles.drift(x, y, `fx.leaf.${r.int(0, 1)}`, -0.5, 0.16, 200);
    }
  }

  // -------------------------------------------------------------------------
  // Menu
  // -------------------------------------------------------------------------

  private updateMenu(input: InputSnapshot): void {
    const length = menuLength(this.menu);
    if (input.upPressed) {
      this.menu.cursor = (this.menu.cursor + length - 1) % length;
      sfx.menuMove();
    }
    if (input.downPressed) {
      this.menu.cursor = (this.menu.cursor + 1) % length;
      sfx.menuMove();
    }
    if (input.actionPressed && this.menu.screen !== 'root') {
      this.menu.screen = 'root';
      this.menu.cursor = 0;
      sfx.menuMove();
      return;
    }
    // Drift through the world while nobody is playing. One region is a
    // wallpaper; a rotation is the pitch — sixteen biomes and a whole roster of
    // Errata, none of which used to appear before you pressed start.
    if (this.atTitle && this.menu.screen === 'root') {
      this.titleTimer++;
      if (this.titleTimer >= TITLE_CYCLE) {
        this.titleTimer = 0;
        this.showcase();
        this.mode = 'menu';   // loadDraft ends in 'playing'
      }
    }

    if (!input.attackPressed) return;

    switch (this.menu.screen) {
      case 'root':
        if (this.menu.cursor === 0) {
          // The backdrop is a random deep region; the game starts in the meadow.
          this.atTitle = false;
          this.forcedBiome = null;
          this.loadDraft(this.draft, 0);
          this.mode = 'playing';
          this.showRebirthHint();
        } else {
          const screens = ['difficulty', 'controls', 'teleport', 'boss'] as const;
          this.menu.screen = screens[this.menu.cursor - 1] ?? 'controls';
          // Open the difficulty list on whatever is already chosen, so the
          // current setting is where the cursor starts rather than something the
          // player has to go find.
          this.menu.cursor = this.menu.screen === 'difficulty'
            ? Math.max(0, DIFFICULTY_MODES.indexOf(this.difficulty))
            : 0;
        }
        sfx.pickup();
        break;

      case 'difficulty': {
        const pick = DIFFICULTY_MODES[this.menu.cursor];
        if (pick) {
          this.setDifficulty(pick);
          // Say plainly what took effect now and what waits for the next floor.
          // The alternative is a player who changes the setting, sees the same
          // room, and concludes it is broken.
          this.notice = `${pick} - fully from the next floor`;
          this.noticeFrames = 170;
        }
        this.menu.screen = 'root';
        this.menu.cursor = 1;
        break;
      }

      case 'controls':
        break; // read-only; X goes back

      case 'teleport': {
        const target = BIOMES[this.menu.cursor];
        if (!target) break;
        this.act = actAt(target.act);
        this.forcedBiome = target.id;
        this.loadDraft(this.draft, 0);
        this.seedArrivalFoes();
        this.mode = 'playing';
        this.menu.screen = 'root';
        this.showRebirthHint();
        sfx.stairs(true);
        break;
      }

      case 'boss': {
        const pick = BOSS_ITEMS[this.menu.cursor];
        if (!pick) break;
        // The arena: the boss's home ground, one opponent, nothing else.
        this.act = actAt(pick.id === 'colossus' ? 4 : 1);
        this.forcedBiome = pick.id === 'colossus' ? 'undercity' : 'pinewood';
        this.loadDraft(this.draft, 0);
        const boss = this.entities.spawn(
          Brains.spawnInit(pick.id, this.player.x + 96, this.player.y - 8),
        );
        this.brains.register(boss);
        this.mode = 'playing';
        this.menu.screen = 'root';
        this.showRebirthHint();
        sfx.bars();
        break;
      }
    }
  }

  /**
   * The waking words — what he recognises, and what is wrong.
   *
   * Every Draft opens with the premise restated in one breath: this place is
   * familiar, and something about it is not. Both halves come from the Draft's
   * actual variables, so the hint is information wearing the story's clothes.
   */
  private showRebirthHint(): void {
    const r = makeRng(this.draft.seed).stream('hint');
    const familiar = r.pick([
      `you wake. the ${this.biome.name.toLowerCase()} is as you remember it`,
      'you wake. the shape of the land is familiar',
      'you wake where your existence was last certain',
      'the bells sound the hour they always did',
    ]);
    const strange = r.pick([
      `but ${this.draft.ruler.toLowerCase()} holds ostreya now`,
      `but the land lies ${this.draft.condition}, and it did not before`,
      `but they speak of you as ${this.draft.reputation.toLowerCase()}`,
      `but ${this.draft.faction.toLowerCase()} keeps these roads`,
    ]);
    this.hintLines = [familiar, strange];
    this.hintFrames = 300;
    sfx.wake();
  }

  /**
   * Ambient light for the current place, derived from its tags.
   *
   * Deriving rather than storing it means a new biome is still one data entry —
   * the world builder's whole premise. Daylight is 1,1,1 on purpose: outdoors,
   * lights should *add* glow, never darken the world to make themselves visible.
   */
  private ambientFor(): [number, number, number] {
    const t = this.floor.tags;
    if (t.has('subterranean')) return [0.34, 0.34, 0.46];
    if (t.has('dark')) return [0.58, 0.60, 0.70];
    if (t.has('frozen')) return [0.88, 0.93, 1.04];
    if (t.has('arid') || t.has('hot')) return [1.06, 0.99, 0.86];
    return [1, 1, 1];
  }

  /**
   * Everything in the world that emits light, once per frame.
   *
   * Kept in one place rather than scattered through the draw code: a light is a
   * property of a *thing*, and the list of things that glow is short enough to
   * read at a glance and long enough to be worth seeing together.
   */
  /** the same sources, kept for the batcher's directional pass */
  private readonly directional: Array<{ x: number; y: number; radius: number; strength: number }> = [];

  collectLights(lights: LightBuffer, camX: number, camY: number): void {
    lights.begin(camX, camY, this.ambientFor());
    this.directional.length = 0;

    for (const e of this.entities.all) {
      if (!e.alive || e.carried) continue;
      if (e.spriteKey.startsWith('prop.torch')) {
        // Flicker: two out-of-phase sines so the period never reads as a loop.
        const f = 1 + Math.sin(this.tick * 0.21 + e.id) * 0.06
                    + Math.sin(this.tick * 0.07 + e.id * 3) * 0.04;
        lights.add(e.x, e.y - 10, 74 * f, [1.5, 0.86, 0.42], 1.05);
        // Torches are what the directional pass is *for* — a fixed source you
        // walk around, so the lit side of everything turns as you pass it.
        this.directional.push({ x: e.x, y: e.y - 10, radius: 74 * f, strength: 1 });
      } else if (e.spriteKey.startsWith('prop.teleporter')) {
        lights.add(e.x, e.y - 2, 46, [1.15, 0.92, 0.4], 0.65);
      } else if (e.variant === 'bomb') {
        // Brightens as the fuse burns down — the tell you feel before you see.
        const t = 1 - e.hp / BOMB_FUSE;
        lights.add(e.x, e.y - 6, 30 + t * 26, [1.5, 0.6, 0.25], 0.35 + t * 0.75);
      } else if (e.variant === 'colossus') {
        lights.add(e.x, e.y - 34, 60, [1.4, 0.55, 0.2], 0.8);
      }
    }

    // Blasts: a hard white flash that decays fast.
    for (const blast of this.blasts) {
      const t = 1 - blast.frame / BLAST_FRAMES;
      lights.add(blast.x, blast.y, 90 + blast.frame * 5, [1.7, 1.15, 0.6], t * t * 2.4);
      this.directional.push({
        x: blast.x, y: blast.y, radius: 90 + blast.frame * 5, strength: t * t * 2,
      });
    }

    // The Formcraft rune on Aldez's hand. Faint, and the reason a dungeon is
    // never quite pitch black around him — but scaled by how dark the place
    // actually is, so it does not blow out his hair in broad daylight.
    if (this.player.visible) {
      const ambient = this.ambientFor();
      const dark = Math.max(0, 1 - (ambient[0] + ambient[1] + ambient[2]) / 3);
      if (dark > 0.02) {
        const pulse = 1 + Math.sin(this.tick * 0.05) * 0.12;
        lights.add(this.player.x, this.player.y - 8, 56 * pulse, [0.45, 0.85, 1.05], 0.3 + dark);
      }
    }
  }

  /**
   * Watch what the player is doing and near, and let the tutor decide whether
   * anything is worth saying. The scene owns the *observations*; the tutor owns
   * the judgement, which keeps the teaching rules in one readable list rather
   * than scattered through combat code.
   */
  private updateTutor(input: InputSnapshot): void {
    const walking = input.up || input.down || input.left || input.right;
    if (walking) this.movedOnce = true;

    // Footsteps on the walk cycle's contact frames. Tied to distance travelled
    // rather than to a timer, so the cadence matches the legs at any speed and
    // never drifts out of step with the animation.
    if (walking && !this.player.sword.swinging) {
      this.stepPhase += 1;
      if (this.stepPhase >= 14) {
        this.stepPhase = 0;
        this.stepFoot ^= 1;
        sfx.step(this.stepFoot);
      }
    } else {
      this.stepPhase = 12; // next step lands promptly when they set off again
    }

    if (this.player.sword.swinging) this.swungOnce = true;
    if (this.player.carrying) this.liftedOnce = true;
    if (input.itemPressed) this.usedItemOnce = true;

    const near = (kind: string, radius: number): boolean =>
      this.entities.all.some((e) => {
        if (!e.alive || e.carried || e.kind !== kind) return false;
        return Math.hypot(e.x - this.player.x, e.y - this.player.y) < radius;
      });

    this.tutor.update({
      moved: this.movedOnce,
      swung: this.swungOnce,
      lifted: this.liftedOnce,
      usedItem: this.usedItemOnce,
      nearLiftable: this.entities.all.some((e) =>
        e.alive && !e.carried && e.liftable
        && Math.hypot(e.x - this.player.x, e.y - this.player.y) < 40),
      enemyNear: near('enemy', 110),
      bracing: this.player.bracing,
      exitVisible: Math.hypot(
        this.floor.exit.x - this.player.x,
        this.floor.exit.y - this.player.y,
      ) < 90,
      hasBombs: this.loadout.bombs > 0,
    });
  }

  /**
   * How hard the score is working, 0..1.
   *
   * This was `barredRoom ? 1 : 0`, which meant the music only ever reacted
   * inside dungeons — the entire overworld could be swarming and the bed would
   * stay becalmed. Danger is danger wherever it happens.
   *
   * Three inputs, in rising order of how alarming they are: something is near,
   * several things are near, and you are nearly dead. The last is deliberately
   * the strongest term — a low-health cue is the oldest trick in the genre
   * because it works, and it tells the player something the HUD is too small to
   * shout.
   *
   * Eased rather than set, so a single Keese drifting past does not swell the
   * whole score for four frames.
   */
  private musicIntensity(): number {
    if (this.barredRoom) {
      this.musicLevel = 1;
      return 1;
    }
    let near = 0;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy') continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < 140) near++;
    }
    const health = this.player.health / Math.max(1, this.player.maxHealth);
    let target = 0;
    if (near > 0) target = 0.45;
    if (near >= 3) target = 0.75;
    if (health <= 0.3) target = Math.max(target, 0.9);

    // Rises quickly, falls slowly: a fight should announce itself and then let
    // go, not flicker with every enemy that wanders in and out of range.
    const rate = target > this.musicLevel ? 0.08 : 0.012;
    this.musicLevel += (target - this.musicLevel) * rate;
    return this.musicLevel;
  }

  /**
   * Roll a piece of gear and hand it over.
   *
   * `generosity` is the chance anything drops at all. Chests pass 1 — opening a
   * chest and getting nothing is the single most disappointing thing a game can
   * do. Ordinary kills pass something small, because loot that falls constantly
   * stops being loot.
   */
  private tryDrop(x: number, y: number, generosity: number): void {
    const rng = this.rng.stream(`drop:${this.draft.seed}:${this.tick}:${Math.round(x)}`);
    if (!rng.chance(generosity)) return;

    const tier = dropTier(tierFor(this.act.pressure, this.depth), rng.next());
    const roll = rng.next();
    const item = roll < 0.62
      ? makeWeapon(rng.pick(WEAPON_TYPES), tier)
      : roll < 0.82
        ? makeArmour(tier)
        : makeTreasure(tier);

    this.giveGear(item, x, y);
  }

  /**
   * Hand over a piece of gear, offering the swap when it is an upgrade.
   *
   * Anything that is not a straight improvement goes quietly into the pack —
   * interrupting a fight to ask about a rusted spear is worse than useless. An
   * upgrade pauses and asks, because the game cannot know whether the axe you
   * are carrying was a choice.
   */
  private giveGear(item: GearItem, x: number, y: number): void {
    const { isUpgrade: better } = this.pack.add(item);
    this.pickupBanner = 110;
    sfx.relic();
    this.particles.burst(x, y - 8, { key: 'fx.spark', count: 10, speed: 1.4, lift: 1.8 });

    if (better && !this.fixture) {
      this.offer = item;
      this.offerYes = true;
      this.mode = 'offer';
    }
  }

  /**
   * Contact damage after armour.
   *
   * Floored at one so armour can never make a threat harmless — a tier-50 mail
   * should mean surviving mistakes, not ignoring the game. Halving the incoming
   * hit is the difference between a long fight and no fight at all.
   */
  /**
   * Bind an enemy to the room it stands in, then register its brain.
   *
   * Done here rather than in spawnInit because only the scene knows the room
   * grid, and doing it at every call site is how one gets forgotten.
   */
  private registerIn(e: Entity): void {
    e.homeRoomX = Math.floor(e.x / ROOM_PX_W);
    e.homeRoomY = Math.floor(e.y / ROOM_PX_H);
    this.brains.register(e);
  }

  private afterArmour(damage: number): number {
    // Mode last, and still floored at one. On casual a hit has to remain a hit:
    // the point is to survive mistakes, not to stop noticing them.
    const scaled = (damage - this.pack.damageReduction) * damageScale(this.difficulty);
    return Math.max(1, Math.round(scaled));
  }

  /** The chosen difficulty. Absent in an older save, which means it was hard. */
  get difficulty(): DifficultyMode {
    return this.save.mode ?? DEFAULT_MODE;
  }

  setDifficulty(mode: DifficultyMode): void {
    this.save.mode = mode;
    this.persist();
    // Pacing applies immediately; enemy counts and caps are baked into the floor
    // and take effect on the next one. Saying so in the banner is better than
    // letting the player conclude the setting did nothing.
    const diff = difficultyFor(tierFor(this.act.pressure, this.depth), mode);
    this.brains.setPacing(diff.speed, diff.telegraph);
  }

  /**
   * A boss trophy: guaranteed, and a clear step above whatever the floor was
   * otherwise dropping.
   *
   * Pitched at the top of the local band rather than a fixed tier, so beating
   * the first Warden with a rusted sword is transformative and beating one on
   * floor eight is merely good.
   */
  private dropTrophy(bossName: string, x: number, y: number): void {
    const rng = this.rng.stream(`trophy:${bossName}:${this.draft.seed}:${this.depth}`);
    const tier = Math.min(
      MAX_TIER,
      dropTier(tierFor(this.act.pressure, this.depth), 0.95) + 4,
    );
    const item = rng.chance(0.72)
      ? makeEpicWeapon(bossName, rng.pick(WEAPON_TYPES), tier)
      : makeEpicArmour(bossName, tier);

    this.giveGear(item, x, y);
    this.camera.shake(3, 12);
    this.particles.burst(x, y - 12, { key: 'fx.spark', count: 24, speed: 2.2, lift: 2.6 });
  }

  /**
   * Walk into Amberwake.
   *
   * The condition is rolled from the Draft, so the town's state is a fact about
   * this life rather than about this visit — leave and come back and it is the
   * same year, which is what makes it a place instead of a slot machine.
   */
  enterTown(force?: TownCondition): void {
    const rng = this.rng.stream(`town:${this.draft.seed}`);
    const condition = force ?? rng.pick(TOWN_CONDITIONS);
    const built = generateTown(condition, this.rng.stream(`town-build:${this.draft.seed}`));

    this.world = built.world;
    this.entities = new EntityStore(built.world.tilesW);
    this.brains = new Brains(this.rng.stream(`town-ai:${this.draft.seed}`));
    this.town = { condition, residents: built.residents, gate: built.gate };
    this.inTown = true;

    this.player.x = built.spawn.x;
    this.player.y = built.spawn.y;
    this.roomX = Math.floor(built.spawn.x / ROOM_PX_W);
    this.roomY = Math.floor(built.spawn.y / ROOM_PX_H);
    this.camera.snapTo(this.roomX, this.roomY);

    built.residents.forEach((r, i) => {
      this.entities.spawn({
        kind: 'folk',
        spriteKey: folkSpriteFor(r.role),
        x: r.x,
        y: r.y,
        halfW: 6,
        boxH: 13,
        // Townsfolk take real punishment before they fall. Killing one should be
        // a decision, not something that happens while you are swinging at a pot.
        hp: 10,
        solid: false,
        breakable: true,
        debris: 'fx.gore',
        residentIndex: i,
      });
    });

    this.townAlarm = 0;
    this.hintLines = [`amberwake, ${CONDITION_PROFILES[condition].label}`,
      CONDITION_PROFILES[condition].mood];
    this.hintFrames = 320;
    this.visitedTown = true;
    // Walk back in owing a debt and nobody has to see you do anything: the
    // guards are already looking. A bounty you can escape by leaving the screen
    // is not a consequence, it is a cooldown.
    if ((this.save.bounty ?? 0) > 0) this.raiseAlarm(false);
    sfx.enterTown();
    // The town has its own mood: same mode, a fifth lower, so it reads as the
    // same world at a different hour rather than a different soundtrack.
    music.setMood(this.biome.mode, this.biome.root * 0.75);
  }

  get level(): number {
    return levelForXp(this.xp);
  }

  /**
   * Pay out for a kill, and announce a level when one lands.
   *
   * Extra hearts are granted rather than healed: reaching a new level should not
   * be a free full heal, or the optimal play becomes farming trash at low health.
   */
  private awardXp(e: Entity): void {
    const before = this.level;
    const isBoss = e.variant === 'warden' || e.variant === 'hulk' || e.variant === 'colossus';
    this.xp += xpForKill(Math.max(1, e.hp + 1), e.contactDamage, isBoss);
    const now = this.level;
    if (now > before) {
      const gained = bonusHearts(now) - bonusHearts(before);
      if (gained > 0) {
        this.player.maxHealth += gained * HEART_UNITS;
        this.player.heal(gained * HEART_UNITS);
      }
      this.levelBanner = 150;
      sfx.relic();
    }
  }

  /** Open a trader's board, stocked to the player's standing. */
  private beginShop(resident: TownResident): void {
    const rng = this.rng.stream(`shop:${resident.id}:${this.draft.seed}:${this.level}`);
    const top = merchantTierFor(this.level);
    this.shopStock = [];
    for (let i = 0; i < 5; i++) {
      // Spread around the player's standing so the board holds something
      // affordable now and something worth coming back for.
      const tier = Math.max(1, top - rng.int(0, 6) + rng.int(0, 2));
      const roll = rng.next();
      this.shopStock.push(roll < 0.65
        ? makeWeapon(rng.pick(WEAPON_TYPES), tier)
        : makeArmour(tier));
    }
    this.shopSide = 'buy';
    this.shopCursor = 0;
    this.mode = 'shop';
    sfx.pickup();
  }

  /** What the player is carrying that a trader would take. */
  private sellable(): GearItem[] {
    return this.pack.all.filter((i) =>
      i.uid !== this.pack.equippedWeapon?.uid && i.uid !== this.pack.equippedArmour?.uid);
  }

  private updateShop(input: InputSnapshot): void {
    const list = this.shopSide === 'buy' ? this.shopStock : this.sellable();
    if (input.cyclePressed) {
      this.shopSide = this.shopSide === 'buy' ? 'sell' : 'buy';
      this.shopCursor = 0;
      sfx.menuMove();
    }
    if (list.length > 0) {
      if (input.upPressed) {
        this.shopCursor = (this.shopCursor + list.length - 1) % list.length;
        sfx.menuMove();
      }
      if (input.downPressed) {
        this.shopCursor = (this.shopCursor + 1) % list.length;
        sfx.menuMove();
      }
      if (input.attackPressed) {
        const item = list[this.shopCursor];
        if (item && this.shopSide === 'buy') {
          const cost = priceOf(item.tier, item.epic ?? false);
          if (this.amber >= cost) {
            this.traded = true;
            this.amber -= cost;
            this.shopStock = this.shopStock.filter((s) => s.uid !== item.uid);
            this.shopCursor = 0;
            this.giveGear(item, this.player.x, this.player.y);
            return; // giveGear may open the swap prompt over the shop
          }
          sfx.hitBlocked();
        } else if (item) {
          this.traded = true;
          this.amber += sellValue(item.tier, item.epic ?? false);
          this.pack.drop(item.uid);
          this.shopCursor = 0;
          sfx.pickup();
        }
      }
    }
    if (input.actionPressed || input.menuPressed) {
      this.mode = 'playing';
      this.talkingTo = null;
    }
  }

  /**
   * Say the one thing worth saying about where to go.
   *
   * Priority is what the player most needs next, not what is nearest: in the
   * meadow that is the road to Amberwake, and inside a floor it is the way down.
   * Only one target speaks at a time — two competing directions is how a hint
   * system stops being a hint system.
   */
  /** The current beat, and a thought the first time it becomes current. */
  private get beat(): Beat {
    return beatFor({
      visitedTown: this.visitedTown,
      spokeToAnyone: this.spokeToAnyone,
      traded: this.traded,
      depth: this.depth,
      bossAlive: this.entities.all.some(
        (e) => e.alive && e.kind === 'enemy'
          && (e.variant === 'warden' || e.variant === 'colossus'),
      ),
      draftsLived: this.save.draftsLived,
    });
  }

  private updateThread(): void {
    const beat = this.beat;
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    // The thought explains the objective the corner just changed to. Without it
    // the goal line looks like it was always there.
    this.mutter = beatThought(beat, this.save.draftsLived);
    this.mutterFrames = 220;
    this.mutterCooldown = 600;
  }

  private speakHint(): void {
    if (this.mode !== 'playing' || this.inTown) return;

    let target: HintTarget | null = null;
    let tx = 0;
    let ty = 0;

    if (this.townGate?.alive) {
      target = 'town';
      tx = this.townGate.x;
      ty = this.townGate.y;
    } else if (this.floor.exit) {
      // A boss stands on the stairs, so on those floors the way down and the
      // thing guarding it are the same direction and it should say so.
      const guarded = this.entities.all.some(
        (e) => e.alive && e.kind === 'enemy'
          && (e.variant === 'warden' || e.variant === 'colossus'),
      );
      target = guarded ? 'boss' : 'descent';
      tx = this.floor.exit.x;
      ty = this.floor.exit.y;
    }

    const rng = this.rng.stream(`hint:${this.draft.seed}:${this.tick}`);

    if (target === null) {
      this.mutter = rng.pick(IDLE_LINES);
    } else {
      const dx = tx - this.player.x;
      const dy = ty - this.player.y;
      // Standing on the thing and being told where it is reads as broken — but
      // the radius has to be *arm's length*, not half a room. At half a room the
      // player spawns inside the suppression zone of the very gate the hint
      // exists to point at, and Aldez never says anything at all.
      if (Math.hypot(dx, dy) < TILE * 3) {
        this.mutterCooldown = 240;
        return;
      }
      const rooms = Math.round(Math.hypot(dx / ROOM_PX_W, dy / ROOM_PX_H));
      this.mutter = selfTalk(target, dx, dy, rooms, rng);
    }

    this.mutterFrames = 200;
    this.mutterCooldown = 900;  // 15s, so it never nags
  }

  /** Back out of the gate and into the meadow you came from. */
  leaveTown(): void {
    this.town = null;
    this.inTown = false;
    this.nearFolk = null;
    // No bounty logic here. Leaving is not an offence, and the debt is charged
    // where it is earned.
    sfx.enterTown();
    music.setMood(this.biome.mode, this.biome.root);
    this.loadDraft(this.draft, this.depth);
  }

  /** Nearest townsperson within talking distance, or null. */
  private folkInReach(): { resident: TownResident; entity: Entity } | null {
    if (!this.town) return null;
    let best: { resident: TownResident; entity: Entity; d: number } | null = null;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'folk') continue;
      const r = this.town.residents[e.residentIndex];
      if (!r) continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d > 26) continue;
      if (!best || d < best.d) best = { resident: r, entity: e, d };
    }
    return best ? { resident: best.resident, entity: best.entity } : null;
  }

  private beginTalk(resident: TownResident): void {
    const met = this.save.met?.[resident.id] ?? 0;
    const roll = this.rng.stream(`talk:${resident.id}:${this.draft.seed}:${this.tick}`).next();
    this.talkLine = speak({
      role: resident.role,
      essence: resident.essence as never,
      condition: this.town!.condition,
      met,
      roll,
    });
    this.spokeToAnyone = true;
    this.talkingTo = resident;
    this.mode = 'talk';

    // Meeting is what builds Echo Memory, and it is counted once per Draft per
    // person — talking to Mara ten times in one life is not ten lives of knowing
    // her, and letting it be would make the payoff grindable.
    const key = `${resident.id}:${this.draft.index}`;
    if (!this.metThisDraft.has(key)) {
      this.metThisDraft.add(key);
      this.save.met = this.save.met ?? {};
      this.save.met[resident.id] = met + 1;
    }
  }

  /**
   * Strike a townsperson and the guards come.
   *
   * The alarm is town-wide rather than per-guard: a square full of people
   * watched you do it. Guards already placed at the gate turn hostile and hunt,
   * which is cheaper and reads better than spawning reinforcements from nowhere.
   */
  /**
   * Turn the guards hostile.
   *
   * `charge` separates the two halves that were briefly one thing: committing an
   * offence adds to the bounty, but *arriving already wanted* must not. Conflated,
   * the debt grew by five every time the player walked through the gate — so
   * paying it off became impossible by walking, which is the opposite of what a
   * bounty is for.
   */
  private raiseAlarm(charge = true): void {
    if (!this.town || this.townAlarm > 0) return;
    this.townAlarm = 60 * 45;
    if (charge) {
      // Recorded the moment it is incurred, not when you leave, so fleeing
      // mid-fight cannot outrun it.
      this.save.bounty = (this.save.bounty ?? 0) + BOUNTY_PER_OFFENCE;
      this.persist();
    }
    sfx.bars();
    this.hintLines = charge
      ? ['the guard has seen you', `amberwake does not forget - bounty ${this.save.bounty}`]
      : ['they were waiting for you', `amberwake wants ${this.save.bounty} for what you did`];
    this.hintFrames = 220;

    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'folk') continue;
      const r = this.town.residents[e.residentIndex];
      if (!r || r.role !== 'guard') continue;
      // Becomes a real enemy: hostile, hunting, and a genuine fight — ten hits
      // from a rusted sword, exactly as specified.
      e.kind = 'enemy';
      e.variant = 'moblin';
      e.contactDamage = 4;
      e.hp = 10;
      this.registerIn(e);
    }
  }

  private beginRevision(): void {
    // Instability rises with each Draft: powerful runs create stronger
    // contradictions, which is the in-fiction reason the world gets harder.
    const next = rollDraft(this.draft.index + 1, this.rng, this.draft.instability + this.depth + 1);
    this.revisions = diffDrafts(this.draft, next);
    this.pendingDraft = next;
    this.revisionFrame = 0;
    this.mode = 'revising';
    this.player.sword.interrupt();
    // The revision branch never steps hitstop, so a freeze left over from the
    // killing blow would stay pending for the whole scene and still be counted
    // as "frozen" long after anything moved.
    this.hitstop.clear();
    sfx.death();
    // Write before the world is rewritten: dying is the one moment a player is
    // most likely to close the tab.
    this.save.draftsLived = next.index;
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  update(input: InputSnapshot): void {
    this.tick++;

    // Escape toggles the menu from play and back.
    if (input.menuPressed) {
      if (this.mode === 'playing') {
        // Backing out mid-run keeps the run: re-rolling the backdrop would throw
        // the floor away. A fresh region only when there is nothing to lose.
        this.mode = 'menu';
        this.menu.screen = 'root';
        this.menu.cursor = 0;
        return;
      }
      if (this.mode === 'menu') this.mode = 'playing';
    }

    // The pack opens over a paused world. A loot screen that leaves enemies
    // walking is a loot screen nobody dares open.
    if (input.packPressed && (this.mode === 'playing' || this.mode === 'pack')) {
      this.mode = this.mode === 'pack' ? 'playing' : 'pack';
      this.packCursor = 0;
      sfx.menuMove();
      return;
    }

    if (this.mode === 'shop') {
      this.updateShop(input);
      return;
    }

    // Talking. The world pauses; the town stays visible behind the box.
    if (this.mode === 'talk') {
      // Z opens the board when they have one. The trade is a continuation of
      // the conversation, not a separate mode you enter from somewhere else.
      if (input.attackPressed && this.talkingTo?.shop) {
        this.beginShop(this.talkingTo);
        return;
      }
      if (input.actionPressed || input.menuPressed) {
        this.talkingTo = null;
        this.mode = 'playing';
      }
      return;
    }

    // The swap offer: one question, two answers, no menu to learn.
    if (this.mode === 'offer') {
      if (input.upPressed || input.downPressed || input.cyclePressed) {
        this.offerYes = !this.offerYes;
        sfx.menuMove();
      }
      if (input.attackPressed) {
        if (this.offerYes && this.offer) {
          this.pack.equip(this.offer.uid);
          sfx.pickup();
        }
        this.offer = null;
        this.mode = 'playing';
      }
      // X is always "no" — declining should never need the cursor moved first.
      if (input.actionPressed) {
        this.offer = null;
        this.mode = 'playing';
      }
      return;
    }

    if (this.mode === 'pack') {
      const items = this.pack.all;
      if (items.length > 0) {
        if (input.upPressed) {
          this.packCursor = (this.packCursor + items.length - 1) % items.length;
          sfx.menuMove();
        }
        if (input.downPressed) {
          this.packCursor = (this.packCursor + 1) % items.length;
          sfx.menuMove();
        }
        if (input.attackPressed) {
          const item = items[this.packCursor];
          if (item && item.kind !== 'treasure') {
            this.pack.equip(item.uid);
            sfx.pickup();
          }
        }
      }
      if (input.actionPressed) this.mode = 'playing';
      return;
    }

    if (this.mode === 'menu') {
      this.updateMenu(input);
      // The hub keeps breathing behind the menu.
      this.particles.update();
      this.entities.update();
      if (!this.fixture?.freezeAi) this.brains.update(this.entities, this.player, this.isSolid);
      this.spawnAmbient();
      return;
    }

    if (this.mode === 'revising') {
      this.revisionFrame++;
      this.particles.update();
      // Advance on the player's input once the page has finished writing itself,
      // not on a timer.
      const ready = this.revisionFrame >= revisionReadyAt(this.revisions.length);
      if (ready && input.anyPressed) {
        this.mode = 'reliquary';
        this.reliquaryCursor = 0;
      }
      return;
    }

    if (this.mode === 'reliquary') {
      this.revisionFrame++;
      if (input.upPressed) {
        this.reliquaryCursor = (this.reliquaryCursor + RELICS.length - 1) % RELICS.length;
        sfx.menuMove();
      }
      if (input.downPressed) {
        this.reliquaryCursor = (this.reliquaryCursor + 1) % RELICS.length;
        sfx.menuMove();
      }
      if (input.attackPressed) this.awakenSelected();
      if (input.actionPressed) {
        const next = this.pendingDraft;
        if (next) {
          this.draft = next;
          this.pendingDraft = null;
          // A death costs the floors inside an Act, never the Act itself — and
          // it undoes any teleport, so you always wake in your own region rather
          // than wherever a test pad happened to leave you.
          this.act = actAt(this.save.actIndex);
          this.forcedBiome = null;
          this.loadDraft(next, 0);
          this.showRebirthHint();
        }
      }
      return;
    }

    // Hitstop freezes actors only. Particles, shake and the camera keep running —
    // if the whole frame froze it would read as a stutter, not as impact.
    const actorsRun = this.hitstop.step();

    if (this.camera.transitioning) {
      if (this.nudgeFrames > 0) {
        this.player.nudge(this.nudgeX, this.nudgeY);
        this.nudgeFrames--;
      }
      this.player.update(
        { ...input, up: false, down: false, left: false, right: false },
        this.isSolid,
      );
      this.camera.update();
      this.particles.update();
      if (!this.camera.transitioning) {
        this.player.inputLocked = false;
        // A breath on arrival. Enemies are held to their own screens now, but
        // one waiting just inside the doorway could still land a hit on the
        // frame control comes back — before the player has seen the room, which
        // is the definition of an unfair hit.
        this.player.grantInvulnerability(ARRIVAL_GRACE);
        bus.emit('room:transition:ended', { rx: this.roomX, ry: this.roomY });
      }
      return;
    }

    if (actorsRun) {
      this.player.update(input, this.isSolid);
      this.entities.update();
      if (!this.fixture?.freezeAi) {
        this.brains.update(this.entities, this.player, this.isSolid);
      }
      if (input.cyclePressed) {
        this.loadout.cycle();
        sfx.menuMove();
      }
      // Someone in reach takes priority over anything liftable. X already means
      // "deal with what is in front of you"; a player standing face to face with
      // Mara Venn and picking up a crate instead would rightly call that broken.
      this.nearFolk = this.inTown ? (this.folkInReach()?.resident ?? null) : null;
      if (input.actionPressed && this.nearFolk) {
        this.beginTalk(this.nearFolk);
        return;
      }
      if (input.actionPressed) this.handleAction();
      if (input.itemPressed) this.useItem();
      this.updateCarried();
      this.updateBoomerang();
      this.resolveSwordHits();
      this.resolveProjectiles();
      this.resolveContactDamage();
      this.updateDrowning();
      this.collectPickups();
      // Blasts are visual only, so they age on their own clock.
      for (const blast of this.blasts) blast.frame++;
      this.blasts = this.blasts.filter((b) => b.frame < BLAST_FRAMES);

      this.spawnAmbient();
      this.updateTutor(input);

      // Step onto the road marker to travel to the town.
      if (this.townGate?.alive && this.teleportCooldown <= 0) {
        const d = Math.hypot(this.townGate.x - this.player.x, this.townGate.y - this.player.y);
        // Was 12px — under a tile, so the gate could be walked straight past and
        // it took a deliberate attempt to land on it. A whole tile of tolerance
        // is what makes "step on to enter" true.
        if (d < TOWN_GATE_ENTER) {
          this.enterTown();
          return;
        }
      }

      if (this.inTown) {
        if (this.townAlarm > 0) this.townAlarm--;
        // Walking back out of the south gate returns to the meadow.
        if (this.player.y > this.town!.gate.y - 8) this.leaveTown();
      }

      this.checkTeleporters();
      this.tryBarRoom();
      this.checkRoomCleared();
      if (this.clearPulse > 0) this.clearPulse--;
      if (this.actBanner > 0) this.actBanner--;
      if (this.hintFrames > 0) this.hintFrames--;
      if (this.pickupBanner > 0) this.pickupBanner--;
      if (this.levelBanner > 0) this.levelBanner--;
      if (this.noticeFrames > 0) this.noticeFrames--;
      if (this.mutterFrames > 0) this.mutterFrames--;
      if (this.mutterCooldown > 0) this.mutterCooldown--;
      // A long idle in one place earns a line too: standing still lost is the
      // exact moment a hint is worth most.
      this.updateThread();
      if (this.mutterCooldown <= 0 && this.mode === 'playing') this.speakHint();
      music.setIntensity(this.musicIntensity());

      if (this.player.dead) {
        this.beginRevision();
        return;
      }
      if (this.checkExit()) return;
    }

    this.particles.update();
    this.camera.update();
    if (actorsRun) this.checkRoomChange();
  }

  // -------------------------------------------------------------------------
  // Lift, carry, throw
  // -------------------------------------------------------------------------

  private handleAction(): void {
    if (this.carriedId !== null) {
      this.throwCarried();
      return;
    }
    if (this.player.sword.swinging) return;

    // Grab whatever liftable sits in front of him, nearest first.
    const [fx, fy] = this.player.facingVector;
    const probeX = this.player.x + fx * 10;
    const probeY = this.player.y - 5 + fy * 10;

    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of this.entities.all) {
      if (!e.alive || !e.liftable || e.carried) continue;
      const dx = e.x - probeX;
      const dy = e.y - 6 - probeY;
      const d = Math.hypot(dx, dy);
      if (d < LIFT_REACH && d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    if (!best) return;

    this.entities.setCarried(best, true);
    this.carriedId = best.id;
    this.player.carrying = true;
    sfx.lift();
    this.particles.burst(best.x, best.y - 6, { key: 'fx.spark', count: 3, speed: 0.7 });
  }

  /** Keep the carried prop glued above his head. */
  private updateCarried(): void {
    if (this.carriedId === null) return;
    const held = this.entities.all.find((e) => e.id === this.carriedId);
    if (!held || !held.alive) {
      this.carriedId = null;
      this.player.carrying = false;
      return;
    }
    held.x = this.player.x;
    held.y = this.player.y - 18;
  }

  private throwCarried(): void {
    const held = this.entities.all.find((e) => e.id === this.carriedId);
    this.carriedId = null;
    this.player.carrying = false;
    if (!held || !held.alive) return;

    const [fx, fy] = this.player.facingVector;
    this.entities.setCarried(held, false);
    // Becomes a player-owned projectile: same collision path as an Octorok
    // pellet, opposite ownership, so one code path covers both.
    held.kind = 'projectile';
    held.owner = 'player';
    held.variant = 'thrown';
    held.vx = fx * THROW_SPEED;
    held.vy = fy * THROW_SPEED;
    held.hp = THROW_LIFETIME;
    held.contactDamage = THROWN_DAMAGE;
    held.x = this.player.x + fx * 8;
    held.y = this.player.y - 8 + fy * 4;
  }

  // -------------------------------------------------------------------------
  // Room clear
  // -------------------------------------------------------------------------

  private livingFoesInRoom(rx: number, ry: number): number {
    let n = 0;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy') continue;
      if (Math.floor(e.x / ROOM_PX_W) === rx && Math.floor(e.y / ROOM_PX_H) === ry) n++;
    }
    return n;
  }

  /**
   * Lock the room the player just walked into, if it still has a fight in it.
   *
   * Barring the exits is what turns a room full of enemies from something you
   * can walk past into something you have to answer. It is also the reason a
   * clear feels like an accomplishment rather than an errand.
   */
  private tryBarRoom(): void {
    // Dungeons lock; open country does not. A meadow that bars its exits stops
    // being a place you travel through and becomes a corridor of arenas.
    if (!this.biome.barsRooms) return;

    const id = `${this.roomX},${this.roomY}`;
    if (this.barredRoom === id || this.clearedRooms.has(id)) return;
    if (this.livingFoesInRoom(this.roomX, this.roomY) === 0) {
      this.clearedRooms.add(id);
      return;
    }

    const node = this.floor.rooms.get(id);
    if (!node) return;

    // Wait until the player is clear of the moat band. Barring while they are
    // still standing in the doorway either traps them on a bar or shuts them out
    // of the room entirely. This runs every frame, so it simply retries.
    const localX = this.player.x - this.roomX * ROOM_PX_W;
    const localY = this.player.y - this.roomY * ROOM_PX_H;
    const margin = 3 * TILE;
    if (
      localX < margin || localX > ROOM_PX_W - margin ||
      localY < margin || localY > ROOM_PX_H - margin
    ) return;

    this.barIds = [];
    for (const [tx, ty] of gateBarTiles(node, this.floor.edges)) {
      const bar = this.entities.spawn({
        kind: 'prop',
        spriteKey: 'prop.bars',
        x: tx * TILE + TILE / 2,
        y: ty * TILE + TILE - 1,
        halfW: 8,
        boxH: 16,
        solid: true,
        breakable: false,
        debris: 'fx.spark',
      });
      this.barIds.push(bar.id);
    }
    // Pull strays into the arena. An enemy that wandered into the moat band or a
    // gate corridor is counted as "in the room" but can be unreachable behind the
    // bars that just dropped — and the room then never clears, which locks the
    // player in permanently. Clamping guarantees every counted foe is fightable.
    const inset = (MOAT + 1) * TILE;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy') continue;
      if (Math.floor(e.x / ROOM_PX_W) !== this.roomX) continue;
      if (Math.floor(e.y / ROOM_PX_H) !== this.roomY) continue;
      const minX = this.roomX * ROOM_PX_W + inset;
      const maxX = (this.roomX + 1) * ROOM_PX_W - inset;
      const minY = this.roomY * ROOM_PX_H + inset;
      const maxY = (this.roomY + 1) * ROOM_PX_H - inset;
      e.x = Math.min(maxX, Math.max(minX, e.x));
      e.y = Math.min(maxY, Math.max(minY, e.y));
    }

    this.barredRoom = id;
    bus.emit('room:barred', { rx: this.roomX, ry: this.roomY });
  }

  private checkRoomCleared(): void {
    if (this.barredRoom === null) return;
    const [rx, ry] = this.barredRoom.split(',').map(Number) as [number, number];

    // Hold the fight inside the arena for as long as it lasts. A foe that drifts
    // into the moat is both unreachable and still counted, and the room would
    // never clear. It also reads better: nothing runs away from a barred room.
    const inset = (MOAT + 1) * TILE;
    const minX = rx * ROOM_PX_W + inset;
    const maxX = (rx + 1) * ROOM_PX_W - inset;
    const minY = ry * ROOM_PX_H + inset;
    const maxY = (ry + 1) * ROOM_PX_H - inset;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy') continue;
      if (Math.floor(e.x / ROOM_PX_W) !== rx || Math.floor(e.y / ROOM_PX_H) !== ry) continue;
      e.x = Math.min(maxX, Math.max(minX, e.x));
      e.y = Math.min(maxY, Math.max(minY, e.y));
    }

    if (this.livingFoesInRoom(rx, ry) > 0) return;

    for (const id of this.barIds) {
      const bar = this.entities.all.find((e) => e.id === id);
      if (!bar) continue;
      this.particles.burst(bar.x, bar.y - 8, { key: 'fx.spark', count: 6, speed: 1.4 });
      this.entities.kill(bar);
    }
    this.barIds = [];
    this.clearedRooms.add(this.barredRoom);
    this.barredRoom = null;
    this.clearPulse = 70;
    this.camera.shake(2, 8);

    // Pay the player immediately and visibly. A clear that yields nothing
    // teaches them that clearing is optional.
    const cx = rx * ROOM_PX_W + ROOM_PX_W / 2;
    const cy = ry * ROOM_PX_H + ROOM_PX_H / 2;
    const spoils = 2 + this.rng.stream('spoils').int(0, 2);
    for (let i = 0; i < spoils; i++) {
      this.entities.spawn({
        kind: 'pickup',
        spriteKey: 'pickup.shard',
        x: cx + this.rng.stream('spoils').range(-20, 20),
        y: cy + this.rng.stream('spoils').range(-14, 14),
        halfW: 5,
        boxH: 10,
        solid: false,
        breakable: false,
      });
    }
    if (this.player.health <= this.player.maxHealth / 2) {
      this.entities.spawn({
        kind: 'pickup', spriteKey: 'pickup.heart',
        x: cx, y: cy - 18, halfW: 5, boxH: 10, solid: false, breakable: false,
      });
    }
    this.particles.burst(cx, cy - 8, { key: 'fx.spark', count: 16, speed: 1.8, lift: 2.2 });
    this.metaRoomsCleared++;
    this.persist();
    bus.emit('room:cleared', { rx, ry });
  }

  /**
   * Reaching the way down ends the floor.
   *
   * Descending is *within* a Draft — the world only rewrites itself when Aldez
   * falls, so going deeper must not roll a new history.
   */
  private checkExit(): boolean {
    const dx = this.floor.exit.x - this.player.x;
    const dy = this.floor.exit.y - this.player.y;
    if (dx * dx + dy * dy > 14 * 14) return false;

    this.amber += 5;
    this.particles.burst(this.player.x, this.player.y - 8, {
      key: 'fx.spark', count: 14, speed: 1.6, lift: 2.2,
    });
    sfx.descend();

    // Finishing an Act's last floor opens the next region permanently.
    if (isActFinale(this.act, this.depth) && this.act.index < FINAL_ACT) {
      this.act = actAt(this.act.index + 1);
      this.save.actIndex = this.act.index;
      this.actBanner = 140;
      this.loadDraft(this.draft, 0);
    } else {
      this.loadDraft(this.draft, this.depth + 1);
    }
    this.persist();
    return true;
  }

  private resolveSwordHits(): void {
    const sword = this.player.sword;
    if (!sword.hitboxActive) return;

    const px = this.player.x;
    const py = this.player.y;

    for (const circle of sword.hitCircles(px, py, this.player.facing)) {
      for (const e of this.entities.overlapCircle(circle.x, circle.y, circle.r, this.hitScratch)) {
        if (e.kind !== 'prop' && e.kind !== 'enemy' && e.kind !== 'folk') continue;
        // Armored things shrug off a blade — unless the blade is an axe, which
        // is the whole reason to carry one. The "wrong tool" lesson bombs teach
        // becomes a reason to keep a second weapon in the pack.
        if (e.armored && !this.pack.fellsTrees) {
          if (e.lastHitSwing !== sword.swingId) {
            e.lastHitSwing = sword.swingId;
            sfx.hitBlocked();
            this.particles.burst(circle.x, circle.y, { key: 'fx.spark', count: 3, speed: 1.1 });
          }
          continue;
        }
        // Knock away from the player, not away from the blade — a blade-relative
        // direction sends things sideways at the arc extremes and looks wrong.
        // Weapon first, relics on top. A tier-50 axe should feel like a tier-50
        // axe whether or not the Belliron Edge has been awakened.
        // Doubled while the Warden stands open. The reward for reading the tell
        // has to be worth the wait, or waiting is just a slower way to fight.
        const damage = (this.pack.weaponDamage + this.effects.swordDamage - 1)
          * (sword.isSpin ? 2 : 1)
          * (this.brains.isOpen(e) ? 2 : 1);
        const landed = this.entities.hit(e, sword.swingId, damage, e.x - px, e.y - (py - 9));
        if (landed) {
          if (e.kind === 'folk') this.raiseAlarm();
          this.onHit(e, sword.isSpin);
        }
      }
    }
  }

  private onHit(e: Entity, heavy: boolean): void {
    this.hitstop.request(heavy ? HITSTOP_HEAVY : HITSTOP_NORMAL);
    this.particles.burst(e.x, e.y - 6, { key: 'fx.spark', count: 4, speed: 1.3 });
    if (e.alive) return;

    this.particles.burst(e.x, e.y - 6, { key: e.debris, count: 9, speed: 1.5, lift: 2.0 });
    this.camera.shake(1, 4);

    if (e.kind === 'enemy') {
      this.enemiesKilled++;
      this.metaKills++;
      this.awardXp(e);
      this.brains.forget(e.id);
      this.amber += this.effects.amberPerKill;
      // Felling something huge pays like it felt: a bigger burst, a real shake,
      // and amber worth the fight.
      // A boss always leaves a trophy, named after itself. That certainty is the
      // whole point — a boss that might drop nothing teaches the player that
      // fighting it was optional.
      const bossName = BOSS_TROPHY[e.variant];
      if (bossName) this.dropTrophy(bossName, e.x, e.y);
      else this.tryDrop(e.x, e.y, 0.07);

      if (e.variant === 'hulk' || e.variant === 'colossus') {
        const big = e.variant === 'colossus';
        this.amber += big ? 9 : 4;
        this.camera.shake(big ? 4 : 3, big ? 14 : 9);
        this.particles.burst(e.x, e.y - 12, {
          key: e.debris, count: big ? 26 : 16, speed: 2.2, lift: 2.6,
        });
        this.entities.spawn({
          kind: 'pickup', spriteKey: 'pickup.heart',
          x: e.x, y: e.y - 8, halfW: 5, boxH: 10, solid: false, breakable: false,
        });
      }
      if (this.rng.stream('drops').chance(0.18 + this.effects.heartDropBonus)) {
        this.entities.spawn({
          kind: 'pickup', spriteKey: 'pickup.heart',
          x: e.x, y: e.y, halfW: 5, boxH: 10, solid: false, breakable: false,
        });
      }
      bus.emit('entity:died', { id: e.id, x: e.x, y: e.y });
      return;
    }

    const stats = PROP_STATS[e.spriteKey];

    if (stats?.opens) {
      // Not destroyed — opened. The chest stays in the world with its lid up.
      e.alive = true;
      e.spriteKey = 'prop.chest.open';
      e.breakable = false;
      e.hp = 1;
      this.camera.shake(1, 6);
      this.particles.burst(e.x, e.y - 10, { key: 'fx.spark', count: 12, speed: 1.4, lift: 2.2 });
      const haul = 3 + this.rng.stream('chest').int(0, 3);
      for (let i = 0; i < haul; i++) {
        this.entities.spawn({
          kind: 'pickup', spriteKey: 'pickup.shard',
          x: e.x + this.rng.stream('chest').range(-14, 14),
          y: e.y - 4 + this.rng.stream('chest').range(-8, 8),
          halfW: 5, boxH: 10, solid: false, breakable: false,
        });
      }
      this.entities.spawn({
        kind: 'pickup', spriteKey: 'pickup.heart',
        x: e.x, y: e.y - 16, halfW: 5, boxH: 10, solid: false, breakable: false,
      });
      // A chest always yields gear. Opening one and getting three shards is the
      // most disappointing thing a game can do with a chest.
      this.tryDrop(e.x, e.y, 1);
      bus.emit('chest:opened', { x: e.x, y: e.y });
      return;
    }

    this.propsBroken++;
    bus.emit('prop:broken', { x: e.x, y: e.y, kind: e.spriteKey });
    if (stats?.drop && this.rng.stream('drops').chance(stats.dropChance ?? 0.3)) {
      this.entities.spawn({
        kind: 'pickup',
        spriteKey: stats.drop,
        x: e.x,
        y: e.y,
        halfW: 5,
        boxH: 10,
        solid: false,
        breakable: false,
      });
    }
  }

  private resolveProjectiles(): void {
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'projectile' || e.carried) continue;

      // Expire on terrain or on age. hp doubles as the lifetime counter.
      const tx = Math.floor(e.x / TILE);
      const ty = Math.floor(e.y / TILE);

      // A bomb sits still and burns down; it must not expire on the ground it is
      // resting on, and it detonates rather than fizzling out.
      if (e.variant === 'bomb') {
        if (--e.hp <= 0) this.explodeBomb(e);
        continue;
      }
      // The boomerang turns around at a wall instead of dying on it.
      if (e.variant === 'boomerang') {
        if (--e.hp <= 0) { this.entities.kill(e); this.boomerang = null; }
        continue;
      }

      if (--e.hp <= 0 || this.world.isSolid(tx, ty)) {
        this.shatterProjectile(e);
        continue;
      }

      if (e.owner === 'player') {
        // Thrown props hurt whatever they land on.
        for (const foe of this.entities.overlapCircle(e.x, e.y - 4, 8, this.hitScratch)) {
          if (foe.kind !== 'enemy' || !foe.alive) continue;
          this.entities.hit(foe, -e.id, e.contactDamage, e.vx, e.vy);
          this.onHit(foe, false);
          this.shatterProjectile(e);
          break;
        }
        continue;
      }

      const dx = e.x - this.player.x;
      const dy = e.y - (this.player.y - 6);
      if (dx * dx + dy * dy >= 9 * 9) continue;
      if (this.invincible) continue;

      // Shield: a shot arriving against the facing is turned back on its owner.
      // Deflecting rather than merely cancelling is what makes standing your
      // ground an attack instead of a stall.
      const [fx, fy] = this.player.facingVector;
      const incoming = e.vx * fx + e.vy * fy;
      if (this.player.bracing && incoming < 0) {
        e.vx = -e.vx;
        e.vy = -e.vy;
        e.owner = 'player';
        e.hp = THROW_LIFETIME;
        e.contactDamage = Math.max(1, e.contactDamage);
        this.hitstop.request(HITSTOP_NORMAL);
        this.camera.shake(1, 4);
        this.particles.burst(e.x, e.y, { key: 'fx.spark', count: 6, speed: 1.5 });
        bus.emit('player:blocked', { x: e.x, y: e.y });
        continue;
      }

      if (this.player.damage(this.afterArmour(e.contactDamage), e.x, e.y)) this.onPlayerHurt();
      this.shatterProjectile(e);
    }
  }

  private shatterProjectile(e: Entity): void {
    this.entities.kill(e);
    const debris = e.variant === 'thrown' ? e.debris : 'fx.spark';
    this.particles.burst(e.x, e.y, { key: debris, count: 5, speed: 1.2 });
  }

  private resolveContactDamage(): void {
    if (this.invincible || this.player.invulnerable) return;
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'enemy' || e.contactDamage <= 0) continue;
      const dx = Math.abs(e.x - this.player.x);
      const dy = Math.abs(e.y - 5 - (this.player.y - 5));
      if (dx > e.halfW + 5 || dy > e.boxH / 2 + 6) continue;
      if (this.player.damage(this.afterArmour(e.contactDamage), e.x, e.y)) {
        this.onPlayerHurt();
        return;
      }
    }
  }

  private onPlayerHurt(): void {
    this.hitstop.request(HITSTOP_NORMAL);
    this.camera.shake(2, 6);
    this.particles.burst(this.player.x, this.player.y - 8, {
      key: 'fx.spark', count: 6, speed: 1.4,
    });
    bus.emit('player:damaged', { amount: 4, knockX: 0, knockY: 0 });
  }

  private collectPickups(): void {
    for (const e of this.entities.all) {
      if (!e.alive || e.kind !== 'pickup') continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue;

      this.entities.kill(e);
      if (e.spriteKey === 'pickup.heart') { this.player.heal(HEART_UNITS); sfx.heart(); }
      else if (e.spriteKey === 'pickup.bomb') { this.loadout.addBombs(3); sfx.pickup(); }
      else { this.amber += 1; sfx.pickup(); }
      this.particles.burst(e.x, e.y - 6, { key: 'fx.spark', count: 5, speed: 1.0, lift: 1.8 });
    }
  }

  private checkRoomChange(): void {
    const { rx, ry } = this.world.roomAt(this.player.x, this.player.y);
    if (rx === this.roomX && ry === this.roomY) return;

    const dirX = Math.sign(rx - this.roomX);
    const dirY = Math.sign(ry - this.roomY);

    bus.emit('room:transition:started', {
      fromX: this.roomX, fromY: this.roomY, toX: rx, toY: ry,
    });
    this.prevRoomX = this.roomX;
    this.prevRoomY = this.roomY;
    this.roomX = rx;
    this.roomY = ry;

    // Speak on arriving somewhere new, not on every doorway. Backtracking
    // through a cleared room to hear the same line again is how a voice turns
    // into a notification.
    const key = `${rx},${ry}`;
    if (!this.roomsVisited.has(key)) {
      this.roomsVisited.add(key);
      this.speakHint();
    }

    // A swing must not survive into the next room — the hitbox would sweep
    // through entities the player never saw.
    this.player.sword.interrupt();

    const frames = dirY !== 0 ? SCROLL_FRAMES_V : SCROLL_FRAMES_H;
    this.camera.scrollTo(rx * ROOM_PX_W, ry * ROOM_PX_H, frames);

    this.player.inputLocked = true;
    this.nudgeX = (dirX * DOORWAY_NUDGE) / frames;
    this.nudgeY = (dirY * DOORWAY_NUDGE) / frames;
    this.nudgeFrames = frames;

    bus.emit('room:changed', { rx, ry });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  draw(batch: SpriteBatch, lights?: LightBuffer): void {
    // Centre the room in the viewport. When the viewport is wider than a room —
    // any 16:9 screen — the surplus shows the surrounding country on both sides
    // instead of stretching the room to fit.
    const padX = Math.floor((viewport.w - ROOM_PX_W) / 2);
    const padY = Math.floor((viewport.h - ROOM_PX_H) / 2);
    // Clamp to the world. A viewport wider than the map would otherwise scroll
    // off the edge and show black void beside the terrain — which reads as a
    // rendering failure, not as the end of the world.
    const camX = clampCamera(this.camera.viewX - padX, this.world.tilesW * TILE, viewport.w);
    const camY = clampCamera(this.camera.viewY - padY, this.world.tilesH * TILE, viewport.h);
    batch.begin(camX, camY, viewport.w, viewport.h);
    // Lights share the camera the world is drawn with, so a pool never lags the
    // torch that casts it during a room scroll.
    if (lights) {
      this.collectLights(lights, camX, camY);
      batch.setLights(this.directional);
      batch.setNormalMix(1);
    }

    // Dungeon fog: in a barred biome only the room you are in exists. The next
    // room is black until you commit to its doorway — the suspense ALTTP built
    // its dungeons on. During the transition scroll both rooms show, so the new
    // one is *revealed* rather than popped.
    const fog = this.biome.barsRooms;
    const roomVisible = (wx: number, wy: number): boolean => {
      if (!fog) return true;
      const rx = Math.floor(wx / ROOM_PX_W);
      const ry = Math.floor(wy / ROOM_PX_H);
      if (rx === this.roomX && ry === this.roomY) return true;
      return this.camera.transitioning && rx === this.prevRoomX && ry === this.prevRoomY;
    };

    // Ground layer. Iterating the visible tile rect rather than the current room
    // means a mid-transition camera straddling two rooms just works.
    const tx0 = Math.floor(camX / TILE);
    const ty0 = Math.floor(camY / TILE);
    const tx1 = Math.floor((camX + viewport.w - 1) / TILE);
    const ty1 = Math.floor((camY + viewport.h - 1) / TILE);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.world.tilesW || ty >= this.world.tilesH) continue;
        if (!roomVisible(tx * TILE, ty * TILE)) continue;
        batch.draw(tileKey(this.world, tx, ty, this.tick), tx * TILE, ty * TILE);

        // Cast shade: anything tall throws a band on the open ground south of
        // it. One light direction applied consistently is what turns a flat
        // top-down field into terrain with height in it — and it costs a
        // neighbour lookup, because the tile above already knows it is tall.
        if (castsShade(this.world, tx, ty - 1) && !castsShade(this.world, tx, ty)) {
          batch.draw('fx.wallshade', tx * TILE, ty * TILE, { alpha: 0.28 });
        }
      }
    }

    // Object layer, painter-sorted by feet so things overlap correctly.
    this.drawList.length = 0;
    for (const e of this.entities.all) {
      if (!e.alive || e.carried) continue;
      if (e.x < camX - TILE || e.x > camX + viewport.w + TILE) continue;
      if (e.y < camY - TILE || e.y > camY + viewport.h + TILE) continue;
      if (!roomVisible(e.x, e.y)) continue;

      const bob = e.kind === 'pickup' ? Math.round(Math.sin(e.age / 9) * 1.5) - 2 : 0;
      // Shadows are sized to the thing casting them. A 16px blob under a 48px
      // Colossus made it look balanced on a coin — grounding is proportional or
      // it is comedy. Standing trees get one too, which is most of what stops a
      // wood reading as stickers on a lawn.
      if (e.kind === 'enemy' || e.kind === 'critter' || e.spriteKey === 'prop.tree') {
        this.drawList.push({
          key: shadowKeyFor(e.halfW), x: e.x, y: e.y + 1, alpha: SHADOW_ALPHA,
        });
      }
      // A stunned Errata shivers in place. The stun was mechanically real before
      // this and still *looked* like nothing — a 1px shudder is the difference
      // between a stat effect and a thing you can see.
      const stunned = e.kind === 'enemy' && e.hitstunFrames > ENEMY_HITSTUN_FRAMES;
      const shiver = stunned ? (((this.tick >> 2) & 1) === 0 ? 1 : -1) : 0;
      this.drawList.push({
        key: spriteKeyFor(e, this.tick, this.brains.isOpen(e)),
        x: e.x + shiver,
        y: e.y + bob,
        flash: e.flashFrames > 0 ? 1 : 0,
      });
    }

    this.drawList.push({
      key: 'fx.shadow', x: this.player.x, y: this.player.y + 1, alpha: SHADOW_ALPHA,
    });
    if (this.player.visible) {
      // Shield goes behind the body when facing away, in front otherwise — that
      // ordering is the whole reason it reads as being held rather than pasted on.
      if (this.player.bracing) {
        const [fx, fy] = this.player.facingVector;
        this.drawList.push({
          key: 'player.shield',
          x: this.player.x + fx * 7 + (fy !== 0 ? 5 : 0),
          y: this.player.y - 9 + fy * 4,
          // Behind the body when facing away, in front otherwise.
          sortY: this.player.facing === 'up' ? this.player.y - 0.01 : this.player.y + 0.01,
        });
      }
      this.drawList.push({ key: this.player.spriteKey(), x: this.player.x, y: this.player.y });

      if (this.carriedId !== null) {
        const held = this.entities.all.find((e) => e.id === this.carriedId);
        if (held) {
          this.drawList.push({
            key: held.spriteKey,
            x: held.x,
            y: held.y,
            sortY: this.player.y + 0.02, // over the head, so always last
          });
        }
      }
    }
    this.drawList.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));

    for (const d of this.drawList) {
      batch.draw(d.key, d.x, d.y, { alpha: d.alpha ?? 1, flash: d.flash ?? 0 });
    }

    if (this.townGate?.alive) {
      // The name alone was not enough. "to amberwake" tells you where the thing
      // goes and nothing about what to do with it, so a player can stand beside
      // the only route out of the meadow and read it as scenery. Standing close
      // enough swaps the sign for an instruction.
      const near = Math.hypot(
        this.townGate.x - this.player.x, this.townGate.y - this.player.y,
      ) < TOWN_GATE_PROMPT;
      drawTextCentred(batch, this.townGate.x, this.townGate.y + 4, 'to amberwake', 0.9);
      if (near) {
        drawTextCentred(batch, this.townGate.x, this.townGate.y + 12, 'step on to enter', 0.75);
      }
    }

    // Teleporter labels, in world space so they sit under their pad. Hidden
    // while the menu is up — two layers of text in one place reads as neither.
    for (const id of this.mode === 'menu' ? [] : this.teleporterIds) {
      const pad = this.entities.all.find((e) => e.id === id);
      const target = this.teleporterTargets.get(id);
      if (!pad || !pad.alive || !target) continue;
      // World coordinates: the batch already subtracts the camera, so offsetting
      // here as well would put the label a whole screen away.
      drawTextCentred(batch, pad.x, pad.y + 3, target.name, 0.9);
    }

    // Blasts sit above the object layer but below particles.
    for (const blast of this.blasts) {
      const stage = Math.min(2, Math.floor((blast.frame / BLAST_FRAMES) * 3));
      const fade = 1 - blast.frame / BLAST_FRAMES;
      batch.draw(`fx.blast.${stage}`, blast.x, blast.y, { alpha: 0.35 + fade * 0.65 });
    }

    // Particles ride above everything — debris passing behind the thing it came
    // out of reads as a glitch.
    for (const p of this.particles.all) {
      if (!p.active) continue;
      if (!roomVisible(p.x, p.y)) continue; // motes must not glow through the fog
      batch.draw(p.key, p.x, p.y - p.z, { alpha: this.particles.alphaOf(p) });
    }
    batch.flush();

    // UI pass: camera at the origin, so everything below is in screen space.
    // UI pass: flat. Text and hearts have no surface for a torch to rake across.
    batch.setNormalMix(0);
    batch.begin(0, 0, viewport.w, viewport.h);
    if (this.mode === 'shop' && this.talkingTo) {
      drawShop(batch, {
        trader: this.talkingTo.name,
        role: this.talkingTo.role,
        stock: this.shopStock,
        sellable: this.sellable(),
        side: this.shopSide,
        cursor: this.shopCursor,
        shards: this.amber,
        level: this.level,
      }, this.tick);
    } else if (this.mode === 'talk' && this.talkingTo) {
      const r = this.talkingTo;
      drawTalk(batch, {
        name: r.name,
        role: r.role,
        line: this.talkLine,
        met: this.save.met?.[r.id] ?? 0,
        truth: r.anchor ? r.truth : null,
        shop: r.shop,
      });
    } else if (this.mode === 'offer' && this.offer) {
      drawOffer(batch, this.offer, this.pack.currentFor(this.offer), this.offerYes);
    } else if (this.mode === 'pack') {
      drawPack(batch, {
        items: this.pack.all,
        cursor: this.packCursor,
        equippedWeapon: this.pack.equippedWeapon,
        equippedArmour: this.pack.equippedArmour,
        treasure: this.pack.treasureValue,
        amber: this.amber,
      }, this.tick);
    } else if (this.mode === 'menu') {
      this.menu.difficulty = this.difficulty;
      drawMenu(batch, this.menu, this.tick, this.padStatus);
    } else if (this.mode === 'reliquary') {
      drawReliquary(batch, {
        cursor: this.reliquaryCursor,
        amber: this.amber,
        owned: this.owned,
        frame: this.revisionFrame,
      });
    } else if (this.mode === 'revising') {
      drawRevision(batch, {
        frame: this.revisionFrame,
        revisions: this.revisions,
        draftIndex: this.pendingDraft?.index ?? this.draft.index,
        amber: this.amber,
        bestDepth: this.save.bestDepth,
        reachedDepth: this.depth + 1,
      });
    } else {
      drawHud(batch, {
        health: this.player.health,
        maxHealth: this.player.maxHealth,
        amber: this.amber,
        level: this.level,
        levelProgress: levelProgress(this.xp),
        ...(this.invincible ? { god: true } : {}),
        ...(this.loadout.selected
          ? { itemIcon: this.loadout.selected.icon, itemAmmo: this.loadout.selectedAmmo }
          : {}),
        // The biome is the place; the Act is the chapter. Showing the biome name
        // is what makes the world builder legible from inside the game.
        draftLine: `${this.biome.name} - floor ${this.depth + 1} of ${this.act.floors}`,
        subLine: draftSummary(this.draft),
        objective: objectiveLine(this.beat),
        thought: this.mutter,
        // The rebirth couplet is already Aldez thinking out loud, and stacking a
        // second thought under it put four separate voices on the screen in the
        // first ten seconds. One at a time: the waking lines have priority, and
        // the thread's thought waits its turn.
        thoughtAlpha: this.hintFrames > 0 ? 0 : Math.min(1, this.mutterFrames / 45),
        keys: true,
        banner: this.actBanner > 0
          ? this.act.name
          : this.clearPulse > 0
            ? 'room cleared'
            : this.barredRoom ? 'the way is barred' : '',
        bannerFrames: this.actBanner > 0
          ? this.actBanner
          : this.clearPulse > 0 ? this.clearPulse : this.barredRoom ? 40 : 0,
      });

      if (this.levelBanner > 0) {
        const a = Math.min(1, this.levelBanner / 30) * 0.95;
        drawTextCentred(batch, viewport.w / 2, 50, `level ${this.level}`, a);
      }

      if (this.noticeFrames > 0) {
        const a = Math.min(1, this.noticeFrames / 30) * 0.9;
        drawTextCentred(batch, viewport.w / 2, 60, this.notice, a);
      }

      // Aldez's own voice sits low and dim, apart from the HUD. It is a thought,
      // not a readout, and it should never compete with the hearts for the eye.
      // Aldez's voice is drawn by the HUD now, above the key legend, so the
      // thought and the keys cannot land on the same row.

      // What you just picked up, and whether it went straight on. Loot the
      // player does not notice is loot that did not happen.
      if (this.pickupBanner > 0 && this.pack.lastPickup) {
        const item = this.pack.lastPickup;
        const alpha = Math.min(1, this.pickupBanner / 30) * 0.95;
        const equipped = item.uid === this.pack.equippedWeapon?.uid
          || item.uid === this.pack.equippedArmour?.uid;
        drawTextCentred(batch, viewport.w / 2, 62, `found  ${item.name}`, alpha);
        if (equipped) {
          drawTextCentred(batch, viewport.w / 2, 71, 'equipped', alpha * 0.7);
        }
      }

      // Who you are standing next to. Names on the ground are what turn a crowd
      // into people you might recognise next life.
      if (this.nearFolk && this.mode === 'playing') {
        drawTextCentred(batch, viewport.w / 2, viewport.h - 62,
          `x  speak to ${this.nearFolk.name.toLowerCase()}`, 0.85);
      }

      // Teaching sits above the waking words and below the action, and never
      // covers the player: it fades in, fades out, and blocks nothing.
      const lesson = this.tutor.current();
      if (lesson) {
        drawTextCentred(batch, viewport.w / 2, viewport.h - 54, lesson.text, lesson.alpha);
      }

      // The waking words, low on the screen, fading out at the end.
      if (this.hintLines && this.hintFrames > 0) {
        const alpha = Math.min(1, this.hintFrames / 50) * 0.9;
        drawTextCentred(batch, viewport.w / 2, viewport.h - 40, this.hintLines[0], alpha);
        drawTextCentred(batch, viewport.w / 2, viewport.h - 30, this.hintLines[1], alpha);
      }
    }
    batch.flush();
  }

  /**
   * Where the exits from the current room are. Used by the capture harness to
   * aim at a gate instead of guessing a direction — with a generated floor, a
   * fixed walk just runs into the moat and silently tests nothing.
   */
  roomExits(): { rx: number; ry: number; doors: string[] } {
    const node = this.floor.rooms.get(`${this.roomX},${this.roomY}`);
    return { rx: this.roomX, ry: this.roomY, doors: [...(node?.doors ?? [])] };
  }

  debugText(): string {
    const s = this.player.sword;
    const enemies = this.entities.all.filter((e) => e.alive && e.kind === 'enemy').length;
    return [
      `draft ${this.draft.index} ${this.draft.condition}  ${this.mode}`,
      `room  ${this.roomX},${this.roomY}${this.camera.transitioning ? ' (scrolling)' : ''}`,
      `pos   ${this.player.x.toFixed(1)}, ${this.player.y.toFixed(1)}  ${this.player.facing}`,
      `hp    ${this.player.health}/${this.player.maxHealth}  ifr ${this.player.iframes}`,
      `sword ${s.phase} f${s.frame}   stop ${this.hitstop.remaining}`,
      `foes  ${enemies}  killed ${this.enemiesKilled}  amber ${this.amber}`,
      `room  ${this.barredRoom ? 'BARRED' : 'open'}  cleared ${this.clearedRooms.size}`,
      `meta  kills ${this.metaKills}  rooms ${this.metaRoomsCleared}  best f${this.save.bestDepth}`,
    ].join('\n');
  }
}

/**
 * Keep the view inside the world. When the world is smaller than the viewport
 * there is nothing to clamp to, so centre it instead of pinning it to a corner.
 */
/**
 * Does this tile stand tall enough to throw a shadow?
 *
 * Water does not — it is a hole, not a wall, and shading its south shore was the
 * one case that read as a mistake rather than as depth.
 */
function castsShade(world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.tilesW || ty >= world.tilesH) return false;
  const kind = world.at(tx, ty);
  return kind === TileKind.Tree || kind === TileKind.Cliff || kind === TileKind.Wall;
}

/**
 * Which silhouette a role wears.
 *
 * Five bodies covering thirteen roles: the shape only has to say what someone is
 * doing at a glance across a square. Their name and their actual role are on
 * screen the moment you speak to them.
 */
function folkSpriteFor(role: string): string {
  if (role === 'guard' || role === 'soldier') return 'folk.guard.0';
  if (role === 'merchant' || role === 'innkeeper') return 'folk.trader.0';
  if (role === 'noble' || role === 'priest') return 'folk.gentry.0';
  if (role === 'beggar' || role === 'drunk' || role === 'scavenger') return 'folk.poor.0';
  return 'folk.worker.0';
}

/** Contact shadow sized to the caster's footprint. */
function shadowKeyFor(halfW: number): string {
  if (halfW >= 18) return 'fx.shadow.big';
  if (halfW >= 10) return 'fx.shadow.mid';
  return 'fx.shadow';
}

function clampCamera(value: number, worldSize: number, viewSize: number): number {
  if (worldSize <= viewSize) return Math.round(-(viewSize - worldSize) / 2);
  return Math.max(0, Math.min(worldSize - viewSize, value));
}

function spriteKeyFor(e: Entity, tick: number, open = false): string {
  // The Warden's keyhole lights while it is recovering. Passing the state in
  // keeps Brains.spriteKey a pure function of the entity, and puts the one
  // exception where the caller already knows the answer.
  if (e.variant === 'warden') return `warden.${open ? 'open' : 'walk'}.${e.animFrame}`;
  if (e.kind === 'enemy') return Brains.spriteKey(e);
  if (e.spriteKey.startsWith('prop.torch')) return `prop.torch.${Math.floor(tick / 8) % 2}`;
  if (e.spriteKey.startsWith('prop.teleporter')) {
    return `prop.teleporter.${Math.floor(tick / 14) % 2}`;
  }
  return e.spriteKey;
}
