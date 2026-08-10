/**
 * Keyboard input.
 *
 * Held state is sampled by the simulation; edge-triggered presses are latched on
 * keydown and consumed once per simulation step, so a tap between two steps can
 * never be missed on a slow display or double-counted on a fast one.
 */

export interface InputSnapshot {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
  attackPressed: boolean;
  /** lift, carry and throw — Zelda's A button, separate from the sword */
  action: boolean;
  actionPressed: boolean;
  /** use the selected secondary item */
  itemPressed: boolean;
  /** cycle the selected item */
  cyclePressed: boolean;
  /** edge-triggered directions, for menu navigation where held keys would race */
  upPressed: boolean;
  downPressed: boolean;
  /** any key at all this step; used by "press any key" prompts */
  anyPressed: boolean;
  debugPressed: boolean;
  crtPressed: boolean;
  fullscreenPressed: boolean;
  /** debug: toggle walking through anything that would hurt you */
  invinciblePressed: boolean;
  /** open or close the menu */
  menuPressed: boolean;
}

/** Logical actions a key can map to. Not all of them expose a held state. */
type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'action' | 'item' | 'cycle';

const BINDINGS: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'attack', KeyJ: 'attack', Space: 'attack',
  KeyX: 'action', KeyK: 'action', KeyE: 'action',
  KeyC: 'item', KeyL: 'item', ShiftLeft: 'item',
  KeyQ: 'cycle', Tab: 'cycle',
};

export interface Input {
  /** Latch edges and return the state for this simulation step. */
  step(): InputSnapshot;
  destroy(): void;
}

export function createInput(target: Window = window): Input {
  const held = new Set<string>();
  let attackLatched = false;
  let actionLatched = false;
  let upLatched = false;
  let downLatched = false;
  let itemLatched = false;
  let cycleLatched = false;
  let anyLatched = false;
  let debugLatched = false;
  let crtLatched = false;
  let fullscreenLatched = false;
  let invinciblePressed = false;
  let menuLatched = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (BINDINGS[e.code] || e.code === 'F1' || e.code === 'F2') e.preventDefault();

    held.add(e.code);
    anyLatched = true;
    if (BINDINGS[e.code] === 'attack') attackLatched = true;
    if (BINDINGS[e.code] === 'action') actionLatched = true;
    if (BINDINGS[e.code] === 'up') upLatched = true;
    if (BINDINGS[e.code] === 'down') downLatched = true;
    if (BINDINGS[e.code] === 'item') itemLatched = true;
    if (BINDINGS[e.code] === 'cycle') cycleLatched = true;
    if (e.code === 'F1') debugLatched = true;
    if (e.code === 'F2') crtLatched = true;
    if (e.code === 'F3' || e.code === 'KeyF') fullscreenLatched = true;
    if (e.code === 'F4' || e.code === 'KeyI') invinciblePressed = true;
    if (e.code === 'Escape') menuLatched = true;
  };
  const onKeyUp = (e: KeyboardEvent): void => { held.delete(e.code); };
  // Losing focus mid-key would otherwise leave the player walking forever.
  const onBlur = (): void => { held.clear(); };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  const isHeld = (action: Action): boolean => {
    for (const code of held) if (BINDINGS[code] === action) return true;
    return false;
  };

  return {
    step() {
      const snap: InputSnapshot = {
        up: isHeld('up'),
        down: isHeld('down'),
        left: isHeld('left'),
        right: isHeld('right'),
        attack: isHeld('attack'),
        attackPressed: attackLatched,
        action: isHeld('action'),
        actionPressed: actionLatched,
        itemPressed: itemLatched,
        cyclePressed: cycleLatched,
        upPressed: upLatched,
        downPressed: downLatched,
        anyPressed: anyLatched,
        debugPressed: debugLatched,
        crtPressed: crtLatched,
        fullscreenPressed: fullscreenLatched,
        invinciblePressed,
        menuPressed: menuLatched,
      };
      fullscreenLatched = false;
      invinciblePressed = false;
      menuLatched = false;
      attackLatched = false;
      actionLatched = false;
      upLatched = false;
      downLatched = false;
      itemLatched = false;
      cycleLatched = false;
      anyLatched = false;
      debugLatched = false;
      crtLatched = false;
      return snap;
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
