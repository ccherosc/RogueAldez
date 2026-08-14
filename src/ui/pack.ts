/**
 * The pack screen.
 *
 * Deliberately a list, not a grid of icons. Every piece of gear here is
 * described by two numbers and a name, and a name is far more legible than a
 * 16px icon of a sword that looks like every other 16px icon of a sword. The
 * grid can come when there is art worth showing.
 *
 * The comparison column is the point: what you are hovering versus what you have
 * on. Loot screens live or die on whether the player can tell, in one glance,
 * whether the thing they just found is better.
 */

import { viewport } from '../core/const.ts';
import { weaponStats, armourReduction } from '../chronicle/gear.ts';
import type { GearItem } from '../chronicle/gear.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export interface PackView {
  items: readonly GearItem[];
  cursor: number;
  equippedWeapon: GearItem | null;
  equippedArmour: GearItem | null;
  treasure: number;
  amber: number;
}

/** One line of stats for any gear, so the list reads uniformly. */
function describe(item: GearItem): string {
  if (item.kind === 'weapon' && item.type) {
    const s = weaponStats(item.type, item.tier);
    const extras = [
      s.fellsTrees ? 'fells trees' : '',
      s.reach > 0 ? 'long reach' : '',
      s.ranged ? 'ranged' : '',
      s.swing > 1.1 ? 'slow' : s.swing < 1 ? 'quick' : '',
    ].filter(Boolean).join(', ');
    return `dmg ${s.damage}${extras ? `   ${extras}` : ''}`;
  }
  if (item.kind === 'armour') return `absorbs ${armourReduction(item.tier)}`;
  return `worth ${item.value ?? 0}`;
}

/**
 * The swap offer.
 *
 * One question with both answers on screen, and the stat line for each side
 * directly under its name. A loot prompt that makes you remember what you were
 * carrying is a prompt you learn to dismiss without reading.
 */
export function drawOffer(
  batch: SpriteBatch,
  found: GearItem,
  current: GearItem | null,
  yes: boolean,
): void {
  for (let y = 0; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: 0.72 });
    }
  }
  const cx = viewport.w / 2;
  const top = viewport.h / 2 - 40;

  drawTextCentred(batch, cx, top, found.epic ? 'a trophy' : 'an upgrade', 0.6);
  drawTextCentred(batch, cx, top + 12, found.name, 1);
  drawTextCentred(batch, cx, top + 21, describe(found), 0.7);

  drawTextCentred(batch, cx, top + 36, 'replacing', 0.45);
  drawTextCentred(batch, cx, top + 45, current ? current.name : 'nothing', 0.8);
  if (current) drawTextCentred(batch, cx, top + 54, describe(current), 0.55);

  // Both answers visible at once: no cursor to hunt for, no memory required.
  const y = top + 70;
  drawText(batch, cx - 34, y, 'equip', yes ? 1 : 0.4);
  drawText(batch, cx + 12, y, 'keep', yes ? 0.4 : 1);
  drawText(batch, yes ? cx - 42 : cx + 4, y, '>', 0.95);
  drawTextCentred(batch, cx, y + 14, 'z choose    x keep', 0.55);
}

export function drawPack(batch: SpriteBatch, view: PackView, frame: number): void {
  for (let y = 0; y < viewport.h; y += 8) {
    for (let x = 0; x < viewport.w; x += 8) {
      batch.draw('fx.dim', x, y, { alpha: 0.8 });
    }
  }

  const cx = viewport.w / 2;
  drawTextCentred(batch, cx, 16, 'the pack', 0.95);
  drawTextCentred(
    batch, cx, 26,
    `amber ${view.amber}    treasure ${view.treasure}`,
    0.5,
  );

  const left = cx - 128;
  drawText(batch, left, 40, 'carrying', 0.45);
  drawText(batch, cx + 24, 40, 'equipped', 0.45);

  // Equipped column: what the hovered item is being judged against.
  let ey = 50;
  for (const [label, item] of [
    ['weapon', view.equippedWeapon],
    ['armour', view.equippedArmour],
  ] as const) {
    drawText(batch, cx + 24, ey, label, 0.5);
    drawText(batch, cx + 24, ey + 8, item ? item.name : 'none', 0.85);
    if (item) drawText(batch, cx + 24, ey + 16, describe(item), 0.55);
    ey += 30;
  }

  // Scroll the list so the cursor stays visible in a fixed window.
  const ROWS = 11;
  const first = Math.max(0, Math.min(view.items.length - ROWS, view.cursor - Math.floor(ROWS / 2)));
  let y = 50;
  for (let i = first; i < Math.min(view.items.length, first + ROWS); i++) {
    const item = view.items[i]!;
    const selected = i === view.cursor;
    const isOn = item.uid === view.equippedWeapon?.uid || item.uid === view.equippedArmour?.uid;
    if (selected) drawText(batch, left - 8, y, '>', 0.95);
    // A word, not a symbol: the bitmap font carries letters and digits, and an
    // asterisk renders as '?'. Marking rather than re-sorting also keeps the
    // order stable, so the cursor does not jump under the player's hand when
    // they equip something.
    const worn = isOn ? (item.kind === 'armour' ? '  worn' : '  held') : '';
    drawText(batch, left, y, `${item.name}${worn}`, selected ? 1 : 0.6);
    if (selected) drawText(batch, left + 4, y + 8, describe(item), 0.6);
    y += selected ? 17 : 9;
  }

  if (view.items.length > first + ROWS) drawText(batch, left, y, '...', 0.4);

  if (Math.floor(frame / 24) % 2 === 0) {
    drawTextCentred(batch, cx, viewport.h - 14, 'z equip    x close', 0.8);
  }
}
