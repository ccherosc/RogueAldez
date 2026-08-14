/**
 * Boot. Initialises subsystems in layer order and starts the loop.
 *
 * Note on interpolation: the loop hands render() an `alpha`, and we deliberately
 * ignore it. Everything snaps to integer pixels at 256x224, so interpolating
 * would only produce positions that round to the same pixel — or worse, jitter
 * between two. A 60 Hz simulation displayed on a 144 Hz panel *should* step
 * rather than glide; that stepping is what the era looked like.
 */

import { ART_SCALE, viewport } from './core/const.ts';
import { startLoop } from './core/loop.ts';
import { createContext, createRenderTarget } from './render/gl.ts';
import { loadAtlas } from './render/atlas.ts';
import { SpriteBatch } from './render/batcher.ts';
import { LightBuffer } from './render/lights.ts';
import { Presenter } from './render/post.ts';
import { createInput } from './player/input.ts';
import { isTouchDevice, mountTouchControls, toggleFullscreen } from './player/touch.ts';
import { GamepadReader, mergePad } from './player/gamepad.ts';
import { Scene } from './game/scene.ts';
import { fixtureFromLocation } from './game/fixtures.ts';
import { unlockAudio, isReady } from './audio/engine.ts';
import { wireSfx, sfx } from './audio/sfx.ts';
import { music } from './audio/music.ts';

function fatal(err: unknown): void {
  const el = document.getElementById('fatal');
  const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  if (el) {
    el.textContent = message;
    el.style.display = 'grid';
  }
  console.error(err);
}

// A runtime exception inside the loop reads as "the game froze" — the worst
// possible bug report, because it carries no information. Surface anything
// uncaught on the fatal overlay so a freeze always comes with its reason.
window.addEventListener('error', (e) => fatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

async function boot(): Promise<void> {
  const canvas = document.getElementById('game');
  const hud = document.getElementById('hud');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#game canvas not found');

  const gl = createContext(canvas);
  const atlas = await loadAtlas(gl);
  const batch = new SpriteBatch(gl, atlas);
  const presenter = new Presenter(gl, canvas);
  // The offscreen target is in texels: ART_SCALE times the world resolution.
  let target = createRenderTarget(gl, viewport.w * ART_SCALE, viewport.h * ART_SCALE);
  // The light map is deliberately coarse — light is smooth, so half the world
  // resolution costs a quarter of the pixels and the bilinear filter turns the
  // low resolution into exactly the softness a light pool wants.
  const lightBuffer = new LightBuffer(gl);
  let lightTarget = createRenderTarget(gl, Math.ceil(viewport.w / 2), Math.ceil(viewport.h / 2));
  const input = createInput();
  if (isTouchDevice()) mountTouchControls();
  const pads = new GamepadReader();
  // `?fixture=<id>` loads a sealed deterministic scenario for the capture
  // harness. Absent in normal play.
  const fixture = fixtureFromLocation(window.location.search);
  const scene = new Scene(undefined, fixture);

  let showDebug = false;
  let audioStarted = false;

  /**
   * Per-tick ring buffer for the critic harness.
   *
   * Screenshots sample at display rate and can't resolve a 4-frame freeze, so
   * timing claims — hitstop, swing phase lengths, flash duration — are verified
   * from this instead. It is the difference between "looks about right" and
   * "positions were byte-identical for exactly 4 ticks".
   */
  // A full minute of simulation. The revision and Reliquary screens tick too, and
  // at 900 they would evict the combat frames a critic actually needs.
  const FRAME_LOG = 3600;
  const frames: Array<Record<string, number | string>> = [];
  let frameCursor = 0;

  // The render target is sized to the viewport, so a resize that changes the
  // internal resolution has to rebuild it.
  const fit = (): void => {
    if (presenter.resize(window.innerWidth, window.innerHeight)) {
      target = createRenderTarget(gl, viewport.w * ART_SCALE, viewport.h * ART_SCALE);
      lightTarget = createRenderTarget(gl, Math.ceil(viewport.w / 2), Math.ceil(viewport.h / 2));
    }
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));

  const loop = startLoop({
    update() {
      // Keyboard, touch and gamepad all feed one snapshot; whichever the player
      // reaches for wins, and nothing downstream knows the difference.
      const snapshot = mergePad(input.step(), pads.read());
      // The controls screen shows what the browser will actually admit to.
      if (scene.mode === 'menu') scene.padStatus = pads.status();
      if (snapshot.invinciblePressed) scene.invincible = !scene.invincible;

      // Browsers refuse to start audio without a gesture, so the graph is built
      // on the first real keypress and the bed fades in behind it.
      if (snapshot.anyPressed && !audioStarted) {
        unlockAudio();
        if (isReady()) {
          wireSfx();
          music.setMood(scene.biome.mode, scene.biome.root);
          music.start();
          audioStarted = true;
        }
      }
      if (snapshot.attackPressed && scene.mode === 'playing') sfx.swing();

      if (snapshot.debugPressed) {
        showDebug = !showDebug;
        if (hud) hud.hidden = !showDebug;
      }
      if (snapshot.fullscreenPressed) void toggleFullscreen();
      if (snapshot.crtPressed) {
        presenter.scanlineStrength = presenter.scanlineStrength > 0 ? 0 : 0.14;
      }
      scene.update(snapshot);
      // Grade comes from the biome, not the Act — two floors of the same Act can
      // be a bright reed flat and a dark drowned ruin.
      presenter.setGrade(scene.biome.grade);
      presenter.stepGrade();

      const sample = {
        tick: scene.tick,
        x: scene.player.x,
        y: scene.player.y,
        facing: scene.player.facing,
        phase: scene.player.sword.phase,
        // The rendered cell, so the harness can prove a spin actually turns
        // rather than holding one pose for twelve frames.
        sprite: scene.player.spriteKey(),
        swing: scene.player.sword.swingId,
        stop: scene.hitstop.remaining,
        flashing: scene.entities.all.reduce((n, e) => n + (e.flashFrames > 0 ? 1 : 0), 0),
        broken: scene.propsBroken,
        killed: scene.enemiesKilled,
        hp: scene.player.health,
        iframes: scene.player.iframes,
        amber: scene.amber,
        mode: scene.mode,
        draft: scene.draft.index,
      };
      if (frames.length < FRAME_LOG) frames.push(sample);
      else {
        frames[frameCursor] = sample;
        frameCursor = (frameCursor + 1) % FRAME_LOG;
      }
    },

    render() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      scene.draw(batch, lightBuffer);
      lightBuffer.flush(lightTarget);
      presenter.present(target, lightTarget);

      if (showDebug && hud) {
        const s = loop.stats;
        hud.textContent =
          `${s.fps.toFixed(1)} fps   tick ${s.tick}   x${presenter.scale}\n` +
          `upd ${s.updateMs.toFixed(2)}ms  draw ${s.renderMs.toFixed(2)}ms  calls ${batch.drawCalls}\n` +
          scene.debugText();
      }
    },
  });

  // Handle for the headless capture harness (see the visual-critic skill).
  Reflect.set(window, '__aldez', {
    scene,
    loop,
    presenter,
    atlas,
    /** frame log in chronological order, oldest first */
    frames: () => [...frames.slice(frameCursor), ...frames.slice(0, frameCursor)],
  });
}

boot().catch(fatal);
