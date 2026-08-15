/**
 * npm run capture
 *
 * Headless capture harness for the critic loop.
 *
 * Every check runs against a **fixture**: a sealed, deterministic scenario loaded
 * with `?fixture=<id>`, on its own fresh page. The previous design played one
 * long scripted run and asserted everything from it, which could never be
 * reliable — proving "you can win a fight" and "a fight can kill you" from a
 * single playthrough are mutually exclusive goals, and a scripted bot fighting
 * emergent enemies is a playtest wearing a test's clothes.
 *
 * The rule now: if a check needs a particular world state, a fixture provides it.
 * Nothing is left to whether the bot happened to corner a bat.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env['ALDEZ_URL'] ?? 'http://localhost:5173';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = join(ROOT, '.captures', stamp);

type Frame = Record<string, number | string>;

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Result[] = [];
const consoleErrors: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
}

// ---------------------------------------------------------------------------
// page helpers
// ---------------------------------------------------------------------------

async function shot(page: Page, name: string): Promise<void> {
  await page.locator('#game').screenshot({ path: join(OUT, `${name}.png`) });
}

/** Load a fixture on a fresh page and wait for the game to be running. */
async function openFixture(browser: Browser, id: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${id}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${id}] pageerror: ${e.message}`));

  await page.goto(`${BASE_URL}/?fixture=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Reflect.get(window, '__aldez') !== undefined, null, {
    timeout: 20000,
  });
  await page.waitForTimeout(350);
  return page;
}

interface Snapshot {
  mode: string;
  tick: number;
  hp: number;
  maxHp: number;
  amber: number;
  owned: number;
  draft: number;
  act: number;
  biome: string;
  barsRooms: boolean;
  px: number;
  py: number;
  facing: string;
  carrying: boolean;
  bracing: boolean;
  camX: number;
  camY: number;
  transitioning: boolean;
  foes: number;
  bars: number;
  props: number;
  liftable: { x: number; y: number } | null;
  nearestFoe: { x: number; y: number; d: number } | null;
  openChests: number;
  bombs: number;
  item: string;
  liveBombs: number;
  boomerangs: number;
  /** highest hitstun on any living enemy — how a stun is proven, not eyeballed */
  stunMax: number;
}

async function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const g = Reflect.get(window, '__aldez') as {
      scene: {
        mode: string; tick: number; amber: number; draft: { index: number };
        act: { index: number }; biome: { id: string; barsRooms: boolean };
        owned: Set<string>;
        player: {
          x: number; y: number; health: number; maxHealth: number;
          facing: string; carrying: boolean; bracing: boolean;
        };
        camera: { viewX: number; viewY: number; transitioning: boolean };
        loadout: { bombs: number; selected: { id: string } | null };
        entities: {
          all: ReadonlyArray<{
            alive: boolean; kind: string; spriteKey: string; liftable: boolean;
            carried: boolean; variant: string; hitstunFrames: number; x: number; y: number;
          }>;
        };
      };
    };
    const s = g.scene;
    const p = s.player;
    let foes = 0, bars = 0, props = 0, openChests = 0, liveBombs = 0, boomerangs = 0;
    let stunMax = 0;
    let liftable: { x: number; y: number } | null = null;
    let nearestFoe: { x: number; y: number; d: number } | null = null;

    for (const e of s.entities.all) {
      if (!e.alive) continue;
      if (e.spriteKey === 'prop.bars') bars++;
      if (e.spriteKey === 'prop.chest.open') openChests++;
      if (e.variant === 'bomb') liveBombs++;
      if (e.variant === 'boomerang') boomerangs++;
      if (e.kind === 'prop') {
        props++;
        if (e.liftable && !e.carried && !liftable) liftable = { x: e.x, y: e.y };
      }
      if (e.kind === 'enemy') {
        foes++;
        stunMax = Math.max(stunMax, e.hitstunFrames);
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (!nearestFoe || d < nearestFoe.d) nearestFoe = { x: e.x, y: e.y, d };
      }
    }
    return {
      mode: s.mode, tick: s.tick, hp: p.health, maxHp: p.maxHealth,
      amber: s.amber, owned: s.owned.size, draft: s.draft.index, act: s.act.index,
      biome: s.biome.id, barsRooms: s.biome.barsRooms,
      px: p.x, py: p.y, facing: p.facing, carrying: p.carrying, bracing: p.bracing,
      camX: s.camera.viewX, camY: s.camera.viewY, transitioning: s.camera.transitioning,
      foes, bars, props, liftable, nearestFoe, openChests,
      bombs: s.loadout.bombs, item: s.loadout.selected?.id ?? '',
      liveBombs, boomerangs, stunMax,
    };
  });
}

