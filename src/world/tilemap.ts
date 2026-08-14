/**
 * The tile grid, room addressing, and atlas key selection.
 *
 * A room is exactly one screen (16x14 tiles) and rooms tile the world on a grid.
 * That constraint is what lets the camera stay room-locked and lets a transition
 * be a fixed-length scroll rather than a chase.
 */

import { ROOM_TILES_H, ROOM_TILES_W } from '../core/const.ts';
import { TILE, normalizeBlobMask } from '../art/tiles.ts';

export const TileKind = {
  Grass: 0,
  Dirt: 1,
  Water: 2,
  Floor: 3,
  Wall: 4,
  /** Dense canopy — a forest barrier. Solid. */
  Tree: 5,
  /** Rock face — a mountain barrier. Solid. */
  Cliff: 6,
  /** A tiled roof seen from above. Solid — you walk around houses, not through. */
  Roof: 7,
  /** Cobbled street. Walkable, and unmistakably a town. */
  Cobble: 8,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

export interface Prop {
  key: string;
  /** world tile coordinates */
  tx: number;
  ty: number;
  solid: boolean;
  /**
   * Which placeable put this here. Several placeables legitimately share one
   * sprite — rubble, a fallen log and a boulder are all `prop.rock` — so the
   * sprite key cannot identify the contract that authorised the placement.
   */
  sourceId?: string;
}

export interface Room {
  rx: number;
  ry: number;
  tiles: Uint8Array;
}

const PROP_DEFS: Record<string, { key: string; base: TileKind; solid: boolean }> = {
  b: { key: 'prop.bush', base: TileKind.Grass, solid: true },
  p: { key: 'prop.pot', base: TileKind.Grass, solid: true },
  P: { key: 'prop.pot', base: TileKind.Floor, solid: true },
  c: { key: 'prop.chest.closed', base: TileKind.Floor, solid: true },
  t: { key: 'prop.torch.0', base: TileKind.Floor, solid: true },
  T: { key: 'prop.dummy', base: TileKind.Grass, solid: true },
};

const TILE_CHARS: Record<string, TileKind> = {
  G: TileKind.Grass,
  D: TileKind.Dirt,
  W: TileKind.Water,
  F: TileKind.Floor,
  X: TileKind.Wall,
};

export class World {
  readonly roomsW: number;
  readonly roomsH: number;
  private readonly tiles: Uint8Array;
  /**
   * Spawn data only. Props become entities the moment a Draft loads — anything
   * with state that changes during play belongs in entity/, not in the tile grid.
   */
  readonly props: Prop[] = [];

  /**
   * Optional per-tile material choice, 0 = "decide from the position hash".
   *
   * Position hashing is right for terrain — it is what stops a field of grass
   * repeating — but wrong for anything built, because a builder does not change
   * tile supplier halfway across a roof. A generator that knows a structure is
   * one object stamps its choice here, and the whole structure agrees.
   */
  private readonly materials: Uint8Array;

  constructor(roomsW: number, roomsH: number) {
    this.roomsW = roomsW;
    this.roomsH = roomsH;
    this.tiles = new Uint8Array(roomsW * ROOM_TILES_W * roomsH * ROOM_TILES_H);
    this.materials = new Uint8Array(this.tiles.length);
  }

  /** Stamp a material on a tile. `variant` is 1-based; 0 restores the hash. */
  setMaterial(tx: number, ty: number, variant: number): void {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return;
    this.materials[ty * this.tilesW + tx] = variant;
  }

  /** 0 when nothing was stamped, meaning "fall back to the position hash". */
  materialAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return 0;
    return this.materials[ty * this.tilesW + tx]!;
  }

  get tilesW(): number { return this.roomsW * ROOM_TILES_W; }
  get tilesH(): number { return this.roomsH * ROOM_TILES_H; }

  /** Out-of-bounds reads return Wall so the player can never leave the map. */
  at(tx: number, ty: number): TileKind {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return TileKind.Wall;
    return this.tiles[ty * this.tilesW + tx] as TileKind;
  }

  /** Terrain solidity only. Prop and enemy solidity comes from entity/. */
  isSolid(tx: number, ty: number): boolean {
    const kind = this.at(tx, ty);
    return (
      kind === TileKind.Wall ||
      kind === TileKind.Water ||
      kind === TileKind.Tree ||
      kind === TileKind.Cliff ||
      kind === TileKind.Roof
    );
  }

  /** Solid *and* deadly. Anything knocked in here drowns. */
  isDrowning(tx: number, ty: number): boolean {
    return this.at(tx, ty) === TileKind.Water;
  }

  setTile(tx: number, ty: number, kind: TileKind): void {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return;
    this.tiles[ty * this.tilesW + tx] = kind;
  }

  fillTiles(kind: TileKind): void {
    this.tiles.fill(kind);
  }

  addProp(key: string, tx: number, ty: number, solid = true, sourceId?: string): void {
    this.props.push({ key, tx, ty, solid, ...(sourceId === undefined ? {} : { sourceId }) });
  }

  /** Clear props off a tile. Used when carving a guaranteed path through a room. */
  removePropsAt(tx: number, ty: number): void {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i]!;
      if (p.tx === tx && p.ty === ty) this.props.splice(i, 1);
    }
  }

  /** Terrain is walkable and no solid prop stands here. */
  isWalkable(tx: number, ty: number): boolean {
    if (this.isSolid(tx, ty)) return false;
    return !this.props.some((p) => p.solid && p.tx === tx && p.ty === ty);
  }

  /** Load a room from an ASCII template — see the room-template model in dungeon-gen. */
  loadRoom(rx: number, ry: number, rows: readonly string[]): void {
    if (rows.length !== ROOM_TILES_H) {
      throw new Error(`room ${rx},${ry}: expected ${ROOM_TILES_H} rows, got ${rows.length}`);
    }
    const ox = rx * ROOM_TILES_W;
    const oy = ry * ROOM_TILES_H;

    rows.forEach((row, y) => {
      if (row.length !== ROOM_TILES_W) {
        throw new Error(`room ${rx},${ry} row ${y}: expected ${ROOM_TILES_W} cols, got ${row.length}`);
      }
      [...row].forEach((ch, x) => {
        const tx = ox + x;
        const ty = oy + y;
        const prop = PROP_DEFS[ch];
        if (prop) {
          this.tiles[ty * this.tilesW + tx] = prop.base;
          this.props.push({ key: prop.key, tx, ty, solid: prop.solid });
          return;
        }
        const kind = TILE_CHARS[ch];
        if (kind === undefined) throw new Error(`room ${rx},${ry}: unknown char "${ch}"`);
        this.tiles[ty * this.tilesW + tx] = kind;
      });
    });
  }

  roomAt(worldX: number, worldY: number): { rx: number; ry: number } {
    return {
      rx: Math.floor(worldX / (ROOM_TILES_W * TILE)),
      ry: Math.floor(worldY / (ROOM_TILES_H * TILE)),
    };
  }
}

