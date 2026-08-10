/**
 * Enemy behaviour.
 *
 * Brains live here rather than on the entity because entity/ sits below ai/ in
 * the layer order — the store holds state that anything may read, this holds the
 * logic that drives it.
 *
 * The design rule from zelda-feel: **each type must need a different counter**, or
 * combat is one-note however many types you add.
 *
 *   Octorok — stops and spits along its facing.  Counter: don't stand in the line.
 *   Moblin  — charges on sight after a visible telegraph.  Counter: dodge, then punish.
 *   Keese   — erratic flight, contact only.  Counter: timing and patience.
 */

import type { Rng } from '../core/rng.ts';
import { moveActor } from '../physics/collide.ts';
import type { SolidQuery } from '../physics/collide.ts';
import type { DirName, Entity, EntityStore, SpawnInit } from '../entity/store.ts';

export interface EnemyStats {
  hp: number;
  speed: number;
  contactDamage: number;
  halfW: number;
  boxH: number;
  debris: string;
  /** knockback multiplier — mass, expressed as reluctance to move */
  knockScale?: number;
}

export const ENEMY_STATS: Record<string, EnemyStats> = {
  octorok: { hp: 2, speed: 0.55, contactDamage: 4, halfW: 6, boxH: 11, debris: 'fx.gore' },
  moblin: { hp: 3, speed: 0.7, contactDamage: 4, halfW: 6, boxH: 13, debris: 'fx.gore' },
  keese: { hp: 1, speed: 0.9, contactDamage: 2, halfW: 5, boxH: 10, debris: 'fx.gore' },
  // The big ones. Scarce by placement, resistant to knockback by mass — a sword
  // hit that shoves a Keese four tiles barely rocks a Hulk on its heels.
  hulk: { hp: 10, speed: 0.35, contactDamage: 6, halfW: 13, boxH: 26, debris: 'fx.gore', knockScale: 0.2 },
  colossus: { hp: 18, speed: 0.28, contactDamage: 8, halfW: 20, boxH: 40, debris: 'fx.shard', knockScale: 0.08 },
};

/** Frames Moblin visibly winds up before charging — the player's window to react. */
export const MOBLIN_TELEGRAPH = 20;
const MOBLIN_CHARGE_FRAMES = 34;
const MOBLIN_SIGHT = 96;

const OCTOROK_WALK_MIN = 40;
const OCTOROK_WALK_MAX = 100;
const OCTOROK_AIM_FRAMES = 26;
const OCTOROK_RANGE = 128;
const PELLET_SPEED = 1.9;
const PELLET_LIFE = 150;

interface Brain {
  /** shared phase timer */
  timer: number;
  state: 'wander' | 'aim' | 'telegraph' | 'charge' | 'fly' | 'flee';
  dirX: number;
  dirY: number;
  /** keese sine wobble offset, kept per-entity so they don't fly in lockstep */
  phase: number;
}