async function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const g = Reflect.get(window, '__aldez') as { frames: () => Frame[] };
    return g.frames();
  }) as Promise<Frame[]>;
}

/** Hold a key for a wall-clock duration. */
async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Face a world point and stop. */
async function faceToward(page: Page, s: Snapshot, tx: number, ty: number): Promise<void> {
  const dx = tx - s.px;
  const dy = ty - s.py;
  const key = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
    : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
  await hold(page, key, 60);
}

/** Walk toward a world point until within `stopAt` pixels. */
async function walkTo(
  page: Page, tx: number, ty: number, stopAt: number, budget = 40,
): Promise<Snapshot> {
  let s = await snap(page);
  for (let i = 0; i < budget; i++) {
    const dx = tx - s.px;
    const dy = ty - s.py;
    if (Math.hypot(dx, dy) <= stopAt) break;
    const key = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
    await hold(page, key, 70);
    s = await snap(page);
  }
  return s;
}

// ---------------------------------------------------------------------------
// frame-log analysis (timing claims screenshots cannot resolve)
// ---------------------------------------------------------------------------

function longestRun(fs: Frame[], predicate: (f: Frame) => boolean, reset: (f: Frame) => boolean): number {
  let best = 0;
  let run = 0;
  for (const f of fs) {
    if (predicate(f)) { run++; best = Math.max(best, run); }
    else if (reset(f)) run = 0;
  }
  return best;
}

function swingLengths(fs: Frame[]): number[] {
  const out: number[] = [];
  let current = -1;
  let count = 0;
  for (const f of fs) {
    const phase = String(f['phase']);
    if (phase === 'idle') {
      if (current !== -1) { out.push(count); current = -1; count = 0; }
      continue;
    }
    const swing = Number(f['swing']);
    if (swing !== current) {
      if (current !== -1) out.push(count);
      current = swing;
      count = 0;
    }
    // Hitstop freezes the swing timer, so those ticks are not swing frames.
    if (Number(f['stop']) === 0) count++;
  }
  if (current !== -1) out.push(count);
  return out;
}

function flashRuns(fs: Frame[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const f of fs) {
    if (Number(f['flashing']) > 0) {
      if (Number(f['stop']) === 0) run++;
    } else if (run > 0) { out.push(run); run = 0; }
  }
  if (run > 0) out.push(run);
  return out;
}

