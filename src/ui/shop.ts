/**
 * The trader's board.
 *
 * Two columns: what they are selling, what you could sell them. Both visible at
 * once, because the interesting decision in a shop is nearly always *what do I
 * give up to afford this* — and a screen that makes you leave the buy list to
 * check the sell list is a screen that hides the decision it exists for.
 *
 * Stock is keyed to the player's level, so the board improves as they do. What
 * that buys, beyond pacing, is that a merchant is worth revisiting: the same
 * named person in the same square has different things on the table this life,
 * for the same reason everything else about the town does.
 */

import { viewport } from '../core/const.ts';
import { weaponStats, armourReduction } from '../chronicle/gear.ts';
import type { GearItem } from '../chronicle/gear.ts';
import { priceOf, sellValue } from '../chronicle/level.ts';
import type { SpriteBatch } from '../render/batcher.ts';
import { drawText, drawTextCentred } from './text.ts';

export interface ShopView {
  trader: string;
  role: string;
  /** what they will sell */
  stock: readonly GearItem[];
  /** what the player is carrying that they will buy */
  sellable: readonly GearItem[];
  /** which column has the cursor */
  side: 'buy' | 'sell';
  cursor: number;
  shards: number;
  level: number;
}

function stats(item: GearItem): string {
  if (item.kind === 'weapon' && item.type) {
    const s = weaponStats(item.type, item.tier);
    return `dmg ${s.damage}${s.fellsTrees ? '  fells trees' : ''}`;
  }
  if (item.kind === 'armour') return `absorbs ${armourReduction(item.tier)}`;
  return `worth ${item.value ?? 0}`;
}

export function drawShop(batch: SpriteBatch, view: ShopView, frame: number): void {
  batch.fill(0, 0, viewport.w, viewport.h, 0.84);

  const cx = viewport.w / 2;
  drawTextCentred(batch, cx, 14, view.trader, 1);
  drawTextCentred(batch, cx, 23, `${view.role}   -   level ${view.level}   -   ${view.shards} shards`, 0.55);

  const cols: Array<{ label: string; items: readonly GearItem[]; x: number; side: 'buy' | 'sell' }> = [
    { label: 'for sale', items: view.stock, x: cx - 132, side: 'buy' },
    { label: 'they will buy', items: view.sellable, x: cx + 10, side: 'sell' },
  ];

  for (const col of cols) {
    const active = col.side === view.side;
    drawText(batch, col.x, 38, col.label, active ? 0.9 : 0.35);

    const ROWS = 8;
    const first = Math.max(0, Math.min(col.items.length - ROWS,
      (active ? view.cursor : 0) - Math.floor(ROWS / 2)));
    let y = 50;

    if (col.items.length === 0) {
      drawText(batch, col.x, y, col.side === 'buy' ? 'nothing today' : 'nothing spare', 0.35);
      continue;
    }

    for (let i = first; i < Math.min(col.items.length, first + ROWS); i++) {
      const item = col.items[i]!;
      const selected = active && i === view.cursor;
      const price = col.side === 'buy'
        ? priceOf(item.tier, item.epic ?? false)
        : sellValue(item.tier, item.epic ?? false);
      // Grey out what cannot be afforded rather than hiding it: knowing what you
      // are saving for is most of what makes a shop interesting.
      const affordable = col.side === 'sell' || price <= view.shards;
      const alpha = selected ? 1 : affordable ? 0.62 : 0.3;

      if (selected) drawText(batch, col.x - 8, y, '>', 0.95);
      drawText(batch, col.x, y, item.name, alpha);
      drawText(batch, col.x + 96, y, String(price), alpha);
      if (selected) drawText(batch, col.x + 4, y + 8, stats(item), 0.6);
      y += selected ? 17 : 9;
    }
  }

  if (Math.floor(frame / 24) % 2 === 0) {
    drawTextCentred(batch, cx, viewport.h - 12,
      view.side === 'buy' ? 'z buy    q sell side    x leave' : 'z sell    q buy side    x leave', 0.7);
  }
}
