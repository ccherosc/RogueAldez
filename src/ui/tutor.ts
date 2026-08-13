/**
 * Contextual teaching.
 *
 * A new player currently arrives knowing nothing and is told nothing. This is
 * the smallest system that fixes it without a tutorial level: a short list of
 * lessons, each with a condition that means *now is the moment to say this*, and
 * a condition that means *they have understood, stop saying it*.
 *
 * Three rules it holds to, which is why it is a system rather than a pile of
 * strings:
 *
 *   1. **Teach at the moment of use.** "X lifts" is meaningless in an empty
 *      field and obvious standing next to a pot. Every lesson waits for its
 *      situation rather than firing on a timer.
 *   2. **Stop the instant it is learned.** A prompt that repeats after the
 *      player has done the thing reads as nagging, and nagging is how a player
 *      learns to ignore your text.
 *   3. **Never block.** No modal, no pause, no keypress to dismiss. The game
 *      keeps running underneath and the prompt fades on its own.
 *
 * Learned flags live in the save, so a returning player is never taught to walk
 * again — but a *new* Draft still teaches anything they never got round to.
 */

export interface TutorSignals {
  moved: boolean;
  swung: boolean;
  lifted: boolean;
  usedItem: boolean;
  /** a breakable prop within reach */
  nearLiftable: boolean;
  /** an enemy within roughly a screen */
  enemyNear: boolean;
  /** standing still, shield up */
  bracing: boolean;
  /** the way down is on screen */
  exitVisible: boolean;
  hasBombs: boolean;
}

export interface Lesson {
  id: string;
  text: string;
  /** the moment this becomes worth saying */
  when(s: TutorSignals): boolean;
  /** the moment it has been understood */
  learned(s: TutorSignals): boolean;
  /** lower shows first when two lessons are ready at once */
  priority: number;
}

/**
 * Ordered by what a player needs first. Movement before combat, combat before
 * tools, tools before the exit — a lesson that arrives out of order is worse
 * than no lesson, because it competes with the one that mattered.
 */
export const LESSONS: readonly Lesson[] = [
  {
    id: 'move',
    text: 'arrows or wasd to walk',
    when: () => true,
    learned: (s) => s.moved,
    priority: 0,
  },
  {
    id: 'swing',
    text: 'z swings the sword',
    when: (s) => s.moved && (s.enemyNear || s.nearLiftable),
    learned: (s) => s.swung,
    priority: 1,
  },
  {
    id: 'spin',
    text: 'hold z for a spin',
    when: (s) => s.swung && s.enemyNear,
    learned: () => false, // optional flourish: shown once, never chased
    priority: 4,
  },
  {
    id: 'lift',
    text: 'x lifts and throws',
    when: (s) => s.nearLiftable && s.swung,
    learned: (s) => s.lifted,
    priority: 2,
  },
  {
    id: 'brace',
    text: 'stand still to raise the shield',
    when: (s) => s.enemyNear && s.swung,
    learned: (s) => s.bracing,
    priority: 3,
  },
  {
    id: 'item',
    text: 'c uses the item, q cycles',
    when: (s) => s.hasBombs && s.swung,
    learned: (s) => s.usedItem,
    priority: 3,
  },
  {
    id: 'exit',
    text: 'the way down',
    when: (s) => s.exitVisible,
    learned: () => false, // a label, not a lesson — it marks the thing
    priority: 5,
  },
];

/** Every lesson id — used to construct a Tutor that teaches nothing. */
export const LESSON_IDS: readonly string[] = LESSONS.map((l) => l.id);

/** How long a prompt stays up once shown, and how long before it may return. */
const SHOW_FRAMES = 200;
const FADE_FRAMES = 40;

export class Tutor {
  private learned: Set<string>;
  private activeId: string | null = null;
  private frames = 0;
  /** lessons shown this session, so an optional one appears once and stops */
  private shown = new Set<string>();

  constructor(learned: readonly string[] = []) {
    this.learned = new Set(learned);
  }

  /** Flags worth persisting: the player genuinely knows these now. */
  get known(): string[] {
    return [...this.learned];
  }

  update(signals: TutorSignals): void {
    // Retire anything the player has just demonstrated, including the prompt
    // currently on screen — the reward for doing it is that it goes away.
    for (const lesson of LESSONS) {
      if (lesson.learned(signals)) this.learned.add(lesson.id);
    }
    if (this.activeId && this.learned.has(this.activeId)) {
      this.activeId = null;
      this.frames = 0;
    }

    if (this.activeId) {
      this.frames++;
      if (this.frames > SHOW_FRAMES) {
        this.activeId = null;
        this.frames = 0;
      }
      return;
    }

    const next = LESSONS
      .filter((l) => !this.learned.has(l.id) && !this.shown.has(l.id) && l.when(signals))
      .sort((a, b) => a.priority - b.priority)[0];
    if (next) {
      this.activeId = next.id;
      this.frames = 0;
      // Optional lessons have no `learned` condition, so `shown` is what stops
      // them repeating for ever.
      if (!next.learned({ ...signals })) this.shown.add(next.id);
    }
  }

  /** The prompt to draw, and how opaque, or null. */
  current(): { text: string; alpha: number } | null {
    if (!this.activeId) return null;
    const lesson = LESSONS.find((l) => l.id === this.activeId);
    if (!lesson) return null;
    const remaining = SHOW_FRAMES - this.frames;
    const alpha = Math.min(1, Math.min(this.frames, remaining) / FADE_FRAMES);
    return { text: lesson.text, alpha: Math.max(0, alpha) * 0.9 };
  }
}
