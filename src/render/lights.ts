/**
 * The lighting pass.
 *
 * Renders a low-resolution light map — ambient colour plus one soft radial pool
 * per light — which the presenter multiplies over the finished frame. Everything
 * the game draws stays flatly lit in the atlas; the mood comes from this buffer.
 *
 * Why a separate buffer rather than lighting each sprite: a light has to fall on
 * *terrain* as well as actors, has to spill across the seam between them, and has
 * to be additive where two torches overlap. A per-sprite tint can do none of
 * those. It also means adding a light is one call from wherever the thing that
 * emits it already lives, with no shader knowledge required at the call site.
 *
 * The map is deliberately rendered at a fraction of the frame's resolution: the
 * falloff is smooth, so the hardware's bilinear filter is doing exactly the job
 * you want and the cost is a quarter of the pixels. Softness here is a feature —
 * a light pool with hard pixel edges reads as a decal, not as light.
 */

import { viewport } from '../core/const.ts';
import { compileProgram } from './gl.ts';
import type { RenderTarget } from './gl.ts';

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aLocal;
layout(location = 2) in vec3 aColor;
uniform vec2 uSize;
out vec2 vLocal;
out vec3 vColor;
void main() {
  vLocal = aLocal;
  vColor = aColor;
  vec2 clip = (aPos / uSize) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vLocal;
in vec3 vColor;
out vec4 fragColor;
void main() {
  // Inverse-square-ish falloff, clamped at the quad's edge so a light never
  // shows a seam where its quad ends.
  float d = length(vLocal);
  float att = clamp(1.0 - d, 0.0, 1.0);
  att = att * att;
  fragColor = vec4(vColor * att, 1.0);
}`;

/** floats per vertex: x, y, lx, ly, r, g, b */
const FLOATS_PER_VERTEX = 7;
const MAX_LIGHTS = 256;

export class LightBuffer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ebo: WebGLBuffer;
  private readonly uSize: WebGLUniformLocation;
  private readonly data: Float32Array;
  private count = 0;
  private camX = 0;
  private camY = 0;
  private ambient: [number, number, number] = [1, 1, 1];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, VERT, FRAG);
    const uSize = gl.getUniformLocation(this.program, 'uSize');
    if (!uSize) throw new Error('lights: uSize not found');
    this.uSize = uSize;

    this.data = new Float32Array(MAX_LIGHTS * 4 * FLOATS_PER_VERTEX);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ebo = gl.createBuffer();
    if (!vao || !vbo || !ebo) throw new Error('lights: could not allocate buffers');
    this.vao = vao;
    this.vbo = vbo;
    this.ebo = ebo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);

    const indices = new Uint16Array(MAX_LIGHTS * 6);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /**
   * Start a frame. Ambient is the colour the world is lit by *before* any light
   * source — 1,1,1 leaves a scene exactly as the atlas drew it, which is what
   * daylight should do.
   */
  begin(camX: number, camY: number, ambient: readonly [number, number, number]): void {
    this.camX = camX;
    this.camY = camY;
    this.ambient = [ambient[0], ambient[1], ambient[2]];
    this.count = 0;
  }

  /** A light at a world position. Radius is in world pixels. */
  add(
    x: number,
    y: number,
    radius: number,
    color: readonly [number, number, number],
    intensity = 1,
  ): void {
    if (this.count >= MAX_LIGHTS) return;
    const cx = x - this.camX;
    const cy = y - this.camY;
    // Cheap reject — a light entirely off screen still costs a quad otherwise.
    if (cx + radius < 0 || cy + radius < 0) return;
    if (cx - radius > viewport.w || cy - radius > viewport.h) return;

    const r = color[0] * intensity;
    const g = color[1] * intensity;
    const b = color[2] * intensity;
    const o = this.count * 4 * FLOATS_PER_VERTEX;
    const d = this.data;
    const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = corners[i]!;
      const p = o + i * FLOATS_PER_VERTEX;
      d[p] = cx + lx * radius;
      d[p + 1] = cy + ly * radius;
      d[p + 2] = lx;
      d[p + 3] = ly;
      d[p + 4] = r;
      d[p + 5] = g;
      d[p + 6] = b;
    }
    this.count++;
  }

  /** Render the accumulated lights into `target`. */
  flush(target: RenderTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(this.ambient[0], this.ambient[1], this.ambient[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.count > 0) {
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER, 0,
        this.data.subarray(0, this.count * 4 * FLOATS_PER_VERTEX),
      );
      gl.uniform2f(this.uSize, viewport.w, viewport.h);
      // Lights add to one another; two torches are brighter than one.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawElements(gl.TRIANGLES, this.count * 6, gl.UNSIGNED_SHORT, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