function frozenRun(fs: Frame[]): number {
  let best = 0;
  let run = 0;
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1]!;
    const b = fs[i]!;
    if (Number(b['stop']) > 0 && a['x'] === b['x'] && a['y'] === b['y']) {
      run++; best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

/** Sword mechanics against one pinned enemy. */
/**
 * Errata stay on the screen they spawned on.
 *
 * The complaint this comes from was "I am sometimes getting hit during
 * transitions", and the cause was that enemies were free to walk across a room
 * seam and land a contact hit on the first frame after the scroll — from a room
 * the player had already left. Rooms are the unit of the camera, the clear-lock
 * and the dungeon fog, so they should be the unit of a fight too.
 *
 * Asserted by reading every enemy's room each frame while the player runs the
 * length of the floor, rather than by watching for a hit: a hit is the symptom
 * and it only shows up on the seeds where the timing lines up.
 */
async function testRooms(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'rooms');

  const strays = await page.evaluate(async () => {
    const s = (window as any).__aldez.scene;
    const ROOM_W = 256;
    const ROOM_H = 224;
    let wandered = 0;
    let sampled = 0;

    for (let i = 0; i < 600; i++) {
      for (const e of s.entities.all) {
        if (!e.alive || e.kind !== 'enemy') continue;
        if (e.homeRoomX === undefined) continue;
        sampled++;
        const rx = Math.floor(e.x / ROOM_W);
        const ry = Math.floor(e.y / ROOM_H);
        if (rx !== e.homeRoomX || ry !== e.homeRoomY) wandered++;
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return { wandered, sampled };
  });

  check('rooms: every enemy is bound to a room', strays.sampled > 0,
    `${strays.sampled} samples`);
  check('rooms: no enemy leaves the screen it spawned on', strays.wandered === 0,
    `${strays.wandered} of ${strays.sampled}`);
  await shot(page, 'rooms');
  await page.close();
}

/**
 * Amberwake is safe until you make it otherwise, and then it remembers.
 *
 * Written after the first version charged the player five every time they walked
 * through the gate: "commit an offence" and "the guards are already hostile" had
 * been folded into one call, which made the debt unpayable by any means except
 * not entering. The three transitions below are the whole contract.
 */
/**
 * You can walk into Amberwake and keep walking.
 *
 * The generator check proves the avenue is clear; this proves the *player* moves
 * along it, which is a different claim and the one that failed. The town was
 * fully connected and 100% reachable while the way in was three tiles deep, so
 * every measurement of the map looked fine and the game was unplayable.
 */
async function testTownWalk(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'town');

  // Before anything else: can the player see himself?
  //
  // enterTown passed room *indices* to camera.snapTo, which takes pixels, so the
  // camera sat at pixel (1,1) while Aldez stood in room (1,1) at pixel
  // (352,384). Every key worked, the town was fully connected, and the whole
  // place was unplayable — you were looking at a static view of somewhere else.
  // Nothing asserted the most basic invariant a game has: the character you
  // control is on screen.
  const framed = await page.evaluate(`(() => {
    const s = window.__aldez.scene, c = s.camera;
    return s.player.x >= c.viewX && s.player.x <= c.viewX + 256
        && s.player.y >= c.viewY && s.player.y <= c.viewY + 224;
  })()`) as boolean;
  check('town: the player is inside the camera view on arrival', framed);

  // Stand at the arrival tile, then hold north the way a player would.
  await page.evaluate(`(() => {
    const s = window.__aldez.scene;
    s.player.x = s.town.gate.x;
    s.player.y = s.town.gate.y - 24;
  })()`);
  await page.waitForTimeout(200);

  const before = await page.evaluate(`window.__aldez.scene.player.y`) as number;
  await hold(page, 'ArrowUp', 2500);
  const after = await page.evaluate(`window.__aldez.scene.player.y`) as number;

  // Two screens of travel is the difference between a street and a cupboard.
  check('town: you can walk in from the gate', before - after > 120,
    `${Math.round(before - after)}px north`);
  check('town: still inside after walking', await page.evaluate(`window.__aldez.scene.inTown`) === true);
  await shot(page, 'town-walk');
  await page.close();
}

/**
 * The stairs open once, and stay open.
 *
 * The first dungeon is gated on visiting Amberwake. The thread state that
 * records the visit was being cleared in loadDraft — which also runs on every
 * floor change and on *leaving town* — so walking back out of the gate erased
 * the visit and the stairs locked again. Permanently: there is no other way to
 * set it, and no way to descend without it. The whole game after the meadow was
 * unreachable and every generator check passed.
 */
async function testDescentGate(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'town');

  const r = await page.evaluate(`(() => {
    const s = window.__aldez.scene;
    const atStairs = function () { s.player.x = s.floor.exit.x; s.player.y = s.floor.exit.y; };
    s.leaveTown();
    s.visitedTown = false;              // as if never visited
    atStairs();
    const locked = s.checkExit() === false;
    s.enterTown('flourishing');
    s.leaveTown();                      // the step that used to erase it
    const remembered = s.visitedTown === true;
    atStairs();
    const opened = s.checkExit() !== false;
    return { locked: locked, remembered: remembered, opened: opened };
  })()`) as { locked: boolean; remembered: boolean; opened: boolean };

  check('stairs: locked until Amberwake is found', r.locked);
  check('stairs: leaving town does not erase the visit', r.remembered);
  check('stairs: open once the town has been visited', r.opened);
  await page.close();
}

