/**
 * A deliberately small entity store: a flat array, integer ids, no ECS library.
 *
 * Everything the player can hit, break, or pick up lives here. Terrain stays in
 * world/ — the split is "does it have state that changes during a Draft".
 */

export type EntityKind = 'prop' | 'pickup' | 'enemy' | 'projectile' | 'critter' | 'folk';

/** Facing index, matching the sprite key order down/up/left/right. */
export const DIRS = ['down', 'up', 'left', 'right'] as const;
export type DirName = (typeof DIRS)[number];

export interface Entity {
  id: number;
  kind: EntityKind;
  spriteKey: string;
  /** feet position in world pixels */
  x: number;
  y: number;
  halfW: number;
  boxH: number;
  hp: number;
  alive: boolean;
  solid: boolean;
  /** false for scenery like chests and torches — the sword passes over them */
  breakable: boolean;

  /** frames of white damage flash remaining */
  flashFrames: number;
  /** frames of hitstun remaining — the entity does not act */
  hitstunFrames: number;
  knockX: number;
  knockY: number;
  knockFrames: number;
  knockTotal: number;

  /**
   * The swing id that last connected. A swing may only hit an entity once, and
   * comparing ids is cheaper and less error-prone than clearing a per-swing set.
   */
  lastHitSwing: number;

  /** particle sprite family used when this breaks, e.g. 'fx.leaf' */
  debris: string;
  /** sprite key of what pops out when destroyed */
  drop?: string;
  /** frames alive, used for pickup bob */
  age: number;
  /**
   * Frames spent floundering in deep water before going under.
   *
   * Knockback moves entities without a collision check — which is how they end
   * up in a lake — so rather than fight that, drowning turns it into an outcome.
   */
  drowning: number;

  /** enemy/projectile type, e.g. 'octorok' — drives both brain and sprite key */
  variant: string;
  /**
   * Who a projectile belongs to. Deflecting a pellet with the shield flips this
   * to 'player', which is what turns a blocked shot into a counter-attack rather
   * than just a cancelled one.
   */
  owner: 'player' | 'enemy';
  /** can be picked up and thrown */
  liftable: boolean;
  /** true while being carried: not solid, not drawn in the world layer */
  carried: boolean;
  /**
   * Shrugs off blades and boomerangs; only a blast (or a heavy tool) harms it.
   * The armored *gate lives in the callers*, so the bomb path can simply call
   * hit() and pierce.
   */
  armored: boolean;
  /** knockback multiplier — 1 for ordinary things, near 0 for the massive */
  knockScale: number;
  /**
   * Index into the scene's resident table for `folk`.
   *
   * A townsperson's identity, role and dialogue live in the town, not on the
   * entity — the entity is just the body standing in the square. -1 elsewhere.
   */
  residentIndex: number;
  /** free movement, used by projectiles and by brains that steer directly */
  vx: number;
  vy: number;
  /** contact damage dealt to the player, in health subunits */
  contactDamage: number;
  facing: DirName;
  /** animation frame counter owned by ai/ */
  animTimer: number;
  animFrame: number;
}

export interface SpawnInit {
  kind: EntityKind;
  spriteKey: string;
  x: number;
  y: number;
  halfW?: number;
  boxH?: number;
  hp?: number;
  solid?: boolean;
  breakable?: boolean;
  debris?: string;
  drop?: string;
  variant?: string;
  vx?: number;
  vy?: number;
  contactDamage?: number;
  facing?: DirName;
  owner?: 'player' | 'enemy';
  liftable?: boolean;
  armored?: boolean;
  knockScale?: number;
  residentIndex?: number;
}

export const ENEMY_FLASH_FRAMES = 6;
export const ENEMY_HITSTUN_FRAMES = 12;
export const ENEMY_KNOCK_DISTANCE = 16;
export const ENEMY_KNOCK_FRAMES = 8;

export class EntityStore {
  private list: Entity[] = [];
  private nextId = 1;
  /** tile index -> count of solid entities, kept in step with alive/solid */
  private solidTiles = new Map<number, number>();
  private tilesW = 0;

  constructor(tilesW: number) {
    this.tilesW = tilesW;
  }

  get all(): readonly Entity[] {
    return this.list;
  }

