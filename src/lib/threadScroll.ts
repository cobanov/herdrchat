/**
 * Where a thread's scroll position goes, decided in one place.
 *
 * A reader is either following the end of the conversation or reading it. Only
 * the reader moves between the two: a scroll they made, or something they did
 * that means "show me the end" (opening the thread, sending, the jump button).
 * Everything else, a message arriving, a bubble measuring taller than its
 * estimate, the composer growing, the app coming back to the front, only acts
 * on that choice: it keeps a follower at the end and leaves a reader where they
 * are.
 *
 * The screen used to spread this over four flags and five places that forced
 * the list to the end, and each fix for one case opened another: the app coming
 * to the front pulled a reader out of history, and a sent message stayed off
 * screen for anyone not already at the end.
 */

export type ScrollMode = 'following' | 'reading';

export type ScrollEvent =
  /** A scroll the reader made, by drag or by its momentum, at this distance from the end. */
  | { kind: 'readerScrolled'; distanceFromEnd: number }
  /** The content, the viewport or the controls over it changed size. */
  | { kind: 'resized' }
  /** The screen is in front again: focused after another route, or the app resumed. */
  | { kind: 'resumed' }
  /** The reader asked for the end: opened the thread, sent a message, tapped the jump button. */
  | { kind: 'wantsEnd' };

export interface ScrollStep {
  mode: ScrollMode;
  /** Whether the list should be put at its end now. */
  toEnd: boolean;
}

/** One transition. `slack` is how close to the end still counts as at it. */
export function scrollStep(mode: ScrollMode, event: ScrollEvent, slack: number): ScrollStep {
  switch (event.kind) {
    case 'readerScrolled':
      return { mode: event.distanceFromEnd <= slack ? 'following' : 'reading', toEnd: false };
    case 'resized':
    case 'resumed':
      return { mode, toEnd: mode === 'following' };
    case 'wantsEnd':
      return { mode: 'following', toEnd: true };
  }
}