async function testBounty(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'town');

  const r = await page.evaluate(`(() => {
    const s = window.__aldez.scene;
    const hostiles = function () {
      return s.entities.all.filter(function (e) { return e.alive && e.kind === 'enemy'; }).length;
    };
    const peace = { bounty: s.save.bounty || 0, hostiles: hostiles() };
    s.raiseAlarm();
    const struck = { bounty: s.save.bounty || 0, hostiles: hostiles() };
    s.leaveTown();
    const fled = { bounty: s.save.bounty || 0 };
    s.enterTown('flourishing');
    const returned = { bounty: s.save.bounty || 0, hostiles: hostiles() };
    return { peace: peace, struck: struck, fled: fled, returned: returned };
  })()`) as {
    peace: { bounty: number; hostiles: number };
    struck: { bounty: number; hostiles: number };
    fled: { bounty: number };
    returned: { bounty: number; hostiles: number };
  };

  check('town: nobody is hostile until you start it',
    r.peace.hostiles === 0 && r.peace.bounty === 0, `${r.peace.hostiles} hostile`);
  check('town: striking a resident turns the guards and costs 5',
    r.struck.bounty === 5 && r.struck.hostiles > 0,
    `bounty ${r.struck.bounty}, ${r.struck.hostiles} hostile`);
  check('town: fleeing does not clear the bounty', r.fled.bounty === 5, `${r.fled.bounty}`);
  check('town: returning does not charge you again',
    r.returned.bounty === 5 && r.returned.hostiles > 0,
    `bounty ${r.returned.bounty}, ${r.returned.hostiles} waiting`);
  await shot(page, 'bounty');
  await page.close();
}

async function testCombat(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'combat');
  const start = await snap(page);
  check('combat: fixture places exactly one foe', start.foes === 1, `${start.foes}`);
  await shot(page, 'combat-before');

  // Chase and swing until it dies. The Moblin charges and repositions, so
  // re-facing between swings is required — swinging at where it used to be is
  // how the old harness "tested" combat.
  let c = start;
  for (let i = 0; i < 40 && c.foes > 0; i++) {
    if (c.nearestFoe) {
      if (c.nearestFoe.d > 20) {
        await walkTo(page, c.nearestFoe.x, c.nearestFoe.y, 18, 4);
      } else {
        await faceToward(page, c, c.nearestFoe.x, c.nearestFoe.y);
        // Two swings per engagement: the Moblin charges through and a single
        // swing per approach loses the race against its repositioning.
        await page.keyboard.press('KeyZ');
        await page.waitForTimeout(190);
        await page.keyboard.press('KeyZ');
        await page.waitForTimeout(190);
        if (i === 0) await shot(page, 'combat-swing');
      }
    }
    c = await snap(page);
  }
  const after = await snap(page);
  const fs = await frames(page);

  const phases = fs.map((f) => String(f['phase']));
  check('sword runs windup, active, recovery',
    phases.includes('windup') && phases.includes('active') && phases.includes('recovery'));
  // 3 + 6 + 6 = 15, one tick of slack for the sampling boundary.
  const lengths = swingLengths(fs);
  check('swing is 15 frames', lengths.some((n) => n >= 14 && n <= 16), lengths.slice(0, 4).join(','));
  check('hitstop freezes 4 frames', frozenRun(fs) >= 4, `${frozenRun(fs)}`);
  const flashes = flashRuns(fs);
  check('damage flash lasts 6 frames', flashes.some((n) => n >= 5 && n <= 7), flashes.slice(0, 4).join(','));
  check('the foe died', after.foes === 0, `${after.foes} left`);
  await shot(page, 'combat-after');
  await page.close();
}

