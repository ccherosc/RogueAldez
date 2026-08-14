/**
 * The talk box.
 *
 * Bottom third of the screen, the world still visible above it — a full-screen
 * dialogue panel would hide the town the conversation is about, and the town is
 * the thing that changed since last life.
 *
 * The name and the role are on separate lines and weighted differently on
 * purpose. The name is the constant, the role is what the rewriting moved; a
 * player who has met Orra Flint the smith reads "orra flint / beggar" and
 * understands the premise without a word of exposition.
 */

import { viewport } from '../core/const.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export interface TalkView {
  name: string;
  role: string;
  line: string;
  /** how many Drafts this person has met Aldez in */
  met: number;
  /** shown once they half-remember him */
  truth: string | null;
  /** they will trade */
  shop: boolean;
}

export function drawTalk(batch: SpriteBatch, view: TalkView): void {
  const top = viewport.h - 60;
  for (let y = top; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: 0.82 });
    }
  }
  for (let x = 0; x < viewport.w; x += 8) batch.draw('ui.rule', x, top, { alpha: 0.5 });

  const left = 16;
  drawText(batch, left, top + 8, view.name, 1);
  // The role sits under the name, dimmer: it is the part that is temporary.
  drawText(batch, left, top + 17, view.role, 0.55);

  drawText(batch, left, top + 30, view.line, 0.92);

  if (view.truth && view.met >= 3) {
    // What the player has worked out about them across lives. Only shown once
    // they have met often enough for it to mean something.
    drawText(batch, left, top + 41, view.truth, 0.45);
  }

  const hint = view.shop ? 'z trade    x leave' : 'x leave';
  drawTextCentred(batch, viewport.w / 2, viewport.h - 9, hint, 0.6);
}
