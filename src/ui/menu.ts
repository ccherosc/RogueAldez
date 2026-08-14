/**
 * The menu.
 *
 * Rendered over the living hub, dimmed — the world keeps breathing behind the
 * choices, which says "this is a place you are about to enter" better than a
 * black screen could. Three entries: play, go somewhere specific, or fight the
 * big ones directly. Teleport and boss fights are testing tools today and the
 * bones of a chapter-select later, so they get real treatment rather than debug
 * styling.
 */

import { viewport } from '../core/const.ts';
import { DIFFICULTY_MODES, MODE_SCALES } from '../chronicle/difficulty.ts';
import type { DifficultyMode } from '../chronicle/difficulty.ts';
import { BIOMES } from '../worldgen/biomes.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export type MenuScreen = 'root' | 'teleport' | 'boss' | 'controls' | 'difficulty';

export interface MenuState {
  /** current difficulty, so the menu can show what is already chosen */
  difficulty?: DifficultyMode;
  screen: MenuScreen;
  cursor: number;
}

export const ROOT_ITEMS = ['start', 'difficulty', 'controls', 'teleport', 'boss fights'] as const;

/** What the controls screen is told about the pad, so ui/ never polls hardware. */
export interface PadStatus {
  connected: boolean;
  id: string;
  blocked: boolean;
  buttons: number[];
  axes: number[];
}

// The bitmap font carries letters, digits and a small set of punctuation. Slash
// and pipe are not among them and render as '?', so the columns are separated by
// spacing rather than by glyphs the font cannot draw.
const KEY_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['move', 'arrows or wasd', 'stick or d-pad'],
  ['sword', 'z or space', 'a or x'],
  ['spin', 'hold sword', 'hold a'],
  ['lift and throw', 'x or e', 'b'],
  ['use item', 'c or shift', 'y'],
  ['cycle item', 'q or tab', 'shoulders'],
  ['shield', 'stand still', 'stand still'],
  ['menu', 'esc', 'start'],
  ['fullscreen', 'f', 'select'],
  ['god mode', 'i or f4', '-'],
];
export const BOSS_ITEMS = [
  { id: 'hulk', label: 'the hulk - miniboss' },
  { id: 'colossus', label: 'the colossus - megaboss' },
] as const;

export function menuLength(state: MenuState): number {
  switch (state.screen) {
    case 'root': return ROOT_ITEMS.length;
    case 'teleport': return BIOMES.length;
    case 'boss': return BOSS_ITEMS.length;
    case 'controls': return 1;
    case 'difficulty': return DIFFICULTY_MODES.length;
  }
}

/**
 * Controls, and a live readout of whatever pad the browser will admit to.
 *
 * The readout is the point. "Controller doesn't work" has at least four causes —
 * the browser hides pads until a button is pressed, a sandboxed frame can block
 * the API outright, the pad may be paired but asleep, or the mapping may be
 * non-standard — and they are indistinguishable from inside the game. Showing
 * the raw button and axis numbers turns an unfalsifiable complaint into a
 * two-second check: press a button, see whether a number appears.
 */
function drawControls(batch: SpriteBatch, pad: PadStatus, frame: number): void {
  const cx = viewport.w / 2;
  drawTextCentred(batch, cx, 22, 'controls', 0.95);

  drawText(batch, cx - 124, 32, 'action', 0.4);
  drawText(batch, cx - 48, 32, 'keyboard', 0.4);
  drawText(batch, cx + 30, 32, 'gamepad', 0.4);

  let y = 42;
  for (const [action, keys, pad] of KEY_ROWS) {
    drawText(batch, cx - 124, y, action, 0.8);
    drawText(batch, cx - 48, y, keys, 0.6);
    drawText(batch, cx + 30, y, pad, 0.6);
    y += 9;
  }

  y += 6;
  drawTextCentred(batch, cx, y, '- gamepad -', 0.7);
  y += 10;

  if (pad.blocked) {
    drawTextCentred(batch, cx, y, 'blocked by this page. try the localhost build', 0.85);
    y += 9;
    drawTextCentred(batch, cx, y, 'an embedded frame can refuse gamepad access', 0.45);
  } else if (!pad.connected) {
    // Browsers deliberately hide pads until the page has seen input from one.
    const nudge = Math.floor(frame / 30) % 2 === 0
      ? 'no pad seen yet - press any button on it'
      : 'no pad seen yet';
    drawTextCentred(batch, cx, y, nudge, 0.85);
    y += 9;
    drawTextCentred(batch, cx, y, 'browsers hide controllers until one is used', 0.45);
  } else {
    drawTextCentred(batch, cx, y, pad.id.slice(0, 44).toLowerCase(), 0.75);
    y += 9;
    const pressed = pad.buttons.length ? `buttons ${pad.buttons.join(' ')}` : 'press a button to test';
    drawTextCentred(batch, cx, y, pressed, 0.9);
    y += 9;
    const [ax = 0, ay = 0] = pad.axes;
    drawTextCentred(batch, cx, y, `stick ${ax.toFixed(2)} ${ay.toFixed(2)}`, 0.6);
  }
}