/** Spin attack: charge, release, and the sprite must actually turn. */
async function testSpin(browser: Browser): Promise<void> {
  // The empty fixture, not the combat one: taking a hit calls sword.interrupt(),
  // which clears the charge. Testing the spin next to a Moblin was testing
  // whether the Moblin got bored first.
  const page = await openFixture(browser, 'props');
  // Hold long enough to charge (60 frames) and release into the spin.
  await hold(page, 'KeyZ', 1400);
  await page.waitForTimeout(60);
  await shot(page, 'spin');
  const fs = await frames(page);

  const spinFrames = fs.filter((f) => String(f['phase']) === 'spin');
  check('spin attack triggers on a held attack', spinFrames.length > 0, `${spinFrames.length} ticks`);
  // The whole point: the sprite has to cycle facings, not hold one pose.
  const facings = new Set(spinFrames.map((f) => String(f['sprite'])));
  check('spin cycles through facings', facings.size >= 3, `${facings.size} distinct sprites`);
  await page.close();
}

/** Props: break, lift, carry, throw, and open a chest. */
async function testProps(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'props');
  const start = await snap(page);
  check('props: fixture places props and no foes',
    start.props >= 3 && start.foes === 0, `${start.props} props, ${start.foes} foes`);
  await shot(page, 'props-before');

  // Lift the nearest liftable, confirm it is overhead, throw it.
  if (start.liftable) {
    await walkTo(page, start.liftable.x, start.liftable.y, 14);
    const near = await snap(page);
    await faceToward(page, near, start.liftable.x, start.liftable.y);
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(160);
  }
  const carrying = await snap(page);
  check('a prop can be lifted', carrying.carrying);
  await shot(page, 'props-carrying');

  await page.keyboard.press('KeyX');
  await page.waitForTimeout(300);
  const thrown = await snap(page);
  check('a carried prop can be thrown', carrying.carrying && !thrown.carrying);

  // Chests open to a sword swing rather than shattering.
  const chest = await page.evaluate(() => {
    const g = Reflect.get(window, '__aldez') as {
      scene: { entities: { all: ReadonlyArray<{ alive: boolean; spriteKey: string; x: number; y: number }> } };
    };
    const c = g.scene.entities.all.find((e) => e.alive && e.spriteKey === 'prop.chest.closed');
    return c ? { x: c.x, y: c.y } : null;
  });
  check('props: a closed chest exists to test', chest !== null);
  if (chest) {
    await walkTo(page, chest.x, chest.y, 15);
    const nearChest = await snap(page);
    await faceToward(page, nearChest, chest.x, chest.y);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('KeyZ');
      await page.waitForTimeout(200);
    }
  }
  const opened = await snap(page);
  check('a sword swing opens a chest', opened.openChests > 0, `${opened.openChests} open`);
  check('an opened chest spills loot', opened.props > 0);
  await shot(page, 'props-chest');

  // Standing still with no swing raises the shield.
  await page.waitForTimeout(500);
  const idle = await snap(page);
  check('standing still raises the shield', idle.bracing);
  await shot(page, 'props-shield');
  await page.close();
}

