/**
 * The Reliquary of Selves.
 *
 * Shown between Drafts, after the world has finished rewriting itself. Aldez
 * chooses which relics to awaken before the next journey — the moment where a
 * death stops being a loss and becomes the thing that bought the next attempt.
 *
 * Each entry shows the effect *and* the memory, because a relic without its
 * memory is just a stat line, and the memories are the progression the story
 * actually cares about.
 */

import { viewport } from '../core/const.ts';
import { RELICS } from '../chronicle/relics.ts';
import type { RelicId } from '../chronicle/relics.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export interface ReliquaryView {
  cursor: number;
  amber: number;
  owned: ReadonlySet<RelicId>;
  frame: number;
}

const LIST_X = 22;
const LIST_TOP = 40;
const ROW_H = 14;

export function drawReliquary(batch: SpriteBatch, view: ReliquaryView): void {
  // Near-opaque. The revision scene deliberately shows the world being edited
  // underneath; this screen is a different beat — Aldez is choosing what to carry,
  // not watching. Terrain bleeding through just competes with eight rows of text.
  batch.fill(0, 0, viewport.w, viewport.h, 1);

  drawTextCentred(batch, viewport.w / 2, 16, 'the reliquary of selves', 0.95);
  drawText(batch, LIST_X, 26, `${view.amber} star amber`, 0.8);

  RELICS.forEach((relic, i) => {
    const y = LIST_TOP + i * ROW_H;
    const selected = i === view.cursor;
    const owned = view.owned.has(relic.id);
    const affordable = view.amber >= relic.cost;

    if (selected) {
      // Highlight bar behind the row, so the cursor is unmissable at 8px text.
      batch.fill(LIST_X - 6, y - 2, viewport.w - 16 - (LIST_X - 6), 8, 0.55);
      batch.draw('ui.rule', LIST_X - 6, y - 3, { alpha: 0.8 });
    }

    batch.draw(relic.icon, LIST_X - 2, y - 1, { alpha: owned ? 1 : 0.5 });
    // Owned relics read bright; unaffordable ones read dim. The player should be
    // able to see what they are working toward without reading a single word.
    const alpha = owned ? 1 : affordable ? 0.85 : 0.4;
    drawText(batch, LIST_X + 10, y, relic.name, alpha);

    const tag = owned ? 'awakened' : `${relic.cost}`;
    drawText(batch, viewport.w - 22 - tag.length * 4, y, tag, owned ? 0.9 : alpha);
  });

  // Detail pane for the highlighted relic.
  const relic = RELICS[view.cursor];
  if (relic) {
    const detailY = LIST_TOP + RELICS.length * ROW_H + 8;
    batch.draw('ui.rule', LIST_X - 6, detailY - 4, { alpha: 0.4 });
    for (let x = LIST_X - 6; x < viewport.w - 16; x += 8) {
      batch.draw('ui.rule', x, detailY - 4, { alpha: 0.35 });
    }
    drawText(batch, LIST_X, detailY, relic.effect, 0.9);
    for (const [i, line] of wrap(relic.memory, 52).entries()) {
      drawText(batch, LIST_X, detailY + 10 + i * 8, line, 0.6);
    }
  }

  if (Math.floor(view.frame / 22) % 2 === 0) {
    drawTextCentred(batch, viewport.w / 2, viewport.h - 12, 'z awaken    x begin', 0.9);
  }
}

/** Greedy word wrap. The font is fixed-width, so columns are just characters. */
function wrap(text: string, columns: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > columns) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
