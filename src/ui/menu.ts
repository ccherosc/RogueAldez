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
import { BIOMES } from '../worldgen/biomes.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export type MenuScreen = 'root' | 'teleport' | 'boss';

export interface MenuState {
  screen: MenuScreen;
  cursor: number;
}

export const ROOT_ITEMS = ['start', 'teleport', 'boss fights'] as const;
export const BOSS_ITEMS = [
  { id: 'hulk', label: 'the hulk - miniboss' },
  { id: 'colossus', label: 'the colossus - megaboss' },
] as const;

export function menuLength(state: MenuState): number {
  switch (state.screen) {
    case 'root': return ROOT_ITEMS.length;
    case 'teleport': return BIOMES.length;
    case 'boss': return BOSS_ITEMS.length;
  }
}

export function drawMenu(batch: SpriteBatch, state: MenuState, frame: number): void {
  // Dim the hub rather than hide it.
  for (let y = 0; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: 0.72 });
    }
  }

  const cx = viewport.w / 2;

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
      drawRow(1, 'teleport', 'visit any region');
      drawRow(2, 'boss fights', 'face the big ones');
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