/** Taking damage, i-frames, death, the revision scene and the Reliquary. */
async function testLethal(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'lethal');
  const start = await snap(page);
  check('lethal: fixture starts the player low and surrounded',
    start.hp <= 12 && start.foes >= 2, `hp ${start.hp}, ${start.foes} foes`);

  // Walk into them and do not fight back.
  let s = start;
  for (let i = 0; i < 60 && s.mode === 'playing'; i++) {
    if (s.nearestFoe) {
      const dx = s.nearestFoe.x - s.px;
      const dy = s.nearestFoe.y - s.py;
      const key = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
        : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
      await hold(page, key, 90);
    } else {
      await page.waitForTimeout(120);
    }
    s = await snap(page);
  }

  const fs = await frames(page);
  check('the player takes contact damage',
    fs.some((f) => Number(f['iframes']) > 0), '');
  // Measure the gap between successive hits, not the length of an "invulnerable"
  // run. Swarmed, the player is re-hit the instant i-frames lapse, so consecutive
  // windows never touch zero and merge into one long run — and after the killing
  // blow i-frames freeze forever. Hit-to-hit spacing is the number the bar
  // actually specifies, and hitstop ticks are excluded because they freeze the
  // countdown.
  // Measure the counter itself, at the instant it is granted.
  //
  // This used to time the gap between successive hits and require 45..51, which
  // only equals the i-frame window when the player is being re-hit the moment it
  // lapses. Slowing the enemies down made the gaps 52-63 and failed the check on
  // a game whose i-frames had not changed at all — the test was measuring enemy
  // approach speed and calling it invulnerability. The value the bar specifies is
  // the window granted on a hit, so read exactly that.
  const granted: number[] = [];
  let previous = 0;
  for (const f of fs) {
    const iframes = Number(f['iframes']);
    if (iframes > previous) granted.push(iframes); // only ever jumps up on a fresh hit
    previous = iframes;
  }
  check('i-frames last 48', granted.some((n) => n >= 46 && n <= 48),
    granted.length ? granted.join(',') : 'no hit observed');
  check('death reaches the revision scene', s.mode === 'revising', s.mode);
  await page.waitForTimeout(1600);
  await shot(page, 'lethal-revision');

  // The revision must wait for input, not a timer.
  await page.waitForTimeout(6000);
  const waited = await snap(page);
  check('the revision waits for a keypress', waited.mode === 'revising', waited.mode);

  for (let i = 0; i < 12 && (await snap(page)).mode === 'revising'; i++) {
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(250);
  }
  const reliquary = await snap(page);
  check('the Reliquary follows the revision', reliquary.mode === 'reliquary', reliquary.mode);
  await shot(page, 'lethal-reliquary');

  // The fixture grants enough amber to awaken something.
  const before = reliquary.owned;
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(140);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(110);
  }
  const bought = await snap(page);
  check('amber awakens a relic', bought.owned > before, `${before} -> ${bought.owned}`);

  for (let i = 0; i < 12 && (await snap(page)).mode === 'reliquary'; i++) {
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(250);
  }
  const next = await snap(page);
  check('the next Draft begins', next.mode === 'playing' && next.draft > start.draft,
    `draft ${start.draft} -> ${next.draft}`);
  await shot(page, 'lethal-next-draft');
  await page.close();
}

