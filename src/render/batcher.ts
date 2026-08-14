/**
 * Sprite batcher.
 *
 * Every quad in a frame goes into one dynamic buffer and out in as few draw calls
 * as possible. The one rule that matters beyond throughput: **positions snap to
 * integer pixels here**, in the batcher, not at call sites. Sub-pixel sprite
 * placement shimmers as things move and reads instantly as "not SNES", and
 * enforcing it in one place means no caller can forget.
 */

import { ART_SCALE } from '../core/const.ts';
import type { Atlas, AtlasCell } from './atlas.ts';
import { compileProgram } from './gl.ts';

const MAX_QUADS = 8192;
const FLOATS_PER_VERTEX = 6; // x, y, u, v, flash, alpha
const VERTS_PER_QUAD = 4;
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * VERTS_PER_QUAD;

const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec2 aTint;

uniform vec2 uResolution;

out vec2 vUV;
out vec2 vTint;

void main() {
  // Pixel space (y-down, origin top-left) into clip space.
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUV = aUV;
  vTint = aTint;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in vec2 vTint;   // x = flash, y = alpha

uniform sampler2D uAtlas;

uniform sampler2D uNormal;
/** x, y in screen space; z = radius; w = strength. Unused slots have w = 0. */
uniform vec4 uLights[8];
uniform int uLightCount;
uniform float uNormalMix;
out vec4 fragColor;

/**
 * Directional shading from the sprite's own normal map.
 *
 * This *modulates* rather than lights: the light-map pass already decides how
 * bright a place is, and this decides which side of a form is facing the source.
 * Keeping them separate is what stops the two passes double-counting brightness
 * while still letting a torch pick out the edge of a face.
 */
float directional(vec2 screenPos, vec3 n) {
  float acc = 0.0;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLights[i];
    if (L.w <= 0.0) continue;
    vec2 d = L.xy - screenPos;
    float dist = length(d);
    if (dist > L.z) continue;
    float falloff = 1.0 - dist / L.z;
    // Lights sit slightly above the ground plane, so every source has some
    // downward component — without it a light exactly level with a sprite lights
    // nothing at all.
    vec3 dir = normalize(vec3(d / max(dist, 0.001), 0.75));
    acc += max(dot(n, dir), 0.0) * falloff * L.w;
    total += falloff * L.w;
  }
  if (total <= 0.0) return 0.5;
  return acc / total;
}

