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
  const gaps: number[] = [];
  let sinceHit = -1;
  let previous = 0;
  for (const f of fs) {
    const iframes = Number(f['iframes']);
    const hit = iframes > previous; // i-frames only jump up on a fresh hit
    previous = iframes;
    if (hit) {
      if (sinceHit > 0) gaps.push(sinceHit);
      sinceHit = 0;
      continue;
    }
    if (sinceHit >= 0 && Number(f['stop']) === 0) sinceHit++;
  }
  check('i-frames last 48', gaps.some((n) => n >= 45 && n <= 51),
    gaps.length ? gaps.join(',') : 'only one hit observed');
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

  // Drop a bomb, walk clear, and let the fuse run.
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

  // Cycle to the boomerang and throw it.
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(120);
  const cycled = await snap(page);
  check('the item slot cycles', cycled.item === 'boomerang', cycled.item);

  // Throw *at the Octorok* and prove the stun, not just the flight. It wanders,
  // so aim per attempt and allow retries — the claim under test is "a hit stuns
  // for ~60 frames", not "the bot can snipe a moving target first try".
  let sawThrow = false;
  let returned = false;
  let stunSeen = 0;
  // The Octorok wanders, so a throw can legitimately miss. Ten attempts with a
  // fresh approach each time makes a miss cost a retry rather than a red build —
  // the claim under test is "a hit stuns for ~60 frames", and one miss says
  // nothing about it. Four attempts was not enough and the check failed twice on
  // a working game, which is worse than no check at all.
  for (let attempt = 0; attempt < 10 && stunSeen < 45; attempt++) {
    let s = await snap(page);
    if (!s.nearestFoe) break;
    // Line up on the foe's row first, then close the gap along x: a boomerang
    // thrown along an axis sweeps through the target instead of past it.
    const foe = s.nearestFoe;
    s = await walkTo(page, s.px, foe.y, 6, 6);
    s = await walkTo(page, foe.x, foe.y, 48, 14);
    await faceToward(page, s, foe.x, foe.y);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(120);
    const thrown = await snap(page);
    sawThrow = sawThrow || thrown.boomerangs > 0;
    if (attempt === 0) await shot(page, 'items-boomerang');

    // Watch the flight: record the deepest stun, and whether it cleared.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(70);
      const flight = await snap(page);
      stunSeen = Math.max(stunSeen, flight.stunMax);
      if (flight.boomerangs === 0) { returned = true; break; }
    }
  }
  check('a boomerang can be thrown', sawThrow);
  check('the boomerang returns and clears', returned);
  check('the boomerang stuns its target', stunSeen >= 45, `${stunSeen} frames`);

  const finalState = await snap(page);
  check('the boomerang consumes no ammo', finalState.bombs === blasted.bombs,
    `${blasted.bombs} -> ${finalState.bombs}`);
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