/**
 * Stable per-tile pseudo-random in [0,1). Variant choice has to be a pure
 * function of position — deriving it from a stream would make a tile change
 * appearance whenever an unrelated system drew from the same rng.
 */
export function tileHash(tx: number, ty: number): number {
  let h = Math.imul(tx, 0x27d4eb2d) ^ Math.imul(ty, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bit order matches the baked autotile set: N NE E SE S SW W NW. */
function grassMask(world: World, tx: number, ty: number): number {
  const g = (x: number, y: number): number => {
    // Off-map counts as matching. `at()` reports Wall out of bounds, which is right
    // for collision but wrong here: it made every grass tile on the world border an
    // edge tile, framing the whole map in the dirt showing through from underneath.
    if (x < 0 || y < 0 || x >= world.tilesW || y >= world.tilesH) return 1;
    return world.at(x, y) === TileKind.Grass ? 1 : 0;
  };
  return (
    (g(tx, ty - 1) << 0) |
    (g(tx + 1, ty - 1) << 1) |
    (g(tx + 1, ty) << 2) |
    (g(tx + 1, ty + 1) << 3) |
    (g(tx, ty + 1) << 4) |
    (g(tx - 1, ty + 1) << 5) |
    (g(tx - 1, ty) << 6) |
    (g(tx - 1, ty - 1) << 7)
  );
}

/** Which atlas cell a tile draws as. `tick` drives water animation. */
export function tileKey(world: World, tx: number, ty: number, tick: number): string {
  const kind = world.at(tx, ty);
  const h = tileHash(tx, ty);

  switch (kind) {
    case TileKind.Grass: {
      const mask = grassMask(world, tx, ty);
      // Fully surrounded by grass: use a base variant, which has more texture
      // variety than the interior of an edge tile.
      if (mask === 255) return `grass.base.${Math.floor(h * 4)}`;
      return `grass.edge.${String(normalizeBlobMask(mask)).padStart(3, '0')}`;
    }
    case TileKind.Dirt:
      return `dirt.base.${Math.floor(h * 3)}`;
    case TileKind.Water: {
      // Spatial variant by position, animation frame by time — see drawWater.
      const spatial = Math.floor(h * 4);
      const frame = Math.floor(tick / 24) % 2;
      return `water.base.${spatial * 2 + frame}`;
    }
    case TileKind.Floor:
      return `floor.dungeon.${Math.floor(h * 4)}`;
    case TileKind.Wall:
      return `wall.dungeon.${Math.floor(h * 3)}`;
    case TileKind.Tree:
      return `tree.base.${Math.floor(h * 4)}`;
    case TileKind.Cliff:
      return `cliff.base.${Math.floor(h * 4)}`;
    case TileKind.Roof: {
      // Built, not grown: the material is stamped per building so one house is
      // one roof rather than a speckle of three.
      const stamped = world.materialAt(tx, ty);
      return `roof.base.${stamped > 0 ? stamped - 1 : Math.floor(h * 3)}`;
    }
    case TileKind.Cobble:
      return `cobble.base.${Math.floor(h * 3)}`;
  }
}
