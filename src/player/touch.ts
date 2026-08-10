/**
 * Touch controls for phones and tablets.
 *
 * These synthesise the same key events the keyboard produces rather than
 * introducing a second input path. One code path means a control can never work
 * on desktop and silently not on mobile — and the simulation stays entirely
 * unaware that touch exists.
 *
 * The overlay only mounts on devices that actually report touch, so a desktop
 * browser is never cluttered with buttons nobody can press.
 */

const DPAD_KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
} as const;

type Dir = keyof typeof DPAD_KEYS;

function press(code: string, down: boolean): void {
  window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }),
  );
}

export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}

/** Toggle browser fullscreen. Silently ignored where the API is unavailable. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Refused (iOS Safari, or no user gesture). Not worth surfacing.
  }
}

export interface TouchControls {
  destroy(): void;
}

export function mountTouchControls(): TouchControls {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="pad">
      <button data-dir="up"    aria-label="up">▲</button>
      <button data-dir="left"  aria-label="left">◀</button>
      <button data-dir="right" aria-label="right">▶</button>
      <button data-dir="down"  aria-label="down">▼</button>
    </div>
    <div class="acts">
      <button data-key="KeyX" aria-label="lift">✋</button>
      <button data-key="KeyZ" aria-label="attack">⚔</button>
    </div>
    <button class="fs" aria-label="fullscreen">⛶</button>
  `;
  document.body.appendChild(root);

  const held = new Map<number, string>();

  const codeFor = (el: Element): string | null => {
    const dir = el.getAttribute('data-dir') as Dir | null;
    if (dir) return DPAD_KEYS[dir];
    return el.getAttribute('data-key');
  };

  const onDown = (e: PointerEvent): void => {
    const el = (e.target as Element | null)?.closest('button');
    if (!el) return;
    if (el.classList.contains('fs')) {
      void toggleFullscreen();
      return;
    }
    const code = codeFor(el);
    if (!code) return;
    e.preventDefault();
    // Track by pointerId so two thumbs can hold two buttons independently.
    held.set(e.pointerId, code);
    el.setPointerCapture(e.pointerId);
    press(code, true);
  };

  const onUp = (e: PointerEvent): void => {
    const code = held.get(e.pointerId);
    if (!code) return;
    held.delete(e.pointerId);
    press(code, false);
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  // A finger dragged off the button must release it, or movement sticks on.
  root.addEventListener('lostpointercapture', onUp);

  return {
    destroy(): void {
      for (const code of held.values()) press(code, false);
      held.clear();
      root.remove();
    },
  };
}
