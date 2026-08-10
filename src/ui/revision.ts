/**
 * The revision scene — what plays instead of "Game Over".
 *
 * > Death should never display only "Game Over."
 *
 * When Aldez falls the player watches the world being rewritten: each line of the
 * Draft diff is struck through and replaced, one at a time. This is the moment
 * the whole premise lands, so it is an authored sequence with real pacing rather
 * than a fade to a menu.
 */

import { viewport } from '../core/const.ts';
import type { Revision } from '../chronicle/draft.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred, textWidth } from './text.ts';

/** Frames the screen takes to darken before any text appears. */
const FADE_FRAMES = 45;
/** Frames between one revision line resolving and the next starting. */
const LINE_STAGGER = 34;
/** Frames a line spends being struck through before its replacement writes on. */
const STRIKE_FRAMES = 16;
/** Beat after the last line resolves before the prompt appears. */
const SETTLE_FRAMES = 30;

/**
 * When the page has finished writing itself and the player may continue.
 *
 * The scene waits for a keypress after this, rather than advancing on a timer —
 * this is the moment the premise lands, and how long you sit with it should be
 * the player's call, not a countdown's.
 */
export function revisionReadyAt(lines: number): number {
  return FADE_FRAMES + Math.max(1, lines) * LINE_STAGGER + SETTLE_FRAMES;
}

export interface RevisionView {
  frame: number;
  revisions: Revision[];
  draftIndex: number;
  /** carried across the rewrite — the one thing that survives */
  amber: number;
  bestDepth: number;
  reachedDepth: number;
}

export function drawRevision(batch: SpriteBatch, view: RevisionView): void {
  const { frame, revisions } = view;

  // Darken the frozen world underneath rather than clearing it: the player should
  // watch the place they died being edited, not a blank screen.
  const fade = Math.min(1, frame / FADE_FRAMES) * 0.88;
  for (let y = 0; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: fade });
    }
  }
  if (frame < FADE_FRAMES) return;

  const t = frame - FADE_FRAMES;
  drawTextCentred(batch, viewport.w / 2, 40, 'the world reconsiders', 0.9);

  const top = 64;
  revisions.forEach((rev, i) => {
    const local = t - i * LINE_STAGGER;
    if (local < 0) return;
    const y = top + i * 18;

    drawText(batch, 24, y, rev.label, 0.55);

    if (local <= STRIKE_FRAMES) {
      // The old truth, with a line growing across it left to right.
      drawText(batch, 24, y + 8, rev.from, 0.8);
      const strikeW = Math.round(textWidth(rev.from) * (local / STRIKE_FRAMES));
      // A real 1px rule through the middle of the glyphs, drawn in 8px runs.
      for (let x = 0; x < strikeW; x += 8) {
        batch.draw('ui.rule', 24 + x, y + 11, { alpha: 0.95 });
      }
    } else {
      // The replacement writes on in its place — the old line is gone, not layered
      // under it, because two overlapping sentences read as a rendering bug.
      const reveal = Math.min(rev.to.length, Math.floor((local - STRIKE_FRAMES) / 1.5));
      drawText(batch, 24, y + 8, rev.to.slice(0, reveal), 1);
    }
  });

  if (frame >= revisionReadyAt(revisions.length)) {
    // What survived. Naming the carry-over is what makes a death read as progress
    // rather than as a reset.
    const record = view.reachedDepth >= view.bestDepth ? ' - deepest yet' : '';
    drawTextCentred(
      batch, viewport.w / 2, viewport.h - 60,
      `floor ${view.reachedDepth}${record}`, 0.7,
    );
    drawTextCentred(
      batch, viewport.w / 2, viewport.h - 52,
      `${view.amber} star amber endures`, 0.7,
    );
    drawTextCentred(batch, viewport.w / 2, viewport.h - 40, `draft ${view.draftIndex} begins`, 0.85);
    // Blink the prompt so it reads as waiting for you rather than as a label.
    if (Math.floor(frame / 22) % 2 === 0) {
      drawTextCentred(batch, viewport.w / 2, viewport.h - 30, 'press any key', 0.95);
    }
  }
}