/** Dungeon biomes bar their rooms; open country never does. */
async function testBars(browser: Browser): Promise<void> {
  const dungeon = await openFixture(browser, 'barred');
  const d0 = await snap(dungeon);
  check('barred: fixture is a dungeon biome', d0.barsRooms, d0.biome);

  // Step to the middle so the bars are allowed to drop behind the player.
  const roomCx = Math.floor(d0.px / 256) * 256 + 128;
  const roomCy = Math.floor(d0.py / 224) * 224 + 112;
  await walkTo(dungeon, roomCx, roomCy, 12);
  await dungeon.waitForTimeout(300);
  const barred = await snap(dungeon);
  check('a dungeon room bars its exits', barred.bars > 0, `${barred.bars} bars`);
  await shot(dungeon, 'bars-engaged');

  // Clear it: the fixture uses two 1-hp Keese so this always terminates.
  let s = barred;
  for (let i = 0; i < 80 && s.foes > 0; i++) {
    if (s.nearestFoe) {
      if (s.nearestFoe.d > 22) {
        const dx = s.nearestFoe.x - s.px;
        const dy = s.nearestFoe.y - s.py;
        const key = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
          : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
        await hold(dungeon, key, 70);
      } else {
        await faceToward(dungeon, s, s.nearestFoe.x, s.nearestFoe.y);
        await dungeon.keyboard.press('KeyZ');
        await dungeon.waitForTimeout(150);
      }
    }
    s = await snap(dungeon);
  }
  const cleared = await snap(dungeon);
  check('clearing a dungeon room drops the bars',
    cleared.foes === 0 && cleared.bars === 0, `${cleared.foes} foes, ${cleared.bars} bars`);
  check('clearing pays out', cleared.amber > barred.amber, `${barred.amber} -> ${cleared.amber}`);
  await shot(dungeon, 'bars-cleared');
  await dungeon.close();

  // The open world must never bar, even standing in a room full of enemies.
  const open = await openFixture(browser, 'openworld');
  const o0 = await snap(open);
  check('openworld: fixture is an overworld biome', !o0.barsRooms, o0.biome);
  const ocx = Math.floor(o0.px / 256) * 256 + 128;
  const ocy = Math.floor(o0.py / 224) * 224 + 112;
  await walkTo(open, ocx, ocy, 12);
  await open.waitForTimeout(600);
  const o1 = await snap(open);
  check('the open world never bars a room',
    o1.bars === 0 && o1.foes > 0, `${o1.bars} bars with ${o1.foes} foes`);
  await shot(open, 'openworld');
  await open.close();
}

