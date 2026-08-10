/**
 * Loads the generated atlas produced by `npm run gen:art`.
 *
 * Nothing here generates art — see src/art/ for that. This is the runtime side:
 * one texture, one key->rect table.
 */

import { createTexture } from './gl.ts';

export interface AtlasCell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** origin within the cell; sprites anchor at the feet, tiles at (0,0) */
  anchor: [number, number];
}

interface AtlasManifest {
  seed: number;
  width: number;
  height: number;
  cells: Record<string, AtlasCell>;
}

export interface Atlas {
  texture: WebGLTexture;
  /** surface normals, same layout; null when the page is unavailable */
  normalTexture: WebGLTexture | null;
  width: number;
  height: number;
  /** Throws on an unknown key — a silent miss would render an invisible sprite. */
  cell(key: string): AtlasCell;
  has(key: string): boolean;
  keys(): string[];
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * A fully-inlined build (the single-file bundle published as an artifact) sets
 * this global instead of serving /atlas/* — that host permits no network
 * requests at all, so the atlas travels inside the page as a data URI.
 */
interface InlineBundle {
  atlasJson: AtlasManifest;
  atlasPng: string;
  atlasNormalPng?: string;
}

export async function loadAtlas(gl: WebGL2RenderingContext, base = '/atlas'): Promise<Atlas> {
  const inline = Reflect.get(window, '__ALDEZ_BUNDLE') as InlineBundle | undefined;

  let manifest: AtlasManifest;
  let image: HTMLImageElement;
  let normalImage: HTMLImageElement | null = null;
  if (inline) {
    manifest = inline.atlasJson;
    image = await loadImage(inline.atlasPng);
    if (inline.atlasNormalPng) normalImage = await loadImage(inline.atlasNormalPng);
  } else {
    normalImage = await loadImage(`${base}/atlas-normal.png`).catch(() => null);
    const [manifestRes, fetched] = await Promise.all([
      fetch(`${base}/atlas.json`),
      loadImage(`${base}/atlas.png`),
    ]);
    if (!manifestRes.ok) {
      throw new Error(`could not load ${base}/atlas.json — run \`npm run gen:art\``);
    }
    manifest = (await manifestRes.json()) as AtlasManifest;
    image = fetched;
  }

  if (image.naturalWidth !== manifest.width || image.naturalHeight !== manifest.height) {
    throw new Error(
      `atlas.png is ${image.naturalWidth}x${image.naturalHeight} but atlas.json says ` +
        `${manifest.width}x${manifest.height} — regenerate with \`npm run gen:art\``,
    );
  }

  const texture = createTexture(gl, manifest.width, manifest.height, image);

  const normalTexture = normalImage
    ? createTexture(gl, manifest.width, manifest.height, normalImage)
    : null;

  return {
    texture,
    normalTexture,
    width: manifest.width,
    height: manifest.height,
    cell(key) {
      const c = manifest.cells[key];
      if (!c) throw new Error(`atlas: no cell "${key}"`);
      return c;
    },
    has: (key) => manifest.cells[key] !== undefined,
    keys: () => Object.keys(manifest.cells),
  };
}
