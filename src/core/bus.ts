/**
 * Event bus — the only sanctioned way for a subsystem to signal upward or
 * sideways across the layer boundaries in aldez-architecture.
 *
 * Events are plain past-tense data and must be safe to drop. Never put behaviour
 * in a payload, and never rely on handler ordering: if two things must happen in
 * order, that ordering belongs inside one subsystem, not in subscription order.
 */

export interface GameEvents {
  'player:moved': { x: number; y: number; dir: number };
  'player:damaged': { amount: number; knockX: number; knockY: number };
  'entity:damaged': { id: number; amount: number; knockX: number; knockY: number };
  'entity:died': { id: number; x: number; y: number };
  'room:changed': { rx: number; ry: number };
  'room:transition:started': { fromX: number; fromY: number; toX: number; toY: number };
  'room:transition:ended': { rx: number; ry: number };
  'prop:broken': { x: number; y: number; kind: string };
  'player:blocked': { x: number; y: number };
  'prop:lifted': { x: number; y: number; kind: string };
  'room:barred': { rx: number; ry: number };
  'room:cleared': { rx: number; ry: number };
  'chest:opened': { x: number; y: number };
  'item:used': { item: string; x: number; y: number };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export interface Bus {
  on<K extends EventName>(name: K, fn: Handler<K>): () => void;
  off<K extends EventName>(name: K, fn: Handler<K>): void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}

export function makeBus(): Bus {
  const handlers = new Map<EventName, Set<(p: never) => void>>();

  return {
    on(name, fn) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(fn as (p: never) => void);
      return () => this.off(name, fn);
    },

    off(name, fn) {
      handlers.get(name)?.delete(fn as (p: never) => void);
    },

    emit(name, payload) {
      const set = handlers.get(name);
      if (!set) return;
      // Copy before iterating so a handler may unsubscribe during dispatch.
      for (const fn of [...set]) (fn as (p: GameEvents[typeof name]) => void)(payload);
    },

    clear() {
      handlers.clear();
    },
  };
}

/** The one bus for the running game. */
export const bus: Bus = makeBus();