export function drawMenu(
  batch: SpriteBatch,
  state: MenuState,
  frame: number,
  pad?: PadStatus,
): void {
  // Dim the hub rather than hide it.
  for (let y = 0; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: 0.72 });
    }
  }

  const cx = viewport.w / 2;

  // The controls screen is a dense table and needs the whole panel, so it draws
  // its own header instead of sitting under the cartridge title.
  if (state.screen === 'controls') {
    drawControls(batch, pad ?? {
      connected: false, id: '', blocked: false, buttons: [], axes: [],
    }, frame);
    if (Math.floor(frame / 24) % 2 === 0) {
      drawTextCentred(batch, cx, viewport.h - 14, 'x  back', 0.8);
    }
    return;
  }

  // Title: the name set wide, the way a cartridge label would.
  const title = 'R O G U E   A L D E Z';
  drawTextCentred(batch, cx, 34, title, 0.95);
  batch.draw('ui.rule', cx - 56, 44, { alpha: 0.6 });
  for (let x = -56; x < 56; x += 8) batch.draw('ui.rule', cx + x, 44, { alpha: 0.6 });
  drawTextCentred(batch, cx, 50, 'the kingdom rewrites itself', 0.5);

  const top = 78;
  const rowH = 14;

  const drawRow = (index: number, label: string, extra = ''): void => {
    const y = top + index * rowH;
    const selected = index === state.cursor;
    if (selected) {
      for (let x = cx - 80; x < cx + 80; x += 8) batch.draw('fx.dim', x, y - 3, { alpha: 0.55 });
      drawText(batch, cx - 92, y, '>', 0.95);
    }
    drawTextCentred(batch, cx, y, label, selected ? 1 : 0.62);
    if (extra) drawTextCentred(batch, cx, y + 7, extra, 0.4);
  };

  switch (state.screen) {
    case 'root':
      drawRow(0, 'start', 'wake in the vale');
      // The current mode is shown on the root row, not buried one screen down.
      // A difficulty the player cannot see is one they will forget they set.
      drawRow(1, 'difficulty', state.difficulty ?? 'hard');
      drawRow(2, 'controls', 'keys, pad, and a live pad test');
      drawRow(3, 'teleport', 'visit any region');
      drawRow(4, 'boss fights', 'face the big ones');
      break;

    case 'difficulty':
      DIFFICULTY_MODES.forEach((id, i) => {
        const m = MODE_SCALES[id];
        // Mark the active one. Without it the list reads as four buttons rather
        // than as a setting that already has a value.
        const current = id === (state.difficulty ?? 'hard');
        drawRow(i, current ? `${m.label}  *` : m.label, m.blurb);
      });
      break;


    case 'teleport': {
      // Two columns; sixteen biomes will not fit in one.
      const half = Math.ceil(BIOMES.length / 2);
      BIOMES.forEach((biome, i) => {
        const col = i < half ? -1 : 1;
        const y = top - 8 + (i % half) * 11;
        const x = cx + col * 78;
        const selected = i === state.cursor;
        if (selected) drawText(batch, x - textOffset(biome.name) - 8, y, '>', 0.95);
        drawTextCentredAt(batch, x, y, biome.name.toLowerCase(), selected ? 1 : 0.55);
      });
      break;
    }

    case 'boss':
      BOSS_ITEMS.forEach((item, i) => drawRow(i, item.label));
      break;
  }

  if (Math.floor(frame / 24) % 2 === 0) {
    const hint = state.screen === 'root'
      ? 'arrows select   z confirm   f fullscreen'
      : 'arrows select   z confirm   x back';
    drawTextCentred(batch, cx, viewport.h - 18, hint, 0.8);
  }
}

function textOffset(s: string): number {
  return (s.length * 4) / 2;
}

function drawTextCentredAt(batch: SpriteBatch, x: number, y: number, s: string, alpha: number): void {
  drawTextCentred(batch, x, y, s, alpha);
}
