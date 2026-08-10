/**
 * Contact sheet renderer.
 *
 * The visual critic reads this instead of launching the game, so it has to answer
 * "can you tell what each sprite is at a glance" on its own. Cells are drawn at
 * 3x on a checkerboard (so transparency is visible), labelled, and grouped.
 *
 * It also renders 4x4 tiled patches of every ground tile — seams and repetition
 * are invisible on a single cell and obvious on a patch.
 */

import type { Atlas, AtlasCell } from './pack.ts';

const SCALE = 3;
const LABEL_H = 8;
const PAD = 6;
const COLS = 8;
const PAGE_W = 900;

// A 3x5 bitmap font. Small enough to inline, legible enough to label a grid.
const GLYPHS: Record<string, string> = {
  a: '111101111101101', b: '110101110101110', c: '111100100100111', d: '110101101101110',
  e: '111100110100111', f: '111100110100100', g: '111100101101111', h: '101101111101101',
  i: '111010010010111', j: '001001001101111', k: '101101110101101', l: '100100100100111',
  m: '101111111101101', n: '110101101101101', o: '111101101101111', p: '111101111100100',
  q: '111101101111001', r: '111101110101101', s: '111100111001111', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101',
  y: '101101010010010', z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111',
  '.': '000000000000010', '-': '000000111000000', '_': '000000000000111', ' ': '000000000000000',
};

class Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = a;
  }

  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, r, g, b);
  }

  text(x: number, y: number, s: string, r: number, g: number, b: number): void {
    let cx = x;
    for (const rawCh of s.toLowerCase()) {
      const bits = GLYPHS[rawCh] ?? GLYPHS['-']!;
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (bits[gy * 3 + gx] === '1') this.set(cx + gx, y + gy, r, g, b);
        }
      }
      cx += 4;
    }
  }
}

/** Sample a pixel out of the packed atlas. */
function atlasPixel(atlas: Atlas, x: number, y: number): [number, number, number, number] {
  const o = (y * atlas.width + x) * 4;
  return [atlas.rgba[o]!, atlas.rgba[o + 1]!, atlas.rgba[o + 2]!, atlas.rgba[o + 3]!];
}

function drawCell(
  out: Rgba,
  atlas: Atlas,
  cell: AtlasCell,
  dx: number,
  dy: number,
  scale: number,
  repeat = 1,
): void {
  for (let ry = 0; ry < repeat; ry++) {
    for (let rx = 0; rx < repeat; rx++) {
      for (let y = 0; y < cell.h; y++) {
        for (let x = 0; x < cell.w; x++) {
          const [r, g, b, a] = atlasPixel(atlas, cell.x + x, cell.y + y);
          if (a === 0) continue;
          const px = dx + (rx * cell.w + x) * scale;
          const py = dy + (ry * cell.h + y) * scale;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) out.set(px + sx, py + sy, r, g, b);
          }
        }
      }
    }
  }
}

function checkerboard(out: Rgba, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const on = (((xx - x) >> 2) + ((yy - y) >> 2)) % 2 === 0;
      out.set(xx, yy, on ? 44 : 34, on ? 46 : 36, on ? 54 : 44);
    }
  }
}

export interface ContactSheet { width: number; height: number; rgba: Uint8Array }

export function renderContactSheet(atlas: Atlas, tilePatchKeys: readonly string[]): ContactSheet {
  const byKey = new Map(atlas.cells.map((c) => [c.key, c]));

  // Group by the leading dotted segment so related art lands together.
  const groups = new Map<string, AtlasCell[]>();
  for (const cell of atlas.cells) {
    const group = cell.key.split('.')[0]!;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(cell);
  }

  // --- measure ---------------------------------------------------------------
  const patchCells = tilePatchKeys.map((k) => byKey.get(k)).filter((c): c is AtlasCell => !!c);
  const patchW = patchCells.length ? patchCells[0]!.w * 4 * 2 + PAD : 0;
  const patchRowH = patchCells.length ? patchCells[0]!.h * 4 * 2 + LABEL_H + PAD : 0;
  const patchCols = Math.max(1, Math.floor((PAGE_W - PAD) / patchW || 1));
  const patchRows = Math.ceil(patchCells.length / patchCols);

  let height = PAD + 12 + patchRows * patchRowH + PAD;
  const layout: Array<{ group: string; cells: AtlasCell[]; y: number; rows: number; cellH: number }> = [];

  for (const [group, cells] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cellH = Math.max(...cells.map((c) => c.h)) * SCALE + LABEL_H + PAD;
    const rows = Math.ceil(cells.length / COLS);
    layout.push({ group, cells, y: height + 12, rows, cellH });
    height += 12 + rows * cellH + PAD;
  }

  const out = new Rgba(PAGE_W, height);
  out.rect(0, 0, PAGE_W, height, 24, 26, 32);

  // --- tiled patches ---------------------------------------------------------
  out.text(PAD, PAD, 'tiled 4x4 patches - check for seams and repetition', 190, 200, 220);
  patchCells.forEach((cell, i) => {
    const cx = PAD + (i % patchCols) * patchW;
    const cy = PAD + 12 + Math.floor(i / patchCols) * patchRowH;
    drawCell(out, atlas, cell, cx, cy, 2, 4);
    out.text(cx, cy + cell.h * 4 * 2 + 2, cell.key, 150, 160, 180);
  });

  // --- grouped cells ---------------------------------------------------------
  for (const { group, cells, y, cellH } of layout) {
    out.text(PAD, y - 10, group, 235, 210, 140);
    cells.forEach((cell, i) => {
      const cx = PAD + (i % COLS) * Math.floor((PAGE_W - PAD * 2) / COLS);
      const cy = y + Math.floor(i / COLS) * cellH;
      checkerboard(out, cx, cy, cell.w * SCALE, cell.h * SCALE);
      drawCell(out, atlas, cell, cx, cy, SCALE);
      // strip the group prefix; it is already the section heading
      out.text(cx, cy + cell.h * SCALE + 2, cell.key.slice(group.length + 1) || cell.key, 150, 160, 180);
    });
  }

  return { width: out.width, height: out.height, rgba: out.data };
}