  spawn(init: SpawnInit): Entity {
    const e: Entity = {
      id: this.nextId++,
      kind: init.kind,
      spriteKey: init.spriteKey,
      x: init.x,
      y: init.y,
      halfW: init.halfW ?? 6,
      boxH: init.boxH ?? 12,
      hp: init.hp ?? 1,
      alive: true,
      solid: init.solid ?? false,
      breakable: init.breakable ?? true,
      flashFrames: 0,
      hitstunFrames: 0,
      knockX: 0,
      knockY: 0,
      knockFrames: 0,
      knockTotal: 0,
      lastHitSwing: -1,
      debris: init.debris ?? 'fx.spark',
      age: 0,
      variant: init.variant ?? '',
      vx: init.vx ?? 0,
      vy: init.vy ?? 0,
      contactDamage: init.contactDamage ?? 0,
      facing: init.facing ?? 'down',
      owner: init.owner ?? 'enemy',
      liftable: init.liftable ?? false,
      carried: false,
      armored: init.armored ?? false,
      knockScale: init.knockScale ?? 1,
      residentIndex: init.residentIndex ?? -1,
      animTimer: 0,
      animFrame: 0,
      drowning: 0,
      ...(init.drop === undefined ? {} : { drop: init.drop }),
    };
    this.list.push(e);
    if (e.solid) this.addSolid(e);
    return e;
  }

  private tileIndex(e: Entity): number {
    const tx = Math.floor(e.x / 16);
    const ty = Math.floor((e.y - 1) / 16);
    return ty * this.tilesW + tx;
  }

  private addSolid(e: Entity): void {
    const i = this.tileIndex(e);
    this.solidTiles.set(i, (this.solidTiles.get(i) ?? 0) + 1);
  }

  private removeSolid(e: Entity): void {
    const i = this.tileIndex(e);
    const n = (this.solidTiles.get(i) ?? 1) - 1;
    if (n <= 0) this.solidTiles.delete(i);
    else this.solidTiles.set(i, n);
  }

  solidAt(tx: number, ty: number): boolean {
    return this.solidTiles.has(ty * this.tilesW + tx);
  }

  /** Lifting a prop takes it out of the collision grid without killing it. */
  setCarried(e: Entity, carried: boolean): void {
    if (e.carried === carried) return;
    if (carried && e.solid) this.removeSolid(e);
    e.carried = carried;
    e.solid = false;
  }

  /**
   * Apply a hit. Returns true if it landed — false when the entity is already
   * dead or this swing has touched it before.
   */
  hit(e: Entity, swingId: number, damage: number, dirX: number, dirY: number): boolean {
    if (!e.alive || !e.breakable || e.lastHitSwing === swingId) return false;
    e.lastHitSwing = swingId;
    e.hp -= damage;
    e.flashFrames = ENEMY_FLASH_FRAMES;
    e.hitstunFrames = ENEMY_HITSTUN_FRAMES;

    const len = Math.hypot(dirX, dirY) || 1;
    // Mass resists: a Keese sails, a Colossus rocks on its heels.
    e.knockX = (dirX / len) * ENEMY_KNOCK_DISTANCE * e.knockScale;
    e.knockY = (dirY / len) * ENEMY_KNOCK_DISTANCE * e.knockScale;
    e.knockFrames = ENEMY_KNOCK_FRAMES;
    e.knockTotal = ENEMY_KNOCK_FRAMES;

    if (e.hp <= 0) this.kill(e);
    return true;
  }

  kill(e: Entity): void {
    if (!e.alive) return;
    e.alive = false;
    if (e.solid) this.removeSolid(e);
  }

  /** Alive entities whose box overlaps the given circle. */
  overlapCircle(cx: number, cy: number, r: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      // closest point on the box to the circle centre
      const nx = Math.max(e.x - e.halfW, Math.min(cx, e.x + e.halfW));
      const ny = Math.max(e.y - e.boxH, Math.min(cy, e.y));
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy <= r * r) out.push(e);
    }
    return out;
  }

  update(): void {
    for (const e of this.list) {
      e.age++;
      if (e.flashFrames > 0) e.flashFrames--;
      if (e.hitstunFrames > 0) e.hitstunFrames--;

      if (e.knockFrames > 0) {
        // Ease-out: most of the distance is covered in the first few frames, which
        // is what makes a hit read as an impact rather than a shove.
        const t = e.knockFrames / e.knockTotal;
        const step = (t * 2) / (e.knockTotal + 1);
        e.x += e.knockX * step;
        e.y += e.knockY * step;
        e.knockFrames--;
      }

      // Only projectiles integrate velocity here. Enemies move through the
      // collision path in ai/, and applying both would double their speed.
      if (e.kind === 'projectile') {
        e.x += e.vx;
        e.y += e.vy;
      }
    }

    // Compact once per frame rather than splicing mid-iteration.
    if (this.list.some((e) => !e.alive && e.flashFrames === 0)) {
      this.list = this.list.filter((e) => e.alive || e.flashFrames > 0);
    }
  }
}