function dirNameFrom(dx: number, dy: number): DirName {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export interface PlayerView {
  x: number;
  y: number;
}

export class Brains {
  private brains = new Map<number, Brain>();
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  /** Build the spawn payload for an enemy type, so callers don't repeat stats. */
  static spawnInit(variant: string, x: number, y: number): SpawnInit {
    const s = ENEMY_STATS[variant];
    if (!s) throw new Error(`unknown enemy variant "${variant}"`);
    return {
      kind: 'enemy',
      spriteKey: variant,
      variant,
      x,
      y,
      halfW: s.halfW,
      boxH: s.boxH,
      hp: s.hp,
      // Enemies never block movement — in ALTTP you walk through them and take a
      // hit, and making them solid turns every fight into a shoving match.
      solid: false,
      breakable: true,
      debris: s.debris,
      contactDamage: s.contactDamage,
      ...(s.knockScale === undefined ? {} : { knockScale: s.knockScale }),
    };
  }

  register(e: Entity): void {
    this.brains.set(e.id, {
      timer: this.rng.int(0, 40),
      state: e.variant === 'keese' ? 'fly' : 'wander',
      dirX: this.rng.pick([-1, 0, 1]),
      dirY: this.rng.pick([-1, 0, 1]),
      phase: this.rng.range(0, Math.PI * 2),
    });
  }

  forget(id: number): void {
    this.brains.delete(id);
  }

  update(entities: EntityStore, player: PlayerView, isSolid: SolidQuery): void {
    for (const e of entities.all) {
      if (!e.alive) continue;
      if (e.kind === 'critter') {
        const critterBrain = this.brains.get(e.id);
        if (critterBrain) {
          this.critter(e, critterBrain, entities, player, isSolid);
          this.animate(e);
        }
        continue;
      }
      if (e.kind !== 'enemy') continue;
      const brain = this.brains.get(e.id);
      if (!brain) continue;

      // Hitstun means exactly that: the enemy does nothing while it is being
      // knocked back, which is what gives the player their free follow-up.
      if (e.hitstunFrames > 0) {
        // A stun empties the head, it doesn't pause it. A Moblin frozen
        // mid-charge that resumed the same charge on waking read as if the stun
        // had never happened — which is exactly the bug report. It re-telegraphs
        // instead, so the stun visibly buys the player the exchange.
        if (brain.state === 'charge' || brain.state === 'telegraph' || brain.state === 'aim') {
          brain.state = 'wander';
          brain.timer = 0;
        }
        continue;
      }

      brain.timer++;
      switch (e.variant) {
        case 'octorok': this.octorok(e, brain, entities, player, isSolid); break;
        case 'moblin': this.moblin(e, brain, player, isSolid); break;
        case 'keese': this.keese(e, brain, player, isSolid); break;
        case 'hulk':
        case 'colossus': this.brute(e, brain, player, isSolid); break;
      }
      this.animate(e);
    }
  }

  private animate(e: Entity): void {
    e.animTimer++;
    const hold = e.variant === 'keese' ? 5 : 10;
    if (e.animTimer >= hold) {
      e.animTimer = 0;
      e.animFrame = (e.animFrame + 1) % 2;
    }
  }

  /** Spawn payload for fauna. Harmless: no contact damage, nothing barred on it. */
  static critterInit(variant: string, x: number, y: number): SpawnInit {
    return {
      kind: 'critter',
      spriteKey: `${variant}.0`,
      variant,
      x,
      y,
      halfW: 4,
      boxH: 6,
      hp: 1,
      solid: false,
      breakable: false,
      contactDamage: 0,
    };
  }

  /**
   * Fauna: potter about, and bolt when the player closes in.
   *
   * A sparrow flies — it ignores terrain while fleeing and simply leaves. A frog
   * hops along the ground and respects collision. Both despawn once they have
   * fled far enough, because a bird that circles back to exactly where it was
   * reads as a mechanism, not an animal.
   */
  private critter(
    e: Entity,
    brain: Brain,
    entities: EntityStore,
    player: PlayerView,
    isSolid: SolidQuery,
  ): void {
    brain.timer++;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (brain.state !== 'flee' && dist < 44) {
      brain.state = 'flee';
      brain.timer = 0;
      const len = dist || 1;
      brain.dirX = -dx / len;
      brain.dirY = -dy / len;
    }

    if (brain.state === 'flee') {
      if (e.variant === 'sparrow') {
        // Airborne: no collision, straight out of the scene.
        e.x += brain.dirX * 1.8;
        e.y += brain.dirY * 1.8;
      } else {
        this.step(e, brain.dirX * 1.2, brain.dirY * 1.2, isSolid);
      }
      e.facing = brain.dirX < 0 ? 'left' : 'right';
      if (brain.timer > 85) {
        entities.kill(e);
        this.forget(e.id);
      }
      return;
    }

    // Idle: a short hop every couple of seconds, otherwise stillness.
    if (brain.timer % 110 < 10) {
      const wobble = Math.sin(brain.phase + brain.timer) * 0.5;
      this.step(e, wobble, Math.cos(brain.phase) * 0.4, isSolid);
    }
  }

  private step(e: Entity, dx: number, dy: number, isSolid: SolidQuery): boolean {
    const result = moveActor(isSolid, { x: e.x, y: e.y, halfW: e.halfW, boxH: e.boxH }, dx, dy);
    const blocked = result.hitX || result.hitY;
    e.x = result.x;
    e.y = result.y;
    return blocked;
  }

  private octorok(
    e: Entity,
    brain: Brain,
    entities: EntityStore,
    player: PlayerView,
    isSolid: SolidQuery,
  ): void {
    const speed = ENEMY_STATS['octorok']!.speed;
    const dx = player.x - e.x;
    const dy = player.y - e.y;

    if (brain.state === 'wander') {
      const blocked = this.step(e, brain.dirX * speed, brain.dirY * speed, isSolid);
      if (brain.dirX !== 0 || brain.dirY !== 0) e.facing = dirNameFrom(brain.dirX, brain.dirY);

      // Stop and aim when roughly lined up with the player — an Octorok that
      // fires from any angle is just a turret and reads as unfair.
      const lined = Math.abs(dx) < 20 || Math.abs(dy) < 20;
      if (lined && Math.hypot(dx, dy) < OCTOROK_RANGE && brain.timer > 30) {
        brain.state = 'aim';
        brain.timer = 0;
        e.facing = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
        return;
      }

      if (blocked || brain.timer > this.rng.int(OCTOROK_WALK_MIN, OCTOROK_WALK_MAX)) {
        brain.timer = 0;
        brain.dirX = this.rng.pick([-1, 0, 1]);
        brain.dirY = brain.dirX === 0 ? this.rng.pick([-1, 1]) : 0;
      }
      return;
    }

    // aim: hold still, then spit
    if (brain.timer >= OCTOROK_AIM_FRAMES) {
      brain.state = 'wander';
      brain.timer = 0;
      const vel: Record<DirName, [number, number]> = {
        down: [0, PELLET_SPEED], up: [0, -PELLET_SPEED],
        left: [-PELLET_SPEED, 0], right: [PELLET_SPEED, 0],
      };
      const [vx, vy] = vel[e.facing];
      entities.spawn({
        kind: 'projectile',
        spriteKey: 'fx.pellet',
        variant: 'pellet',
        x: e.x + vx * 4,
        y: e.y - 5 + vy * 4,
        halfW: 3,
        boxH: 6,
        hp: PELLET_LIFE,
        solid: false,
        breakable: false,
        vx,
        vy,
        contactDamage: 4,
      });
    }
  }

  private moblin(e: Entity, brain: Brain, player: PlayerView, isSolid: SolidQuery): void {
    const speed = ENEMY_STATS['moblin']!.speed;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (brain.state === 'wander') {
      this.step(e, brain.dirX * speed, brain.dirY * speed, isSolid);
      if (brain.dirX !== 0 || brain.dirY !== 0) e.facing = dirNameFrom(brain.dirX, brain.dirY);
      if (brain.timer > 70) {
        brain.timer = 0;
        brain.dirX = this.rng.pick([-1, 0, 1]);
        brain.dirY = this.rng.pick([-1, 0, 1]);
      }
      if (dist < MOBLIN_SIGHT) {
        brain.state = 'telegraph';
        brain.timer = 0;
        e.facing = dirNameFrom(dx, dy);
      }
      return;
    }

    if (brain.state === 'telegraph') {
      // Stand still and face the player. The pause *is* the tell — a charge with
      // no windup is a cheap shot, not a challenge.
      if (brain.timer >= MOBLIN_TELEGRAPH) {
        brain.state = 'charge';
        brain.timer = 0;
        const len = dist || 1;
        brain.dirX = dx / len;
        brain.dirY = dy / len;
      }
      return;
    }

    // charge: committed, in a straight line, ends on a wall or a timer
    const blocked = this.step(e, brain.dirX * speed * 2.6, brain.dirY * speed * 2.6, isSolid);
    if (blocked || brain.timer >= MOBLIN_CHARGE_FRAMES) {
      brain.state = 'wander';
      brain.timer = 0;
    }
  }

  /**
   * The big ones: a slow, inevitable walk toward the player, and a telegraphed
   * lunge when close.
   *
   * Everything about a brute is pause and payoff. The walk gives the player all
   * the time in the world; the 26-frame wind-up before the lunge is the tell you
   * learn once and respect forever. No wandering, no idling — something this
   * size has exactly one interest.
   */
  private brute(e: Entity, brain: Brain, player: PlayerView, isSolid: SolidQuery): void {
    const stats = ENEMY_STATS[e.variant]!;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (brain.state === 'telegraph') {
      // Plant the feet. The stillness *is* the warning.
      if (brain.timer >= 26) {
        brain.state = 'charge';
        brain.timer = 0;
        const len = dist || 1;
        brain.dirX = dx / len;
        brain.dirY = dy / len;
      }
      return;
    }

    if (brain.state === 'charge') {
      const blocked = this.step(e, brain.dirX * stats.speed * 6, brain.dirY * stats.speed * 6, isSolid);
      if (blocked || brain.timer >= 13) {
        brain.state = 'wander';
        brain.timer = 0;
      }
      return;
    }

    // The walk. Sight range is long — it noticed you a while ago.
    if (dist < 60 && brain.timer > 30) {
      brain.state = 'telegraph';
      brain.timer = 0;
      return;
    }
    if (dist < 180) {
      const len = dist || 1;
      this.step(e, (dx / len) * stats.speed, (dy / len) * stats.speed, isSolid);
      e.facing = dirNameFrom(dx, dy);
    }
  }

  private keese(e: Entity, brain: Brain, player: PlayerView, isSolid: SolidQuery): void {
    const speed = ENEMY_STATS['keese']!.speed;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;

    // Drift toward the player, but ride a sine perpendicular to that heading so
    // the path is erratic rather than a homing missile.
    const wobble = Math.sin(brain.phase + brain.timer * 0.13) * 1.15;
    const nx = dx / len;
    const ny = dy / len;
    const vx = nx * speed + -ny * wobble;
    const vy = ny * speed + nx * wobble;

    if (this.step(e, vx, vy, isSolid)) {
      // Bounce off geometry instead of grinding along it.
      brain.phase += Math.PI;
    }
    e.facing = dirNameFrom(vx, vy);
  }

  /** Sprite key for the current frame. */
  static spriteKey(e: Entity): string {
    if (e.kind === 'critter') return `${e.variant}.${e.animFrame}`;
    if (e.variant === 'keese') return `keese.fly.${e.animFrame}`;
    // Brutes are symmetric and front-facing; their mass is the message.
    if (e.variant === 'hulk' || e.variant === 'colossus') {
      return `${e.variant}.walk.${e.animFrame}`;
    }
    return `${e.variant}.${e.facing}.walk.${e.animFrame}`;
  }
}
