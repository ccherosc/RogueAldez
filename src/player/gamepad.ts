/**
 * Gamepad support.
 *
 * Xbox controllers pair over Bluetooth and appear through the standard Gamepad
 * API with the "standard" mapping, so this is genuinely easy — no driver, no
 * vendor SDK, no pairing code of our own. Same for PlayStation and most modern
 * pads.
 *
 * Like the touch controls, this feeds the *existing* input path rather than
 * adding a second one: it reports held/pressed state in the same shape the
 * keyboard does, and the simulation never learns which device produced it.
 *
 * The one wrinkle is that browsers hide gamepads until the page has seen an
 * input from one, so nothing appears until a button is pressed. That is a
 * privacy measure, not a bug — hence the prompt in the debug overlay.
 */

/** Standard-mapping button indices. */
const BTN = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  back: 8,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

/** Sticks rest slightly off-centre; below this counts as neutral. */
const DEADZONE = 0.35;

export interface PadState {
  connected: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
  attackPressed: boolean;
  actionPressed: boolean;
  itemPressed: boolean;
  cyclePressed: boolean;
  upPressed: boolean;
  downPressed: boolean;
  anyPressed: boolean;
  fullscreenPressed: boolean;
}

const EMPTY: PadState = {
  connected: false,
  up: false, down: false, left: false, right: false,
  attack: false, attackPressed: false, actionPressed: false,
  itemPressed: false, cyclePressed: false,
  upPressed: false, downPressed: false, anyPressed: false, fullscreenPressed: false,
};

export class GamepadReader {
  private previous = new Map<number, boolean>();
  /**
   * Frames to wait before asking again after a SecurityError.
   *
   * This used to latch off permanently on the first failure, which was wrong in
   * the one case that matters: a page can be denied gamepad access early and
   * granted it later (permission policies, a pad paired after load). Backing off
   * and retrying costs nothing and means plugging a controller in mid-session
   * actually works.
   */
  private retryIn = 0;
  private lastId = '';

  /** For the controls screen: what the reader can actually see right now. */
  status(): { connected: boolean; id: string; blocked: boolean; buttons: number[]; axes: number[] } {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = typeof navigator?.getGamepads === 'function' ? Array.from(navigator.getGamepads()) : [];
    } catch {
      return { connected: false, id: '', blocked: true, buttons: [], axes: [] };
    }
    const pad = pads.find((p): p is Gamepad => p !== null && p.connected);
    if (!pad) return { connected: false, id: '', blocked: false, buttons: [], axes: [] };
    return {
      connected: true,
      id: pad.id,
      blocked: false,
      buttons: pad.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0),
      axes: pad.axes.map((a) => Math.round(a * 100) / 100),
    };
  }

  /** Poll once per simulation step. */
  read(): PadState {
    if (this.retryIn > 0) {
      this.retryIn--;
      return EMPTY;
    }
    let pads: (Gamepad | null)[] = [];
    try {
      pads = typeof navigator?.getGamepads === 'function' ? Array.from(navigator.getGamepads()) : [];
    } catch {
      // Sandboxed iframes without the gamepad permissions-policy throw here.
      // This runs every simulation tick, so an unguarded throw would not lose
      // gamepad support — it would freeze the entire game. Back off ~3s.
      this.retryIn = 180;
      return EMPTY;
    }
    const pad = pads.find((p): p is Gamepad => p !== null && p.connected);
    if (pad && pad.id !== this.lastId) {
      // A different pad (or the first one) — drop stale edge state so the first
      // press after connecting registers rather than being eaten as "held".
      this.previous.clear();
      this.lastId = pad.id;
    }
    if (!pad) {
      this.previous.clear();
      return EMPTY;
    }

    const held = (index: number): boolean => pad.buttons[index]?.pressed ?? false;
    // Rising edge only — the caller consumes these once per step, exactly like
    // the keyboard's latched presses.
    const pressed = (index: number): boolean => {
      const now = held(index);
      const before = this.previous.get(index) ?? false;
      this.previous.set(index, now);
      return now && !before;
    };

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;

    // Track stick direction as pseudo-buttons so menu navigation gets edges too.
    const stickUp = axisY < -DEADZONE;
    const stickDown = axisY > DEADZONE;
    const edgeStickUp = stickUp && !(this.previous.get(-1) ?? false);
    const edgeStickDown = stickDown && !(this.previous.get(-2) ?? false);
    this.previous.set(-1, stickUp);
    this.previous.set(-2, stickDown);

    const up = held(BTN.dpadUp) || stickUp;
    const down = held(BTN.dpadDown) || stickDown;
    const left = held(BTN.dpadLeft) || axisX < -DEADZONE;
    const right = held(BTN.dpadRight) || axisX > DEADZONE;

    const attackPressed = pressed(BTN.a) || pressed(BTN.x);
    const actionPressed = pressed(BTN.b);
    const itemPressed = pressed(BTN.y);
    const cyclePressed = pressed(BTN.rb) || pressed(BTN.lb);
    const dpadUpPressed = pressed(BTN.dpadUp);
    const dpadDownPressed = pressed(BTN.dpadDown);
    const fullscreenPressed = pressed(BTN.start);

    return {
      connected: true,
      up, down, left, right,
      attack: held(BTN.a) || held(BTN.x),
      attackPressed,
      actionPressed,
      itemPressed,
      cyclePressed,
      upPressed: dpadUpPressed || edgeStickUp,
      downPressed: dpadDownPressed || edgeStickDown,
      anyPressed:
        attackPressed || actionPressed || itemPressed || cyclePressed ||
        dpadUpPressed || dpadDownPressed || pressed(BTN.back) || fullscreenPressed,
      fullscreenPressed,
    };
  }
}

/**
 * Merge a pad reading over a keyboard snapshot. Either device can drive, and
 * holding a key while nudging a stick does not fight — a true from either side
 * wins.
 */
export function mergePad<T extends object>(keys: T, pad: PadState): T {
  if (!pad.connected) return keys;
  const merged: Record<string, unknown> = { ...(keys as Record<string, unknown>) };
  for (const [key, value] of Object.entries(pad)) {
    if (key === 'connected') continue;
    if (value === true && key in merged) merged[key] = true;
  }
  return merged as T;
}
