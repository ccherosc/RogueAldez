/**
 * Presentation pass: upscale the 256x224 target to the canvas by an integer
 * factor and apply a restrained CRT treatment.
 *
 * Integer scaling is non-negotiable — a fractional factor makes some source
 * pixels wider than others, which is far uglier than a black border. The CRT
 * effect stays subtle on purpose; heavy scanlines and curvature read as a filter
 * slapped on top rather than as the era.
 */

import { ART_SCALE, computeViewport, setViewport, viewport } from '../core/const.ts';
import { compileProgram } from './gl.ts';
import type { RenderTarget } from './gl.ts';

const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
out vec2 vUV;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uSrc;
uniform sampler2D uLight;
uniform vec2 uSize;
uniform float uScanline;
uniform vec3 uGrade;
out vec4 fragColor;

void main() {
  // Per-Act colour grade. One multiply turns the same tiles from a warm valley
  // into a cold lake or a lamplit crypt — far cheaper than a second tileset, and
  // it changes how a place *feels* rather than what is in it.
  vec3 c = texture(uSrc, vUV).rgb * uGrade;

  // The light map, sampled with the hardware's bilinear filter so a torch pool
  // has soft edges rather than the stair-steps of its low-resolution quad.
  vec3 light = texture(uLight, vUV).rgb;
  c *= light;

  // Bloom where light and bright art coincide. Only the top of the range blooms,
  // so a torch flares and lit grass does not — this is the single cheapest thing
  // that makes a 2D scene read as *lit* rather than as tinted.
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += c * smoothstep(0.86, 1.25, lum) * 0.35;

  // Darken the lower part of each *source* row. At 3x and above this reads as
  // scanlines; below that it is nearly invisible, which is the right behaviour.
  float line = fract(vUV.y * uSize.y);
  float scan = 1.0 - uScanline * smoothstep(0.45, 1.0, line);

  // Very gentle vignette — enough to round the corners of the image, not enough
  // to notice as an effect.
  vec2 d = vUV - 0.5;
  float vig = 1.0 - 0.16 * dot(d, d);

  fragColor = vec4(c * scan * vig, 1.0);
}`;

export class Presenter {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uSize: WebGLUniformLocation;
  private readonly uScanline: WebGLUniformLocation;
  private readonly uGrade: WebGLUniformLocation;

  scanlineStrength = 0.14;
  scale = 1;
  /** current grade, eased toward `gradeTarget` so Act changes fade rather than snap */
  private grade: [number, number, number] = [1, 1, 1];
  private gradeTarget: [number, number, number] = [1, 1, 1];

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);

    const uSize = gl.getUniformLocation(this.program, 'uSize');
    const uScan = gl.getUniformLocation(this.program, 'uScanline');
    const uGrade = gl.getUniformLocation(this.program, 'uGrade');
    if (!uSize || !uScan || !uGrade) throw new Error('presenter: uniforms not found');
    this.uSize = uSize;
    this.uScanline = uScan;
    this.uGrade = uGrade;

    // Bind the samplers once: scene on unit 0, light map on unit 1.
    gl.useProgram(this.program);
    const uSrc = gl.getUniformLocation(this.program, 'uSrc');
    const uLight = gl.getUniformLocation(this.program, 'uLight');
    if (uSrc) gl.uniform1i(uSrc, 0);
    if (uLight) gl.uniform1i(uLight, 1);

    // Fullscreen quad. Clip y=+1 is the top of the screen and maps to v=1, which
    // is where world y=0 landed in the render target — so the image is upright.
    const verts = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
       1,  1, 1, 1,
      -1, -1, 0, 0,
       1,  1, 1, 1,
      -1,  1, 0, 1,
    ]);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error('presenter: buffer allocation failed');
    this.vao = vao;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  /**
   * Recompute the viewport and resize the canvas.
   *
   * Returns true when the internal resolution changed, which means the render
   * target has to be rebuilt. Call on boot, on resize, and on orientation change.
   */
  resize(availableW: number, availableH: number): boolean {
    const changed = setViewport(computeViewport(availableW, availableH));
    this.scale = viewport.scale;

    // Backing store: texels x integer scale — always exact.
    const w = viewport.w * ART_SCALE * viewport.scale;
    const h = viewport.h * ART_SCALE * viewport.scale;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // CSS: 1:1 with the backing wherever it fits. On screens smaller than the
    // minimum backing (phones, in CSS pixels) shrink fractionally — device DPR
    // still oversamples the texels, so nothing softens in practice.
    const fit = Math.min(1, availableW / w, availableH / h);
    this.canvas.style.width = `${Math.floor(w * fit)}px`;
    this.canvas.style.height = `${Math.floor(h * fit)}px`;
    return changed;
  }

  present(target: RenderTarget, lights?: RenderTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    // Unit 1 is the light map. Without one bound the sampler reads black and the
    // whole screen goes dark, so fall back to the scene itself only as a shape —
    // callers always pass a map in practice.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (lights ?? target).texture);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(this.uSize, viewport.w, viewport.h);
    gl.uniform1f(this.uScanline, this.scanlineStrength);
    gl.uniform3f(this.uGrade, this.grade[0], this.grade[1], this.grade[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /** Target grade for the current Act. Eased in by `stepGrade`. */
  setGrade(grade: readonly [number, number, number]): void {
    this.gradeTarget = [grade[0], grade[1], grade[2]];
  }

  /** Ease one simulation step toward the target — an Act change fades in. */
  stepGrade(): void {
    const [tr, tg, tb] = this.gradeTarget;
    const [r, g, b] = this.grade;
    this.grade = [r + (tr - r) * 0.04, g + (tg - g) * 0.04, b + (tb - b) * 0.04];
  }
}
