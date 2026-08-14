/**
 * The HUD: hearts, star amber, and the Draft line.
 *
 * Drawn in screen space at 256x224, so the numbers here are SNES-scale — hearts
 * are 8px and sit 8px from the corner, the way ALTTP lays them out.
 */

import { viewport } from '../core/const.ts';
import { HEART_UNITS } from '../player/player.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred, UI_SCALE } from './text.ts';

const MARGIN = 8;
const HEART_SPACING = 9;

export interface HudState {
  health: number;
  maxHealth: number;
  amber: number;
  /** selected secondary item: atlas icon and remaining uses (null = unlimited) */
  itemIcon?: string;
  itemAmmo?: number | null;
  draftLine: string;
  /** dimmer second line — the Draft's history under the region name */
  subLine?: string;
  /** current level, and progress toward the next, 0..1 */
  level?: number;
  levelProgress?: number;
  /** debug: invincibility is on — must be unmissable so it never taints a playtest */
  god?: boolean;
  /** transient centred message, e.g. the room-clear flourish */
  banner?: string;
  /** frames remaining on the banner, used to fade it out */
  bannerFrames?: number;
}

export function drawHud(batch: SpriteBatch, state: HudState): void {
  const hearts = Math.ceil(state.maxHealth / HEART_UNITS);

  for (let i = 0; i < hearts; i++) {
    const remaining = state.health - i * HEART_UNITS;
    const key =
      remaining >= HEART_UNITS ? 'ui.heart.full'
        : remaining > 0 ? 'ui.heart.half'
          : 'ui.heart.empty';
    batch.draw(key, MARGIN + i * HEART_SPACING, MARGIN);
  }

  // Star amber, right-aligned. Counter digits are their own cells so the count
  // never needs the proportional font.
  const digits = String(state.amber);
  // Icon and digits are drawn at UI_SCALE, so the right-alignment maths has to
  // halve with them or the counter drifts off the edge.
  const width = 4 + 2 + digits.length * 3;
  const x0 = viewport.w - MARGIN - width;
  batch.draw('ui.amber', x0, MARGIN, { scale: UI_SCALE });
  for (let i = 0; i < digits.length; i++) {
    batch.draw(`ui.digit.${digits[i]}`, x0 + 6 + i * 3, MARGIN, { scale: UI_SCALE });
  }

  // 10px apart, not 8: the glyph cell is 8 tall, so a line height of 8 leaves
  // descenders touching the line below.
  // Item slot, immediately left of the amber counter. A framed box rather than a
  // bare icon, so it reads as "equipped" rather than as something lying around.
  if (state.itemIcon) {
    // The whole slot draws at UI_SCALE. A full-size icon beside half-size
    // everything else made the bomb the largest object on a 1080p screen.
    const slotX = x0 - 22;
    for (let i = 0; i < 5; i++) {
      batch.draw('ui.rule', slotX - 2 + i * 2, MARGIN - 2, { alpha: 0.4, scale: UI_SCALE });
      batch.draw('ui.rule', slotX - 2 + i * 2, MARGIN + 8, { alpha: 0.4, scale: UI_SCALE });
    }
    batch.draw(state.itemIcon, slotX - 1, MARGIN - 1, { scale: UI_SCALE });
    if (state.itemAmmo !== null && state.itemAmmo !== undefined) {
      const ammo = String(state.itemAmmo);
      for (let i = 0; i < ammo.length; i++) {
        batch.draw(`ui.digit.${ammo[i]}`, slotX + 8 + i * 3, MARGIN + 1, { scale: UI_SCALE });
      }
    }
  }

  // Level sits under the hearts with a thin progress rule: the number tells you
  // where you are, the bar tells you whether the last fight was worth it.
  if (state.level !== undefined) {
    drawText(batch, MARGIN, MARGIN + 10, `lv ${state.level}`, 0.9);
    const barX = MARGIN + 16;
    const filled = Math.round((state.levelProgress ?? 0) * 7);
    for (let i = 0; i < 7; i++) {
      batch.draw('ui.rule', barX + i * 4, MARGIN + 12, {
        alpha: i < filled ? 0.85 : 0.2, scale: UI_SCALE,
      });
    }
  }

  drawText(batch, MARGIN, MARGIN + 18, state.draftLine, 0.8);
  if (state.subLine) drawText(batch, MARGIN, MARGIN + 24, state.subLine, 0.45);

  if (state.god) {
    // Deliberately loud. A playtest with god mode silently on is a playtest
    // whose findings are worthless.
    drawTextCentred(batch, viewport.w / 2, MARGIN, 'god mode - i to disable', 0.9);
  }

  if (state.banner && (state.bannerFrames ?? 0) > 0) {
    // Fade over the last half-second so the flourish resolves rather than blinks out.
    const alpha = Math.min(1, (state.bannerFrames ?? 0) / 30);
    drawTextCentred(batch, viewport.w / 2, 40, state.banner, alpha);
  }
}