void main() {
  vec4 c = texture(uAtlas, vUV);
  if (c.a < 0.01) discard;

  // Directional shading. uNormalMix is 0 for UI, which has no form to light.
  if (uNormalMix > 0.0) {
    vec4 nSample = texture(uNormal, vUV);
    if (nSample.a > 0.01) {
      vec3 n = normalize(nSample.rgb * 2.0 - 1.0);
      float lit = directional(gl_FragCoord.xy, n);
      // Centred on 1.0 so an unlit sprite is unchanged and the effect only ever
      // shifts a surface toward or away from the light that reaches it.
      float shade = mix(1.0, 0.55 + lit * 0.9, uNormalMix * nSample.a);
      c.rgb *= shade;
    }
  }

  // Damage flash replaces the sprite with white rather than tinting it — see the
  // enemy flash rule in zelda-feel.
  fragColor = vec4(mix(c.rgb, vec3(1.0), vTint.x), c.a * vTint.y);
}`;

export interface DrawOptions {
  /** 0 = normal, 1 = fully white. Used for the damage flash. */
  flash?: number;
  /**
   * 0..1 multiplier. Palettes have no alpha channel, so anything that needs to
   * be translucent — drop shadows above all — gets it here rather than baked in.
   */
  alpha?: number;
  /**
   * Size multiplier in world pixels; 1 keeps the cell's authored size. 0.5 draws
   * at one texel per world pixel — used by the HUD so UI stays proportionate as
   * magnification rises.
   */
  scale?: number;
  flipX?: boolean;
}

export class SpriteBatch {
  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: Atlas;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly data: Float32Array;
  private readonly uResolution: WebGLUniformLocation;
  private readonly uLights: WebGLUniformLocation | null;
  private readonly uLightCount: WebGLUniformLocation | null;
  private readonly uNormalMix: WebGLUniformLocation | null;

  private quads = 0;
  private camX = 0;
  private camY = 0;
  private viewW = 0;
  private viewH = 0;
  /** draw calls issued since the last begin() — surfaced in the debug overlay */
  drawCalls = 0;

  constructor(gl: WebGL2RenderingContext, atlas: Atlas) {
    this.gl = gl;
    this.atlas = atlas;
    this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
    this.data = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD);

    const uRes = gl.getUniformLocation(this.program, 'uResolution');
    if (!uRes) throw new Error('batcher: uResolution not found');
    this.uResolution = uRes;
    this.uLights = gl.getUniformLocation(this.program, 'uLights');
    this.uLightCount = gl.getUniformLocation(this.program, 'uLightCount');
    this.uNormalMix = gl.getUniformLocation(this.program, 'uNormalMix');

    // Atlas on unit 0, normals on unit 2 (unit 1 is the presenter's light map).
    gl.useProgram(this.program);
    const uAtlas = gl.getUniformLocation(this.program, 'uAtlas');
    const uNorm = gl.getUniformLocation(this.program, 'uNormal');
    if (uAtlas) gl.uniform1i(uAtlas, 0);
    if (uNorm) gl.uniform1i(uNorm, 2);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) throw new Error('batcher: buffer allocation failed');
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);

    // Quad indices never change, so they are uploaded once and left alone.
    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      const i = q * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  /** Camera position is rounded once here so every sprite shares the same offset. */
  /**
   * Lights for the directional pass, in *world* coordinates. Converted to screen
   * space at flush, so a caller never has to know about the camera.
   */
  private lights: number[] = [];
  private normalMix = 1;

  /** Clear and repopulate the directional light set for this pass. */
  setLights(list: ReadonlyArray<{ x: number; y: number; radius: number; strength: number }>): void {
    this.lights = [];
    for (const l of list.slice(0, 8)) {
      this.lights.push(l.x, l.y, l.radius, l.strength);
    }
  }

  /** UI has no surface to light; 0 disables the directional term entirely. */
  setNormalMix(v: number): void {
    this.normalMix = v;
  }

  private uploadLights(gl: WebGL2RenderingContext): void {
    const count = this.lights.length / 4;
    const buf = new Float32Array(32);
    for (let i = 0; i < count; i++) {
      // World -> screen. The framebuffer's y axis runs the same way the world's
      // does here, and gl_FragCoord is bottom-up, so y is flipped at use.
      buf[i * 4] = (this.lights[i * 4]! - this.camX) * ART_SCALE;
      buf[i * 4 + 1] = (this.viewH - (this.lights[i * 4 + 1]! - this.camY)) * ART_SCALE;
      buf[i * 4 + 2] = this.lights[i * 4 + 2]! * ART_SCALE;
      buf[i * 4 + 3] = this.lights[i * 4 + 3]!;
    }
    if (this.uLights) gl.uniform4fv(this.uLights, buf);
    if (this.uLightCount) gl.uniform1i(this.uLightCount, count);
    if (this.uNormalMix) gl.uniform1f(this.uNormalMix, this.atlas.normalTexture ? this.normalMix : 0);
  }

  begin(camX: number, camY: number, viewW: number, viewH: number): void {
    this.camX = Math.round(camX);
    this.camY = Math.round(camY);
    this.viewW = viewW;
    this.viewH = viewH;
    this.quads = 0;
    this.drawCalls = 0;
  }

  /** `x, y` is the sprite's anchor in world pixels — feet for actors, top-left for tiles. */
  draw(key: string, x: number, y: number, opts?: DrawOptions): void {
    this.drawCell(this.atlas.cell(key), x, y, opts);
  }

  /**
   * A flat wash of one colour over a rectangle, as a single quad.
   *
   * Every dimmed panel in the game used to be built by tiling the 8x8 `fx.dim`
   * sprite across the whole screen — around a thousand quads, each sampling to
   * the exact edge of its atlas cell. At the edges that picks up a sliver of
   * whatever cell was packed next door, and repeated every eight pixels the
   * slivers line up into a lattice of bright dots. On the title screen, which is
   * the largest dimmed area in the game, it read as a grid laid over the art and
   * made the menu text hard to hold on to.
   *
   * One quad cannot have interior seams, and the UVs collapse to a single texel
   * well inside the cell, so there is no neighbour within reach to bleed from.
   */
  fill(x: number, y: number, w: number, h: number, alpha: number): void {
    if (w <= 0 || h <= 0) return;
    if (this.quads >= MAX_QUADS) this.flush();

    const cell = this.atlas.cell('fx.dim');
    // Dead centre of the cell, as a zero-area UV range.
    const u = (cell.x + cell.w / 2) / this.atlas.width;
    const v = (cell.y + cell.h / 2) / this.atlas.height;

    const dx = Math.round(x) - this.camX;
    const dy = Math.round(y) - this.camY;
    const d = this.data;
    let o = this.quads * FLOATS_PER_QUAD;

    d[o++] = dx;     d[o++] = dy;     d[o++] = u; d[o++] = v; d[o++] = 0; d[o++] = alpha;
    d[o++] = dx + w; d[o++] = dy;     d[o++] = u; d[o++] = v; d[o++] = 0; d[o++] = alpha;
    d[o++] = dx + w; d[o++] = dy + h; d[o++] = u; d[o++] = v; d[o++] = 0; d[o++] = alpha;
    d[o++] = dx;     d[o++] = dy + h; d[o++] = u; d[o++] = v; d[o++] = 0; d[o++] = alpha;

    this.quads++;
  }

  drawCell(cell: AtlasCell, x: number, y: number, opts?: DrawOptions): void {
    // Atlas cells are texels; positions and sizes here are world pixels. The
    // framebuffer is ART_SCALE denser than the world, so a quad w world pixels
    // wide samples w*ART_SCALE texels — that is where the extra detail lives.
    // `scale` lets a caller draw a cell smaller than its world-pixel size. UI
    // uses 0.5, which maps one texel to one world pixel — the crispest the art
    // can be, and the only way to keep the HUD from ballooning now that a big
    // monitor magnifies world pixels six or eight times.
    const s = opts?.scale ?? 1;
    const w = (cell.w / ART_SCALE) * s;
    const h = (cell.h / ART_SCALE) * s;
    const dx = Math.round(x) - (cell.anchor[0] / ART_SCALE) * s - this.camX;
    const dy = Math.round(y) - (cell.anchor[1] / ART_SCALE) * s - this.camY;

    // Cheap reject: anything fully offscreen costs nothing but the test.
    if (dx + w < 0 || dy + h < 0 || dx > this.viewW || dy > this.viewH) return;

    if (this.quads >= MAX_QUADS) this.flush();

    const aw = this.atlas.width;
    const ah = this.atlas.height;
    let u0 = cell.x / aw;
    let u1 = (cell.x + cell.w) / aw;
    const v0 = cell.y / ah;
    const v1 = (cell.y + cell.h) / ah;
    if (opts?.flipX) {
      const t = u0;
      u0 = u1;
      u1 = t;
    }

    const f = opts?.flash ?? 0;
    const a = opts?.alpha ?? 1;
    const d = this.data;
    let o = this.quads * FLOATS_PER_QUAD;

    d[o++] = dx;     d[o++] = dy;     d[o++] = u0; d[o++] = v0; d[o++] = f; d[o++] = a;
    d[o++] = dx + w; d[o++] = dy;     d[o++] = u1; d[o++] = v0; d[o++] = f; d[o++] = a;
    d[o++] = dx + w; d[o++] = dy + h; d[o++] = u1; d[o++] = v1; d[o++] = f; d[o++] = a;
    d[o++] = dx;     d[o++] = dy + h; d[o++] = u0; d[o++] = v1; d[o++] = f; d[o++] = a;

    this.quads++;
  }

  flush(): void {
    if (this.quads === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.quads * FLOATS_PER_QUAD);

    gl.uniform2f(this.uResolution, this.viewW, this.viewH);
    this.uploadLights(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    if (this.atlas.normalTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.normalTexture);
      gl.activeTexture(gl.TEXTURE0);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, this.quads * 6, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);
    this.quads = 0;
    this.drawCalls++;
  }
}