/** Bombs and the boomerang: the two verbs the sword cannot cover. */
async function testItems(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'items');
  const start = await snap(page);
  check('items: bombs start stocked', start.bombs > 0, `${start.bombs}`);
  check('items: bomb is selected first', start.item === 'bomb', start.item);

  // --- boomerang first, from the fixture's exact starting position -----------
  //
  // Order matters here, and getting it wrong cost two sessions. The bomb
  // sequence walks the player 700ms to the left and waits out a fuse; throwing
  // afterwards meant aiming from wherever that left them, which the check then
  // papered over with retries and still failed on a game that was working
  // perfectly. Instrumenting one throw showed a clean 60-frame stun on frame 3.
  //
  // The fixture already places the foe 56px dead ahead with its AI frozen. Throw
  // from the spawn tile, along the axis, at a target that cannot move: nothing
  // is left to be flaky about, and the check now measures the mechanic rather
  // than the bot's aim.
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(120);
  const cycled = await snap(page);
  check('the item slot cycles', cycled.item === 'boomerang', cycled.item);

  // hold(), not press(). Movement is sampled per simulation step via isHeld(),
  // so a sub-frame press can land entirely between two 60Hz steps and never be
  // seen — the player keeps facing 'down' and the throw goes the wrong way. That
  // silent coin-flip is what made this check look like a game bug for two
  // sessions; the mechanic was correct the whole time. Edge-latched inputs
  // (menu navigation, attack) are safe with press(); directions are not.
  await hold(page, 'ArrowRight', 140);

  // Sample the stun *inside the page*, at display rate.
  //
  // Polling from the harness costs a round trip per sample, which is longer than
  // the thing being measured decays in — the first observation after the hit
  // read 31 of a 60-frame stun and the check failed on a correct game. A peak
  // recorded in-page cannot miss it. This is the general lesson for any check
  // measuring a short-lived value: watch from inside, report the extreme.
  await page.evaluate(() => {
    const w = window as unknown as { __peakStun?: number };
    w.__peakStun = 0;
    const tick = (): void => {
      const s = (Reflect.get(window, '__aldez') as {
        scene: { entities: { all: ReadonlyArray<{ alive: boolean; kind: string; hitstunFrames: number }> } };
      }).scene;
      for (const e of s.entities.all) {
        if (e.alive && e.kind === 'enemy') w.__peakStun = Math.max(w.__peakStun ?? 0, e.hitstunFrames);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.keyboard.press('KeyC');
  await page.waitForTimeout(100);
  const thrown = await snap(page);
  check('a boomerang can be thrown', thrown.boomerangs > 0, `${thrown.boomerangs}`);
  await shot(page, 'items-boomerang');

  // Sample fast: a 60-frame stun is one second, and coarse sampling was part of
  // why this looked unreliable.
  let returned = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(30);
    const flight = await snap(page);
    if (flight.boomerangs === 0) { returned = true; break; }
  }
  const stunSeen = await page.evaluate(
    () => (window as unknown as { __peakStun?: number }).__peakStun ?? 0,
  );
  check('the boomerang stuns its target', stunSeen >= 45, `${stunSeen} frames`);
  check('the boomerang returns and clears', returned);

  const afterThrow = await snap(page);
  check('the boomerang consumes no ammo', afterThrow.bombs === start.bombs,
    `${start.bombs} -> ${afterThrow.bombs}`);

  // --- then bombs ------------------------------------------------------------
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(120);
  const placed = await snap(page);
  check('a bomb can be placed', placed.bombs === start.bombs - 1 && placed.liveBombs > 0,
    `${placed.bombs} left, ${placed.liveBombs} live`);
  await shot(page, 'items-bomb');

  // Retreat so the blast does not take the player with it.
  await hold(page, 'ArrowLeft', 700);
  // The fuse is 60 frames; wait it out plus the blast.
  await page.waitForTimeout(1600);
  const blasted = await snap(page);
  check('the bomb detonates', blasted.liveBombs === 0);
  check('the blast destroys nearby props', blasted.props < start.props,
    `${start.props} -> ${blasted.props}`);
  await shot(page, 'items-blast');
  await page.close();
}


/** Movement and camera invariants, measured on a calm fixture. */
async function testMovement(browser: Browser): Promise<void> {
  const page = await openFixture(browser, 'props');
  const samples: Snapshot[] = [];
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.down(key);
    for (let i = 0; i < 6; i++) {
      samples.push(await snap(page));
      await page.waitForTimeout(40);
    }
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
  const a = await snap(page);
  await page.waitForTimeout(250);
  const b = await snap(page);

  check('the player stops instantly', a.px === b.px && a.py === b.py);
  check('the player moved at all', samples.some((s) => s.px !== samples[0]!.px));
  const settled = samples.filter((s) => !s.transitioning);
  check('camera positions are integers',
    settled.every((s) => Number.isInteger(s.camX) && Number.isInteger(s.camY)));
  // Room-locked, with 5px of tolerance for screen shake.
  const near = (v: number, size: number): boolean => {
    const m = ((v % size) + size) % size;
    return m <= 5 || m >= size - 5;
  };
  check('the camera stays locked to room origins',
    settled.every((s) => near(s.camX, 256) && near(s.camY, 224)));
  await page.close();
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      // Headless Chromium has no GPU; SwiftShader provides real WebGL2.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',
    ],
  });

  const scenarios: Array<[string, (b: Browser) => Promise<void>]> = [
    ['movement', testMovement],
    ['combat', testCombat],
    ['rooms', testRooms],
    ['bounty', testBounty],
    ['townwalk', testTownWalk],
    ['descent', testDescentGate],
    ['spin', testSpin],
    ['props', testProps],
    ['items', testItems],
    ['bars', testBars],
    ['lethal', testLethal],
  ];

  for (const [name, run] of scenarios) {
    try {
      await run(browser);
    } catch (err) {
      check(`${name}: scenario crashed`, false, err instanceof Error ? err.message : String(err));
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2));

  console.log(`captured to .captures/${stamp}\n`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);

  if (consoleErrors.length > 0) {
    console.error(`\n  ${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 8)) console.error(`    ${e}`);
  } else {
    console.log('  no console errors');
  }

  process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
